import { WebSocket, WebSocketServer } from "ws";

import { resamplePcm16 } from "../audio/pcm.js";

const GEMINI_MODEL =
  process.env.GEMINI_MODEL || "gemini-3.1-flash-live-preview";

const GEMINI_VOICE = process.env.GEMINI_VOICE || "Puck";

const SYSTEM_PROMPT = `
You are a friendly, helpful AI phone assistant.

- Introduce yourself as an AI assistant.
- Speak naturally and keep responses concise.
- Let the caller finish speaking before responding.
- Ask relevant follow-up questions when useful.
- Never claim to have performed an action you did not perform.
- If the caller wants to finish, say a brief goodbye.
- Do not request passwords, OTPs, or sensitive payment information.
`;

const EXOTEL_RATE = 16000;
const GEMINI_INPUT_RATE = 16000;
const GEMINI_OUTPUT_RATE = 24000;

// Exotel outbound audio frames: 3200 bytes = 100 ms
// for 16 kHz, signed 16-bit, mono PCM.
const EXOTEL_FRAME_BYTES = 3200;

const SUPPORTED_RATES = [8000, 16000, 24000];
const SUPPORTED_ENCODINGS = ["audio/x-raw", "base64"];

export function registerExotelMedia(server) {
  const wss = new WebSocketServer({
    server,
    path: "/exotel/media",
    maxPayload: 2 * 1024 * 1024,
  });

  wss.on("connection", (exotel) => {
    let gemini = null;
    let streamSid = null;
    let setupComplete = false;
    let closed = false;
    let inputQueue = [];
    let outputBuffer = Buffer.alloc(0);
    let inputRate = null;

    function sendExotel(message) {
      if (exotel.readyState === WebSocket.OPEN) {
        exotel.send(JSON.stringify(message));
      }
    }

    function sendGemini(message) {
      if (gemini?.readyState === WebSocket.OPEN) {
        gemini.send(JSON.stringify(message));
        return true;
      }

      return false;
    }

    function cleanup() {
      if (closed) return;

      closed = true;
      inputQueue = [];
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
        // Bound the queue so a slow upstream cannot exhaust memory.
        if (inputQueue.length < 100) {
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

    function flushAudioToCaller(padFinalFrame = false) {
      if (closed || !streamSid) return;

      while (outputBuffer.length >= EXOTEL_FRAME_BYTES) {
        const frame = outputBuffer.subarray(0, EXOTEL_FRAME_BYTES);

        outputBuffer = outputBuffer.subarray(EXOTEL_FRAME_BYTES);

        sendExotel({
          event: "media",
          stream_sid: streamSid,
          media: {
            payload: frame.toString("base64"),
          },
        });
      }

      // A final short audio fragment must not remain stuck in the buffer.
      // Pad the final frame with silence so it meets the minimum frame size.
      if (padFinalFrame && outputBuffer.length > 0) {
        const requiredLength = Math.max(
          EXOTEL_FRAME_BYTES,
          Math.ceil(outputBuffer.length / 320) * 320,
        );

        const frame = Buffer.alloc(requiredLength);
        outputBuffer.copy(frame);

        outputBuffer = Buffer.alloc(0);

        sendExotel({
          event: "media",
          stream_sid: streamSid,
          media: {
            payload: frame.toString("base64"),
          },
        });
      }
    }

    function sendAudioToCaller(base64Audio) {
      if (closed || !streamSid) return;

      const geminiPcm = Buffer.from(base64Audio, "base64");

      if (geminiPcm.length === 0) return;

      // Gemini audio is expected to be signed 16-bit little-endian PCM.
      const exotelPcm = resamplePcm16(
        geminiPcm,
        GEMINI_OUTPUT_RATE,
        EXOTEL_RATE,
      );

      outputBuffer = Buffer.concat([outputBuffer, exotelPcm]);

      flushAudioToCaller();
    }

    function connectGemini() {
      if (gemini || closed) return;

      const key = process.env.GEMINI_API_KEY;

      if (!key) {
        console.error("GEMINI_API_KEY is missing");
        cleanup();
        exotel.close();
        return;
      }

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
                parts: [{ text: SYSTEM_PROMPT }],
              },
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

          console.log("Gemini session ready");

          // Request a spoken greeting once the session is ready.
          sendGemini({
            realtimeInput: {
              text:
                "The call has just connected. Greet the caller briefly " +
                "and introduce yourself as an AI assistant.",
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
          // Clear queued playback when the caller interrupts.
          sendExotel({
            event: "clear",
            stream_sid: streamSid,
          });

          outputBuffer = Buffer.alloc(0);
        }

        if (content?.inputTranscription?.text) {
          console.log("Caller:", content.inputTranscription.text);
        }

        if (content?.outputTranscription?.text) {
          console.log("Assistant:", content.outputTranscription.text);
        }

        for (const part of content?.modelTurn?.parts ?? []) {
          if (part.inlineData?.data) {
            sendAudioToCaller(part.inlineData.data);
          }
        }

        if (content?.turnComplete) {
          flushAudioToCaller(true);
        }

        if (message.toolCall?.functionCalls?.length) {
          console.log("Gemini requested a function call");
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

          // Accommodate both spellings seen in stream implementations.
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
            callSid: start.call_sid ?? start.callSid,
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

          // Exotel sends Base64-transported audio.
          // This assumes the decoded payload is raw signed 16-bit PCM.
          const pcm = Buffer.from(message.media.payload, "base64");

          if (pcm.length === 0) break;

          // Convert incoming audio to Gemini's expected 16 kHz PCM.
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
          console.log("Exotel stream stopped");
          cleanup();
          break;
        }

        default: {
          console.log("Unhandled Exotel event:", message.event);
        }
      }
    });

    exotel.on("close", () => {
      console.log("Exotel WebSocket closed");
      cleanup();
    });

    exotel.on("error", (error) => {
      console.error("Exotel WebSocket error:", error.message);
      cleanup();
    });
  });

  return wss;
}
