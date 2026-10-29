# Real-Time AI Outbound Voice Assistant (Exotel + Google Gemini Live + SQLite)

A full-duplex, real-time conversational AI phone calling system. The application bridges **Exotel Cloud Telephony (Connect Voice AI)** with **Google Gemini's Multimodal Live API (`BidiGenerateContent`)** and a local **relational SQLite clinical database** to conduct context-aware, low-latency, two-way voice conversations over regular cellular networks.

---

## Table of Contents
1. [Product Overview](#product-overview)
2. [Key Features](#key-features)
3. [Architecture & Tech Stack](#architecture--tech-stack)
4. [Separate Required Data Fields for Lookup](#separate-required-data-fields-for-lookup)
5. [Database Models & SQLite Schema](#database-models--sqlite-schema)
6. [Dynamic Prompting Engine](#dynamic-prompting-engine)
7. [Gemini Real-Time Database Tool Calling](#gemini-real-time-database-tool-calling)
8. [Project Structure](#project-structure)
9. [End-to-End Workflow](#end-to-end-workflow)
10. [Detailed Code & Method Breakdown](#detailed-code--method-breakdown)
   - [src/db/schema.js](#srcdbschemajs)
   - [src/db/database.js](#srcdbdatabasejs)
   - [src/telephony/promptBuilder.js](#srctelephonypromptbuilderjs)
   - [src/routes/outboundCalls.js](#srcroutesoutboundcallsjs)
   - [src/telephony/exotelMedia.js](#srctelephonyexotelmediajs)
   - [src/audio/pcm.js](#srcaudiopcmjs)
   - [src/server.js](#srcserverjs)
11. [Audio Pipeline & DSP Mechanics](#audio-pipeline--dsp-mechanics)
12. [Environment Configuration (.env)](#environment-configuration-env)
13. [Setup & Running Locally](#setup--running-locally)
14. [API Reference](#api-reference)

---

## Product Overview

* **Use Case**: Automated appointment booking assistant (**"Maya"**) for **Brightside Dental Clinic**.
* **Role**: Placed via outbound phone call to a patient's mobile number. Before dialing, it **looks up the patient's active medical history, last visit details, pending actions, and doctor's schedule from the database**, then dynamically tailors Maya's personality, greeting, clinical context, and available appointment slots.
* **Telephony Provider**: [Exotel](https://exotel.com) (Connect Voice AI bidirectional streaming).
* **AI Engine**: Google Gemini Multimodal Live API (`gemini-3.1-flash-live-preview`) using WebSocket bidirectional streaming with synthetic voice output (`Puck`).
* **Database**: Local SQLite database with Write-Ahead Logging (`WAL`) mode, storing patients, active contexts, doctors, live appointment slots, booked appointments, and call logs.

---

## Key Features

- **Active Database Lookup**: Looks up patient profile, past visit procedures, clinical notes, and pending treatment plans before the call begins.
- **Dynamic Context-Aware Prompting**: Prompts are dynamically generated per call. Maya introduces herself, references the caller's preferred name, asks about recovery from their specific previous procedure (e.g., root canal on tooth #14), and proposes matching open slots.
- **Real-Time Interactive DB Tools**: Maya can interact with the clinic database live during the call:
  - Query real-time open slots (`check_available_slots`).
  - Book and confirm appointments directly into the database (`book_appointment`).
  - Retrieve patient medical history and allergies (`lookup_patient_info`).
- **Full-Duplex Audio & Sub-Second Latency**: Simultaneous, bi-directional streaming of raw audio. Native audio-in/audio-out eliminates intermediate text translation latency.
- **True Barge-In (Interruption Detection)**: If the caller interrupts while Maya is speaking, audio playback stops immediately, and an `event: "clear"` packet is sent to Exotel to flush the telephony carrier's playout buffer.
- **Linear Audio Resampling**: Fast 16-bit linear PCM resampling between Gemini's 24 kHz output and Exotel's 16 kHz telephony rate.
- **100 ms Frame Pacing**: Delivers audio in exact 3,200-byte frames on a 100 ms interval timer to prevent buffer underrun and robotic stutter.
- **Coordinated Call Teardown**: When the booking is finished, Maya says goodbye and calls `end_call`. The server lets all goodbye audio frames drain completely before closing the line.

---

## Architecture & Tech Stack

```
                        ┌──────────────────────────────────────────────┐
                        │            User's Mobile Phone               │
                        └──────────────────────┬───────────────────────┘
                                               │ Cellular Call (GSM / VoLTE)
                                               ▼
                        ┌──────────────────────────────────────────────┐
                        │             Exotel Telephony                 │
                        └──────────────┬───────────────────────────────┘
                                       │
              1. REST Call Trigger     │ 2. Bidirectional Audio (PCM)
        (POST /v1/.../Calls/connect)   │    WebSocket (/exotel/media)
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                 Node.js Application (testing_call)                          │
│                                                                             │
│  ┌───────────────────────┐             ┌─────────────────────────────────┐  │
│  │  src/routes/          │             │  src/telephony/exotelMedia.js   │  │
│  │  outboundCalls.js     │             │                                 │  │
│  │  (Trigger Outbound)   │             │  • 100ms Audio Framing (3200 B) │  │
│  └───────────┬───────────┘             │  • Jitter & Queue Control       │  │
│              │                         │  • Barge-in / Interrupt Clear   │  │
│              ▼                         │  • Real-time Tool Dispatch      │  │
│  ┌───────────────────────┐             │  • end_call Coordination        │  │
│  │  src/db/database.js   │◄───────────►└──────────────┬──────────────────┘  │
│  │  (SQLite Clinical DB) │                            │                     │
│  └───────────┬───────────┘                            │                     │
│              │ (Context)                              │                     │
│              ▼                                        │                     │
│  ┌───────────────────────┐                            │                     │
│  │  src/telephony/       │                            │                     │
│  │  promptBuilder.js     │                            │                     │
│  │  (Dynamic Prompts)    │                            │                     │
│  └───────────────────────┘                            │                     │
│  ┌───────────────────────┐                            │                     │
│  │  src/audio/pcm.js     │◄───────────────────────────┘                     │
│  │  (Resampling 16k↔24k) │                                                  │
│  └───────────────────────┘                                                  │
└───────────────────────────────────────┬─────────────────────────────────────┘
                                        │
                                        │ 3. Full-Duplex Multimodal Live API
                                        │    WebSocket (PCM 16k in / 24k out)
                                        ▼
                        ┌──────────────────────────────────────────────┐
                        │           Google Gemini Live API             │
                        │       (gemini-3.1-flash-live-preview)        │
                        └──────────────────────────────────────────────┘
```

---

## Separate Required Data Fields for Lookup

To ensure the AI voice assistant has the complete context for every call, the data fields are divided into **Input Lookup Keys**, **Required Patient Profile Fields**, and **Required Active Context Fields**:

### 1. Lookup Input Keys
* **Primary Key**: `phone` (E.164 format, e.g. `+918218627040`)
* **Secondary Key**: `patientId` (e.g. `PAT-1042`)

### 2. Separate Required Patient Profile Fields
When querying the database, the returned `patient` object must contain:
| Field Name | Type | Description | Example |
|---|---|---|---|
| `patientId` | String | Unique patient identifier | `"PAT-1042"` |
| `phone` | String | Verified phone number | `"+918218627040"` |
| `fullName` | String | Legal full name | `"Surender Kumar"` |
| `preferredName` | String | Preferred conversational name | `"Surender"` |
| `assignedDoctorId` | String | Primary doctor identifier | `"DOC-1"` |
| `assignedDoctorName`| String | Primary doctor full name | `"Dr. Sneha Rao"` |
| `medicalAlerts` | Array | Known allergies and conditions | `["Allergic to Penicillin", "Mild dental anxiety"]` |
| `insurancePlan` | String | Active insurance provider | `"BrightCare Dental Platinum Plan"` |
| `preferredTimeOfDay`| String | Morning / Afternoon / Evening | `"Morning"` |
| `generalNotes` | String | Clinical history notes | `"Recent root canal on #14; needs crown."` |

### 3. Separate Required Active Context Fields
The `activeContext` object holds the active clinical reason for the call:
| Field Name | Type | Description | Example |
|---|---|---|---|
| `contextId` | String | Unique context record ID | `"CTX-2001"` |
| `callGoal` | String | High-level clinical goal enum | `"CROWN_PLACEMENT_SCHEDULING"` |
| `callReason` | String | Conversational purpose of call | `"Post-root-canal check & schedule crown"` |
| `lastVisit.date` | String | Date of previous procedure | `"2026-10-18"` |
| `lastVisit.procedure`| String | Specific procedure performed | `"Root Canal Therapy on Tooth #14"` |
| `lastVisit.doctor` | String | Doctor who performed procedure | `"Dr. Sneha Rao"` |
| `lastVisit.outcome` | String | Clinical notes & recovery state | `"Canals sealed. Temporary filling placed."` |
| `pendingAction` | String | Exact task AI must accomplish | `"Check tooth sensitivity and book crown."` |
| `recommendedDurationMinutes` | Number | Appointment time needed | `45` |
| `urgency` | String | Clinical priority | `"HIGH"` |

---

## Database Models & SQLite Schema

The database is defined in [`src/db/schema.js`](file:///home/cm113/Downloads/testing_call/src/db/schema.js) and initialized in [`src/db/database.js`](file:///home/cm113/Downloads/testing_call/src/db/database.js) at `data/clinic.db`.

```sql
-- Patients table
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

-- Active clinical contexts & recall objectives
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

-- Doctors table
CREATE TABLE IF NOT EXISTS doctors (
  doctor_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  specialty TEXT NOT NULL,
  available_days TEXT
);

-- Live open appointment slots
CREATE TABLE IF NOT EXISTS appointment_slots (
  slot_id TEXT PRIMARY KEY,
  doctor_id TEXT NOT NULL,
  date TEXT NOT NULL, -- YYYY-MM-DD
  time TEXT NOT NULL, -- e.g. "10:00 AM"
  is_available INTEGER DEFAULT 1,
  FOREIGN KEY(doctor_id) REFERENCES doctors(doctor_id)
);

-- Booked appointments table
CREATE TABLE IF NOT EXISTS appointments (
  appointment_id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  doctor_id TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  treatment_type TEXT NOT NULL,
  status TEXT DEFAULT 'SCHEDULED',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(patient_id) REFERENCES patients(patient_id),
  FOREIGN KEY(doctor_id) REFERENCES doctors(doctor_id)
);

-- Call history & outcome logs
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
```

---

## Dynamic Prompting Engine

Instead of generic, static instructions, [`src/telephony/promptBuilder.js`](file:///home/cm113/Downloads/testing_call/src/telephony/promptBuilder.js) combines the looked-up patient record, active context, doctor profile, and available slots into an individualized prompt:

```text
=== ACTIVE PATIENT RECORD (LOOKED UP FROM CLINIC DATABASE) ===
• Patient ID: PAT-1042
• Full Name: Surender Kumar (Prefers to be called: "Surender")
• Phone: +918218627040
• Primary Doctor: Dr. Sneha Rao (Senior Endodontist & Implant Specialist)
• Medical Alerts / Patient Notes: Allergic to Penicillin, Mild dental anxiety, Prefers morning appointments
• Insurance Coverage: BrightCare Dental Platinum Plan
• Preferred Time of Day: Morning

=== ACTIVE CLINICAL CONTEXT & CALL PURPOSE ===
• Call Reason: Post-root-canal recovery check & scheduling permanent crown fitting
• Call Goal: CROWN_PLACEMENT_SCHEDULING
• Last Visit Date: 2026-10-18
• Last Visit Procedure: Root Canal Therapy (Stage 1 & 2) on Tooth #14
• Treating Doctor: Dr. Sneha Rao
• Clinical Outcome: Canals sealed. Temporary filling placed. Permanent crown needed within 2-3 weeks to avoid tooth fracture.
• Required Action on This Call: Check how tooth #14 is feeling, and schedule 45-min appointment for permanent crown fitting.

=== CURRENTLY AVAILABLE APPOINTMENT SLOTS IN DATABASE ===
• 2026-10-29 at 10:00 AM with Dr. Sneha Rao
• 2026-10-29 at 11:30 AM with Dr. Sneha Rao
• 2026-10-30 at 09:30 AM with Dr. Sneha Rao
```

### Initial Greeting Injection
When the call connects, the following dynamic instruction triggers Maya's opening line:
> *"The phone call has just connected with Surender. Greet Surender warmly by name, introduce yourself as Maya from Brightside Dental Clinic, and state that you are calling to check how they are feeling after their Root Canal Therapy on Tooth #14. Keep your opening greeting under 20 words."*

---

## Gemini Real-Time Database Tool Calling

The assistant is equipped with four function tools defined in Gemini's session configuration:

1. **`check_available_slots`**:
   - *Arguments*: `{ date?: string, doctorId?: string }`
   - *Behavior*: Queries `appointment_slots` in real time. Returns live open slots to Gemini so Maya can propose new dates if the caller asks for alternative times.
2. **`book_appointment`**:
   - *Arguments*: `{ patientId, doctorId, date, time, treatmentType, notes }`
   - *Behavior*: Inserts a record into `appointments`, updates `appointment_slots` (`is_available = 0`), and returns a confirmation code (e.g. `APT-800663`) that Maya confirms to the caller over the phone.
3. **`lookup_patient_info`**:
   - *Arguments*: `{ phone?: string, patientId?: string }`
   - *Behavior*: Retrieves updated patient records, allergies, or past procedures from the database.
4. **`end_call`**:
   - *Arguments*: `{ reason: string }`
   - *Behavior*: Logs call completion in `call_logs` and schedules stream hangup after goodbye audio finishes.

---

## Project Structure

```
testing_call/
├── .env                         # Secrets, API keys, URLs, and allowed test numbers
├── package.json                 # Dependencies (express, ws, dotenv, better-sqlite3)
├── README.md                    # Project documentation
├── data/                        # Persistent SQLite database directory (gitignored)
│   └── clinic.db
└── src/
    ├── server.js                # HTTP server, WebSocket binding & health checks
    ├── db/
    │   ├── schema.js            # Schemas, required lookup contracts & SQL DDL
    │   ├── database.js          # SQLite client, lookup methods, booking & call logging
    │   └── seedData.js          # Sample patients (including TEST_PHONE_NUMBER) & slots
    ├── routes/
    │   └── outboundCalls.js     # REST routes (POST /api/calls, GET /api/context, slots)
    ├── telephony/
    │   ├── exotelMedia.js       # Core bridge between Exotel and Gemini WebSockets
    │   └── promptBuilder.js     # Context-aware dynamic prompt and greeting builder
    └── audio/
        └── pcm.js               # Linear interpolation 16-bit PCM resampler
```

---

## Detailed Code & Method Breakdown

### `src/db/schema.js`
* Defines `LOOKUP_INPUT_FIELDS` (`phone`, `patientId`).
* Defines `REQUIRED_PATIENT_FIELDS` and `REQUIRED_ACTIVE_CONTEXT_FIELDS` arrays.
* Exports `SQL_SCHEMA`: Full DDL statements for `patients`, `active_contexts`, `doctors`, `appointment_slots`, `appointments`, and `call_logs`.
* Exports `validateContextContract(context)`: Enforces that no required field is undefined before returning from DB lookups.

### `src/db/database.js`
* **`getDb()`**: Singleton initialization of `better-sqlite3` instance with WAL mode (`journal_mode = WAL`) and foreign keys enabled.
* **`seedIfEmpty(db)`**: Seeds initial doctors, patients (including the configured `TEST_PHONE_NUMBER`), active clinical contexts, and upcoming open slots on first run.
* **`lookupPatientContext({ phone, patientId })`**:
  * Relational query joining patient, active context, assigned doctor, and live slots.
  * Formats into a clean contract.
  * If phone is unknown, returns a structured "New Patient" context so the assistant can handle unregistered callers.
* **`getAvailableSlots({ doctorId, date })`**: Filters open slots from `appointment_slots`.
* **`bookAppointment({ patientId, doctorId, date, time, treatmentType, notes })`**: Atomic transaction inserting an appointment and marking the slot unavailable.
* **`saveCallLog({ callSid, phone, patientId, callReason, outcome, notes })`**: Records call interaction into `call_logs`.

### `src/telephony/promptBuilder.js`
* **`buildSystemPrompt(context)`**: Injects patient name, allergies, doctor, last procedure, pending clinical action, and available slots into the system prompt.
* **`buildInitialGreetingPrompt(context)`**: Generates the opening greeting instruction tailored to the patient and procedure.
* **`END_RULES`**: Directives for natural goodbyes before calling `end_call`.

### `src/routes/outboundCalls.js`
* **`GET /api/context`**: Test endpoint to inspect the exact active DB context for a phone number.
* **`GET /api/slots`**: Queries all currently open appointment slots.
* **`GET /api/appointments`**: Lists booked appointments in the database.
* **`POST /api/calls`**:
  * Validates recipient phone format (`+91XXXXXXXXXX`) and test whitelist.
  * Executes `lookupPatientContext({ phone: to })`.
  * Appends `?phone=...&patientId=...` to Exotel's `StreamUrl`.
  * Sends Exotel call connect request and returns call SID + active context summary.

### `src/telephony/exotelMedia.js`
* Mounts WebSocket server at `/exotel/media`.
* Parses `phone` and `patientId` from incoming connection URL.
* Queries `lookupPatientContext` to populate `activeContext`.
* Connects to Gemini Live API with dynamic system prompt and tool definitions.
* Dispatches tool executions (`check_available_slots`, `book_appointment`, `lookup_patient_info`, `end_call`) and returns `toolResponse` back to Gemini.
* Handles audio resampling, 100 ms frame pacing (3,200 bytes), barge-in interruptions, and deferred call teardown.

---

## Setup & Running Locally

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment (.env)
```env
PORT=3001
TEST_PHONE_NUMBER=+918218627040

GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.1-flash-live-preview
GEMINI_VOICE=Puck

EXOTEL_ACCOUNT_SID=your_exotel_account_sid
EXOTEL_API_KEY=your_exotel_api_key
EXOTEL_API_TOKEN=your_exotel_api_token
EXOTEL_CALLER_ID=your_exotel_caller_id
EXOTEL_API_BASE_URL=https://api.exotel.com

PUBLIC_WSS_URL=wss://your-tunnel-subdomain.ngrok-free.app/exotel/media
```

### 3. Expose Server to Internet (ngrok)
```bash
ngrok http 3001
```
Set `PUBLIC_WSS_URL` in `.env` to the assigned `wss://...` address.

### 4. Build & Database Management (Debugging & Testing)
To clear and re-seed the SQLite database with fresh doctors, patients, clinical contexts, and appointment slots:
```bash
# Option A: Run build or clear-db command
npm run build       # Clears tables and re-seeds database
npm run db:clear    # Alias for clearing and re-seeding
npm run db:reset    # Alias for clearing and re-seeding

# Option B: Run server with auto-clear enabled
CLEAR_DB=true npm run dev
```

### 5. Start the Application
```bash
# Starts Express, initializes SQLite, and registers WebSockets
npm run dev
```

---

## API Reference

### 1. Check Active Patient Context
Inspects the looked-up active context for a phone number.

* **Endpoint**: `GET /api/context?phone=+918218627040`
* **Response**:
  ```json
  {
    "ok": true,
    "context": {
      "patient": {
        "patientId": "PAT-1042",
        "phone": "+918218627040",
        "fullName": "Surender Kumar",
        "preferredName": "Surender",
        "assignedDoctorName": "Dr. Sneha Rao",
        "medicalAlerts": ["Allergic to Penicillin", "Mild dental anxiety"]
      },
      "activeContext": {
        "callGoal": "CROWN_PLACEMENT_SCHEDULING",
        "callReason": "Post-root-canal recovery check & scheduling permanent crown fitting",
        "lastVisit": {
          "date": "2026-10-18",
          "procedure": "Root Canal Therapy (Stage 1 & 2) on Tooth #14",
          "doctor": "Dr. Sneha Rao"
        },
        "pendingAction": "Check how tooth #14 is feeling and schedule crown fitting."
      },
      "availableSlots": [
        { "slotId": "SLOT-101", "date": "2026-10-29", "time": "10:00 AM" }
      ]
    }
  }
  ```

---

### 2. Query Live Available Slots
* **Endpoint**: `GET /api/slots`

---

### 3. List Booked Appointments
* **Endpoint**: `GET /api/appointments`

---

### 4. Trigger Outbound Context-Aware Call
* **Endpoint**: `POST /api/calls`
* **Body**:
  ```json
  {
    "to": "+918218627040"
  }
  ```
* **Response (`202 Accepted`)**:
  ```json
  {
    "accepted": true,
    "call": {
      "sid": "0123456789abcdef0123456789abcdef",
      "status": "in-progress"
    },
    "activeContext": {
      "patient": { "fullName": "Surender Kumar", "preferredName": "Surender" },
      "clinicalContext": { "callGoal": "CROWN_PLACEMENT_SCHEDULING" }
    }
  }
  ```

---

### 5. Clear / Reset Database (Debugging & Testing)
Resets all clinic tables and re-seeds fresh data on the running server.
* **Endpoint**: `POST /api/db/clear` (or `POST /api/db/reset`)
* **Response**:
  ```json
  {
    "ok": true,
    "message": "Database cleared and re-seeded successfully for debugging",
    "result": {
      "success": true,
      "cleared": true,
      "reseeded": true,
      "counts": {
        "doctorsCount": 2,
        "patientsCount": 3,
        "contextsCount": 3,
        "slotsCount": 9
      }
    }
  }
  ```
