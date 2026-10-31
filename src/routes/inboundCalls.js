import { Router } from "express";
import {
  lookupPatientContext,
  getDb,
  getAllPatients,
  getPatientById,
} from "../db/database.js";
import { registerPendingCall } from "../telephony/callRegistry.js";
import { prewarmGeminiSession } from "../telephony/geminiPrewarm.js";

const router = Router();

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

/**
 * Normalizes phone numbers to Indian E.164 (+91XXXXXXXXXX) format where applicable.
 */
function normalizePhoneNumber(raw) {
  if (!raw || typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+91${digits}`;
  }
  if (digits.length === 12 && digits.startsWith("91")) {
    return `+${digits}`;
  }
  if (raw.startsWith("+")) return raw;
  return `+${digits}`;
}

/**
 * GET /api/inbound/config
 * Returns current Exotel inbound configuration, virtual number, stream URL, and applet instructions.
 */
router.get("/api/inbound/config", (_req, res) => {
  const callerId = process.env.EXOTEL_CALLER_ID || "08047289577";
  const publicWssUrl = process.env.PUBLIC_WSS_URL || "";
  const testPhone = process.env.TEST_PHONE_NUMBER || "+918218627040";

  let inboundStreamUrl = "";
  try {
    if (publicWssUrl) {
      const url = new URL(publicWssUrl);
      url.searchParams.set("direction", "inbound");
      inboundStreamUrl = url.toString();
    }
  } catch {}

  res.json({
    ok: true,
    virtualNumber: callerId,
    testPhoneNumber: testPhone,
    streamUrl: inboundStreamUrl || `${publicWssUrl}?direction=inbound`,
    webhookUrl: "/api/inbound/webhook",
    supportedDepartments: [
      "Cardiology",
      "Ophthalmology",
      "ENT",
      "Hepatology",
      "Dental",
      "Orthopedics",
      "General Medicine",
    ],
    setupGuide: {
      exotelAppletType: "Connect Voice AI / Voice Streaming Applet",
      flowSteps: [
        "1. Direct your Exotel Virtual Number (ExoPhone) to an Exotel Applet Flow.",
        "2. Add a Passthru Applet pointing to: POST /api/inbound/webhook",
        `3. Add a Voice Streaming Applet with StreamUrl: ${inboundStreamUrl || `${publicWssUrl}?direction=inbound`}`,
        "4. StreamType: bidirectional, Format: 16kHz Linear PCM.",
      ],
    },
  });
});

/**
 * ALL /api/inbound/webhook (GET & POST)
 * Handles incoming call webhooks from Exotel Passthru applet.
 * Correlates caller phone, pre-registers inbound call, and pre-warms Gemini session.
 */
router.all("/api/inbound/webhook", (req, res) => {
  try {
    const params = {
      ...(req.query || {}),
      ...(req.body || {}),
    };

    const callSid = params.CallSid || params.callSid || `EXO-INB-${Date.now()}`;
    const rawFrom = params.From || params.from || params.Caller || "";
    const rawTo = params.To || params.to || "";
    const customField = params.CustomField || params.customField || null;

    const callerPhone = normalizePhoneNumber(rawFrom) || process.env.TEST_PHONE_NUMBER;

    console.log("[InboundWebhook] Incoming call webhook received from Exotel:", {
      callSid,
      from: callerPhone,
      to: rawTo,
      customField,
    });

    // Check if patientId is in customField (e.g. "patient-PAT-2002")
    let targetPatientId = null;
    if (customField) {
      const match = customField.match(/patient-([A-Za-z0-9_-]+)/);
      if (match && match[1]) {
        targetPatientId = match[1] === "NEW" ? undefined : match[1];
      }
    }

    // Look up active clinical context for this incoming caller
    const activeContext = lookupPatientContext({
      phone: callerPhone,
      patientId: targetPatientId,
    });
    activeContext.direction = "INBOUND";

    // Register inbound call in registry
    registerPendingCall(callSid, {
      patientId: activeContext.patient.patientId,
      phone: callerPhone,
      direction: "INBOUND",
      activeContext,
    });

    // Pre-warm Gemini session immediately while the call connects
    let prewarmed = null;
    try {
      prewarmed = prewarmGeminiSession({
        callSid,
        patientId: activeContext.patient.patientId,
        phone: callerPhone,
        direction: "INBOUND",
        activeContext,
      });
    } catch (prewarmErr) {
      console.warn("[InboundWebhook] Could not prewarm Gemini session:", prewarmErr.message);
    }

    const publicWssUrl = process.env.PUBLIC_WSS_URL || "";
    let finalStreamUrl = publicWssUrl;
    try {
      const parsed = new URL(publicWssUrl);
      parsed.searchParams.set("direction", "inbound");
      parsed.searchParams.set("phone", callerPhone);
      parsed.searchParams.set("patientId", activeContext.patient.patientId);
      finalStreamUrl = parsed.toString();
    } catch {}

    // Return 200 with JSON payload
    return res.status(200).json({
      ok: true,
      message: "Inbound call acknowledged and Gemini session pre-warmed",
      callSid,
      caller: callerPhone,
      patient: {
        id: activeContext.patient.patientId,
        name: activeContext.patient.fullName,
        isKnown: activeContext.isKnownPatient,
      },
      direction: "INBOUND",
      streamUrl: finalStreamUrl,
    });
  } catch (error) {
    console.error("[InboundWebhook] Error processing inbound webhook:", error.message);
    return res.status(500).json({
      error: "Internal error processing inbound call webhook",
      details: error.message,
    });
  }
});

/**
 * POST /api/inbound/intent
 * Pre-registers caller intent before an inbound call is placed.
 */
router.post("/api/inbound/intent", (req, res) => {
  try {
    const { patientId, phone, callReason, department } = req.body ?? {};

    const testPhoneNumber = process.env.TEST_PHONE_NUMBER || "+918218627040";
    const callerPhone = phone ? normalizePhoneNumber(phone) : testPhoneNumber;

    const isNew = Boolean(!patientId || patientId === "NEW" || patientId === "NEW_PATIENT");

    const activeContext = lookupPatientContext({
      phone: callerPhone,
      patientId: isNew ? undefined : patientId,
      isNewPatient: isNew,
    });
    activeContext.direction = "INBOUND";

    if (callReason) {
      activeContext.activeContext.callReason = callReason;
    }

    const simulatedSid = `INTENT-INB-${Date.now()}`;
    registerPendingCall(simulatedSid, {
      patientId: isNew ? "NEW" : activeContext.patient.patientId,
      phone: callerPhone,
      direction: "INBOUND",
      activeContext,
    });

    try {
      prewarmGeminiSession({
        callSid: simulatedSid,
        patientId: isNew ? "NEW" : activeContext.patient.patientId,
        phone: callerPhone,
        direction: "INBOUND",
        activeContext,
      });
    } catch (err) {
      console.warn("[InboundIntent] Prewarm notice:", err.message);
    }

    return res.json({
      ok: true,
      message: "Inbound call intent registered successfully",
      intentSid: simulatedSid,
      patient: activeContext.patient,
      activeContext: activeContext.activeContext,
    });
  } catch (error) {
    console.error("[InboundIntent] Error registering intent:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/inbound/simulate
 * Simulates or executes an inbound call for live testing.
 * If triggerPhoneCall is true, places a call to TEST_PHONE_NUMBER via Exotel where Maya behaves in INBOUND mode!
 */
router.post("/api/inbound/simulate", async (req, res) => {
  try {
    const {
      patientId,
      from,
      triggerPhoneCall = true,
      callReason,
      department,
    } = req.body ?? {};

    const testPhoneNumber = requiredEnv("TEST_PHONE_NUMBER");
    const callerNumber = from ? normalizePhoneNumber(from) : testPhoneNumber;

    const isNew = Boolean(!patientId || patientId === "NEW" || patientId === "NEW_PATIENT");

    // Look up active clinical context for this inbound caller
    const activeContext = lookupPatientContext({
      phone: callerNumber,
      patientId: isNew ? undefined : patientId,
      isNewPatient: isNew,
    });
    activeContext.direction = "INBOUND";

    if (callReason) {
      activeContext.activeContext.callReason = callReason;
    }

    console.log("[InboundSimulate] Simulating inbound call:", {
      caller: callerNumber,
      isNewCaller: isNew,
      patientId: activeContext.patient.patientId,
      patientName: activeContext.patient.fullName,
      triggerPhoneCall,
    });

    // If triggerPhoneCall is true, place an Exotel call to testPhoneNumber configured with direction=inbound
    if (triggerPhoneCall) {
      const accountSid = requiredEnv("EXOTEL_ACCOUNT_SID");
      const apiKey = requiredEnv("EXOTEL_API_KEY");
      const apiToken = requiredEnv("EXOTEL_API_TOKEN");
      const callerId = requiredEnv("EXOTEL_CALLER_ID");

      const baseUrl = requiredEnv("EXOTEL_API_BASE_URL").replace(/\/+$/, "");
      const streamUrl = requiredEnv("PUBLIC_WSS_URL");

      if (!streamUrl.startsWith("wss://")) {
        return res.status(500).json({
          error: "PUBLIC_WSS_URL must use secure WebSockets (wss://)",
        });
      }

      // Configure stream URL with direction=inbound
      const parsedStreamUrl = new URL(streamUrl);
      parsedStreamUrl.searchParams.set("direction", "inbound");
      parsedStreamUrl.searchParams.set("phone", callerNumber);
      parsedStreamUrl.searchParams.set(
        "patientId",
        isNew ? "NEW" : activeContext.patient.patientId,
      );
      const finalStreamUrl = parsedStreamUrl.toString();

      // Track active call in registry with INBOUND direction
      registerPendingCall(null, {
        patientId: isNew ? "NEW" : activeContext.patient.patientId,
        phone: callerNumber,
        direction: "INBOUND",
        activeContext,
      });

      // Pre-warm Gemini session immediately for zero-latency greeting
      let prewarmed = null;
      try {
        prewarmed = prewarmGeminiSession({
          patientId: isNew ? "NEW" : activeContext.patient.patientId,
          phone: callerNumber,
          direction: "INBOUND",
          activeContext,
        });
      } catch (prewarmErr) {
        console.warn("[InboundSimulate] Prewarm warning:", prewarmErr.message);
      }

      const endpoint = `${baseUrl}/v1/Accounts/${encodeURIComponent(accountSid)}/Calls/connect`;

      const form = new URLSearchParams({
        From: callerNumber,
        CallerId: callerId,
        StreamUrl: finalStreamUrl,
        StreamType: "bidirectional",
        TimeLimit: "300",
        CustomField: isNew
          ? "inbound-patient-NEW"
          : `inbound-patient-${activeContext.patient.patientId}`,
      });

      const auth = Buffer.from(`${apiKey}:${apiToken}`).toString("base64");

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form,
        signal: AbortSignal.timeout(20000),
      });

      const raw = await response.text();

      if (!response.ok) {
        console.error("[InboundSimulate] Exotel rejected simulation call:", {
          status: response.status,
          response: raw.slice(0, 1000),
        });

        return res.status(502).json({
          error: "Exotel rejected the inbound simulation call",
          providerStatus: response.status,
        });
      }

      const callSid = raw.match(/<Sid>([^<]*)<\/Sid>/)?.[1];
      const status = raw.match(/<Status>([^<]*)<\/Status>/)?.[1];

      if (!callSid) {
        return res.status(502).json({
          error: "Could not parse CallSid from Exotel response",
        });
      }

      // Link callSid in registry and prewarmed session
      registerPendingCall(callSid, {
        patientId: activeContext.patient.patientId,
        phone: callerNumber,
        direction: "INBOUND",
        activeContext,
      });

      if (prewarmed) {
        prewarmed.setCallSid(callSid);
      }

      return res.status(202).json({
        ok: true,
        simulated: true,
        direction: "INBOUND",
        call: {
          sid: callSid,
          status: status || "accepted",
          from: callerNumber,
        },
        activeContext: {
          patient: activeContext.patient,
          clinicalContext: activeContext.activeContext,
          doctor: activeContext.doctor,
          direction: "INBOUND",
        },
      });
    }

    // Pure software simulation without placing a phone call
    const simulatedSid = `SIM-INB-${Date.now()}`;
    registerPendingCall(simulatedSid, {
      patientId: isNew ? "NEW" : activeContext.patient.patientId,
      phone: callerNumber,
      direction: "INBOUND",
      activeContext,
    });

    prewarmGeminiSession({
      callSid: simulatedSid,
      patientId: isNew ? "NEW" : activeContext.patient.patientId,
      phone: callerNumber,
      direction: "INBOUND",
      activeContext,
    });

    return res.json({
      ok: true,
      simulated: true,
      direction: "INBOUND",
      callSid: simulatedSid,
      patient: activeContext.patient,
      activeContext: activeContext.activeContext,
      message: "Inbound call simulated and pre-warmed for incoming media stream",
    });
  } catch (error) {
    console.error("[InboundSimulate] Failed to simulate inbound call:", error.message);
    return res.status(500).json({
      error: "Unable to simulate inbound call",
      details: error.message,
    });
  }
});

export default router;
