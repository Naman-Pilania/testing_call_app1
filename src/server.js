import "dotenv/config";

import express from "express";
import { createServer } from "node:http";

import callsRouter from "./routes/outboundCalls.js";
import { registerExotelMedia } from "./telephony/exotelMedia.js";

const PORT = Number(process.env.PORT || 3001);

const app = express();
const server = createServer(app);

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    exotelConfigured: Boolean(
      process.env.EXOTEL_ACCOUNT_SID &&
      process.env.EXOTEL_API_KEY &&
      process.env.EXOTEL_API_TOKEN &&
      process.env.EXOTEL_CALLER_ID &&
      process.env.EXOTEL_API_BASE_URL &&
      process.env.PUBLIC_WSS_URL &&
      process.env.TEST_PHONE_NUMBER,
    ),
  });
});

app.use(callsRouter);

registerExotelMedia(server);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Voice assistant server listening on port ${PORT}`);
});

function shutdown() {
  console.log("Shutting down voice assistant server...");

  server.close(() => {
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
