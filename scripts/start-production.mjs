import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

/*
 * BRIXTA_ENV_BOOTSTRAP_V1
 *
 * Environment must exist BEFORE dist/index.js is imported because
 * database/runtime modules may validate environment variables during
 * ESM module initialization.
 *
 * Priority:
 *
 * process environment
 *     ↓
 * .env.local
 *     ↓
 * .env
 *
 * Existing environment variables are NEVER overwritten.
 */

const candidates = [
  ".env.local",
  ".env",
];

for (const filename of candidates) {
  const absolute = path.resolve(
    process.cwd(),
    filename,
  );

  if (!fs.existsSync(absolute)) {
    continue;
  }

  const result = dotenv.config({
    path: absolute,
    override: false,
  });

  if (result.error) {
    console.error(
      `Failed loading ${filename}:`,
      result.error.message,
    );

    process.exit(1);
  }
}

if (!process.env.DATABASE_URL) {
  console.error("");
  console.error(
    "❌ DATABASE_URL is unavailable."
  );
  console.error(
    "Set it in the process environment, .env.local, or .env."
  );
  console.error("");

  process.exit(1);
}

/*
 * IMPORTANT:
 *
 * Dynamic import is deliberate.
 * Environment initialization above MUST finish first.
 */
await import("../dist/index.js");
