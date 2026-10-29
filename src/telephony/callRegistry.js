import { lookupPatientContext } from "../db/database.js";

// In-memory call registry mapping callSid -> { patientId, phone, activeContext, timestamp }
const registry = new Map();

// Latest initiated call as a fallback for immediate connects
let latestPendingCall = null;

/**
 * Registers an outbound call before/upon dispatch so the incoming WebSocket connection
 * can immediately correlate to the correct patient profile even when phone numbers are identical
 * (e.g. testing mode) or query parameters are stripped by telephony providers.
 */
export function registerPendingCall(
  callSid,
  { patientId, phone, activeContext } = {},
) {
  const entry = {
    callSid: callSid || null,
    patientId: patientId || activeContext?.patient?.patientId || null,
    phone: phone || activeContext?.patient?.phone || null,
    activeContext: activeContext || null,
    timestamp: Date.now(),
  };

  if (callSid) {
    registry.set(callSid, entry);
  }

  // Always update latest pending call as a fast fallback
  latestPendingCall = entry;

  // Prune entries older than 30 minutes
  const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
  for (const [key, value] of registry.entries()) {
    if (value.timestamp < thirtyMinutesAgo) {
      registry.delete(key);
    }
  }

  console.log(
    `[CallRegistry] Registered call [${callSid || "pending"}] for patient ${entry.patientId} (${entry.phone})`,
  );
  return entry;
}

/**
 * Resolves the patient context using all available correlation signals:
 * 1. Exotel Call SID (via in-memory registry)
 * 2. Exotel CustomField (e.g., "patient-PAT-2002")
 * 3. Query parameter patientId (if preserved)
 * 4. Latest pending call within the last 5 minutes
 * 5. Primary phone number lookup fallback
 */
export function resolveCallContext({
  callSid,
  customField,
  patientId,
  phone,
} = {}) {
  console.log("[CallRegistry] Resolving context with signals:", {
    callSid,
    customField,
    patientId,
    phone,
  });

  // 1. Check registry by callSid
  if (callSid && registry.has(callSid)) {
    const entry = registry.get(callSid);
    console.log(
      `[CallRegistry] Matched by callSid '${callSid}': patient ${entry.patientId}`,
    );
    return (
      entry.activeContext ||
      lookupPatientContext({
        patientId: entry.patientId,
        phone: entry.phone,
      })
    );
  }

  // 2. Check customField (Exotel echoes this in the 'start' event)
  if (customField && typeof customField === "string") {
    const match = customField.match(/patient-([A-Za-z0-9_-]+)/);
    if (match && match[1]) {
      const extractedPatientId = match[1];
      console.log(
        `[CallRegistry] Matched by customField '${customField}': patient ${extractedPatientId}`,
      );
      return lookupPatientContext({
        patientId: extractedPatientId,
        phone,
      });
    }
  }

  // 3. Check query param patientId if present
  if (patientId) {
    console.log(
      `[CallRegistry] Matched by explicit patientId parameter: patient ${patientId}`,
    );
    return lookupPatientContext({ patientId, phone });
  }

  // 4. Fallback to latest pending call if initiated within the last 5 minutes
  if (
    latestPendingCall &&
    Date.now() - latestPendingCall.timestamp < 5 * 60 * 1000
  ) {
    console.log(
      `[CallRegistry] Matched by latest pending call: patient ${latestPendingCall.patientId}`,
    );
    return (
      latestPendingCall.activeContext ||
      lookupPatientContext({
        patientId: latestPendingCall.patientId,
        phone: latestPendingCall.phone,
      })
    );
  }

  // 5. Fallback to phone number lookup
  const targetPhone = phone || process.env.TEST_PHONE_NUMBER;
  console.log(
    `[CallRegistry] Falling back to phone lookup for: ${targetPhone}`,
  );
  return lookupPatientContext({ phone: targetPhone });
}

export function clearCallRegistry() {
  registry.clear();
  latestPendingCall = null;
}
