/**
 * Seed data for Brightside Dental Clinic.
 * Seeds doctors, patients (including the configured TEST_PHONE_NUMBER),
 * active clinical contexts, and open appointment slots.
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
      doctor_id: "DOC-1",
      name: "Dr. Sneha Rao",
      specialty: "Senior Endodontist & Implant Specialist",
      available_days: "Monday, Tuesday, Thursday, Friday",
    },
    {
      doctor_id: "DOC-2",
      name: "Dr. Vikram Mehta",
      specialty: "General, Aesthetic & Preventive Dentist",
      available_days: "Monday, Wednesday, Friday, Saturday",
    },
  ];

  const patients = [
    {
      patient_id: "PAT-1042",
      phone: "+918283828192",
      full_name: "Surender Kumar",
      preferred_name: "Surender",
      age: 34,
      gender: "Male",
      assigned_doctor_id: "DOC-1",
      medical_alerts: JSON.stringify([
        "Allergic to Penicillin",
        "Mild dental anxiety",
        "Prefers morning appointments",
      ]),
      insurance_plan: "BrightCare Dental Platinum Plan",
      preferred_time_of_day: "Morning",
      general_notes:
        "Patient underwent root canal therapy on Tooth #14 recently; needs permanent zirconia crown fitting.",
    },
    {
      patient_id: "PAT-1088",
      phone: "+919876543210",
      full_name: "Priya Sharma",
      preferred_name: "Priya",
      age: 28,
      gender: "Female",
      assigned_doctor_id: "DOC-2",
      medical_alerts: JSON.stringify(["Sensitive gums"]),
      insurance_plan: "Delta Dental PPO",
      preferred_time_of_day: "Afternoon",
      general_notes:
        "Overdue for 6-month hygiene recall and preventative cleaning.",
    },
    {
      patient_id: "PAT-2002",
      phone: testPhone,
      full_name: "Naman Pilania",
      preferred_name: "Naman",
      age: 24,
      gender: "Male",
      assigned_doctor_id: "DOC-1",
      medical_alerts: JSON.stringify([
        "Allergic to Penicillin",
        "Mild dental anxiety",
        "Prefers morning appointments",
      ]),
      insurance_plan: "BrightCare Dental Platinum Plan",
      preferred_time_of_day: "Morning",
      general_notes:
        "Patient underwent root canal therapy on Tooth #14 recently; needs permanent zirconia crown fitting.",
    },
  ];

  const activeContexts = [
    {
      context_id: "CTX-2001",
      patient_id: "PAT-1042",
      call_goal: "CROWN_PLACEMENT_SCHEDULING",
      call_reason:
        "Post-root-canal recovery check & scheduling permanent crown fitting",
      last_visit_date: "2026-10-18",
      last_visit_procedure: "Root Canal Therapy (Stage 1 & 2) on Tooth #14",
      last_visit_doctor: "Dr. Sneha Rao",
      last_visit_outcome:
        "Canals instrumented, disinfected, and sealed. Temporary filling placed. Patient advised mild soreness is normal for 48h. Advised that permanent crown must be placed within 2-3 weeks to avoid tooth fracture.",
      pending_action:
        "Check how tooth #14 is feeling (any sensitivity or discomfort?), and schedule a 45-minute appointment for permanent crown fitting.",
      recommended_duration_minutes: 45,
      urgency: "HIGH",
      is_active: 1,
    },
    {
      context_id: "CTX-2002",
      patient_id: "PAT-1088",
      call_goal: "ROUTINE_HYGIENE_RECALL",
      call_reason:
        "Semi-annual routine dental exam and prophylaxis cleaning overdue by 3 weeks",
      last_visit_date: "2026-03-22",
      last_visit_procedure:
        "Comprehensive oral exam, bitewing X-rays, ultrasonic cleaning",
      last_visit_doctor: "Dr. Vikram Mehta",
      last_visit_outcome:
        "No active cavities. Mild plaque accumulation along lower incisors. Recommended 6-month recall.",
      pending_action:
        "Book a 30-minute routine teeth cleaning and oral health checkup.",
      recommended_duration_minutes: 30,
      urgency: "MEDIUM",
      is_active: 1,
    },
    {
      context_id: "CTX-2003",
      patient_id: "PAT-2002",
      call_goal: "CROWN_PLACEMENT_SCHEDULING",
      call_reason:
        "Post-root-canal recovery check & scheduling permanent crown fitting",
      last_visit_date: "2026-10-18",
      last_visit_procedure: "Root Canal Therapy (Stage 1 & 2) on Tooth #14",
      last_visit_doctor: "Dr. Sneha Rao",
      last_visit_outcome:
        "Canals instrumented, disinfected, and sealed. Temporary filling placed. Patient advised mild soreness is normal for 48h. Advised that permanent crown must be placed within 2-3 weeks to avoid tooth fracture.",
      pending_action:
        "Check how tooth #14 is feeling (any sensitivity or discomfort?), and schedule a 45-minute appointment for permanent crown fitting.",
      recommended_duration_minutes: 45,
      urgency: "HIGH",
      is_active: 1,
    },
  ];

  const appointmentSlots = [
    // Slots for Dr. Sneha Rao (DOC-1)
    {
      slot_id: "SLOT-101",
      doctor_id: "DOC-1",
      date: tomorrow,
      time: "10:00 AM",
      is_available: 1,
    },
    {
      slot_id: "SLOT-102",
      doctor_id: "DOC-1",
      date: tomorrow,
      time: "11:30 AM",
      is_available: 1,
    },
    {
      slot_id: "SLOT-103",
      doctor_id: "DOC-1",
      date: tomorrow,
      time: "03:00 PM",
      is_available: 1,
    },
    {
      slot_id: "SLOT-104",
      doctor_id: "DOC-1",
      date: dayAfter,
      time: "09:30 AM",
      is_available: 1,
    },
    {
      slot_id: "SLOT-105",
      doctor_id: "DOC-1",
      date: dayAfter,
      time: "02:00 PM",
      is_available: 1,
    },
    {
      slot_id: "SLOT-106",
      doctor_id: "DOC-1",
      date: inThreeDays,
      time: "10:30 AM",
      is_available: 1,
    },

    // Slots for Dr. Vikram Mehta (DOC-2)
    {
      slot_id: "SLOT-201",
      doctor_id: "DOC-2",
      date: tomorrow,
      time: "02:00 PM",
      is_available: 1,
    },
    {
      slot_id: "SLOT-202",
      doctor_id: "DOC-2",
      date: tomorrow,
      time: "04:30 PM",
      is_available: 1,
    },
    {
      slot_id: "SLOT-203",
      doctor_id: "DOC-2",
      date: dayAfter,
      time: "11:00 AM",
      is_available: 1,
    },
  ];

  return { doctors, patients, activeContexts, appointmentSlots };
}
