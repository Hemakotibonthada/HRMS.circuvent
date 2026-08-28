// ═══════════════════════════════════════════════════════════════
// Referral form ↔ API contract
// ═══════════════════════════════════════════════════════════════
// The form posted `referrerName`/`candidateName`/`position` while the route
// required `candidateName`/`candidateEmail`/`positionTitle`. Nothing connected
// the two, so every submission failed validation and the page reported a flat
// "Failed to submit referral" — with no clue that an email was never collected.
//
// These tests read both files and compare them, so the two cannot drift again.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const pageSrc = readFileSync(
  join(root, "src", "app", "(dashboard)", "referrals", "page.tsx"),
  "utf8",
);
const routeSrc = readFileSync(
  join(root, "src", "app", "api", "referrals", "route.ts"),
  "utf8",
);

/** Field names on the submit schema, and whether each is optional. */
function schemaFields(): { name: string; optional: boolean }[] {
  const block = routeSrc.match(/const submitSchema = z\.object\(\{([\s\S]*?)\n\}\);/);
  if (!block) throw new Error("submitSchema not found — did the route change shape?");
  const fields: { name: string; optional: boolean }[] = [];
  // Each entry starts at a `name:` at the object's top level of indentation.
  const entries = block[1].split(/\n(?=\s{2}\w+:)/);
  for (const entry of entries) {
    const name = entry.match(/^\s*(\w+):/)?.[1];
    if (!name) continue;
    fields.push({ name, optional: /\.optional\(\)/.test(entry) });
  }
  return fields;
}

/** Keys the page actually puts in the POST body. */
function payloadKeys(): string[] {
  const block = pageSrc.match(/const payload = \{([\s\S]*?)\n    \};/);
  if (!block) throw new Error("payload object not found in the referrals page");
  return [...block[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
}

/** `name="..."` attributes on the form's inputs. */
function formInputNames(): string[] {
  return [...pageSrc.matchAll(/name="(\w+)"/g)].map((m) => m[1]);
}

describe("referral submit schema", () => {
  it("is parsed correctly by these tests", () => {
    const fields = schemaFields();
    expect(fields.length).toBeGreaterThan(5);
    expect(fields.find((f) => f.name === "candidateEmail")?.optional).toBe(false);
    expect(fields.find((f) => f.name === "candidatePhone")?.optional).toBe(true);
  });
});

describe("the form posts what the route requires", () => {
  it("sends every required field", () => {
    const required = schemaFields().filter((f) => !f.optional).map((f) => f.name);
    const sent = payloadKeys();
    expect(required.length).toBeGreaterThan(0);
    for (const field of required) {
      expect(sent, `payload is missing required field "${field}"`).toContain(field);
    }
  });

  it("sends nothing the route would reject", () => {
    const known = schemaFields().map((f) => f.name);
    for (const key of payloadKeys()) {
      expect(known, `payload sends "${key}", which submitSchema does not accept`).toContain(key);
    }
  });

  it("collects every required field from the user", () => {
    const required = schemaFields().filter((f) => !f.optional).map((f) => f.name);
    const inputs = formInputNames();
    for (const field of required) {
      expect(inputs, `no input collects "${field}" — it can only ever be blank`).toContain(field);
    }
  });

  it("does not ask for the referrer, which the route takes from the session", () => {
    // The route comments that accepting this from the body would let someone
    // submit a referral in a colleague's name. A field for it is misleading.
    expect(formInputNames()).not.toContain("referrerName");
    expect(payloadKeys()).not.toContain("referrerId");
  });

  it("surfaces the server's reason rather than a blanket message", () => {
    // A duplicate candidate, a rate limit and a malformed address are all
    // different problems; reporting one string for all of them left people
    // retrying a form that could never succeed.
    expect(pageSrc).toMatch(/body\?\.error/);
  });
});
