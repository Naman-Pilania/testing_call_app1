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

/**
 * Initializes and returns the SQLite database instance.
 * Applies schema and seeds sample data on first run.
 */
export function getDb() {
  if (dbInstance) return dbInstance;

  dbInstance = new Database(DB_PATH);
  dbInstance.pragma("journal_mode = WAL");
  dbInstance.pragma("foreign_keys = ON");

  // Apply Schema
  dbInstance.exec(SQL_SCHEMA);

  // Seed Data if empty
  seedIfEmpty(dbInstance);

  return dbInstance;
}

/**
 * Seeds initial doctors, patients, contexts, and slots if the database is newly initialized.
 */
function seedIfEmpty(db) {
  const patientCount = db
    .prepare("SELECT COUNT(*) AS count FROM patients")
    .get().count;

  if (patientCount > 0) {
    return;
  }

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

  const seedTx = db.transaction(() => {
    for (const d of doctors) {
      insertDoctor.run(d.doctor_id, d.name, d.specialty, d.available_days);
    }
    for (const p of patients) {
      insertPatient.run(
        p.patient_id,
        p.phone,
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
  });

  seedTx();
  console.log("Database seeded successfully.");
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

  if (phone) {
    patientRow = db
      .prepare("SELECT * FROM patients WHERE phone = ?")
      .get(phone);
  }

  if (!patientRow && patientId) {
    patientRow = db
      .prepare("SELECT * FROM patients WHERE patient_id = ?")
      .get(patientId);
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
