import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { resamplePcm16 } from "./pcm.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GEMINI_OUTPUT_RATE = 24000;
const EXOTEL_RATE = 16000;

// Cache pre-resampled 16kHz PCM buffers in memory for zero-latency playback
const fillerCache = new Map();

const FILLER_FILES = {
  registering: "registering.pcm",
  booking: "booking.pcm",
  checking_slots: "checking_slots.pcm",
};

export function initFillers() {
  const fillersDir = path.join(__dirname, "fillers");

  for (const [key, filename] of Object.entries(FILLER_FILES)) {
    const filePath = path.join(fillersDir, filename);
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath);
        // Ensure even number of bytes for 16-bit PCM
        const evenRaw = raw.subarray(0, raw.length - (raw.length % 2));
        const resampled = resamplePcm16(
          evenRaw,
          GEMINI_OUTPUT_RATE,
          EXOTEL_RATE,
        );
        fillerCache.set(key, resampled);
        console.log(
          `[Fillers] Loaded and pre-resampled ${key} (${resampled.length} bytes, ${(resampled.length / 32000).toFixed(2)}s @ 16kHz)`,
        );
      } else {
        console.warn(`[Fillers] Warning: Filler file not found: ${filePath}`);
      }
    } catch (err) {
      console.error(`[Fillers] Failed to load filler ${key}:`, err.message);
    }
  }
}

// Initialize on module import
initFillers();

export function getFillerAudio(key) {
  return fillerCache.get(key) || null;
}

export function hasFillerAudio(key) {
  return fillerCache.has(key);
}
