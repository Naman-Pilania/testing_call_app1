import { lookupPatientContext } from "../db/database.js";

// In-memory call registry mapping callSid -> { patientId, phone, direction, activeContext, timestamp }
const registry = new Map();

// Latest initiated calls as fallback for immediate connects
let latestPendingCall = null;
let latestInboundCall = null;

/**
 * Registers an outbound or inbound call before/upon dispatch so the incoming WebSocket connection
 * can immediately correlate to the correct patient profile even when phone numbers are identical
 * (e.g. testing mode) or query parameters are stripped by telephony providers.
 */
export function registerPendingCall(
  callSid,
  { patientId, phone, direction = "OUTBOUND", activeContext } = {},
) {
  const normDirection = (direction || "OUTBOUND").toUpperCase();
  const entry = {
    callSid: callSid || null,
    patientId: patientId || activeContext?.patient?.patientId || null,
    phone: phone || activeContext?.patient?.phone || null,
    direction: normDirection,
    activeContext: activeContext || null,
    timestamp: Date.now(),
  };

  if (callSid) {
    registry.set(callSid, entry);
  }

  if (normDirection === "INBOUND") {
    latestInboundCall = entry;
  } else {
    latestPendingCall = entry;
  }

  // Prune entries older than 30 minutes
  const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
  for (const [key, value] of registry.entries()) {
    if (value.timestamp < thirtyMinutesAgo) {
      registry.delete(key);
    }
  }

  console.log(
    `[CallRegistry] Registered ${normDirection} call [${callSid || "pending"}] for patient ${entry.patientId} (${entry.phone})`,
  );
  return entry;
}

/**
 * Convenience method to register an inbound call intent.
 */
export function registerInboundCall(
  callSid,
  { patientId, phone, activeContext } = {},
) {
  return registerPendingCall(callSid, {
    patientId,
    phone,
    direction: "INBOUND",
    activeContext,
  });
}

/**
 * Resolves the patient context using all available correlation signals:
 * 1. Exotel Call SID (via in-memory registry)
 * 2. Exotel CustomField (e.g., "patient-PAT-2002" or "inbound-PAT-2002")
 * 3. Query parameter patientId (if preserved)
 * 4. Inbound / Outbound direction-specific fallback
 * 5. Primary phone number lookup fallback
 */
export function resolveCallContext({
  callSid,
  customField,
  patientId,
  phone,
  direction,
} = {}) {
  const isExplicitInbound =
    direction?.toUpperCase() === "INBOUND" ||
    (customField && /inbound/i.test(customField));

  console.log("[CallRegistry] Resolving context with signals:", {
    callSid,
    customField,
    patientId,
    phone,
    direction: isExplicitInbound ? "INBOUND" : direction || "OUTBOUND",
  });

  // 1. Check registry by callSid
  if (callSid && registry.has(callSid)) {
    const entry = registry.get(callSid);
    console.log(
      `[CallRegistry] Matched by callSid '${callSid}': patient ${entry.patientId} (${entry.direction})`,
    );
    const resolvedContext =
      entry.activeContext ||
      lookupPatientContext({
        patientId: entry.patientId,
        phone: entry.phone,
      });
    resolvedContext.direction = entry.direction || (isExplicitInbound ? "INBOUND" : "OUTBOUND");
    return resolvedContext;
  }

  // 2. Check customField (Exotel echoes this in the 'start' event)
  if (customField && typeof customField === "string") {
    const match = customField.match(/patient-([A-Za-z0-9_-]+)/);
    if (match && match[1]) {
      const extractedPatientId = match[1];
      console.log(
        `[CallRegistry] Matched by customField '${customField}': patient ${extractedPatientId}`,
      );
      const isNew = extractedPatientId === "NEW" || extractedPatientId.startsWith("NEW");
      const resolvedContext = lookupPatientContext({
        patientId: isNew ? undefined : extractedPatientId,
        phone,
        isNewPatient: isNew,
      });
      resolvedContext.direction = isExplicitInbound ? "INBOUND" : "OUTBOUND";
      return resolvedContext;
    }
  }

  // 3. Check query param patientId if present
  if (patientId) {
    console.log(
      `[CallRegistry] Matched by explicit patientId parameter: patient ${patientId}`,
    );
    const isNew = patientId === "NEW" || patientId.startsWith("NEW");
    const resolvedContext = lookupPatientContext({
      patientId: isNew ? undefined : patientId,
      phone,
      isNewPatient: isNew,
    });
    resolvedContext.direction = isExplicitInbound ? "INBOUND" : "OUTBOUND";
    return resolvedContext;
  }

  // 4. Inbound-specific matching
  if (isExplicitInbound) {
    if (latestInboundCall && Date.now() - latestInboundCall.timestamp < 5 * 60 * 1000) {
      console.log(
        `[CallRegistry] Matched by latest inbound call: patient ${latestInboundCall.patientId}`,
      );
      const resolvedContext =
        latestInboundCall.activeContext ||
        lookupPatientContext({
          patientId: latestInboundCall.patientId,
          phone: latestInboundCall.phone,
        });
      resolvedContext.direction = "INBOUND";
      return resolvedContext;
    }

    // Phone lookup for inbound caller
    const callerPhone = phone || process.env.TEST_PHONE_NUMBER;
    console.log(`[CallRegistry] Inbound caller lookup for phone: ${callerPhone}`);
    const resolvedContext = lookupPatientContext({
      phone: callerPhone,
    });
    resolvedContext.direction = "INBOUND";
    return resolvedContext;
  }

  // 5. Outbound fallback: latest pending call if initiated within last 5 minutes
  if (
    latestPendingCall &&
    Date.now() - latestPendingCall.timestamp < 5 * 60 * 1000
  ) {
    console.log(
      `[CallRegistry] Matched by latest pending outbound call: patient ${latestPendingCall.patientId}`,
    );
    const resolvedContext =
      latestPendingCall.activeContext ||
      lookupPatientContext({
        patientId: latestPendingCall.patientId,
        phone: latestPendingCall.phone,
      });
    resolvedContext.direction = "OUTBOUND";
    return resolvedContext;
  }

  // 6. Generic fallback to phone number lookup
  const targetPhone = phone || process.env.TEST_PHONE_NUMBER;
  const isTestPrototypePhone = targetPhone === process.env.TEST_PHONE_NUMBER;
  console.log(
    `[CallRegistry] Falling back to phone lookup for: ${targetPhone} (isTestPrototypePhone: ${isTestPrototypePhone})`,
  );
  const resolvedContext = lookupPatientContext({
    phone: targetPhone,
    isNewPatient: isTestPrototypePhone,
  });
  resolvedContext.direction = "OUTBOUND";
  return resolvedContext;
}

export function clearCallRegistry() {
  registry.clear();
  latestPendingCall = null;
  latestInboundCall = null;
}
