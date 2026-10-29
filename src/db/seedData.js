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
      phone: testPhone,
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
      phone: testPhone,
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

  const callLogs = [
    {
      call_sid: "EXO-CALL-882194",
      phone: testPhone,
      patient_id: "PAT-1042",
      call_reason: "Post-root-canal recovery check & scheduling permanent crown fitting",
      started_at: "2026-10-27 11:15:00",
      ended_at: "2026-10-27 11:18:42",
      outcome: "APPOINTMENT_SCHEDULED",
      notes: "Patient reported slight tenderness in tooth #14 which subsided after 48h. Successfully booked permanent crown fitting for tomorrow at 10:00 AM with Dr. Sneha Rao.",
      transcript_summary: `[00:02] Maya (AI): Hello! Am I speaking with Surender?
[00:05] Patient: Yes, this is Surender speaking. Who's calling?
[00:08] Maya (AI): Hi Surender! This is Maya calling from Brightside Dental Clinic on behalf of Dr. Sneha Rao. I'm following up on your recent root canal on tooth number 14. How has that area been feeling?
[00:18] Patient: Oh hi Maya! It was a bit sore the first couple days, but honestly it feels pretty normal now.
[00:24] Maya (AI): That's wonderful to hear! Dr. Rao noted that while your temporary filling is intact, we need to place your permanent zirconia crown soon so the tooth stays strong and protected. Dr. Rao has an opening tomorrow morning at 10:00 AM or 11:30 AM. Would either of those suit you?
[00:41] Patient: Tomorrow at 10:00 AM works great for me.
[00:45] Maya (AI): Perfect! I've reserved tomorrow, 10:00 AM with Dr. Sneha Rao for your crown fitting. You'll receive a confirmation SMS shortly. Take care, Surender!
[00:54] Patient: Thanks Maya, bye!
[00:56] Maya (AI): Goodbye!`,
    },
    {
      call_sid: "EXO-CALL-882195",
      phone: testPhone,
      patient_id: "PAT-1088",
      call_reason: "Semi-annual routine dental exam and prophylaxis cleaning overdue by 3 weeks",
      started_at: "2026-10-26 15:30:00",
      ended_at: "2026-10-26 15:33:10",
      outcome: "FOLLOW_UP_REQUIRED",
      notes: "Priya mentioned sensitive gums recently. Inquired about afternoon slots with Dr. Vikram Mehta. Requested a callback later in the week due to work travel.",
      transcript_summary: `[00:02] Maya (AI): Hello, could I speak with Priya please?
[00:05] Patient: Speaking, who is this?
[00:07] Maya (AI): Good afternoon Priya! This is Maya from Brightside Dental Clinic. I noticed you're due for your 6-month routine cleaning and checkup with Dr. Vikram Mehta.
[00:16] Patient: Oh yes, I know I'm late! My gums have actually been feeling a bit sensitive lately.
[00:22] Maya (AI): I'm sorry to hear about the sensitivity. That's definitely something Dr. Mehta will examine closely. We have an opening with Dr. Mehta tomorrow at 2:00 PM or 4:30 PM.
[00:33] Patient: I'm currently traveling for work until Friday. Could you follow up with me this weekend?
[00:39] Maya (AI): Absolutely, Priya. I've noted that for our team to follow up on Saturday. If the sensitivity worsens before then, please give us a call. Have a safe trip!
[00:48] Patient: Thank you so much, Maya.`,
    },
    {
      call_sid: "EXO-CALL-882196",
      phone: testPhone,
      patient_id: "PAT-2002",
      call_reason: "Post-root-canal recovery check & scheduling permanent crown fitting",
      started_at: "2026-10-28 10:00:00",
      ended_at: "2026-10-28 10:03:15",
      outcome: "COMPLETED",
      notes: "Discussed crown options with patient. Confirmed patient has no pain. Offered slots with Dr. Sneha Rao.",
      transcript_summary: `[00:02] Maya (AI): Hi Naman! This is Maya calling from Brightside Dental Clinic. How are you doing today?
[00:06] Patient: Hey Maya, doing well, thanks.
[00:09] Maya (AI): Glad to hear that! I'm checking in following your root canal therapy with Dr. Sneha Rao. How has your tooth been feeling? Any discomfort with hot or cold?
[00:19] Patient: No discomfort at all, everything healed up nicely.
[00:23] Maya (AI): That's fantastic news. The next step is placing your permanent crown to keep the tooth intact. Would you like to review available appointment times?
[00:32] Patient: Yes please, what times do you have open?
[00:35] Maya (AI): Dr. Rao has open slots tomorrow at 10:00 AM, 11:30 AM, or 3:00 PM.
[00:41] Patient: Let me check my calendar and I will call back to lock it in.
[00:45] Maya (AI): Sounds great, Naman. We're here whenever you're ready. Have a wonderful day!`,
    },
  ];

  return { doctors, patients, activeContexts, appointmentSlots, callLogs };
}
