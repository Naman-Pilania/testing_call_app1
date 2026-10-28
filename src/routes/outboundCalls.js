import { Router } from "express";

const router = Router();

function requiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

router.post("/api/calls", async (req, res) => {
  try {
    const { to } = req.body ?? {};

    // Indian mobile number in +91XXXXXXXXXX format.
    if (typeof to !== "string" || !/^\+91\d{10}$/.test(to)) {
      return res.status(400).json({
        error: "Use an Indian mobile number in +91XXXXXXXXXX format",
      });
    }

    // Restrict the prototype to the configured test number.
    const testPhoneNumber = requiredEnv("TEST_PHONE_NUMBER");

    if (to !== testPhoneNumber) {
      return res.status(403).json({
        error: "Only the configured test number is allowed",
      });
    }

    const accountSid = requiredEnv("EXOTEL_ACCOUNT_SID");
    const apiKey = requiredEnv("EXOTEL_API_KEY");
    const apiToken = requiredEnv("EXOTEL_API_TOKEN");
    const callerId = requiredEnv("EXOTEL_CALLER_ID");

    const baseUrl = requiredEnv("EXOTEL_API_BASE_URL").replace(/\/+$/, "");
    const streamUrl = requiredEnv("PUBLIC_WSS_URL");

    if (!streamUrl.startsWith("wss://")) {
      return res.status(500).json({
        error: "PUBLIC_WSS_URL must use secure WebSockets (wss://)",
      });
    }

    const endpoint = `${baseUrl}/v1/Accounts/${encodeURIComponent(accountSid)}/Calls/connect`;

    // Exotel Connect Voice AI request.
    const form = new URLSearchParams({
      From: to,
      CallerId: callerId,
      StreamUrl: streamUrl,
      StreamType: "bidirectional",
      TimeLimit: "300",
      CustomField: "gemini-prototype",
    });

    const auth = Buffer.from(`${apiKey}:${apiToken}`).toString("base64");

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
      signal: AbortSignal.timeout(20000),
    });

    const raw = await response.text();

    if (!response.ok) {
      // Avoid logging credentials or the full request.
      console.error("Exotel rejected call request", {
        status: response.status,
        response: raw.slice(0, 1000),
      });

      return res.status(502).json({
        error: "Exotel rejected the call request",
        providerStatus: response.status,
      });
    }

    // Exotel may return XML instead of JSON.
    const callSid = raw.match(/<Sid>([^<]*)<\/Sid>/)?.[1];
    const status = raw.match(/<Status>([^<]*)<\/Status>/)?.[1];
    const from = raw.match(/<From>([^<]*)<\/From>/)?.[1];

    if (!callSid) {
      console.error("Could not parse Exotel call response", {
        response: raw.slice(0, 1000),
      });

      return res.status(502).json({
        error: "Could not parse Exotel call response",
      });
    }

    return res.status(202).json({
      accepted: true,
      call: {
        sid: callSid,
        status: status || "accepted",
        from: from || null,
      },
    });
  } catch (error) {
    console.error("Failed to initiate call:", error.message);

    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return res.status(504).json({
        error:
          "Exotel call request timed out; verify call status before retrying",
      });
    }

    return res.status(500).json({
      error: "Unable to initiate the call",
    });
  }
});

export default router;
