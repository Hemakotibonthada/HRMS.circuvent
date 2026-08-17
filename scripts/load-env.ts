// ═══════════════════════════════════════════════════════════════
// ENVIRONMENT FOR SCRIPTS RUN OUTSIDE NEXT.JS
// ═══════════════════════════════════════════════════════════════
//
// Next.js loads `.env.local` itself, so application code never has to think
// about it. A `tsx` script does not get that, and two of the commands this
// project documents as part of setting up a deployment —
// `npm run db:seed:templates` and `npm run db:encrypt-fields` — imported the
// database client and died on "DATABASE_URL is not set" every time they were
// run as written.
//
// The failure was not subtle, but it was terminal for the features behind it:
// the offer letter templates could not be installed, so the letters screen had
// nothing to offer and its "New offer" button stayed disabled, which reads as
// a broken feature rather than an unrun setup step.
//
// Importing this module for its side effect is enough. Values already present
// in the real environment win, so CI and a deployment shell are unaffected.

import { existsSync, readFileSync } from "node:fs";

const FILES = [".env.local", ".env"];

function parse(contents: string): Record<string, string> {
  const out: Record<string, string> = {};

  for (const raw of contents.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;

    // Strips one matching pair of surrounding quotes, and nothing else — a
    // password containing a quote is not the same string once it is mangled.
    const value = match[2].replace(/^(['"])([\s\S]*)\1$/, "$2");
    out[match[1]] = value.trim();
  }

  return out;
}

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;

  for (const file of FILES) {
    if (!existsSync(file)) continue;

    for (const [key, value] of Object.entries(parse(readFileSync(file, "utf8")))) {
      // A real environment variable beats a file, so a deployment does not
      // silently pick up a developer's leftover .env.local.
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

loadEnv();
