/**
 * Shared Gemini Live Function Declarations for Apex Multispecialty Hospital.
 * Used for pre-warming sessions and active media stream execution.
 */

export const GEMINI_TOOLS = [
  {
    functionDeclarations: [
      {
        name: "end_call",
        description:
          "Ends the current phone call after speaking your polite goodbye. Only call this when the conversation has reached a natural conclusion and any requested appointment has been confirmed.",
        parameters: {
          type: "OBJECT",
          properties: {
            reason: {
              type: "STRING",
              description: "Brief reason why the call concluded",
            },
          },
          required: ["reason"],
        },
      },
      {
        name: "check_available_slots",
        description:
          "Queries the hospital database in real time for open appointment slots. IMPORTANT: Always speak a brief conversational filler first (e.g., 'Let me check the doctor schedule for you right now...') before calling this tool.",
        parameters: {
          type: "OBJECT",
          properties: {
            date: {
              type: "STRING",
              description: "Date in YYYY-MM-DD format (optional)",
            },
            doctorId: {
              type: "STRING",
              description:
                "Doctor ID e.g. DOC-CARD, DOC-ENT, DOC-EYE, DOC-LIV, DOC-DENT, DOC-ORTHO, DOC-MED (optional)",
            },
            department: {
              type: "STRING",
              description:
                "Hospital department e.g. Cardiology, ENT, Ophthalmology, Hepatology, Dental, Orthopedics, General Medicine (optional)",
            },
          },
        },
      },
      {
        name: "register_new_patient",
        description:
          "Registers a new patient into the hospital database as soon as they provide their name. IMPORTANT: Call this IMMEDIATELY as soon as the caller mentions their name (e.g. 'I am Aman' or 'My name is Rahul'). Always speak a brief conversational filler first (e.g., 'Please wait just a moment while I register you in our hospital system...') before calling this tool.",
        parameters: {
          type: "OBJECT",
          properties: {
            fullName: {
              type: "STRING",
              description:
                "Full name of the caller/patient (e.g. 'Aman', 'Aman Gupta', 'Rahul Sharma')",
            },
            preferredName: {
              type: "STRING",
              description:
                "Preferred first name for address (optional, e.g. 'Aman')",
            },
            phone: {
              type: "STRING",
              description:
                "Patient phone number (optional, defaults to caller phone)",
            },
            department: {
              type: "STRING",
              description:
                "Target hospital department: Cardiology, Ophthalmology, ENT, Hepatology, Dental, Orthopedics, or General Medicine (optional)",
            },
            reason: {
              type: "STRING",
              description:
                "Medical concern, primary symptoms, or consultation request (e.g. 'Chest pain evaluation', 'Cataract review', 'Knee sports injury', 'General checkup')",
            },
            age: {
              type: "INTEGER",
              description: "Patient age in years (optional)",
            },
            gender: {
              type: "STRING",
              description: "Gender: Male, Female, or Other (optional)",
            },
            medicalAlerts: {
              type: "ARRAY",
              items: { type: "STRING" },
              description:
                "Any known allergies or conditions mentioned by the caller (optional)",
            },
          },
          required: ["fullName"],
        },
      },
      {
        name: "book_appointment",
        description:
          "Books and confirms an appointment in the hospital database for the patient and reserves the slot. IMPORTANT: Always speak a brief conversational filler first (e.g., 'One moment please, locking in your appointment right now...') before calling this tool. You MUST call this function when the patient agrees to an appointment date and time.",
        parameters: {
          type: "OBJECT",
          properties: {
            patientId: {
              type: "STRING",
              description:
                "Patient ID e.g. PAT-1042 or PAT-2002 (optional if patientName is given)",
            },
            patientName: {
              type: "STRING",
              description:
                "Full name of the patient (e.g. 'Aman', 'Aman Gupta') - ALWAYS provide the caller's stated name when booking for a new or unindexed patient.",
            },
            doctorId: {
              type: "STRING",
              description:
                "Doctor ID e.g. DOC-CARD, DOC-ENT, DOC-EYE, DOC-LIV, DOC-DENT, DOC-ORTHO, DOC-MED (optional)",
            },
            department: {
              type: "STRING",
              description:
                "Hospital department name e.g. Cardiology, ENT, Ophthalmology, Hepatology, Dental, Orthopedics, General Medicine (optional)",
            },
            date: {
              type: "STRING",
              description: "Date in YYYY-MM-DD format (e.g. 2026-10-31)",
            },
            time: {
              type: "STRING",
              description: "Time slot e.g. '10:00 AM' or '02:30 PM'",
            },
            treatmentType: {
              type: "STRING",
              description:
                "Procedure or consultation name e.g. 'Cardiology Consult', 'Eye Cataract Review', 'General Checkup'",
            },
            notes: {
              type: "STRING",
              description: "Any special patient requests or clinical notes",
            },
          },
          required: ["date", "time"],
        },
      },
      {
        name: "lookup_patient_info",
        description:
          "Looks up active patient medical history, previous procedure details, clinical notes, and doctor information from the database.",
        parameters: {
          type: "OBJECT",
          properties: {
            phone: {
              type: "STRING",
              description: "Patient phone number (optional)",
            },
            patientId: {
              type: "STRING",
              description: "Patient unique ID (optional)",
            },
          },
        },
      },
    ],
  },
];
