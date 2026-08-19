#!/usr/bin/env node
/**
 * Seeds the generated public holidays for a range of years.
 *
 * Only the dates this product can state with certainty — the Gregorian-fixed
 * and solar ones, plus Good Friday by the computus. The lunisolar and Islamic
 * festivals are deliberately absent: they need a panchangam or a moon sighting,
 * and inventing them here would put a wrong closed day in front of attendance
 * and payroll. HR fills those in per year from the holidays screen, which is
 * why that screen tells them how many are still to be confirmed.
 *
 * Idempotent: a holiday already recorded for the same org, date and name is
 * left alone, so re-running after HR has edited a year does not undo their work.
 *
 * Usage:
 *   HRMS_URL=... node scripts/seed-holidays.mjs [--from 2026] [--to 2041] [--dry]
 */

import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const argOf = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};

const url = process.env.HRMS_URL;
if (!url) {
  console.error("HRMS_URL is not set.");
  process.exit(1);
}
const sql = neon(url);

// The generator is TypeScript under src/, which this plain .mjs cannot import.
// Rather than duplicate the holiday table — the failure mode being two lists
// that drift apart — the source is read and the two exported arrays are pulled
// out of it. A change to ap-holidays.ts is therefore reflected here with no
// second edit.
const source = readFileSync(new URL("../src/lib/ap-holidays.ts", import.meta.url), "utf8");

function extractFixed() {
  const start = source.indexOf("export const FIXED_HOLIDAYS");
  const body = source.slice(source.indexOf("[", start), source.indexOf("\n];", start));
  const out = [];
  for (const block of body.split(/\n  \{/).slice(1)) {
    const name = /name:\s*"([^"]+)"/.exec(block)?.[1];
    const month = Number(/month:\s*(\d+)/.exec(block)?.[1]);
    const day = Number(/day:\s*(\d+)/.exec(block)?.[1]);
    const restricted = /restricted:\s*true/.test(block);
    const description = /description:\s*\n?\s*"([^"]+)"/.exec(block)?.[1] ?? "";
    if (name && month && day) out.push({ name, month, day, restricted, description });
  }
  return out;
}

/** The anonymous Gregorian computus, mirroring `easterSunday` in the library. */
function easter(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  return [Math.floor((h + l - 7 * m + 114) / 31), ((h + l - 7 * m + 114) % 31) + 1];
}

function goodFriday(year) {
  const [mo, d] = easter(year);
  return new Date(Date.UTC(year, mo - 1, d) - 2 * 86_400_000).toISOString().slice(0, 10);
}

const FIXED = extractFixed();
if (FIXED.length === 0) {
  console.error("Could not read FIXED_HOLIDAYS out of ap-holidays.ts — refusing to seed a partial year.");
  process.exit(1);
}

function holidaysFor(year) {
  const iso = (mo, d) => `${year}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const rows = FIXED.map((h) => ({
    name: h.name,
    date: iso(h.month, h.day),
    restricted: h.restricted,
    description: h.description,
  }));
  const friday = goodFriday(year);
  const clash = rows.find((r) => r.date === friday);
  if (clash) {
    clash.name = `${clash.name} / Good Friday`;
    clash.description = `${clash.description} Good Friday falls on the same day this year.`;
  } else {
    rows.push({
      name: "Good Friday",
      date: friday,
      restricted: false,
      description: "The Friday before Easter, by the Gregorian computus.",
    });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

const from = argOf("--from", 2026);
const to = argOf("--to", 2041);

const orgs = await sql`SELECT id, name FROM identity.organizations WHERE deleted_at IS NULL ORDER BY created_at`;
if (orgs.length === 0) {
  console.error("No organisation to seed against.");
  process.exit(1);
}

console.log(`${FIXED.length} fixed holidays + Good Friday, ${from}–${to}, for ${orgs.length} organisation(s)\n`);

let inserted = 0;
let already = 0;

for (const org of orgs) {
  for (let year = from; year <= to; year++) {
    for (const h of holidaysFor(year)) {
      if (dry) { inserted++; continue; }
      const done = await sql`
        INSERT INTO hrms.holidays (org_id, name, holiday_date, is_optional, year, description)
        VALUES (${org.id}, ${h.name}, ${h.date}, ${h.restricted}, ${year}, ${h.description})
        ON CONFLICT DO NOTHING
        RETURNING id`;
      if (done.length) inserted++; else already++;
    }
  }
  console.log(`  ${org.name}: ${from}–${to} done`);
}

console.log(`\n${inserted} inserted, ${already} already present.${dry ? " (dry run)" : ""}`);

if (!dry) {
  const check = await sql`
    SELECT year, count(*)::int n FROM hrms.holidays
     WHERE year BETWEEN ${from} AND ${to} GROUP BY year ORDER BY year`;
  console.log("\nPer year: " + check.map((r) => `${r.year}:${r.n}`).join("  "));
}
