#!/usr/bin/env node
import "dotenv/config";
import { clearDb, closeDb } from "./database.js";

console.log("==================================================");
console.log("Apex Multispecialty Hospital - Resetting Database");
console.log("==================================================");

try {
  const result = clearDb({ reseed: true });
  console.log("✓ Database reset & seed completed successfully.");
  console.log("Summary:", JSON.stringify(result.counts, null, 2));
  process.exit(0);
} catch (error) {
  console.error("✗ Failed to clear database:", error);
  process.exit(1);
} finally {
  closeDb();
}
