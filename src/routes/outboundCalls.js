import { Router } from "express";
import {
  lookupPatientContext,
  getAvailableSlots,
  getAllSlotsWithBookingDetails,
  getDb,
  clearDb,
  getAllPatients,
  getPatientById,
  getAllDoctors,
  getAllCallLogs,
  getCallLogBySid,
  bookAppointment,
  createPatient,
} from "../db/database.js";
import { registerPendingCall } from "../telephony/callRegistry.js";

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

    const context = lookupPatientContext({ phone, patientId });
    return res.json({ ok: true, context });
  } catch (error) {
    console.error("Failed to query context:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/patients
 * Returns all stored patients with active clinical contexts and counts.
 */
router.get("/api/patients", (_req, res) => {
  try {
    const patients = getAllPatients();
    return res.json({ ok: true, count: patients.length, patients });
  } catch (error) {
    console.error("Failed to query patients:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/patients/:id
 * Returns a specific patient profile by ID.
 */
router.get("/api/patients/:id", (req, res) => {
  try {
    const patient = getPatientById(req.params.id);
    if (!patient) {
      return res.status(404).json({ error: "Patient not found" });
    }
    return res.json({ ok: true, patient });
  } catch (error) {
    console.error("Failed to query patient:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/patients
 * Creates a new patient with their clinical context and follow-up summary.
 */
router.post("/api/patients", (req, res) => {
  try {
    const {
      fullName,
      preferredName,
      phone,
      age,
      gender,
      assignedDoctorId,
      medicalAlerts,
      insurancePlan,
      preferredTimeOfDay,
      generalNotes,
      activeContext,
    } = req.body ?? {};

    if (!fullName) {
      return res.status(400).json({
        error: "fullName is a required field",
      });
    }

    const defaultPhone = process.env.TEST_PHONE_NUMBER || "+918218627040";
    const targetPhone = phone || defaultPhone;

    if (!/^\+91\d{10}$/.test(String(targetPhone))) {
      return res.status(400).json({
        error: "Use an Indian mobile number in +91XXXXXXXXXX format",
      });
    }

    const newPatient = createPatient({
      fullName,
      preferredName,
      phone: targetPhone,
      age,
      gender,
      assignedDoctorId,
      medicalAlerts,
      insurancePlan,
      preferredTimeOfDay,
      generalNotes,
      activeContext,
    });

    return res.status(201).json({
      ok: true,
      message: "Patient and active clinical context created successfully",
      patient: newPatient,
    });
  } catch (error) {
    console.error("Failed to create patient:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/doctors
 * Returns all clinic doctors with availability and statistics.
 */
router.get("/api/doctors", (_req, res) => {
  try {
    const doctors = getAllDoctors();
    return res.json({ ok: true, count: doctors.length, doctors });
  } catch (error) {
    console.error("Failed to query doctors:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/calls
 * Returns all past call logs with transcript summaries and outcomes.
 */
router.get("/api/calls", (_req, res) => {
  try {
    const calls = getAllCallLogs();
    return res.json({ ok: true, count: calls.length, calls });
  } catch (error) {
    console.error("Failed to query call logs:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/calls/:callSid
 * Returns a specific call log by SID.
 */
router.get("/api/calls/:callSid", (req, res) => {
  try {
    const call = getCallLogBySid(req.params.callSid);
    if (!call) {
      return res.status(404).json({ error: "Call log not found" });
    }
    return res.json({ ok: true, call });
  } catch (error) {
    console.error("Failed to query call log:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/slots
 * Returns appointment slots with rich availability and booking details.
 * Supports query params: doctorId, date, status ('ALL', 'AVAILABLE', 'BOOKED'), availableOnly ('true')
 */
router.get("/api/slots", (req, res) => {
  try {
    const { doctorId, date, status, availableOnly } = req.query;
    if (availableOnly === "true") {
      const slots = getAvailableSlots({ doctorId, date });
      return res.json({ ok: true, count: slots.length, slots });
    }
    const slots = getAllSlotsWithBookingDetails({
      doctorId,
      date,
      status: status || "ALL",
    });
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
 * POST /api/appointments
 * Manually schedules an appointment.
 */
router.post("/api/appointments", (req, res) => {
  try {
    const { patientId, doctorId, date, time, treatmentType, notes } =
      req.body ?? {};
    if (!patientId || !date || !time) {
      return res
        .status(400)
        .json({ error: "patientId, date, and time are required" });
    }

    const result = bookAppointment({
      patientId,
      doctorId,
      date,
      time,
      treatmentType,
      notes,
    });

    return res.status(201).json({ ok: true, appointment: result });
  } catch (error) {
    console.error("Failed to book appointment:", error.message);
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
    const { to, patientId, forceTestPhone } = req.body ?? {};

    const testPhoneNumber = requiredEnv("TEST_PHONE_NUMBER");
    const targetNumber = to || testPhoneNumber;

    // Indian mobile number in +91XXXXXXXXXX format.
    if (typeof targetNumber !== "string" || !/^\+91\d{10}$/.test(targetNumber)) {
      return res.status(400).json({
        error: "Use an Indian mobile number in +91XXXXXXXXXX format",
      });
    }

    // Dial number: if forceTestPhone is true or in prototype mode, ensure dial destination is testPhoneNumber
    const dialNumber = forceTestPhone ? testPhoneNumber : targetNumber;

    if (dialNumber !== testPhoneNumber) {
      return res.status(403).json({
        error: `Only the configured test number (${testPhoneNumber}) is allowed in testing mode. Check 'Forward call to verified Prototype Number' to test this patient on your phone.`,
      });
    }

    // Step 1: Active Database Context Lookup (prioritizes patientId, falls back to targetNumber)
    const activeContext = lookupPatientContext({ phone: targetNumber, patientId });
    console.log("Looked up active context for outbound call:", {
      phone: targetNumber,
      dialedTo: dialNumber,
      patientId: activeContext.patient.patientId,
      patientName: activeContext.patient.fullName,
      callGoal: activeContext.activeContext.callGoal,
      pendingAction: activeContext.activeContext.pendingAction,
    });

    // Track active call in registry immediately so incoming WebSocket is guaranteed to identify patient
    registerPendingCall(null, {
      patientId: activeContext.patient.patientId,
      phone: dialNumber,
      activeContext,
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
    parsedStreamUrl.searchParams.set("phone", dialNumber);
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
      From: dialNumber,
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

    // Register callSid in call registry
    registerPendingCall(callSid, {
      patientId: activeContext.patient.patientId,
      phone: dialNumber,
      activeContext,
    });

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
