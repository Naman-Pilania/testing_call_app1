/**
 * Seed data for Apex Multispecialty Hospital.
 * Seeds comprehensive hospital departments, doctors, patients,
 * active clinical follow-up contexts, and open appointment slots across:
 * - Cardiology (Heart)
 * - Ophthalmology (Eyes)
 * - ENT (Ear, Nose & Throat)
 * - Hepatology (Liver & Gastroenterology)
 * - Dental & Maxillofacial (Dental)
 * - Orthopedics (Joint & Bone)
 * - General Medicine
 */

export function getSeedData(configuredTestPhone = "+918218627040") {
  const testPhone = process.env.TEST_PHONE_NUMBER || configuredTestPhone;

  // Compute dynamic relative dates (tomorrow, day after tomorrow, etc.)
  const now = new Date();
  const formatDate = (offsetDays) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().split("T")[0]; // YYYY-MM-DD
  };

  const tomorrow = formatDate(1);
  const dayAfter = formatDate(2);
  const inThreeDays = formatDate(3);

  const doctors = [
    {
      doctor_id: "DOC-CARD",
      name: "Dr. Rajesh Sharma",
      specialty: "Senior Consultant Interventional Cardiologist",
      department: "Cardiology",
      available_days: "Monday, Tuesday, Thursday, Friday",
    },
    {
      doctor_id: "DOC-ENT",
      name: "Dr. Farhan Al-Mansoor",
      specialty: "Senior ENT & Head-Neck Surgeon",
      department: "ENT",
      available_days: "Monday, Wednesday, Friday, Saturday",
    },
    {
      doctor_id: "DOC-EYE",
      name: "Dr. Ananya Iyer",
      specialty: "Chief Vitreo-Retinal & Cataract Surgeon",
      department: "Ophthalmology",
      available_days: "Tuesday, Thursday, Friday, Saturday",
    },
    {
      doctor_id: "DOC-LIV",
      name: "Dr. Priya Mukherjee",
      specialty: "Lead Hepatologist & Gastroenterologist",
      department: "Hepatology",
      available_days: "Monday, Tuesday, Wednesday, Friday",
    },
    {
      doctor_id: "DOC-DENT",
      name: "Dr. Sneha Rao",
      specialty: "Senior Maxillofacial & Dental Surgeon",
      department: "Dental",
      available_days: "Monday, Wednesday, Thursday, Saturday",
    },
    {
      doctor_id: "DOC-ORTHO",
      name: "Dr. Arun Verma",
      specialty: "Senior Joint Replacement & Spine Surgeon",
      department: "Orthopedics",
      available_days: "Monday, Thursday, Friday, Saturday",
    },
    {
      doctor_id: "DOC-MED",
      name: "Dr. Sunita Kapoor",
      specialty: "Consultant Physician & Diabetologist",
      department: "General Medicine",
      available_days: "Monday through Saturday",
    },
  ];

  const patients = [
    {
      patient_id: "PAT-1042",
      phone: testPhone,
      full_name: "Surender Kumar",
      preferred_name: "Surender",
      age: 52,
      gender: "Male",
      assigned_doctor_id: "DOC-CARD",
      medical_alerts: JSON.stringify([
        "Type 2 Diabetes",
        "Hypertension",
        "On Dual Antiplatelet Therapy (Ecosprin + Ticagrelor)",
      ]),
      insurance_plan: "Apex Comprehensive Heart & Health Shield",
      preferred_time_of_day: "Morning",
      general_notes:
        "Underwent primary coronary angioplasty with drug-eluting stent (DES) in LAD 3 weeks ago; requires routine 30-day post-stent cardiac evaluation.",
    },
    {
      patient_id: "PAT-2002",
      phone: testPhone,
      full_name: "Naman Pilania",
      preferred_name: "Naman",
      age: 29,
      gender: "Male",
      assigned_doctor_id: "DOC-ENT",
      medical_alerts: JSON.stringify([
        "Mild Allergic Asthma",
        "Allergic to Ibuprofen (NSAIDs)",
      ]),
      insurance_plan: "CareFirst Multispecialty PPO",
      preferred_time_of_day: "Morning",
      general_notes:
        "Underwent Functional Endoscopic Sinus Surgery (FESS) & Septoplasty 10 days ago; needs post-op airway examination and nasal cavity debridement.",
    },
    {
      patient_id: "PAT-1088",
      phone: testPhone,
      full_name: "Priya Sharma",
      preferred_name: "Priya",
      age: 61,
      gender: "Female",
      assigned_doctor_id: "DOC-EYE",
      medical_alerts: JSON.stringify([
        "Sulfa Allergy",
        "Early stage dry-eye syndrome",
      ]),
      insurance_plan: "VisionCare Senior Plus",
      preferred_time_of_day: "Afternoon",
      general_notes:
        "Had micro-incision cataract surgery on left eye 2 weeks ago; scheduled for follow-up visual acuity check and intraocular pressure (IOP) measurement.",
    },
    {
      patient_id: "PAT-3001",
      phone: testPhone,
      full_name: "Vikram Malhotra",
      preferred_name: "Vikram",
      age: 44,
      gender: "Male",
      assigned_doctor_id: "DOC-LIV",
      medical_alerts: JSON.stringify([
        "Elevated ALT/AST liver enzymes",
        "Fatty Liver Grade II",
      ]),
      insurance_plan: "Corporate Executive Health Gold",
      preferred_time_of_day: "Afternoon",
      general_notes:
        "Recently diagnosed with Metabolic Dysfunction-Associated Steatohepatitis (MASH); requires FibroScan staging review and hepatology dietary protocol.",
    },
    {
      patient_id: "PAT-3002",
      phone: testPhone,
      full_name: "Sunita Patel",
      preferred_name: "Sunita",
      age: 38,
      gender: "Female",
      assigned_doctor_id: "DOC-DENT",
      medical_alerts: JSON.stringify([
        "Penicillin Allergy",
        "Mild dental anxiety",
      ]),
      insurance_plan: "DentalCare Platinum Plus",
      preferred_time_of_day: "Morning",
      general_notes:
        "Completed root canal therapy on Tooth #14 recently; temporary restoration intact, scheduled for permanent zirconia crown placement.",
    },
    {
      patient_id: "PAT-3003",
      phone: testPhone,
      full_name: "Rohan Gupta",
      preferred_name: "Rohan",
      age: 32,
      gender: "Male",
      assigned_doctor_id: "DOC-ORTHO",
      medical_alerts: JSON.stringify(["Post-ACL Reconstruction (Right Knee)"]),
      insurance_plan: "SportsShield Active Ortho",
      preferred_time_of_day: "Afternoon",
      general_notes:
        "4 weeks post-operative from arthroscopic ACL reconstruction with hamstring graft; needs range of motion assessment and rehabilitation clearance.",
    },
  ];

  const activeContexts = [
    {
      context_id: "CTX-101",
      patient_id: "PAT-1042",
      call_goal: "CARDIOLOGY_POST_STENT_CHECK",
      call_reason:
        "30-day post-angioplasty recovery check, medication adherence verification, and stress echo scheduling",
      last_visit_date: "2026-10-08",
      last_visit_procedure: "Coronary Angioplasty with LAD Stent Placement",
      last_visit_doctor: "Dr. Rajesh Sharma",
      last_visit_outcome:
        "Successful DES deployment in proximal LAD. Good TIMI III distal flow. Discharged on dual antiplatelet therapy.",
      pending_action:
        "Schedule 30-Day Follow-up & Resting ECG with Dr. Rajesh Sharma",
      recommended_duration_minutes: 30,
      urgency: "HIGH",
      is_active: 1,
    },
    {
      context_id: "CTX-202",
      patient_id: "PAT-2002",
      call_goal: "ENT_POST_OP_AIRWAY_CHECK",
      call_reason:
        "Post-op FESS sinus recovery assessment, nasal breathing evaluation, and cavity debridement booking",
      last_visit_date: "2026-10-18",
      last_visit_procedure:
        "Functional Endoscopic Sinus Surgery (FESS) & Septoplasty",
      last_visit_doctor: "Dr. Farhan Al-Mansoor",
      last_visit_outcome:
        "Bilateral ethmoidectomy and maxillary antrostomy completed without hemorrhage. Airway patent.",
      pending_action:
        "Schedule Post-Op Airway Inspection & Nasal Endoscopy with Dr. Farhan Al-Mansoor",
      recommended_duration_minutes: 20,
      urgency: "HIGH",
      is_active: 1,
    },
    {
      context_id: "CTX-303",
      patient_id: "PAT-1088",
      call_goal: "OPHTHALMOLOGY_CATARACT_REVIEW",
      call_reason:
        "2-week post-cataract surgery visual acuity check, eye drop compliance, and IOP evaluation",
      last_visit_date: "2026-10-15",
      last_visit_procedure:
        "Left Eye Micro-Incision Phacoemulsification with IOL",
      last_visit_doctor: "Dr. Ananya Iyer",
      last_visit_outcome:
        "Clear cornea, well-centered acrylic foldable intraocular lens, IOP 14 mmHg.",
      pending_action:
        "Schedule 2-Week Post-Op Slit-Lamp & Vision Exam with Dr. Ananya Iyer",
      recommended_duration_minutes: 25,
      urgency: "MEDIUM",
      is_active: 1,
    },
    {
      context_id: "CTX-404",
      patient_id: "PAT-3001",
      call_goal: "HEPATOLOGY_LIVER_STAGING_REVIEW",
      call_reason:
        "Fatty liver grade II staging review, liver enzyme monitoring, and FibroScan consultation",
      last_visit_date: "2026-10-20",
      last_visit_procedure:
        "Comprehensive Liver Function Panel & Abdominal Ultrasound",
      last_visit_doctor: "Dr. Priya Mukherjee",
      last_visit_outcome:
        "Moderate diffuse hepatic steatosis confirmed. Serum ALT 68 U/L, AST 54 U/L. Recommended FibroScan.",
      pending_action:
        "Schedule Liver FibroScan Staging Consultation with Dr. Priya Mukherjee",
      recommended_duration_minutes: 30,
      urgency: "MEDIUM",
      is_active: 1,
    },
    {
      context_id: "CTX-505",
      patient_id: "PAT-3002",
      call_goal: "DENTAL_CROWN_PLACEMENT",
      call_reason:
        "Post-root-canal recovery verification and scheduling permanent zirconia crown placement",
      last_visit_date: "2026-10-22",
      last_visit_procedure: "Root Canal Therapy on Tooth #14",
      last_visit_doctor: "Dr. Sneha Rao",
      last_visit_outcome:
        "Canals obturated cleanly to apex, asymptomatic recovery reported. Ready for permanent crown.",
      pending_action:
        "Schedule Permanent Zirconia Crown Placement with Dr. Sneha Rao",
      recommended_duration_minutes: 45,
      urgency: "MEDIUM",
      is_active: 1,
    },
    {
      context_id: "CTX-606",
      patient_id: "PAT-3003",
      call_goal: "ORTHOPEDIC_ACL_REHAB_REVIEW",
      call_reason:
        "4-week knee rehabilitation milestone review, weight-bearing assessment, and physical therapy clearance",
      last_visit_date: "2026-10-01",
      last_visit_procedure:
        "Arthroscopic ACL Reconstruction with Hamstring Autograft",
      last_visit_doctor: "Dr. Arun Verma",
      last_visit_outcome:
        "Stable Lachman test, surgical incisions healed cleanly, full extension achieved.",
      pending_action:
        "Schedule 4-Week Functional Knee Assessment with Dr. Arun Verma",
      recommended_duration_minutes: 30,
      urgency: "MEDIUM",
      is_active: 1,
    },
  ];

  const appointmentSlots = [
    // Cardiology (Dr. Rajesh Sharma)
    {
      slot_id: "SLOT-CARD-1",
      doctor_id: "DOC-CARD",
      date: tomorrow,
      time: "10:00 AM",
      is_available: 1,
    },
    {
      slot_id: "SLOT-CARD-2",
      doctor_id: "DOC-CARD",
      date: tomorrow,
      time: "02:30 PM",
      is_available: 1,
    },
    {
      slot_id: "SLOT-CARD-3",
      doctor_id: "DOC-CARD",
      date: dayAfter,
      time: "11:30 AM",
      is_available: 1,
    },

    // ENT (Dr. Farhan Al-Mansoor)
    {
      slot_id: "SLOT-ENT-1",
      doctor_id: "DOC-ENT",
      date: tomorrow,
      time: "11:00 AM",
      is_available: 1,
    },
    {
      slot_id: "SLOT-ENT-2",
      doctor_id: "DOC-ENT",
      date: tomorrow,
      time: "03:30 PM",
      is_available: 1,
    },
    {
      slot_id: "SLOT-ENT-3",
      doctor_id: "DOC-ENT",
      date: dayAfter,
      time: "10:00 AM",
      is_available: 1,
    },

    // Ophthalmology (Dr. Ananya Iyer)
    {
      slot_id: "SLOT-EYE-1",
      doctor_id: "DOC-EYE",
      date: tomorrow,
      time: "09:30 AM",
      is_available: 1,
    },
    {
      slot_id: "SLOT-EYE-2",
      doctor_id: "DOC-EYE",
      date: tomorrow,
      time: "04:00 PM",
      is_available: 1,
    },
    {
      slot_id: "SLOT-EYE-3",
      doctor_id: "DOC-EYE",
      date: dayAfter,
      time: "02:00 PM",
      is_available: 1,
    },

    // Hepatology (Dr. Priya Mukherjee)
    {
      slot_id: "SLOT-LIV-1",
      doctor_id: "DOC-LIV",
      date: tomorrow,
      time: "11:30 AM",
      is_available: 1,
    },
    {
      slot_id: "SLOT-LIV-2",
      doctor_id: "DOC-LIV",
      date: tomorrow,
      time: "03:00 PM",
      is_available: 1,
    },
    {
      slot_id: "SLOT-LIV-3",
      doctor_id: "DOC-LIV",
      date: dayAfter,
      time: "04:00 PM",
      is_available: 1,
    },

    // Dental (Dr. Sneha Rao)
    {
      slot_id: "SLOT-DENT-1",
      doctor_id: "DOC-DENT",
      date: tomorrow,
      time: "10:00 AM",
      is_available: 1,
    },
    {
      slot_id: "SLOT-DENT-2",
      doctor_id: "DOC-DENT",
      date: tomorrow,
      time: "02:00 PM",
      is_available: 1,
    },
    {
      slot_id: "SLOT-DENT-3",
      doctor_id: "DOC-DENT",
      date: dayAfter,
      time: "09:30 AM",
      is_available: 1,
    },

    // Orthopedics (Dr. Arun Verma)
    {
      slot_id: "SLOT-ORTHO-1",
      doctor_id: "DOC-ORTHO",
      date: tomorrow,
      time: "01:30 PM",
      is_available: 1,
    },
    {
      slot_id: "SLOT-ORTHO-2",
      doctor_id: "DOC-ORTHO",
      date: dayAfter,
      time: "10:30 AM",
      is_available: 1,
    },

    // General Medicine (Dr. Sunita Kapoor)
    {
      slot_id: "SLOT-MED-1",
      doctor_id: "DOC-MED",
      date: tomorrow,
      time: "12:00 PM",
      is_available: 1,
    },
    {
      slot_id: "SLOT-MED-2",
      doctor_id: "DOC-MED",
      date: dayAfter,
      time: "03:00 PM",
      is_available: 1,
    },
  ];

  const callLogs = [
    {
      call_sid: "EXO-CALL-901121",
      phone: testPhone,
      patient_id: "PAT-1042",
      direction: "OUTBOUND",
      call_reason:
        "Post-angioplasty recovery check & scheduling cardiac stress echo",
      started_at: "2026-10-27 10:30:00",
      ended_at: "2026-10-27 10:34:20",
      outcome: "APPOINTMENT_SCHEDULED",
      notes:
        "Surender reported feeling much better with zero chest discomfort. Confirmed daily adherence to Ecosprin and Ticagrelor. Scheduled 30-day cardiac follow-up with Dr. Rajesh Sharma for tomorrow at 10:00 AM.",
      transcript_summary: `[00:02] Maya (AI): Hello! Am I speaking with Surender?
[00:05] Patient: Yes, this is Surender speaking.
[00:08] Maya (AI): Hello Surender! This is Maya calling from Apex Multispecialty Hospital on behalf of Dr. Rajesh Sharma from our Cardiology Department. I'm checking in following your coronary stent placement. How are you feeling today?
[00:22] Patient: Hi Maya! I'm actually feeling quite good, no chest heaviness at all when I take short walks.
[00:29] Maya (AI): That is wonderful to hear! Are you continuing to take your blood thinners as prescribed?
[00:34] Patient: Yes, taking them twice daily without fail.
[00:38] Maya (AI): Excellent. Dr. Sharma would like to review your recovery and perform your 30-day resting ECG. Dr. Sharma has open slots tomorrow at 10:00 AM or 02:30 PM. Which works best for you?
[00:52] Patient: Tomorrow at 10:00 AM suits me very well.
[00:56] Maya (AI): Perfect! I have reserved tomorrow, 10:00 AM with Dr. Rajesh Sharma in Cardiology. You'll receive an SMS confirmation. Take care, Surender!
[01:05] Patient: Thank you Maya, goodbye!
[01:08] Maya (AI): Goodbye!`,
    },
    {
      call_sid: "EXO-CALL-901122",
      phone: testPhone,
      patient_id: "PAT-2002",
      direction: "OUTBOUND",
      call_reason:
        "Post-op FESS sinus recovery assessment & cavity inspection booking",
      started_at: "2026-10-28 11:15:00",
      ended_at: "2026-10-28 11:18:45",
      outcome: "APPOINTMENT_SCHEDULED",
      notes:
        "Naman reported clear nasal breathing with minimal congestion. Continuing saline rinses. Scheduled post-op airway examination with Dr. Farhan Al-Mansoor for tomorrow at 11:00 AM.",
      transcript_summary: `[00:02] Maya (AI): Good morning! May I speak with Naman?
[00:05] Patient: Yes, Naman here.
[00:07] Maya (AI): Hi Naman! This is Maya from Apex Multispecialty Hospital calling on behalf of Dr. Farhan Al-Mansoor in the ENT Department. I'm following up on your recent endoscopic sinus surgery. How has your breathing been?
[00:18] Patient: Hey Maya! Much better than expected. The swelling has gone down substantially.
[00:24] Maya (AI): Glad to hear that! Any facial pressure or bleeding?
[00:28] Patient: None at all.
[00:31] Maya (AI): Great. Dr. Al-Mansoor needs to perform your routine post-op cavity inspection to ensure proper healing. We have an opening tomorrow at 11:00 AM or in the afternoon at 03:30 PM.
[00:43] Patient: Let's do tomorrow at 11:00 AM please.
[00:46] Maya (AI): Done! Your appointment is confirmed for tomorrow at 11:00 AM with Dr. Farhan Al-Mansoor in ENT Suite 3. Have a pleasant day!
[00:54] Patient: Thanks Maya, bye.`,
    },
    {
      call_sid: "EXO-CALL-901123",
      phone: testPhone,
      patient_id: "PAT-1088",
      direction: "OUTBOUND",
      call_reason:
        "2-week post-cataract surgery visual acuity and eye drop adherence check",
      started_at: "2026-10-28 15:00:00",
      ended_at: "2026-10-28 15:03:10",
      outcome: "FOLLOW_UP_REQUIRED",
      notes:
        "Priya confirmed vision is clear without pain. Traveling until Friday. Requested callback Saturday morning to confirm eye exam.",
      transcript_summary: `[00:02] Maya (AI): Hello Priya, this is Maya calling from Apex Multispecialty Hospital's Eye Care Department.
[00:07] Patient: Hello Maya, yes I am here.
[00:09] Maya (AI): I'm following up on your left eye cataract surgery with Dr. Ananya Iyer. How is your vision feeling in bright light?
[00:17] Patient: Everything is sharp! Just a little dry in the evenings, but I use the lubricating drops.
[00:24] Maya (AI): That's typical during the initial weeks. Dr. Iyer has an opening tomorrow at 09:30 AM for your pressure check.
[00:32] Patient: I am out of town until Friday evening. Could you call me back on Saturday?
[00:38] Maya (AI): Certainly, Priya. I have scheduled a callback for Saturday morning. Please continue your protective sunglasses outdoors. Take care!`,
    },
    {
      call_sid: "EXO-INB-901124",
      phone: testPhone,
      patient_id: "PAT-3002",
      direction: "INBOUND",
      call_reason:
        "Inbound inquiry regarding post-root canal crown fitting and tooth sensitivity",
      started_at: "2026-10-29 14:10:00",
      ended_at: "2026-10-29 14:13:30",
      outcome: "APPOINTMENT_SCHEDULED",
      notes:
        "Patient called hospital reception inquiring about minor sensitivity following root canal. Maya welcomed caller, reviewed dental history with Dr. Sneha Rao, and booked permanent zirconia crown evaluation for tomorrow at 11:30 AM.",
      transcript_summary: `[00:01] Maya (AI): Thank you for calling Apex Multispecialty Hospital. This is Maya, how may I help you today?
[00:06] Patient: Hi Maya, this is Sunita Patel. I had a root canal with Dr. Sneha Rao recently and wanted to check about booking my permanent crown fitting.
[00:15] Maya (AI): Hello Sunita! Great to hear from you. Dr. Rao has open slots tomorrow at 11:30 AM or at 03:00 PM in our Dental Department. Which time suits you best?
[00:25] Patient: Tomorrow at 11:30 AM would be great.
[00:28] Maya (AI): Wonderful! One moment please, locking in your appointment right now... I have confirmed your appointment for tomorrow at 11:30 AM with Dr. Sneha Rao in Dental Suite 2.
[00:38] Patient: Thanks so much Maya, appreciate the quick booking!
[00:41] Maya (AI): You are very welcome, Sunita. Have a wonderful day! Goodbye.`,
    },
    {
      call_sid: "EXO-INB-901125",
      phone: testPhone,
      patient_id: "PAT-4001",
      direction: "INBOUND",
      call_reason:
        "Inbound new patient consultation inquiry for cardiology evaluation",
      started_at: "2026-10-30 09:20:00",
      ended_at: "2026-10-30 09:23:45",
      outcome: "APPOINTMENT_SCHEDULED",
      notes:
        "New caller dialed into hospital care line. Introduced himself as Amit Shah. Maya registered new patient profile and scheduled first-time cardiology consultation with Dr. Rajesh Sharma for tomorrow at 09:30 AM.",
      transcript_summary: `[00:01] Maya (AI): Thank you for calling Apex Multispecialty Hospital. My name is Maya. How may I assist you today?
[00:07] Patient: Hello, my name is Amit Shah. I've been having mild breathlessness while climbing stairs and wanted to see a heart specialist.
[00:16] Maya (AI): Hello Amit! Please wait just a moment while I register you in our hospital system... Let me check Dr. Rajesh Sharma's schedule in Cardiology for you.
[00:27] Maya (AI): Dr. Rajesh Sharma has open slots tomorrow morning at 09:30 AM or at 02:00 PM.
[00:34] Patient: 09:30 AM tomorrow works best for me.
[00:37] Maya (AI): One moment please, locking in your appointment right now... Excellent Amit, I have booked your cardiology consultation with Dr. Rajesh Sharma for tomorrow at 09:30 AM.
[00:48] Patient: Thank you very much Maya!
[00:50] Maya (AI): You are welcome, Amit. Please report to the reception desk 10 minutes early. Take care and goodbye!`,
    },
  ];

  return {
    doctors,
    patients,
    activeContexts,
    appointmentSlots,
    callLogs,
  };
}
