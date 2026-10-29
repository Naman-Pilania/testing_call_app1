import { Router } from "express";
import {
  lookupPatientContext,
  getAvailableSlots,
  getDb,
  clearDb,
} from "../db/database.js";

const router = Router();

function requiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

/**
 * GET /api/context
 * Look up the active clinical and patient context by phone or patientId.
 */
router.get("/api/context", (req, res) => {
  try {
    const phone = req.query.phone || process.env.TEST_PHONE_NUMBER;
    const patientId = req.query.patientId;
    
    console.log("🚀 ~ phone:", phone)

    const context = lookupPatientContext({ phone, patientId });
    return res.json({ ok: true, context });
  } catch (error) {
    console.error("Failed to query context:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/slots
 * Returns all currently available appointment slots from the database.
 */
router.get("/api/slots", (req, res) => {
  try {
    const { doctorId, date } = req.query;
    const slots = getAvailableSlots({ doctorId, date });
    return res.json({ ok: true, count: slots.length, slots });
  } catch (error) {
    console.error("Failed to fetch slots:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/appointments
 * Returns all booked appointments.
 */
router.get("/api/appointments", (_req, res) => {
  try {
    const db = getDb();
    const appointments = db
      .prepare(`
        SELECT a.*, p.full_name AS patient_name, p.phone AS patient_phone, d.name AS doctor_name
        FROM appointments a
        LEFT JOIN patients p ON a.patient_id = p.patient_id
        LEFT JOIN doctors d ON a.doctor_id = d.doctor_id
        ORDER BY a.created_at DESC
      `)
      .all();
    return res.json({ ok: true, count: appointments.length, appointments });
  } catch (error) {
    console.error("Failed to fetch appointments:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/db/clear or POST /api/db/reset
 * Clears all database tables and reseeds them for debugging and fresh testing.
 */
router.post(["/api/db/clear", "/api/db/reset"], (_req, res) => {
  try {
    const result = clearDb({ reseed: true });
    return res.json({
      ok: true,
      message: "Database cleared and re-seeded successfully for debugging",
      result,
    });
  } catch (error) {
    console.error("Failed to clear database:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/calls
 * Triggers an outbound call with active context lookup.
 */
router.post("/api/calls", async (req, res) => {
  try {
    const { to, patientId } = req.body ?? {};

    // Indian mobile number in +91XXXXXXXXXX format.
    if (typeof to !== "string" || !/^\+91\d{10}$/.test(to)) {
      return res.status(400).json({
        error: "Use an Indian mobile number in +91XXXXXXXXXX format",
      });
    }

    // Restrict the prototype to the configured test number.
    const testPhoneNumber = requiredEnv("TEST_PHONE_NUMBER");

    if (to !== testPhoneNumber) {
      return res.status(403).json({
        error: "Only the configured test number is allowed",
      });
    }

    // Step 1: Active Database Context Lookup
    const activeContext = lookupPatientContext({ phone: to, patientId });
    console.log("Looked up active context for call:", {
      phone: to,
      patientName: activeContext.patient.fullName,
      callGoal: activeContext.activeContext.callGoal,
      pendingAction: activeContext.activeContext.pendingAction,
    });

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

    // Attach active lookup identity into the stream URL so WebSocket server
    // immediately receives the exact phone number and patientId on connect.
    const parsedStreamUrl = new URL(streamUrl);
    parsedStreamUrl.searchParams.set("phone", to);
    if (activeContext.patient?.patientId) {
      parsedStreamUrl.searchParams.set(
        "patientId",
        activeContext.patient.patientId,
      );
    }
    const finalStreamUrl = parsedStreamUrl.toString();

    const endpoint = `${baseUrl}/v1/Accounts/${encodeURIComponent(accountSid)}/Calls/connect`;

    // Exotel Connect Voice AI request.
    const form = new URLSearchParams({
      From: to,
      CallerId: callerId,
      StreamUrl: finalStreamUrl,
      StreamType: "bidirectional",
      TimeLimit: "300",
      CustomField: `patient-${activeContext.patient.patientId}`,
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
      console.error("Exotel rejected call request", {
        status: response.status,
        response: raw.slice(0, 1000),
      });

      return res.status(502).json({
        error: "Exotel rejected the call request",
        providerStatus: response.status,
      });
    }

    // Exotel may return XML instead of JSON.
    const callSid = raw.match(/<Sid>([^<]*)<\/Sid>/)?.[1];
    const status = raw.match(/<Status>([^<]*)<\/Status>/)?.[1];
    const from = raw.match(/<From>([^<]*)<\/From>/)?.[1];

    if (!callSid) {
      console.error("Could not parse Exotel call response", {
        response: raw.slice(0, 1000),
      });

      return res.status(502).json({
        error: "Could not parse Exotel call response",
      });
    }

    return res.status(202).json({
      accepted: true,
      call: {
        sid: callSid,
        status: status || "accepted",
        from: from || null,
      },
      activeContext: {
        patient: activeContext.patient,
        clinicalContext: activeContext.activeContext,
        doctor: activeContext.doctor,
        availableSlotsCount: activeContext.availableSlots.length,
      },
    });
  } catch (error) {
    console.error("Failed to initiate call:", error.message);

    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return res.status(504).json({
        error:
          "Exotel call request timed out; verify call status before retrying",
      });
    }

    return res.status(500).json({
      error: "Unable to initiate the call",
    });
  }
});

export default router;
