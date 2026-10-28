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

    if (typeof to !== "string" || !/^\+91\d{10}$/.test(to)) {
      return res.status(400).json({
        error: "Use an Indian mobile number in +91XXXXXXXXXX format",
      });
    }

    // Initial prototype: only allow your own number.
    if (to !== process.env.TEST_PHONE_NUMBER) {
      return res.status(403).json({
        error: "Only the configured test number is allowed",
      });
    }

    const sid = requiredEnv("EXOTEL_ACCOUNT_SID");
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

    const endpoint = `${baseUrl}/v1/Accounts/${encodeURIComponent(sid)}/Calls/connect`;

    const form = new FormData();

    form.set("From", to);
    form.set("CallerId", callerId);
    form.set("StreamUrl", streamUrl);
    form.set("StreamType", "bidirectional");
    form.set("TimeLimit", "300");
    form.set("CustomField", "gemini-prototype");

    const auth = Buffer.from(`${apiKey}:${apiToken}`).toString("base64");

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
      },
      body: form,
      signal: AbortSignal.timeout(20000),
    });

    const raw = await response.text();

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }

    if (!response.ok) {
      console.error("Exotel rejected call request", {
        status: response.status,
        response: raw.slice(0, 1000),
      });

      return res.status(502).json({
        error: "Exotel rejected the call request",
        providerStatus: response.status,
      });
    }

    if (!data?.Call) {
      console.error("Unexpected Exotel response", raw.slice(0, 1000));

      return res.status(502).json({
        error: "Exotel returned an unexpected response",
      });
    }

    return res.status(202).json({
      accepted: true,
      call: {
        sid: data.Call.Sid,
        status: data.Call.Status,
        from: data.Call.From,
      },
    });
  } catch (error) {
    console.error("Failed to initiate call:", error.message);

    return res.status(500).json({
      error: "Unable to initiate the call",
    });
  }
});

export default router;
