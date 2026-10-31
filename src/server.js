import "dotenv/config";

import express from "express";
import { createServer } from "node:http";

import callsRouter from "./routes/outboundCalls.js";
import inboundRouter from "./routes/inboundCalls.js";
import { registerExotelMedia } from "./telephony/exotelMedia.js";
import { getDb, clearDb } from "./db/database.js";

const PORT = Number(process.env.PORT || 3001);

// Debugging mode: automatically clear and reseed the DB on build/startup
if (process.env.CLEAR_DB === "true" || process.env.CLEAR_DB === "1") {
  console.log("[Build/Debug] Auto-clearing and reseeding SQLite database for debug build...");
  clearDb({ reseed: true });
} else {
  getDb();
}

const app = express();
const server = createServer(app);

app.disable("x-powered-by");

// CORS middleware to enable communication with testing_call_client frontend
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization",
  );
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json({ limit: "32kb" }));

app.get(["/health", "/api/health"], (_req, res) => {
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
app.use(inboundRouter);

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
