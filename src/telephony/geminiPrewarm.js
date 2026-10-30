import { WebSocket } from "ws";
import { GEMINI_TOOLS } from "./geminiTools.js";
import {
  buildSystemPrompt,
  buildInitialGreetingPrompt,
  END_RULES,
} from "./promptBuilder.js";

const GEMINI_MODEL =
  process.env.GEMINI_MODEL || "gemini-3.1-flash-live-preview";

const GEMINI_VOICE = process.env.GEMINI_VOICE || "Puck";

// Map of sessionId -> sessionObject
const activePrewarmedSessions = new Map();

/**
 * Initiates a pre-warmed Gemini WebSocket session while the outbound call
 * is being dialed / ringing. This eliminates the 3-5 second silence when the
 * user answers the call.
 */
export function prewarmGeminiSession({
  callSid = null,
  patientId = null,
  phone = null,
  activeContext,
}) {
  const key = process.env.GEMINI_API_KEY;

  if (!key) {
    console.warn(
      "[GeminiPrewarm] Cannot prewarm session: GEMINI_API_KEY is missing",
    );
    return null;
  }

  if (!activeContext) {
    console.warn(
      "[GeminiPrewarm] Cannot prewarm session: activeContext is missing",
    );
    return null;
  }

  const url = new URL(
    "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent",
  );
  url.searchParams.set("key", key);

  const dynamicPrompt = buildSystemPrompt(activeContext) + END_RULES;
  const initialGreeting = buildInitialGreetingPrompt(activeContext);

  const sessionId = `prewarm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  let ws;
  try {
    ws = new WebSocket(url.toString());
  } catch (err) {
    console.error("[GeminiPrewarm] Failed to instantiate WebSocket:", err.message);
    return null;
  }

  const session = {
    id: sessionId,
    ws,
    callSid: callSid || null,
    patientId: patientId || activeContext?.patient?.patientId || null,
    phone: phone || activeContext?.patient?.phone || null,
    activeContext,
    dynamicPrompt,
    initialGreeting,
    ready: false,
    claimed: false,
    greetingSent: false,
    earlyAudioChunks: [], // base64 strings of Gemini 24kHz audio
    earlyAssistantText: "",
    createdAt: Date.now(),
    expireTimer: null,
    setCallSid(sid) {
      if (sid) {
        this.callSid = sid;
        console.log(
          `[GeminiPrewarm] Session ${this.id} linked to callSid '${sid}'`,
        );
      }
    },
  };

  activePrewarmedSessions.set(sessionId, session);

  ws.on("open", () => {
    if (session.claimed) return;

    console.log(
      `[GeminiPrewarm] WebSocket opened for session ${session.id} (callSid: ${session.callSid || "pending"}). Sending setup...`,
    );

    const model = GEMINI_MODEL.replace(/^models\//, "");

    ws.send(
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

  const prewarmMessageHandler = (raw) => {
    // If already claimed by active call, let active call handle it
    if (session.claimed) return;

    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.setupComplete) {
      session.ready = true;
      console.log(
        `[GeminiPrewarm] Session ${session.id} setupComplete received! Pre-generating initial greeting...`,
      );

      // Pre-send the initial greeting prompt so audio is generated and buffered
      // before the caller even picks up the phone!
      if (!session.greetingSent && ws.readyState === WebSocket.OPEN) {
        session.greetingSent = true;
        ws.send(
          JSON.stringify({
            realtimeInput: {
              text: session.initialGreeting,
            },
          }),
        );
      }
      return;
    }

    const content = msg.serverContent;

    // Buffer early audio parts generated while ringing
    for (const part of content?.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) {
        session.earlyAudioChunks.push(part.inlineData.data);
      }
    }

    // Buffer early transcription
    if (content?.outputTranscription?.text) {
      session.earlyAssistantText += content.outputTranscription.text;
    }
  };

  ws.on("message", prewarmMessageHandler);

  ws.on("error", (err) => {
    console.error(`[GeminiPrewarm] Session ${session.id} error:`, err.message);
    cleanupPrewarmedSession(session);
  });

  ws.on("close", (code) => {
    console.log(`[GeminiPrewarm] Session ${session.id} closed:`, code);
    cleanupPrewarmedSession(session);
  });

  // Automatically expire and close if call is never answered (90s timeout)
  session.expireTimer = setTimeout(() => {
    if (!session.claimed) {
      console.log(
        `[GeminiPrewarm] Session ${session.id} expired unclaimed after 90 seconds.`,
      );
      cleanupPrewarmedSession(session);
    }
  }, 90000);

  console.log(
    `[GeminiPrewarm] Initialized pre-warming session ${session.id} for patient ${session.patientId} (${session.phone})`,
  );

  return session;
}

/**
 * Claims a pre-warmed Gemini session for an answering Exotel media stream.
 * Matches by callSid, customField, patientId, phone, or latest pending session.
 */
export function claimPrewarmedSession({
  callSid,
  customField,
  patientId,
  phone,
} = {}) {
  console.log("[GeminiPrewarm] Attempting to claim prewarmed session with signals:", {
    callSid,
    customField,
    patientId,
    phone,
    activeCount: activePrewarmedSessions.size,
  });

  let matched = null;

  // 1. Match by callSid
  if (callSid) {
    for (const session of activePrewarmedSessions.values()) {
      if (!session.claimed && session.callSid === callSid) {
        matched = session;
        console.log(`[GeminiPrewarm] Matched session ${session.id} by callSid '${callSid}'`);
        break;
      }
    }
  }

  // 2. Match by customField (e.g. patient-PAT-2002)
  if (!matched && customField && typeof customField === "string") {
    const cfMatch = customField.match(/patient-([A-Za-z0-9_-]+)/);
    if (cfMatch && cfMatch[1]) {
      const pid = cfMatch[1];
      for (const session of activePrewarmedSessions.values()) {
        if (!session.claimed && session.patientId === pid) {
          matched = session;
          console.log(`[GeminiPrewarm] Matched session ${session.id} by customField '${customField}'`);
          break;
        }
      }
    }
  }

  // 3. Match by explicit patientId
  if (!matched && patientId && patientId !== "NEW") {
    for (const session of activePrewarmedSessions.values()) {
      if (!session.claimed && session.patientId === patientId) {
        matched = session;
        console.log(`[GeminiPrewarm] Matched session ${session.id} by patientId '${patientId}'`);
        break;
      }
    }
  }

  // 4. Match by phone
  if (!matched && phone) {
    for (const session of activePrewarmedSessions.values()) {
      if (!session.claimed && session.phone === phone) {
        matched = session;
        console.log(`[GeminiPrewarm] Matched session ${session.id} by phone '${phone}'`);
        break;
      }
    }
  }

  // 5. Fallback: If only 1 unclaimed session exists within the last 90 seconds, use it
  if (!matched && activePrewarmedSessions.size > 0) {
    const candidates = Array.from(activePrewarmedSessions.values()).filter(
      (s) => !s.claimed && Date.now() - s.createdAt < 90000,
    );
    if (candidates.length === 1) {
      matched = candidates[0];
      console.log(
        `[GeminiPrewarm] Matched single active candidate session ${matched.id}`,
      );
    }
  }

  if (matched) {
    matched.claimed = true;
    if (matched.expireTimer) {
      clearTimeout(matched.expireTimer);
      matched.expireTimer = null;
    }
    activePrewarmedSessions.delete(matched.id);

    // If socket is dead/closed, discard
    if (
      matched.ws.readyState !== WebSocket.OPEN &&
      matched.ws.readyState !== WebSocket.CONNECTING
    ) {
      console.warn(
        `[GeminiPrewarm] Matched session ${matched.id} but WebSocket was not ready (${matched.ws.readyState})`,
      );
      return null;
    }

    return matched;
  }

  console.log("[GeminiPrewarm] No prewarmed session matched.");
  return null;
}

function cleanupPrewarmedSession(session) {
  if (!session) return;
  if (session.expireTimer) {
    clearTimeout(session.expireTimer);
    session.expireTimer = null;
  }
  activePrewarmedSessions.delete(session.id);
  if (
    session.ws &&
    (session.ws.readyState === WebSocket.OPEN ||
      session.ws.readyState === WebSocket.CONNECTING)
  ) {
    try {
      session.ws.close();
    } catch {}
  }
}
