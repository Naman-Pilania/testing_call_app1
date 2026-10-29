import Database from "better-sqlite3";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

import {
  SQL_SCHEMA,
  validateContextContract,
} from "./schema.js";
import { getSeedData } from "./seedData.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "../../data/clinic.db");

// Ensure directory exists
mkdirSync(dirname(DB_PATH), { recursive: true });

let dbInstance = null;
let autoClearedOnStartup = false;

/**
 * Returns the raw Database instance without running schema or seeds.
 */
function getRawDb() {
  if (!dbInstance) {
    dbInstance = new Database(DB_PATH);
    dbInstance.pragma("journal_mode = WAL");
    dbInstance.pragma("foreign_keys = ON");
  }
  return dbInstance;
}

/**
 * Initializes and returns the SQLite database instance.
 * Automatically clears and reseeds if CLEAR_DB=true or RESET_DB=true.
 * Otherwise applies schema and seeds sample data if empty.
 */
export function getDb() {
  const db = getRawDb();

  // If CLEAR_DB=true or RESET_DB=true, clear and re-seed once on startup
  if (
    !autoClearedOnStartup &&
    (process.env.CLEAR_DB === "true" || process.env.RESET_DB === "true")
  ) {
    autoClearedOnStartup = true;
    console.log("[DB] Auto-clearing and reseeding database due to CLEAR_DB/RESET_DB environment flag...");
    clearDb({ reseed: true });
    return db;
  }

  // Apply Schema
  db.exec(SQL_SCHEMA);

  // Seed Data if empty
  seedIfEmpty(db);

  return db;
}

/**
 * Seeds doctors, patients, active clinical contexts, and appointment slots.
 * Can be called explicitly during resets or initial seeding.
 */
export function seedDatabase(db = getRawDb()) {
  console.log("Seeding Brightside Dental Clinic database with active data...");

  const { doctors, patients, activeContexts, appointmentSlots } = getSeedData();

  const insertDoctor = db.prepare(
    "INSERT INTO doctors (doctor_id, name, specialty, available_days) VALUES (?, ?, ?, ?)",
  );

  const insertPatient = db.prepare(`
    INSERT INTO patients (
      patient_id, phone, full_name, preferred_name, age, gender,
      assigned_doctor_id, medical_alerts, insurance_plan, preferred_time_of_day, general_notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertContext = db.prepare(`
    INSERT INTO active_contexts (
      context_id, patient_id, call_goal, call_reason,
      last_visit_date, last_visit_procedure, last_visit_doctor, last_visit_outcome,
      pending_action, recommended_duration_minutes, urgency, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertSlot = db.prepare(
    "INSERT INTO appointment_slots (slot_id, doctor_id, date, time, is_available) VALUES (?, ?, ?, ?, ?)",
  );

  const insertCallLog = db.prepare(`
    INSERT INTO call_logs (
      call_sid, phone, patient_id, call_reason, started_at, ended_at, outcome, notes, transcript_summary
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const seedTx = db.transaction(() => {
    for (const d of doctors) {
      insertDoctor.run(d.doctor_id, d.name, d.specialty, d.available_days);
    }
    for (const p of patients) {
      insertPatient.run(
        p.patient_id,
        String(p.phone),
        p.full_name,
        p.preferred_name,
        p.age,
        p.gender,
        p.assigned_doctor_id,
        p.medical_alerts,
        p.insurance_plan,
        p.preferred_time_of_day,
        p.general_notes,
      );
    }
    for (const c of activeContexts) {
      insertContext.run(
        c.context_id,
        c.patient_id,
        c.call_goal,
        c.call_reason,
        c.last_visit_date,
        c.last_visit_procedure,
        c.last_visit_doctor,
        c.last_visit_outcome,
        c.pending_action,
        c.recommended_duration_minutes,
        c.urgency,
        c.is_active,
      );
    }
    for (const s of appointmentSlots) {
      insertSlot.run(s.slot_id, s.doctor_id, s.date, s.time, s.is_available);
    }
    if (Array.isArray(getSeedData().callLogs)) {
      for (const log of getSeedData().callLogs) {
        insertCallLog.run(
          log.call_sid,
          log.phone,
          log.patient_id,
          log.call_reason,
          log.started_at,
          log.ended_at,
          log.outcome,
          log.notes,
          log.transcript_summary,
        );
      }
    }
  });

  seedTx();
  console.log("Database seeded successfully.");

  return {
    doctorsCount: doctors.length,
    patientsCount: patients.length,
    contextsCount: activeContexts.length,
    slotsCount: appointmentSlots.length,
    callLogsCount: getSeedData().callLogs?.length || 0,
  };
}

/**
 * Seeds initial doctors, patients, contexts, and slots if the database is newly initialized.
 */
export function seedIfEmpty(db = getRawDb()) {
  const patientCount = db
    .prepare("SELECT COUNT(*) AS count FROM patients")
    .get().count;

  if (patientCount > 0) {
    return false;
  }

  seedDatabase(db);
  return true;
}

/**
 * Clears all clinic tables and re-initializes the schema.
 * Optionally re-seeds data (defaults to true for debugging).
 */
export function clearDb({ reseed = true } = {}) {
  const db = getRawDb();

  console.log("[DB] Clearing database tables for fresh debug build...");

  db.pragma("foreign_keys = OFF");

  db.exec(`
    DROP TABLE IF EXISTS call_logs;
    DROP TABLE IF EXISTS appointments;
    DROP TABLE IF EXISTS appointment_slots;
    DROP TABLE IF EXISTS active_contexts;
    DROP TABLE IF EXISTS patients;
    DROP TABLE IF EXISTS doctors;
  `);

  db.pragma("foreign_keys = ON");

  // Re-apply schema
  db.exec(SQL_SCHEMA);

  let counts = null;
  if (reseed) {
    counts = seedDatabase(db);
    console.log("[DB] Database cleared and re-seeded successfully.", counts);
  } else {
    console.log("[DB] Database cleared (schema re-applied, tables empty).");
  }

  return {
    success: true,
    cleared: true,
    reseeded: Boolean(reseed),
    counts,
  };
}

/**
 * Alias for clearDb.
 */
export const resetDb = clearDb;

/**
 * Safely closes the active SQLite database instance.
 */
export function closeDb() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    autoClearedOnStartup = false;
  }
}

/**
 * Looks up a patient by phone or patientId and returns the complete context:
 * - Patient Profile (with required fields)
 * - Active Clinical / Call Context (with required fields)
 * - Assigned Doctor Details
 * - Open Appointment Slots
 */
export function lookupPatientContext({ phone, patientId } = {}) {
  const db = getDb();

  let patientRow = null;

  // Check patientId first to allow distinct lookups when multiple patients share a test phone
  if (patientId) {
    patientRow = db
      .prepare("SELECT * FROM patients WHERE patient_id = ?")
      .get(patientId);
  }

  if (!patientRow && phone) {
    patientRow = db
      .prepare("SELECT * FROM patients WHERE phone = ?")
      .get(phone);
  }

  // If patient found in database
  if (patientRow) {
    const activeCtxRow = db
      .prepare(
        "SELECT * FROM active_contexts WHERE patient_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1",
      )
      .get(patientRow.patient_id);

    const doctorRow = db
      .prepare("SELECT * FROM doctors WHERE doctor_id = ?")
      .get(patientRow.assigned_doctor_id);

    const openSlots = db
      .prepare(`
        SELECT s.slot_id, s.doctor_id, d.name AS doctor_name, s.date, s.time
        FROM appointment_slots s
        LEFT JOIN doctors d ON s.doctor_id = d.doctor_id
        WHERE s.is_available = 1 AND (s.doctor_id = ? OR ? IS NULL)
        ORDER BY s.date ASC, s.time ASC
        LIMIT 6
      `)
      .all(patientRow.assigned_doctor_id, patientRow.assigned_doctor_id);

    let parsedAlerts = [];
    try {
      parsedAlerts = JSON.parse(patientRow.medical_alerts || "[]");
    } catch {
      parsedAlerts = [];
    }

    const context = {
      patient: {
        patientId: patientRow.patient_id,
        phone: patientRow.phone,
        fullName: patientRow.full_name,
        preferredName: patientRow.preferred_name,
        age: patientRow.age || null,
        gender: patientRow.gender || null,
        assignedDoctorId: patientRow.assigned_doctor_id || "DOC-1",
        assignedDoctorName: doctorRow?.name || "Dr. Sneha Rao",
        medicalAlerts: parsedAlerts,
        insurancePlan: patientRow.insurance_plan || "Standard Coverage",
        preferredTimeOfDay: patientRow.preferred_time_of_day || "Morning",
        generalNotes: patientRow.general_notes || "",
      },
      activeContext: {
        contextId: activeCtxRow?.context_id || "CTX-DEFAULT",
        callGoal: activeCtxRow?.call_goal || "ROUTINE_FOLLOW_UP",
        callReason:
          activeCtxRow?.call_reason ||
          "Routine dental checkup and appointment scheduling",
        lastVisit: {
          date: activeCtxRow?.last_visit_date || "Recent visit",
          procedure: activeCtxRow?.last_visit_procedure || "General consultation",
          doctor: activeCtxRow?.last_visit_doctor || doctorRow?.name || "Dr. Sneha Rao",
          outcome:
            activeCtxRow?.last_visit_outcome || "Patient in good condition",
        },
        pendingAction:
          activeCtxRow?.pending_action ||
          "Confirm patient well-being and schedule their next appointment.",
        recommendedDurationMinutes:
          activeCtxRow?.recommended_duration_minutes || 30,
        urgency: activeCtxRow?.urgency || "MEDIUM",
      },
      doctor: {
        doctorId: doctorRow?.doctor_id || "DOC-1",
        name: doctorRow?.name || "Dr. Sneha Rao",
        specialty:
          doctorRow?.specialty || "Senior Endodontist & General Dentist",
        availableDays:
          doctorRow?.available_days || "Monday, Tuesday, Thursday, Friday",
      },
      availableSlots: openSlots.map((s) => ({
        slotId: s.slot_id,
        doctorId: s.doctor_id,
        doctorName: s.doctor_name,
        date: s.date,
        time: s.time,
      })),
      isKnownPatient: true,
    };

    validateContextContract(context);
    return context;
  }

  // Fallback: If not found in DB, return a structured New-Patient context
  const defaultDoctor = db.prepare("SELECT * FROM doctors LIMIT 1").get();
  const openSlots = db
    .prepare(`
      SELECT s.slot_id, s.doctor_id, d.name AS doctor_name, s.date, s.time
      FROM appointment_slots s
      LEFT JOIN doctors d ON s.doctor_id = d.doctor_id
      WHERE s.is_available = 1
      ORDER BY s.date ASC, s.time ASC
      LIMIT 6
    `)
    .all();

  const fallbackContext = {
    patient: {
      patientId: `NEW-${Date.now().toString().slice(-4)}`,
      phone: phone || "UNSPECIFIED",
      fullName: "Valued Patient",
      preferredName: "there",
      age: null,
      gender: null,
      assignedDoctorId: defaultDoctor?.doctor_id || "DOC-1",
      assignedDoctorName: defaultDoctor?.name || "Dr. Sneha Rao",
      medicalAlerts: [],
      insurancePlan: "Self-Pay / Not Recorded",
      preferredTimeOfDay: "Flexible",
      generalNotes: "New caller or unindexed phone number",
    },
    activeContext: {
      contextId: "CTX-NEW",
      callGoal: "NEW_PATIENT_INQUIRY",
      callReason: "New patient consultation and appointment booking",
      lastVisit: {
        date: "None",
        procedure: "None on file",
        doctor: "N/A",
        outcome: "First-time visitor to Brightside Dental",
      },
      pendingAction:
        "Introduce Brightside Dental, inquire about dental needs, collect full name, and book an appointment.",
      recommendedDurationMinutes: 30,
      urgency: "LOW",
    },
    doctor: {
      doctorId: defaultDoctor?.doctor_id || "DOC-1",
      name: defaultDoctor?.name || "Dr. Sneha Rao",
      specialty:
        defaultDoctor?.specialty || "Senior Endodontist & General Dentist",
      availableDays:
        defaultDoctor?.available_days || "Monday through Friday",
    },
    availableSlots: openSlots.map((s) => ({
      slotId: s.slot_id,
      doctorId: s.doctor_id,
      doctorName: s.doctor_name,
      date: s.date,
      time: s.time,
    })),
    isKnownPatient: false,
  };

  validateContextContract(fallbackContext);
  return fallbackContext;
}

/**
 * Retrieves available appointment slots, optionally filtered by doctorId and date.
 */
export function getAvailableSlots({ doctorId, date } = {}) {
  const db = getDb();

  let query = `
    SELECT s.slot_id, s.doctor_id, d.name AS doctor_name, s.date, s.time
    FROM appointment_slots s
    LEFT JOIN doctors d ON s.doctor_id = d.doctor_id
    WHERE s.is_available = 1
  `;
  const params = [];

  if (doctorId) {
    query += " AND s.doctor_id = ?";
    params.push(doctorId);
  }

  if (date) {
    query += " AND s.date = ?";
    params.push(date);
  }

  query += " ORDER BY s.date ASC, s.time ASC LIMIT 10";

  return db.prepare(query).all(...params);
}

/**
 * Retrieves all slots (both available and booked) with enriched booking & patient details.
 */
export function getAllSlotsWithBookingDetails({
  doctorId,
  date,
  status = "ALL",
} = {}) {
  const db = getDb();
  let query = `
    SELECT
      s.slot_id AS slotId,
      s.doctor_id AS doctorId,
      d.name AS doctorName,
      d.specialty AS doctorSpecialty,
      s.date,
      s.time,
      s.is_available AS isAvailable,
      a.appointment_id AS appointmentId,
      a.patient_id AS patientId,
      p.full_name AS patientName,
      p.phone AS patientPhone,
      a.treatment_type AS treatmentType,
      a.status AS appointmentStatus,
      a.notes AS appointmentNotes
    FROM appointment_slots s
    LEFT JOIN doctors d ON s.doctor_id = d.doctor_id
    LEFT JOIN appointments a ON (s.doctor_id = a.doctor_id AND s.date = a.date AND s.time = a.time)
    LEFT JOIN patients p ON a.patient_id = p.patient_id
    WHERE 1=1
  `;
  const params = [];

  if (doctorId) {
    query += " AND s.doctor_id = ?";
    params.push(doctorId);
  }

  if (date) {
    query += " AND s.date = ?";
    params.push(date);
  }

  if (status === "AVAILABLE") {
    query += " AND s.is_available = 1";
  } else if (status === "BOOKED") {
    query += " AND s.is_available = 0";
  }

  query += " ORDER BY s.date ASC, s.time ASC LIMIT 50";
  return db
    .prepare(query)
    .all(...params)
    .map((row) => ({
      slotId: row.slotId,
      doctorId: row.doctorId,
      doctorName: row.doctorName || "Clinic Doctor",
      doctorSpecialty: row.doctorSpecialty || "",
      date: row.date,
      time: row.time,
      isAvailable: Boolean(row.isAvailable),
      booking: !row.isAvailable
        ? {
            appointmentId: row.appointmentId,
            patientId: row.patientId,
            patientName: row.patientName || "Booked Patient",
            patientPhone: row.patientPhone || "",
            treatmentType: row.treatmentType || "General Consultation",
            status: row.appointmentStatus || "SCHEDULED",
            notes: row.appointmentNotes || "",
          }
        : null,
    }));
}

/**
 * Books an appointment in the database and marks the slot as booked.
 */
export function bookAppointment({
  patientId,
  doctorId,
  date,
  time,
  treatmentType,
  notes = "",
}) {
  const db = getDb();
  const appointmentId = `APT-${Date.now().toString().slice(-6)}`;

  const tx = db.transaction(() => {
    // Insert the appointment
    db.prepare(`
      INSERT INTO appointments (
        appointment_id, patient_id, doctor_id, date, time, treatment_type, status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, 'SCHEDULED', ?)
    `).run(
      appointmentId,
      patientId,
      doctorId || "DOC-1",
      date,
      time,
      treatmentType || "General Consultation",
      notes,
    );

    // Mark slot as booked if matching slot exists
    db.prepare(`
      UPDATE appointment_slots
      SET is_available = 0
      WHERE (doctor_id = ? OR ? IS NULL) AND date = ? AND time = ?
    `).run(doctorId || null, doctorId || null, date, time);
  });

  tx();

  return {
    success: true,
    appointmentId,
    patientId,
    doctorId: doctorId || "DOC-1",
    date,
    time,
    treatmentType: treatmentType || "General Consultation",
    status: "SCHEDULED",
  };
}

/**
 * Saves a call record to call_logs.
 */
export function saveCallLog({
  callSid,
  phone,
  patientId,
  callReason,
  outcome,
  notes = "",
  transcriptSummary = "",
}) {
  const db = getDb();

  db.prepare(`
    INSERT INTO call_logs (
      call_sid, phone, patient_id, call_reason, outcome, notes, transcript_summary, ended_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(call_sid) DO UPDATE SET
      outcome = excluded.outcome,
      notes = excluded.notes,
      transcript_summary = excluded.transcript_summary,
      ended_at = excluded.ended_at
  `).run(
    callSid,
    phone,
    patientId || null,
    callReason || null,
    outcome || "COMPLETED",
    notes,
    transcriptSummary,
  );
}

/**
 * Returns all stored patients with their assigned doctor and active clinical context.
 */
export function getAllPatients() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      p.*,
      d.name AS assigned_doctor_name,
      d.specialty AS assigned_doctor_specialty,
      ac.context_id,
      ac.call_goal,
      ac.call_reason,
      ac.last_visit_date,
      ac.last_visit_procedure,
      ac.last_visit_doctor,
      ac.last_visit_outcome,
      ac.pending_action,
      ac.recommended_duration_minutes,
      ac.urgency,
      ac.is_active AS context_is_active,
      (SELECT COUNT(*) FROM appointments a WHERE a.patient_id = p.patient_id) AS appointments_count,
      (SELECT COUNT(*) FROM call_logs cl WHERE (cl.patient_id IS NOT NULL AND cl.patient_id = p.patient_id) OR (cl.patient_id IS NULL AND cl.phone = p.phone)) AS calls_count
    FROM patients p
    LEFT JOIN doctors d ON p.assigned_doctor_id = d.doctor_id
    LEFT JOIN active_contexts ac ON ac.patient_id = p.patient_id AND ac.is_active = 1
    ORDER BY p.patient_id ASC
  `).all();

  return rows.map((r) => {
    let medicalAlerts = [];
    try {
      medicalAlerts = JSON.parse(r.medical_alerts || "[]");
    } catch {
      medicalAlerts = [];
    }

    return {
      patientId: r.patient_id,
      phone: r.phone,
      fullName: r.full_name,
      preferredName: r.preferred_name,
      age: r.age,
      gender: r.gender,
      assignedDoctorId: r.assigned_doctor_id,
      assignedDoctorName: r.assigned_doctor_name || "Unassigned",
      assignedDoctorSpecialty: r.assigned_doctor_specialty || "",
      medicalAlerts,
      insurancePlan: r.insurance_plan || "Standard Coverage",
      preferredTimeOfDay: r.preferred_time_of_day || "Morning",
      generalNotes: r.general_notes || "",
      createdAt: r.created_at,
      appointmentsCount: r.appointments_count || 0,
      callsCount: r.calls_count || 0,
      activeContext: r.context_id ? {
        contextId: r.context_id,
        callGoal: r.call_goal,
        callReason: r.call_reason,
        lastVisitDate: r.last_visit_date,
        lastVisitProcedure: r.last_visit_procedure,
        lastVisitDoctor: r.last_visit_doctor,
        lastVisitOutcome: r.last_visit_outcome,
        pendingAction: r.pending_action,
        recommendedDurationMinutes: r.recommended_duration_minutes,
        urgency: r.urgency,
        isActive: Boolean(r.context_is_active),
      } : null,
    };
  });
}

/**
 * Retrieves a single patient by ID.
 */
export function getPatientById(patientId) {
  const all = getAllPatients();
  return all.find((p) => p.patientId === patientId) || null;
}

/**
 * Returns all doctors with available slot and appointment counts.
 */
export function getAllDoctors() {
  const db = getDb();
  return db.prepare(`
    SELECT
      d.*,
      (SELECT COUNT(*) FROM appointment_slots s WHERE s.doctor_id = d.doctor_id AND s.is_available = 1) AS available_slots_count,
      (SELECT COUNT(*) FROM appointments a WHERE a.doctor_id = d.doctor_id) AS booked_appointments_count
    FROM doctors d
    ORDER BY d.name ASC
  `).all().map((d) => ({
    doctorId: d.doctor_id,
    name: d.name,
    specialty: d.specialty,
    availableDays: d.available_days,
    availableSlotsCount: d.available_slots_count || 0,
    bookedAppointmentsCount: d.booked_appointments_count || 0,
  }));
}

/**
 * Returns all logged calls with patient identity and outcome details.
 */
export function getAllCallLogs() {
  const db = getDb();
  return db.prepare(`
    SELECT
      c.*,
      p.full_name AS patient_name,
      p.preferred_name AS patient_preferred_name
    FROM call_logs c
    LEFT JOIN patients p ON (c.patient_id IS NOT NULL AND c.patient_id = p.patient_id)
                         OR (c.patient_id IS NULL AND c.phone = p.phone)
    ORDER BY c.started_at DESC
  `).all().map((c) => ({
    callSid: c.call_sid,
    phone: c.phone,
    patientId: c.patient_id,
    patientName: c.patient_name || "Unknown Caller",
    patientPreferredName: c.patient_preferred_name || "Caller",
    callReason: c.call_reason || "Outbound Follow-up",
    startedAt: c.started_at,
    endedAt: c.ended_at,
    outcome: c.outcome || "COMPLETED",
    notes: c.notes || "",
    transcriptSummary: c.transcript_summary || "",
  }));
}

/**
 * Retrieves detailed call record by Call SID.
 */
export function getCallLogBySid(callSid) {
  const db = getDb();
  const c = db.prepare(`
    SELECT
      c.*,
      p.full_name AS patient_name,
      p.preferred_name AS patient_preferred_name,
      p.assigned_doctor_id,
      d.name AS doctor_name
    FROM call_logs c
    LEFT JOIN patients p ON (c.patient_id IS NOT NULL AND c.patient_id = p.patient_id)
                         OR (c.patient_id IS NULL AND c.phone = p.phone)
    LEFT JOIN doctors d ON p.assigned_doctor_id = d.doctor_id
    WHERE c.call_sid = ?
  `).get(callSid);

  if (!c) return null;

  return {
    callSid: c.call_sid,
    phone: c.phone,
    patientId: c.patient_id,
    patientName: c.patient_name || "Unknown Caller",
    patientPreferredName: c.patient_preferred_name || "Caller",
    doctorName: c.doctor_name || "Dr. Sneha Rao",
    callReason: c.call_reason || "Outbound Follow-up",
    startedAt: c.started_at,
    endedAt: c.ended_at,
    outcome: c.outcome || "COMPLETED",
    notes: c.notes || "",
    transcriptSummary: c.transcript_summary || "",
  };
}

/**
 * Creates and stores a new patient with their active clinical context and follow-up summary.
 */
export function createPatient({
  fullName,
  preferredName,
  phone,
  age = null,
  gender = null,
  assignedDoctorId = "DOC-1",
  medicalAlerts = [],
  insurancePlan = "Standard Coverage",
  preferredTimeOfDay = "Morning",
  generalNotes = "",
  activeContext = {},
}) {
  const db = getDb();
  const randNum = Math.floor(1000 + Math.random() * 9000);
  const patientId = `PAT-${randNum}`;
  const contextId = `CTX-${randNum}`;

  let alertsJson = "[]";
  if (Array.isArray(medicalAlerts)) {
    alertsJson = JSON.stringify(medicalAlerts);
  } else if (typeof medicalAlerts === "string") {
    alertsJson = JSON.stringify(
      medicalAlerts
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }

  const tx = db.transaction(() => {
    // 1. Insert patient profile
    db.prepare(`
      INSERT INTO patients (
        patient_id, phone, full_name, preferred_name, age, gender,
        assigned_doctor_id, medical_alerts, insurance_plan, preferred_time_of_day, general_notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      patientId,
      String(phone),
      fullName,
      preferredName || fullName.split(" ")[0] || fullName,
      age ? Number(age) : null,
      gender || null,
      assignedDoctorId || "DOC-1",
      alertsJson,
      insurancePlan || "Standard Coverage",
      preferredTimeOfDay || "Morning",
      generalNotes || "",
    );

    // 2. Insert active clinical context / call summary
    const callGoal = activeContext.callGoal || "ROUTINE_FOLLOW_UP";
    const callReason =
      activeContext.callReason ||
      "Routine dental checkup and appointment scheduling";
    const pendingAction =
      activeContext.pendingAction ||
      "Check patient status and schedule next consultation slot.";

    db.prepare(`
      INSERT INTO active_contexts (
        context_id, patient_id, call_goal, call_reason,
        last_visit_date, last_visit_procedure, last_visit_doctor, last_visit_outcome,
        pending_action, recommended_duration_minutes, urgency, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      contextId,
      patientId,
      callGoal,
      callReason,
      activeContext.lastVisitDate || null,
      activeContext.lastVisitProcedure || null,
      activeContext.lastVisitDoctor || null,
      activeContext.lastVisitOutcome || null,
      pendingAction,
      activeContext.recommendedDurationMinutes
        ? Number(activeContext.recommendedDurationMinutes)
        : 30,
      activeContext.urgency || "MEDIUM",
    );
  });

  tx();

  return getPatientById(patientId);
}
