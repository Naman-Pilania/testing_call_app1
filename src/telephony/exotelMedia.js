import { WebSocket, WebSocketServer } from "ws";

import { resamplePcm16 } from "../audio/pcm.js";
import {
  lookupPatientContext,
  getAvailableSlots,
  bookAppointment,
  saveCallLog,
} from "../db/database.js";
import {
  buildSystemPrompt,
  buildInitialGreetingPrompt,
  END_RULES,
} from "./promptBuilder.js";

const GEMINI_MODEL =
  process.env.GEMINI_MODEL || "gemini-3.1-flash-live-preview";

const GEMINI_VOICE = process.env.GEMINI_VOICE || "Vega";

const EXOTEL_RATE = 16000;
const GEMINI_INPUT_RATE = 16000;
const GEMINI_OUTPUT_RATE = 24000;

// 3,200 bytes = 100 ms of 16 kHz, 16-bit mono PCM.
const EXOTEL_FRAME_BYTES = 3200;
const EXOTEL_FRAME_INTERVAL_MS = 100;

const MAX_INPUT_QUEUE_CHUNKS = 100;
const MAX_OUTPUT_QUEUE_FRAMES = 100;

const SUPPORTED_RATES = [8000, 16000, 24000];
const SUPPORTED_ENCODINGS = ["audio/x-raw", "base64"];

export function registerExotelMedia(server) {
  const wss = new WebSocketServer({
    server,
    path: "/exotel/media",
    maxPayload: 2 * 1024 * 1024,
  });

  wss.on("connection", (exotel, req) => {
    console.log("🚀 ~ registerExotelMedia ~ req:", req)
    let gemini = null;
    let streamSid = null;
    let callSid = null;
    let inputRate = null;

    // Extract query parameters attached by outboundCalls router
    let targetPhone = null;
    let targetPatientId = null;

    try {
      console.log("🚀 ~ registerExotelMedia ~ req.url:", req.url)
      const parsedUrl = new URL(req.url, "http://localhost");
      targetPhone = parsedUrl.searchParams.get("phone");
      targetPatientId = parsedUrl.searchParams.get("patientId");
    } catch {}

    // Active DB context for this specific phone call
    let activeContext = null;

    let setupComplete = false;
    let closed = false;
    let endCallRequested = false;
    let endCallTimer = null;
    let outputTimer = null;

    let inputQueue = [];
    let outputBuffer = Buffer.alloc(0);
    let outputQueue = [];
    let assistantAudioBytesThisTurn = 0;

    function sendExotel(message) {
      if (exotel.readyState !== WebSocket.OPEN) return false;

      // Avoid flooding console on 100ms audio media frames
      if (message.event !== "media") {
        console.log("Outgoing Exotel event:", message.event);
      }
      exotel.send(JSON.stringify(message));
      return true;
    }

    function sendGemini(message) {
      if (gemini?.readyState !== WebSocket.OPEN) return false;

      gemini.send(JSON.stringify(message));
      return true;
    }

    function stopOutputPlayback() {
      if (outputTimer) {
        clearInterval(outputTimer);
        outputTimer = null;
      }

      outputQueue = [];
      outputBuffer = Buffer.alloc(0);
    }

    function cleanup() {
      if (closed) return;

      closed = true;

      if (endCallTimer) {
        clearTimeout(endCallTimer);
        endCallTimer = null;
      }

      if (outputTimer) {
        clearInterval(outputTimer);
        outputTimer = null;
      }

      inputQueue = [];
      outputQueue = [];
      outputBuffer = Buffer.alloc(0);

      if (
        gemini &&
        (gemini.readyState === WebSocket.OPEN ||
          gemini.readyState === WebSocket.CONNECTING)
      ) {
        gemini.close();
      }
    }

    function sendAudioToGemini(pcm) {
      if (closed || !pcm?.length) return;

      if (!setupComplete) {
        if (inputQueue.length < MAX_INPUT_QUEUE_CHUNKS) {
          inputQueue.push(pcm);
        }

        return;
      }

      sendGemini({
        realtimeInput: {
          audio: {
            data: pcm.toString("base64"),
            mimeType: `audio/pcm;rate=${GEMINI_INPUT_RATE}`,
          },
        },
      });
    }

    function scheduleCallEndAfterPlayback() {
      if (!endCallRequested || closed || endCallTimer) return;

      // Wait until the generated goodbye frames have played out of
      // the local queue before closing the Exotel media stream.
      if (outputQueue.length > 0 || outputBuffer.length > 0 || outputTimer) {
        endCallTimer = setTimeout(() => {
          endCallTimer = null;
          scheduleCallEndAfterPlayback();
        }, EXOTEL_FRAME_INTERVAL_MS);

        return;
      }

      console.log("Goodbye audio queue drained; ending Exotel stream", {
        callSid,
      });

      endTelephoneCall();
    }

    function startOutputPlayback() {
      if (outputTimer || closed) return;

      outputTimer = setInterval(() => {
        if (closed || exotel.readyState !== WebSocket.OPEN) {
          if (outputTimer) {
            clearInterval(outputTimer);
            outputTimer = null;
          }

          return;
        }

        const frame = outputQueue.shift();

        if (!frame) {
          clearInterval(outputTimer);
          outputTimer = null;

          if (endCallRequested) {
            scheduleCallEndAfterPlayback();
          }

          return;
        }

        sendExotel({
          event: "media",
          stream_sid: streamSid,
          media: {
            payload: frame.toString("base64"),
          },
        });
      }, EXOTEL_FRAME_INTERVAL_MS);
    }

    function queuePcmForCaller(pcm) {
      if (closed || !streamSid || !pcm?.length) return;

      outputBuffer = Buffer.concat([outputBuffer, pcm]);

      while (outputBuffer.length >= EXOTEL_FRAME_BYTES) {
        const frame = Buffer.from(outputBuffer.subarray(0, EXOTEL_FRAME_BYTES));

        outputBuffer = outputBuffer.subarray(EXOTEL_FRAME_BYTES);
        outputQueue.push(frame);
      }

      if (outputQueue.length > MAX_OUTPUT_QUEUE_FRAMES) {
        console.warn(
          "Outgoing audio backlog exceeded limit; clearing playback",
        );

        stopOutputPlayback();

        sendExotel({
          event: "clear",
          stream_sid: streamSid,
        });

        if (endCallTimer) {
          clearTimeout(endCallTimer);
          endCallTimer = null;
        }

        if (endCallRequested) {
          scheduleCallEndAfterPlayback();
        }

        return;
      }

      startOutputPlayback();
    }

    function finishAudioTurn() {
      if (closed || !streamSid) return;

      // Pad the final partial frame with silence.
      if (outputBuffer.length > 0) {
        const paddedFrame = Buffer.alloc(EXOTEL_FRAME_BYTES);
        outputBuffer.copy(paddedFrame);

        outputBuffer = Buffer.alloc(0);
        outputQueue.push(paddedFrame);
      }

      startOutputPlayback();

      if (endCallRequested) {
        scheduleCallEndAfterPlayback();
      }
    }

    function sendAudioToCaller(base64Audio) {
      if (closed || !streamSid) return;

      const geminiPcm = Buffer.from(base64Audio, "base64");

      if (geminiPcm.length === 0) return;

      // Resample Gemini 24 kHz to Exotel 16 kHz.
      const exotelPcm = resamplePcm16(
        geminiPcm,
        GEMINI_OUTPUT_RATE,
        EXOTEL_RATE,
      );

      assistantAudioBytesThisTurn += exotelPcm.length;
      queuePcmForCaller(exotelPcm);
    }

    function endTelephoneCall() {
      if (closed) return;

      console.log("AI requested call termination", { callSid });

      if (endCallTimer) {
        clearTimeout(endCallTimer);
        endCallTimer = null;
      }

      cleanup();

      if (
        exotel.readyState === WebSocket.OPEN ||
        exotel.readyState === WebSocket.CONNECTING
      ) {
        exotel.close(1000, "Assistant finished the call");
      }
    }

    function connectGemini() {
      if (gemini || closed) return;

      const key = process.env.GEMINI_API_KEY;

      if (!key) {
        console.error("GEMINI_API_KEY is missing");
        cleanup();

        if (exotel.readyState === WebSocket.OPEN) {
          exotel.close();
        }

        return;
      }

      // Step 1: Active DB Lookup for this call
      if (!activeContext) {
        activeContext = lookupPatientContext({
          phone: targetPhone || process.env.TEST_PHONE_NUMBER,
          patientId: targetPatientId,
        });
      }

      console.log("Initialized call with active DB context:", {
        patient: activeContext.patient.fullName,
        goal: activeContext.activeContext.callGoal,
        action: activeContext.activeContext.pendingAction,
      });

      // Step 2: Build dynamic system prompt with complete context
      const dynamicPrompt = buildSystemPrompt(activeContext) + END_RULES;

      const url = new URL(
        "wss://generativelanguage.googleapis.com/ws/" +
          "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent",
      );

      url.searchParams.set("key", key);

      gemini = new WebSocket(url.toString());

      gemini.on("open", () => {
        const model = GEMINI_MODEL.replace(/^models\//, "");

        gemini.send(
          JSON.stringify({
            setup: {
              model: `models/${model}`,
              generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: {
                      voiceName: GEMINI_VOICE,
                    },
                  },
                },
              },
              systemInstruction: {
                parts: [{ text: dynamicPrompt }],
              },
              tools: [
                {
                  functionDeclarations: [
                    {
                      name: "end_call",
                      description:
                        "Ends the current phone call after the assistant has spoken its goodbye.",
                      parameters: {
                        type: "OBJECT",
                        properties: {
                          reason: {
                            type: "STRING",
                            description: "Why the conversation is ending",
                          },
                        },
                        required: ["reason"],
                      },
                    },
                    {
                      name: "check_available_slots",
                      description:
                        "Queries the clinic database in real time for currently open appointment slots for a specific date or doctor.",
                      parameters: {
                        type: "OBJECT",
                        properties: {
                          date: {
                            type: "STRING",
                            description: "Date in YYYY-MM-DD format (optional)",
                          },
                          doctorId: {
                            type: "STRING",
                            description: "Doctor ID e.g. DOC-1 (optional)",
                          },
                        },
                      },
                    },
                    {
                      name: "book_appointment",
                      description:
                        "Books and confirms an appointment in the clinic database for the patient and reserves the slot.",
                      parameters: {
                        type: "OBJECT",
                        properties: {
                          patientId: {
                            type: "STRING",
                            description: "Patient ID e.g. PAT-1042",
                          },
                          doctorId: {
                            type: "STRING",
                            description: "Doctor ID e.g. DOC-1 (optional)",
                          },
                          date: {
                            type: "STRING",
                            description: "Date in YYYY-MM-DD format",
                          },
                          time: {
                            type: "STRING",
                            description: "Time slot e.g. '10:00 AM'",
                          },
                          treatmentType: {
                            type: "STRING",
                            description:
                              "Procedure or treatment name e.g. 'Permanent Crown Placement'",
                          },
                          notes: {
                            type: "STRING",
                            description: "Any special patient requests or notes",
                          },
                        },
                        required: ["patientId", "date", "time", "treatmentType"],
                      },
                    },
                    {
                      name: "lookup_patient_info",
                      description:
                        "Looks up active patient medical history, previous procedure details, clinical notes, and doctor information from the database.",
                      parameters: {
                        type: "OBJECT",
                        properties: {
                          phone: {
                            type: "STRING",
                            description: "Patient phone number (optional)",
                          },
                          patientId: {
                            type: "STRING",
                            description: "Patient unique ID (optional)",
                          },
                        },
                      },
                    },
                  ],
                },
              ],
              inputAudioTranscription: {},
              outputAudioTranscription: {},
            },
          }),
        );
      });

      gemini.on("message", (raw) => {
        let message;

        try {
          message = JSON.parse(raw.toString());
        } catch {
          console.warn("Received invalid Gemini message");
          return;
        }

        if (message.error) {
          console.error("Gemini API error:", message.error);
          cleanup();

          if (exotel.readyState === WebSocket.OPEN) {
            exotel.close();
          }

          return;
        }

        if (message.setupComplete) {
          setupComplete = true;

          console.log("Gemini session ready with complete active DB context");

          // Dynamic personalized initial greeting
          const initialGreeting = buildInitialGreetingPrompt(activeContext);

          sendGemini({
            realtimeInput: {
              text: initialGreeting,
            },
          });

          for (const chunk of inputQueue) {
            sendAudioToGemini(chunk);
          }

          inputQueue = [];
          return;
        }

        const content = message.serverContent;

        if (content?.interrupted) {
          stopOutputPlayback();

          sendExotel({
            event: "clear",
            stream_sid: streamSid,
          });

          assistantAudioBytesThisTurn = 0;
        }

        if (content?.inputTranscription?.text) {
          console.log("Caller:", content.inputTranscription.text);
        }

        if (content?.outputTranscription?.text) {
          console.log("Assistant:", content.outputTranscription.text);
        }

        // Forward generated synthetic audio parts to the caller
        for (const part of content?.modelTurn?.parts ?? []) {
          if (part.inlineData?.data) {
            sendAudioToCaller(part.inlineData.data);
          }
        }

        // Process function calls
        for (const call of message.toolCall?.functionCalls ?? []) {
          if (call.name === "end_call") {
            console.log("Gemini requested end_call:", {
              reason: call.args?.reason || "Conversation finished",
            });

            endCallRequested = true;

            if (activeContext) {
              saveCallLog({
                callSid,
                phone: activeContext.patient.phone,
                patientId: activeContext.patient.patientId,
                callReason: activeContext.activeContext.callReason,
                outcome: "COMPLETED",
                notes: call.args?.reason || "Call completed naturally",
              });
            }
          } else if (call.name === "check_available_slots") {
            console.log("Gemini requested check_available_slots:", call.args);

            const slots = getAvailableSlots({
              doctorId: call.args?.doctorId || activeContext?.doctor.doctorId,
              date: call.args?.date,
            });

            sendGemini({
              toolResponse: {
                functionResponses: [
                  {
                    id: call.id,
                    response: {
                      output: {
                        success: true,
                        dateQueried: call.args?.date || "all upcoming",
                        availableSlots: slots,
                        count: slots.length,
                        message:
                          slots.length > 0
                            ? `Found ${slots.length} open slots.`
                            : "No open slots on that date, please suggest alternative dates.",
                      },
                    },
                  },
                ],
              },
            });
          } else if (call.name === "book_appointment") {
            console.log("Gemini requested book_appointment:", call.args);

            const booking = bookAppointment({
              patientId:
                call.args?.patientId || activeContext?.patient.patientId,
              doctorId:
                call.args?.doctorId || activeContext?.doctor.doctorId,
              date: call.args?.date,
              time: call.args?.time,
              treatmentType:
                call.args?.treatmentType ||
                activeContext?.activeContext.pendingAction,
              notes: call.args?.notes || "Booked by Maya AI voice assistant",
            });

            sendGemini({
              toolResponse: {
                functionResponses: [
                  {
                    id: call.id,
                    response: {
                      output: {
                        success: true,
                        appointmentId: booking.appointmentId,
                        confirmedDate: booking.date,
                        confirmedTime: booking.time,
                        doctor: activeContext?.doctor.name || "Clinic Doctor",
                        message: `Appointment ${booking.appointmentId} confirmed for ${booking.date} at ${booking.time}.`,
                      },
                    },
                  },
                ],
              },
            });
          } else if (call.name === "lookup_patient_info") {
            console.log("Gemini requested lookup_patient_info:", call.args);

            const refreshed = lookupPatientContext({
              phone: call.args?.phone || activeContext?.patient.phone,
              patientId:
                call.args?.patientId || activeContext?.patient.patientId,
            });

            sendGemini({
              toolResponse: {
                functionResponses: [
                  {
                    id: call.id,
                    response: {
                      output: {
                        success: true,
                        patient: refreshed.patient,
                        activeContext: refreshed.activeContext,
                        assignedDoctor: refreshed.doctor,
                      },
                    },
                  },
                ],
              },
            });
          } else {
            console.warn("Unknown Gemini function:", call.name);
          }
        }

        if (content?.turnComplete) {
          finishAudioTurn();
          assistantAudioBytesThisTurn = 0;
        }
      });

      gemini.on("error", (error) => {
        console.error("Gemini WebSocket error:", error.message);
        cleanup();

        if (exotel.readyState === WebSocket.OPEN) {
          exotel.close();
        }
      });

      gemini.on("close", (code) => {
        console.log("Gemini session closed:", code);
      });
    }

    exotel.on("message", (raw) => {
      if (closed) return;

      let message;

      try {
        message = JSON.parse(raw.toString());
      } catch {
        console.warn("Invalid Exotel event");
        return;
      }

      switch (message.event) {
        case "connected": {
          console.log("Exotel WebSocket connected");
          break;
        }

        case "start": {
          const start = message.start ?? {};

          streamSid =
            start.stream_sid || start.streamSid || message.stream_sid || null;

          callSid = start.call_sid || start.callSid || null;

          const format =
            start.media_format ??
            start.mediaFormat ??
            message.media_format ??
            {};

          inputRate = Number(
            format.sample_rate ?? format.sampleRate ?? EXOTEL_RATE,
          );

          console.log("Exotel call started", {
            streamSid,
            callSid,
            mediaFormat: format,
          });

          if (
            !SUPPORTED_ENCODINGS.includes(format.encoding) ||
            !SUPPORTED_RATES.includes(inputRate)
          ) {
            console.error("Unsupported Exotel media format", format);
            cleanup();

            if (exotel.readyState === WebSocket.OPEN) {
              exotel.close(1011, "Unsupported audio format");
            }

            return;
          }

          console.log("Accepted Exotel PCM stream", {
            encoding: format.encoding,
            sampleRate: inputRate,
            bitRate: format.bit_rate ?? format.bitRate ?? null,
          });

          connectGemini();
          break;
        }

        case "media": {
          if (!message.media?.payload || !inputRate) break;

          const pcm = Buffer.from(message.media.payload, "base64");

          if (pcm.length === 0) break;

          const geminiPcm = resamplePcm16(pcm, inputRate, GEMINI_INPUT_RATE);

          sendAudioToGemini(geminiPcm);
          break;
        }

        case "dtmf": {
          console.log("Caller pressed a key:", message.dtmf?.digit);
          break;
        }

        case "mark": {
          break;
        }

        case "stop": {
          console.log("Exotel stream stopped", { callSid });
          cleanup();
          break;
        }

        default: {
          console.log("Unhandled Exotel event:", message.event);
        }
      }
    });

    exotel.on("close", () => {
      console.log("Exotel WebSocket closed", { callSid });
      cleanup();
    });

    exotel.on("error", (error) => {
      console.error("Exotel WebSocket error:", error.message);
      cleanup();
    });
  });

  return wss;
}
