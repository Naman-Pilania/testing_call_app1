import { WebSocket, WebSocketServer } from "ws";

import { resamplePcm16 } from "../audio/pcm.js";
import { getFillerAudio } from "../audio/fillers.js";
import {
  getDb,
  lookupPatientContext,
  getAvailableSlots,
  bookAppointment,
  createPatient,
  saveCallLog,
} from "../db/database.js";
import {
  buildSystemPrompt,
  buildInitialGreetingPrompt,
  END_RULES,
} from "./promptBuilder.js";
import { resolveCallContext } from "./callRegistry.js";
import { claimPrewarmedSession } from "./geminiPrewarm.js";
import { GEMINI_TOOLS } from "./geminiTools.js";

const GEMINI_MODEL =
  process.env.GEMINI_MODEL || "gemini-3.1-flash-live-preview";

const GEMINI_VOICE = process.env.GEMINI_VOICE || "Puck";

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

const NON_NAME_STOP_WORDS = new Set([
  "good",
  "fine",
  "ok",
  "okay",
  "great",
  "well",
  "bad",
  "sick",
  "suffering",
  "having",
  "feeling",
  "calling",
  "looking",
  "trying",
  "wondering",
  "asking",
  "speaking",
  "here",
  "there",
  "back",
  "sorry",
  "yes",
  "no",
  "not",
  "just",
  "doing",
  "patient",
  "someone",
  "doctor",
  "sure",
  "listening",
  "free",
  "interested",
  "available",
  "ready",
  "scheduled",
  "confirming",
  "waiting",
  "a",
  "an",
  "the",
  "in",
  "at",
  "to",
  "for",
  "with",
  "from",
]);

function isNonName(str) {
  const words = str.toLowerCase().split(/\s+/);
  return words.some((w) => NON_NAME_STOP_WORDS.has(w));
}

function formatName(raw) {
  return raw
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Extracts a caller's stated name from conversational dialogue turns.
 * Matches phrases like "I am Aman", "My name is Aman", "This is Aman Gupta", "Aman here".
 */
export function extractCallerName(text) {
  if (!text || typeof text !== "string") return null;

  const myNameMatch = text.match(
    /(?:my name is|myself)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i,
  );
  if (myNameMatch) {
    const raw = myNameMatch[1].trim();
    if (!isNonName(raw)) return formatName(raw);
  }

  const thisIsMatch = text.match(/(?:this is)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i);
  if (thisIsMatch) {
    const raw = thisIsMatch[1].trim();
    if (!isNonName(raw)) return formatName(raw);
  }

  const iAmMatch = text.match(/(?:i am|i'm)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i);
  if (iAmMatch) {
    const raw = iAmMatch[1].trim();
    if (!isNonName(raw)) return formatName(raw);
  }

  const hereMatch = text.match(/^([a-zA-Z]+(?:\s+[a-zA-Z]+)?)\s+here/i);
  if (hereMatch) {
    const raw = hereMatch[1].trim();
    if (!isNonName(raw)) return formatName(raw);
  }

  return null;
}

export function registerExotelMedia(server) {
  const wss = new WebSocketServer({
    server,
    path: "/exotel/media",
    maxPayload: 2 * 1024 * 1024,
  });

  wss.on("connection", (exotel, req) => {
    let gemini = null;
    let streamSid = null;
    let callSid = null;
    let inputRate = null;

    // Extract query parameters attached by router or telephony provider
    let targetPhone = null;
    let targetPatientId = null;
    let queryDirection = null;

    try {
      const parsedUrl = new URL(req.url, "http://localhost");
      targetPhone = parsedUrl.searchParams.get("phone") || parsedUrl.searchParams.get("From");
      targetPatientId = parsedUrl.searchParams.get("patientId");
      queryDirection = parsedUrl.searchParams.get("direction");
    } catch {}

    // Active DB context for this specific phone call
    let activeContext = null;

    let setupComplete = false;
    let closed = false;
    let endCallRequested = false;
    let endCallRequestedReason = "";
    let endCallTimer = null;
    let outputTimer = null;

    let inputQueue = [];
    let outputBuffer = Buffer.alloc(0);
    let outputQueue = [];
    let assistantAudioBytesThisTurn = 0;

    // Live conversation dialogue tracking & appointment capture
    const callStartTime = Date.now();
    const transcriptTurns = []; // { speaker: string, text: string, time: string }
    let currentCallerText = "";
    let currentAssistantText = "";
    const bookedAppointments = [];
    let callLogFinalized = false;

    function formatTimestamp(ms) {
      const totalSecs = Math.max(0, Math.floor(ms / 1000));
      const mins = String(Math.floor(totalSecs / 60)).padStart(2, "0");
      const secs = String(totalSecs % 60).padStart(2, "0");
      return `${mins}:${secs}`;
    }

    /**
     * Automatically creates a patient record in the database if the caller introduces themselves
     * and their profile was previously unnamed or generic ("Valued Patient" / "NEW-xxxx").
     */
    function handleCallerNameDetection(text) {
      if (!text || !activeContext) return;

      const currentName = activeContext.patient?.fullName;
      const isUnnamed =
        !currentName ||
        currentName === "Valued Patient" ||
        currentName === "New Hospital Patient" ||
        (activeContext.patient?.patientId &&
          activeContext.patient.patientId.startsWith("NEW"));

      if (!isUnnamed) return;

      const detectedName = extractCallerName(text);
      if (!detectedName) return;

      console.log(
        `[ExotelMedia] Detected caller introducing themselves as: "${detectedName}"`,
      );

      try {
        const phone =
          activeContext.patient?.phone ||
          targetPhone ||
          process.env.TEST_PHONE_NUMBER ||
          "+918218627040";

        const newPatient = createPatient({
          fullName: detectedName,
          preferredName: detectedName.split(" ")[0],
          phone,
          assignedDoctorId: activeContext.doctor?.doctorId || "DOC-MED",
          generalNotes: `Registered from spoken voice introduction during live call`,
          activeContext: {
            callGoal: "NEW_PATIENT_APPOINTMENT",
            callReason: "New patient consultation inquiry",
            pendingAction: `Schedule initial consultation with ${activeContext.doctor?.name || "Doctor"}`,
          },
        });

        activeContext.patient.patientId = newPatient.patientId;
        activeContext.patient.fullName = newPatient.fullName;
        activeContext.patient.preferredName = newPatient.preferredName;
        targetPatientId = newPatient.patientId;

        saveCallLog({
          callSid: callSid || `EXO-${Date.now()}`,
          phone,
          patientId: newPatient.patientId,
          direction: activeContext?.direction || "INBOUND",
          callReason:
            activeContext.activeContext?.callReason || (activeContext?.direction === "INBOUND" ? "Inbound Patient Call" : "Hospital Follow-up Call"),
          outcome: "IN_PROGRESS",
          notes: `Identified and registered caller: ${newPatient.fullName} (${newPatient.patientId})`,
        });

        console.log(
          `[ExotelMedia] Successfully registered caller as patient: ${newPatient.patientId} (${newPatient.fullName})`,
        );
      } catch (err) {
        console.error(
          "[ExotelMedia] Auto-registration from spoken name failed:",
          err.message,
        );
      }
    }

    function flushCallerTurn() {
      if (currentCallerText.trim()) {
        handleCallerNameDetection(currentCallerText);
        const elapsed = Date.now() - callStartTime;
        transcriptTurns.push({
          speaker: "Patient",
          text: currentCallerText.trim(),
          time: formatTimestamp(elapsed),
        });
        currentCallerText = "";
      }
    }

    function flushAssistantTurn() {
      if (currentAssistantText.trim()) {
        const elapsed = Date.now() - callStartTime;
        transcriptTurns.push({
          speaker: "Maya (AI)",
          text: currentAssistantText.trim(),
          time: formatTimestamp(elapsed),
        });
        currentAssistantText = "";
      }
    }

    function finalizeCallLog(reason = "Call finished") {
      if (callLogFinalized) return;
      callLogFinalized = true;

      flushAssistantTurn();
      flushCallerTurn();

      const formattedTranscript =
        transcriptTurns.length > 0
          ? transcriptTurns
              .map((t) => `[${t.time}] ${t.speaker}: ${t.text}`)
              .join("\n")
          : `[00:00] Maya (AI): Call connected and completed.`;

      let outcome = "COMPLETED";
      let notes = endCallRequestedReason || reason;

      if (bookedAppointments.length > 0) {
        outcome = "APPOINTMENT_SCHEDULED";
        notes = `Booked appointment (${bookedAppointments
          .map((b) => `${b.appointmentId} on ${b.date} at ${b.time}`)
          .join("; ")}) via Maya AI voice assistant.`;
      }

      let finalPatientId =
        activeContext?.patient?.patientId || targetPatientId || null;
      const finalPhone =
        activeContext?.patient?.phone ||
        targetPhone ||
        process.env.TEST_PHONE_NUMBER ||
        "+918218627040";
      const finalDirection = activeContext?.direction || "OUTBOUND";
      const finalReason =
        activeContext?.activeContext?.callReason ||
        (finalDirection === "INBOUND" ? "Inbound Consultation Inquiry" : "Outbound Hospital Follow-up");
      const finalSid = callSid || `EXO-${Date.now()}`;

      // If still a generic or temporary patient ID, extract caller's name from transcript as fallback
      if (!finalPatientId || finalPatientId.startsWith("NEW")) {
        const fullTranscript = transcriptTurns.map((t) => t.text).join(" ");
        const extracted = extractCallerName(fullTranscript);
        if (extracted) {
          try {
            const p = createPatient({
              fullName: extracted,
              preferredName: extracted.split(" ")[0],
              phone: finalPhone,
              assignedDoctorId: activeContext?.doctor?.doctorId || "DOC-MED",
              generalNotes:
                "Registered upon call completion from conversation transcript",
              activeContext: {
                callGoal: "NEW_PATIENT_APPOINTMENT",
                callReason: finalReason,
                pendingAction: "Complete hospital intake",
              },
            });
            finalPatientId = p.patientId;
            notes = `Caller identified as ${p.fullName} (${p.patientId}). ${notes}`;
            console.log(
              `[ExotelMedia] Post-call auto-registered caller: ${p.fullName} (${p.patientId})`,
            );
          } catch (e) {
            console.warn(
              "[ExotelMedia] Failed post-call auto-registration:",
              e.message,
            );
          }
        }
      }

      console.log("[ExotelMedia] Finalizing and saving call log:", {
        callSid: finalSid,
        patientId: finalPatientId,
        outcome,
        turnsCount: transcriptTurns.length,
        notes,
      });

      try {
        saveCallLog({
          callSid: finalSid,
          phone: finalPhone,
          patientId: finalPatientId,
          direction: finalDirection,
          callReason: finalReason,
          outcome,
          notes,
          transcriptSummary: formattedTranscript,
        });
      } catch (err) {
        console.error("Failed to save final call log:", err.message);
      }
    }

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

      // Save final call transcript and outcome to DB
      finalizeCallLog("Call finished");

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

    /**
     * Binds full bidirectional event listeners to the Gemini WebSocket.
     * Works with both freshly created connections and pre-warmed sessions.
     */
    function attachGeminiListeners(ws) {
      ws.on("message", (raw) => {
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
          flushAssistantTurn();
          flushCallerTurn();

          sendExotel({
            event: "clear",
            stream_sid: streamSid,
          });

          assistantAudioBytesThisTurn = 0;
        }

        // Live transcription tracking
        if (content?.inputTranscription?.text) {
          flushAssistantTurn();
          currentCallerText += content.inputTranscription.text;
          console.log("Caller:", content.inputTranscription.text);

          handleCallerNameDetection(currentCallerText);
        }

        if (content?.outputTranscription?.text) {
          flushCallerTurn();
          currentAssistantText += content.outputTranscription.text;
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
            endCallRequestedReason =
              call.args?.reason || "Call completed naturally";

            // Acknowledge function call to Gemini
            sendGemini({
              toolResponse: {
                functionResponses: [
                  {
                    id: call.id,
                    response: {
                      output: {
                        success: true,
                        message: "Call conclusion acknowledged.",
                      },
                    },
                  },
                ],
              },
            });

            // Fallback safety check: Did Gemini imply an appointment was booked without calling book_appointment?
            const reasonText = (call.args?.reason || "").toLowerCase();
            const turnsText = transcriptTurns
              .map((t) => t.text)
              .join(" ")
              .toLowerCase();
            const impliedBooking =
              reasonText.includes("book") ||
              reasonText.includes("schedul") ||
              reasonText.includes("appoint") ||
              turnsText.includes("reserved") ||
              turnsText.includes("booked for");

            if (
              bookedAppointments.length === 0 &&
              impliedBooking &&
              activeContext?.availableSlots?.length > 0
            ) {
              console.warn(
                "⚠️ AI indicated appointment was booked but missed book_appointment tool call. Auto-booking first matching slot...",
              );
              try {
                const fallbackSlot = activeContext.availableSlots[0];
                const autoBooking = bookAppointment({
                  patientId: activeContext.patient.patientId,
                  doctorId: activeContext.doctor.doctorId,
                  date: fallbackSlot.date,
                  time: fallbackSlot.time,
                  treatmentType: activeContext.activeContext.pendingAction,
                  notes: `Auto-recorded from call conversation: ${endCallRequestedReason}`,
                });
                bookedAppointments.push(autoBooking);
                console.log("✅ Fallback booking recorded:", autoBooking);
              } catch (e) {
                console.error("Failed fallback booking:", e.message);
              }
            }
          } else if (call.name === "check_available_slots") {
            console.log("Gemini requested check_available_slots:", call.args);

            // Play conversational filler audio immediately to keep caller engaged
            const filler = getFillerAudio("checking_slots");
            if (filler && outputQueue.length === 0) {
              console.log("[ExotelMedia] Playing checking_slots filler audio");
              queuePcmForCaller(filler);
            }

            const slots = getAvailableSlots({
              doctorId:
                call.args?.doctorId ||
                (call.args?.department
                  ? undefined
                  : activeContext?.doctor.doctorId),
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
                        departmentQueried:
                          call.args?.department ||
                          activeContext?.doctor.department ||
                          "All",
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

            // Play conversational filler audio immediately so caller knows booking is occurring
            const filler = getFillerAudio("booking");
            if (filler && outputQueue.length === 0) {
              console.log("[ExotelMedia] Playing booking filler audio");
              queuePcmForCaller(filler);
            }

            try {
              const patientIdToBook =
                call.args?.patientId || activeContext?.patient.patientId;
              const doctorIdToBook =
                call.args?.doctorId ||
                activeContext?.doctor.doctorId ||
                "DOC-MED";
              const departmentToBook =
                call.args?.department ||
                activeContext?.doctor.department ||
                "General Medicine";

              let dateToBook = call.args?.date;
              let timeToBook = call.args?.time;

              // Smart date resolution: if relative or missing, resolve from availableSlots
              if (!dateToBook || !/^\d{4}-\d{2}-\d{2}$/.test(dateToBook)) {
                if (activeContext?.availableSlots?.length > 0) {
                  dateToBook = activeContext.availableSlots[0].date;
                } else {
                  const tomorrow = new Date();
                  tomorrow.setDate(tomorrow.getDate() + 1);
                  dateToBook = tomorrow.toISOString().split("T")[0];
                }
              }

              if (!timeToBook) {
                if (activeContext?.availableSlots?.length > 0) {
                  timeToBook = activeContext.availableSlots[0].time;
                } else {
                  timeToBook = "10:00 AM";
                }
              }

              const treatmentTypeToBook =
                call.args?.treatmentType ||
                activeContext?.activeContext.pendingAction ||
                "Clinical Follow-up Consultation";

              const resolvedPatientName =
                call.args?.patientName ||
                (activeContext?.patient?.fullName !== "Valued Patient" &&
                activeContext?.patient?.fullName !== "New Hospital Patient"
                  ? activeContext?.patient?.fullName
                  : null);

              const booking = bookAppointment({
                patientId: patientIdToBook,
                patientName: resolvedPatientName,
                phone:
                  activeContext?.patient?.phone ||
                  targetPhone ||
                  process.env.TEST_PHONE_NUMBER,
                doctorId: doctorIdToBook,
                department: departmentToBook,
                date: dateToBook,
                time: timeToBook,
                treatmentType: treatmentTypeToBook,
                notes:
                  call.args?.notes ||
                  "Booked by Maya AI voice assistant during live hospital call",
              });

              if (booking.patientId) {
                targetPatientId = booking.patientId;
                if (activeContext?.patient) {
                  activeContext.patient.patientId = booking.patientId;
                  if (
                    resolvedPatientName &&
                    (!activeContext.patient.fullName ||
                      activeContext.patient.fullName === "Valued Patient")
                  ) {
                    activeContext.patient.fullName = resolvedPatientName;
                    activeContext.patient.preferredName =
                      resolvedPatientName.split(" ")[0];
                  }
                }
              }

              console.log(
                "✅ Successfully recorded appointment in SQLite database:",
                booking,
              );
              bookedAppointments.push(booking);

              // Update call log in real time with appointment status
              saveCallLog({
                callSid: callSid || `EXO-${Date.now()}`,
                phone:
                  activeContext?.patient.phone || process.env.TEST_PHONE_NUMBER,
                patientId:
                  booking.patientId || activeContext?.patient.patientId,
                callReason: activeContext?.activeContext.callReason,
                outcome: "APPOINTMENT_SCHEDULED",
                notes: `Appointment ${booking.appointmentId} confirmed for ${booking.date} at ${booking.time}`,
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
                          message: `Appointment ${booking.appointmentId} confirmed for ${booking.date} at ${booking.time} with ${activeContext?.doctor.name || "Dr. Sneha Rao"}.`,
                        },
                      },
                    },
                  ],
                },
              });
            } catch (bookingErr) {
              console.error(
                "❌ Failed to book appointment in database:",
                bookingErr,
              );
              sendGemini({
                toolResponse: {
                  functionResponses: [
                    {
                      id: call.id,
                      response: {
                        output: {
                          success: false,
                          error: bookingErr.message,
                          message:
                            "Failed to record appointment in database. Please ask caller for another time or confirm with reception.",
                        },
                      },
                    },
                  ],
                },
              });
            }
          } else if (call.name === "register_new_patient") {
            console.log("Gemini requested register_new_patient:", call.args);

            // Play conversational filler audio immediately to keep caller engaged
            const filler = getFillerAudio("registering");
            if (filler && outputQueue.length === 0) {
              console.log("[ExotelMedia] Playing registering filler audio");
              queuePcmForCaller(filler);
            }

            try {
              const fullName =
                call.args?.fullName?.trim() ||
                (activeContext?.patient?.fullName !== "Valued Patient" &&
                activeContext?.patient?.fullName !== "New Hospital Patient"
                  ? activeContext?.patient?.fullName
                  : "New Hospital Patient");
              const preferredName =
                call.args?.preferredName?.trim() || fullName.split(" ")[0];
              const phone =
                call.args?.phone ||
                activeContext?.patient?.phone ||
                targetPhone ||
                process.env.TEST_PHONE_NUMBER ||
                "+918218627040";
              const department = call.args?.department || "General Medicine";
              const reason =
                call.args?.reason || "New patient consultation inquiry";

              // Find doctor for this department
              const db = getDb();
              const doc =
                db
                  .prepare(
                    "SELECT * FROM doctors WHERE LOWER(department) LIKE ? LIMIT 1",
                  )
                  .get(`%${department.toLowerCase().slice(0, 4)}%`) ||
                db.prepare("SELECT * FROM doctors LIMIT 1").get();

              const newPatient = createPatient({
                fullName,
                preferredName,
                phone,
                age: call.args?.age ? Number(call.args.age) : null,
                gender: call.args?.gender || "Other",
                assignedDoctorId: doc?.doctor_id || "DOC-MED",
                medicalAlerts: Array.isArray(call.args?.medicalAlerts)
                  ? call.args.medicalAlerts
                  : [],
                insurancePlan: "Standard Hospital Care",
                generalNotes: `Registered during live Maya AI call. Reason: ${reason}`,
                activeContext: {
                  callGoal: "NEW_PATIENT_APPOINTMENT",
                  callReason: reason,
                  lastVisitDate: new Date().toISOString().split("T")[0],
                  lastVisitProcedure: "New Patient Telephony Registration",
                  lastVisitDoctor: doc?.name || "Dr. Vikram Mehta",
                  lastVisitOutcome:
                    "New patient profile successfully registered via voice assistant",
                  pendingAction: `Schedule initial ${department} consultation with ${doc?.name || "Specialist"}`,
                  recommendedDurationMinutes: 30,
                  urgency: "MEDIUM",
                },
              });

              // Update session activeContext so all subsequent queries / bookings link to this new patient
              activeContext = lookupPatientContext({
                patientId: newPatient.patientId,
              });
              targetPatientId = newPatient.patientId;

              // Update call log with new patient ID
              saveCallLog({
                callSid: callSid || `EXO-${Date.now()}`,
                phone,
                patientId: newPatient.patientId,
                callReason: reason,
                outcome: "IN_PROGRESS",
                notes: `Registered new patient: ${newPatient.fullName} (${newPatient.patientId}) - Department: ${department}`,
              });

              console.log(
                "✅ Registered new patient in hospital database:",
                newPatient,
              );

              sendGemini({
                toolResponse: {
                  functionResponses: [
                    {
                      id: call.id,
                      response: {
                        output: {
                          success: true,
                          patientId: newPatient.patientId,
                          fullName: newPatient.fullName,
                          department: doc?.department || department,
                          assignedDoctor: doc?.name,
                          message: `Patient ${newPatient.fullName} successfully registered in ${doc?.department || department} Department with ${doc?.name}. You can now check open slots or book their appointment.`,
                        },
                      },
                    },
                  ],
                },
              });
            } catch (regErr) {
              console.error("❌ Failed to register new patient:", regErr);
              sendGemini({
                toolResponse: {
                  functionResponses: [
                    {
                      id: call.id,
                      response: {
                        output: {
                          success: false,
                          error: regErr.message,
                          message:
                            "Could not register patient record. Proceeding with temporary booking details.",
                        },
                      },
                    },
                  ],
                },
              });
            }
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
          flushAssistantTurn();
          flushCallerTurn();
          finishAudioTurn();
          assistantAudioBytesThisTurn = 0;
        }
      });

      ws.on("error", (error) => {
        console.error("Gemini WebSocket error:", error.message);
        cleanup();

        if (exotel.readyState === WebSocket.OPEN) {
          exotel.close();
        }
      });

      ws.on("close", (code) => {
        console.log("Gemini session closed:", code);
        finalizeCallLog("Gemini session ended");
      });
    }

    /**
     * Connects to Gemini Live fresh if no pre-warmed session was found.
     */
    function connectGeminiFresh() {
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
              tools: GEMINI_TOOLS,
              inputAudioTranscription: {},
              outputAudioTranscription: {},
            },
          }),
        );
      });

      attachGeminiListeners(gemini);
    }

    /**
     * Resolves Gemini connection by claiming a pre-warmed session (zero-latency)
     * or falling back to connectGeminiFresh().
     */
    function initGeminiConnection() {
      if (gemini || closed) return;

      // 1. Ensure active DB context is resolved
      if (!activeContext) {
        activeContext = resolveCallContext({
          callSid,
          patientId: targetPatientId,
          phone: targetPhone,
        });
      }

      console.log("Initialized call with active DB context:", {
        callSid,
        patient: activeContext.patient.fullName,
        patientId: activeContext.patient.patientId,
        goal: activeContext.activeContext.callGoal,
        action: activeContext.activeContext.pendingAction,
      });

      // 2. Check if a pre-warmed session is available
      const prewarmed = claimPrewarmedSession({
        callSid,
        patientId: targetPatientId || activeContext.patient.patientId,
        phone: targetPhone || activeContext.patient.phone,
      });

      if (
        prewarmed &&
        (prewarmed.ws.readyState === WebSocket.OPEN ||
          prewarmed.ws.readyState === WebSocket.CONNECTING)
      ) {
        console.log(
          `[ExotelMedia] CLAIMED pre-warmed Gemini session ${prewarmed.id} for callSid '${callSid}'! Zero connect delay.`,
        );

        gemini = prewarmed.ws;
        setupComplete = prewarmed.ready;

        if (prewarmed.activeContext) {
          activeContext = prewarmed.activeContext;
        }

        attachGeminiListeners(gemini);

        // Immediately stream early audio chunks buffered during pre-warming
        if (prewarmed.earlyAudioChunks?.length > 0) {
          console.log(
            `[ExotelMedia] Streaming ${prewarmed.earlyAudioChunks.length} pre-warmed audio chunks to caller!`,
          );
          for (const chunk of prewarmed.earlyAudioChunks) {
            sendAudioToCaller(chunk);
          }
        }

        if (prewarmed.earlyAssistantText) {
          currentAssistantText += prewarmed.earlyAssistantText;
        }

        // If setup was completed during pre-warming but initial greeting wasn't sent yet
        if (setupComplete && !prewarmed.greetingSent) {
          const initialGreeting = buildInitialGreetingPrompt(activeContext);
          sendGemini({
            realtimeInput: {
              text: initialGreeting,
            },
          });
        }

        return;
      }

      // Fallback: connect fresh
      console.log(
        "[ExotelMedia] No pre-warmed session available; connecting fresh to Gemini...",
      );
      connectGeminiFresh();
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

          callSid = start.call_sid || start.callSid || message.call_sid || `EXO-${Date.now()}`;

          const customField =
            start.custom_field ||
            start.customField ||
            message.custom_field ||
            message.customField ||
            null;

          // Determine call direction
          let detectedDirection = (queryDirection || start.direction || message.direction)?.toUpperCase();
          if (!detectedDirection) {
            if (customField && /inbound/i.test(customField)) {
              detectedDirection = "INBOUND";
            } else if (
              start.from &&
              start.to &&
              process.env.EXOTEL_CALLER_ID &&
              (start.to.includes(process.env.EXOTEL_CALLER_ID) || process.env.EXOTEL_CALLER_ID.includes(start.to))
            ) {
              detectedDirection = "INBOUND";
            } else {
              detectedDirection = "OUTBOUND";
            }
          }

          const callerPhone =
            (detectedDirection === "INBOUND" ? (start.from || targetPhone) : targetPhone) ||
            targetPhone ||
            start.from ||
            process.env.TEST_PHONE_NUMBER;

          // Resolve the EXACT patient context using all available correlation signals:
          activeContext = resolveCallContext({
            callSid,
            customField,
            patientId: targetPatientId,
            phone: callerPhone,
            direction: detectedDirection,
          });
          activeContext.direction = detectedDirection;

          console.log("[ExotelMedia] Active context resolved:", {
            callSid,
            direction: detectedDirection,
            customField,
            patient: activeContext.patient.fullName,
            patientId: activeContext.patient.patientId,
            doctor: activeContext.doctor.name,
            goal: activeContext.activeContext.callGoal,
          });

          // Immediately save call as IN_PROGRESS in call_logs table
          saveCallLog({
            callSid,
            phone: activeContext.patient.phone,
            patientId: activeContext.patient.patientId,
            direction: detectedDirection,
            callReason: activeContext.activeContext.callReason,
            outcome: "IN_PROGRESS",
            notes: `${detectedDirection === "INBOUND" ? "Inbound call answered" : "Call connected"} with ${activeContext.patient.fullName} (${activeContext.patient.patientId})`,
            transcriptSummary: `[00:00] Maya (AI): ${detectedDirection === "INBOUND" ? "Inbound call answered" : "Call connected"} with ${activeContext.patient.fullName}.`,
          });

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

          initGeminiConnection();
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
