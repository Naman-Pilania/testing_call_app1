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

// Exotel requires outbound PCM payload sizes to be multiples of 320 bytes.
const EXOTEL_FRAME_BYTES = 320;

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
            mimeType: `audio/pcm;rate=${inputRate}`,
          },
        },
      });
    }

    function sendAudioToCaller(base64Audio) {
      if (!streamSid || closed) return;

      const geminiPcm = Buffer.from(base64Audio, "base64");

      // Gemini produces signed 16-bit little-endian PCM at 24 kHz.
      const exotelPcm = resamplePcm16(
        geminiPcm,
        GEMINI_OUTPUT_RATE,
        EXOTEL_RATE,
      );

      outputBuffer = Buffer.concat([outputBuffer, exotelPcm]);

      // Send complete 320-byte frames.
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
    }

    function connectGemini() {
      if (gemini) return;

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
          exotel.close();
          return;
        }

        if (message.setupComplete) {
          setupComplete = true;

          // Start with a short greeting.
          sendGemini({
            realtimeInput: {
              text: "The call has just connected. Greet the caller briefly and introduce yourself as an AI assistant.",
            },
          });

          for (const chunk of inputQueue) {
            sendAudioToGemini(chunk);
          }

          inputQueue = [];
          console.log("Gemini session ready");
          return;
        }

        const content = message.serverContent;

        if (content?.interrupted) {
          // Stop any queued Exotel playback when the caller interrupts.
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

        // Function calls can be handled here when you add tools.
        if (message.toolCall?.functionCalls?.length) {
          console.log("Gemini requested a function call");
        }
      });

      gemini.on("error", (error) => {
        console.error("Gemini WebSocket error:", error.message);
        cleanup();
        exotel.close();
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
        case "connected":
          console.log("Exotel WebSocket connected");
          break;

        case "start": {
          const start = message.start ?? {};

          streamSid = start.stream_sid || message.stream_sid;

          const format = start.media_format ?? {};
          inputRate = Number(format.sample_rate);

          console.log("Exotel call started", {
            streamSid,
            callSid: start.call_sid,
            mediaFormat: format,
          });

          if (
            format.encoding !== "audio/x-raw" ||
            Number(format.bit_rate) !== 16 ||
            ![8000, 16000, 24000].includes(inputRate)
          ) {
            console.error("Unsupported Exotel media format", format);
            cleanup();
            exotel.close();
            return;
          }

          connectGemini();
          break;
        }

        case "media": {
          if (!message.media?.payload || !inputRate) break;

          const pcm = Buffer.from(message.media.payload, "base64");

          // Gemini natively accepts 16 kHz PCM. Resample incoming
          // Exotel audio if the provider returns another supported rate.
          const geminiPcm = resamplePcm16(pcm, inputRate, GEMINI_INPUT_RATE);

          sendAudioToGemini(geminiPcm);
          break;
        }

        case "dtmf":
          console.log("Caller pressed a key:", message.dtmf?.digit);
          break;

        case "mark":
          break;

        case "stop":
          console.log("Exotel stream stopped");
          cleanup();
          break;

        default:
          console.log("Unhandled Exotel event:", message.event);
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
