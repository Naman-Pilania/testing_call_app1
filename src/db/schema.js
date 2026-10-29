/**
 * Data schemas, required lookup field definitions, and contracts
 * for the Dental Clinic voice assistant.
 */

/**
 * Required input fields to perform a patient & active context lookup.
 * A lookup requires either a primary phone number or a unique patientId.
 */
export const LOOKUP_INPUT_FIELDS = Object.freeze({
  PRIMARY: "phone",
  SECONDARY: "patientId",
});

/**
 * Required fields that must be present in the Patient Profile returned by the DB lookup.
 */
export const REQUIRED_PATIENT_FIELDS = Object.freeze([
  "patientId",
  "phone",
  "fullName",
  "preferredName",
  "assignedDoctorId",
  "assignedDoctorName",
]);

/**
 * Required fields that must be present in the Active Clinical / Call Context returned by the DB lookup.
 */
export const REQUIRED_ACTIVE_CONTEXT_FIELDS = Object.freeze([
  "callGoal",
  "callReason",
  "pendingAction",
  "lastVisit",
]);

/**
 * Required fields inside the lastVisit sub-object.
 */
export const REQUIRED_LAST_VISIT_FIELDS = Object.freeze([
  "date",
  "procedure",
  "doctor",
  "outcome",
]);

/**
 * SQL DDL statements to initialize the relational SQLite database.
 */
export const SQL_SCHEMA = `
  CREATE TABLE IF NOT EXISTS patients (
    patient_id TEXT PRIMARY KEY,
    phone TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    preferred_name TEXT NOT NULL,
    age INTEGER,
    gender TEXT,
    assigned_doctor_id TEXT,
    medical_alerts TEXT, -- JSON array of strings
    insurance_plan TEXT,
    preferred_time_of_day TEXT DEFAULT 'Morning',
    general_notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS active_contexts (
    context_id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    call_goal TEXT NOT NULL,
    call_reason TEXT NOT NULL,
    last_visit_date TEXT,
    last_visit_procedure TEXT,
    last_visit_doctor TEXT,
    last_visit_outcome TEXT,
    pending_action TEXT NOT NULL,
    recommended_duration_minutes INTEGER DEFAULT 30,
    urgency TEXT DEFAULT 'MEDIUM',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(patient_id) REFERENCES patients(patient_id)
  );

  CREATE TABLE IF NOT EXISTS doctors (
    doctor_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    specialty TEXT NOT NULL,
    available_days TEXT
  );

  CREATE TABLE IF NOT EXISTS appointment_slots (
    slot_id TEXT PRIMARY KEY,
    doctor_id TEXT NOT NULL,
    date TEXT NOT NULL, -- YYYY-MM-DD
    time TEXT NOT NULL, -- e.g. "10:00 AM"
    is_available INTEGER DEFAULT 1,
    FOREIGN KEY(doctor_id) REFERENCES doctors(doctor_id)
  );

  CREATE TABLE IF NOT EXISTS appointments (
    appointment_id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    doctor_id TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    treatment_type TEXT NOT NULL,
    status TEXT DEFAULT 'SCHEDULED', -- SCHEDULED, CONFIRMED, COMPLETED, CANCELLED
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(patient_id) REFERENCES patients(patient_id),
    FOREIGN KEY(doctor_id) REFERENCES doctors(doctor_id)
  );

  CREATE TABLE IF NOT EXISTS call_logs (
    call_sid TEXT PRIMARY KEY,
    phone TEXT NOT NULL,
    patient_id TEXT,
    call_reason TEXT,
    started_at TEXT DEFAULT (datetime('now')),
    ended_at TEXT,
    outcome TEXT,
    notes TEXT,
    transcript_summary TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone);
  CREATE INDEX IF NOT EXISTS idx_active_contexts_patient ON active_contexts(patient_id);
  CREATE INDEX IF NOT EXISTS idx_slots_doctor_date ON appointment_slots(doctor_id, date, is_available);
`;

/**
 * Validates that an active context object contains all required fields.
 * Throws an Error if any required field is missing.
 */
export function validateContextContract(context) {
  if (!context || typeof context !== "object") {
    throw new Error("Context must be a non-null object");
  }

  const { patient, activeContext } = context;

  if (!patient) {
    throw new Error("Missing 'patient' field in context contract");
  }

  for (const field of REQUIRED_PATIENT_FIELDS) {
    if (!patient[field]) {
      throw new Error(`Missing required patient field: ${field}`);
    }
  }

  if (!activeContext) {
    throw new Error("Missing 'activeContext' field in context contract");
  }

  for (const field of REQUIRED_ACTIVE_CONTEXT_FIELDS) {
    if (!activeContext[field]) {
      throw new Error(`Missing required active context field: ${field}`);
    }
  }

  if (activeContext.lastVisit) {
    for (const field of REQUIRED_LAST_VISIT_FIELDS) {
      if (!activeContext.lastVisit[field]) {
        throw new Error(`Missing required lastVisit field: ${field}`);
      }
    }
  }

  return true;
}
