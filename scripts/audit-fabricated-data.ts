// Finds fabricated data across the dashboard.
//
// The distinction that matters is between a *constant* and a *fabrication*.
// A list of Indian state names is a constant. A hardcoded PAN number rendered
// under the heading "PAN Number" is a fabrication: it looks like a fact about
// the person on screen, and nobody reading it can tell that it is not.
//
// Categories, roughly in order of how much damage they do:
//
//   invented   Math.random() rendered as a measurement
//   identity   fake PAN/Aadhaar/account numbers on a person's record
//   people     hardcoded names, emails and photos posing as records
//   notice     notification lists that are the same for every user
//   sample     placeholder text left in a shipping surface

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Everything that can reach a screen.
 *
 * This was `["src/app/(dashboard)", "src/components"]`, and the audit reported
 * clean twice while `useLeaveSummary` in `src/hooks` returned an invented leave
 * calendar and `useSearchStore` in `src/stores` answered global search with
 * three invented people. Scanning the components but not the hooks and stores
 * that feed them checks the plate and not the kitchen: a page is clean
 * precisely because the fabrication moved one import upstream.
 *
 * The roots are now everything under `src`, with the exclusions below carrying
 * a reason each. Anything not excluded is scanned, so a new directory is
 * covered the day it is created rather than the day someone remembers it.
 */
const ROOTS = ["src"];

/** Directories excluded from the scan, each for a stated reason. */
const EXCLUDED = [
  /[\\/]__tests__[\\/]/, // fixtures are supposed to be fabricated
  /\.test\.[tj]sx?$/, // ditto
  /[\\/]node_modules[\\/]/,
  /[\\/]drizzle[\\/]/, // generated migration SQL
];

interface Finding {
  file: string;
  line: number;
  kind: string;
  text: string;
}

const RULES: { kind: string; pattern: RegExp; skip?: RegExp }[] = [
  // A random number rendered as a figure someone will act on.
  //
  // Not every `Math.random` qualifies. A skeleton loader varies its bar widths
  // so the shimmer does not look like a barcode; that is decoration, and the
  // user never reads it as a number. The test is whether the value reaches a
  // label — so this skips a width in a `Skeleton` component and nothing else.
  { kind: "invented", pattern: /Math\.random\(\)/, skip: /Skeleton|shimmer|width/i },

  // Indian statutory identifiers, hardcoded.
  //
  // The format examples are exempt, and deliberately so: a PAN validator has
  // to state the shape it accepts, and "ABCDE1234F" in a regex, a placeholder
  // or an error message is a specification of that shape rather than somebody's
  // tax number. What is not exempt is the same string sitting in a data
  // structure, which is how the deleted employee profile carried a PAN, an
  // Aadhaar and a passport number for a person who did not exist.
  {
    kind: "identity",
    pattern: /\b[A-Z]{5}\d{4}[A-Z]\b/,
    skip: /placeholder|message|e\.g\.|example|pattern|regex|\/\^|test\(|RULES\./i,
  },
  { kind: "identity", pattern: /(aadhaar|aadhar)\w*\s*[:=]\s*["'`]\d/i },
  { kind: "identity", pattern: /(accountNumber|ifsc)\w*\s*[:=]\s*["'`][A-Z0-9]/i },
  { kind: "identity", pattern: /\bUAN\b\s*[:=]\s*["'`]?\d{8,}/i },

  // Placeholder people.
  { kind: "people", pattern: /@(example|test|sample|demo|acme|dummy)\.(com|org|test)/i },
  { kind: "people", pattern: /\b(John Doe|Jane Doe|Foo Bar|Test User|Lorem ipsum)\b/i },
  { kind: "people", pattern: /(pravatar|placehold\.co|placeholder\.com|unsplash\.com)/i },

  // Named as placeholder by their own author.
  //
  // The prefix list was `MOCK_|DUMMY_|FAKE_|SAMPLE_|SEED_` and missed
  // `DEMO_NOTIFICATIONS` — eight invented notifications rendered to every user
  // of every tenant, including the unread badge count. An allowlist of prefixes
  // only catches the prefixes somebody thought of, which is why the structural
  // rule below matters more than this one.
  // Named as placeholder by their own author.
  //
  // The prefix list was `MOCK_|DUMMY_|FAKE_|SAMPLE_|SEED_` and missed
  // `DEMO_NOTIFICATIONS` — eight invented notifications rendered to every user
  // of every tenant, including the unread badge count. An allowlist of prefixes
  // only catches the prefixes somebody thought of, which is why the structural
  // rule below matters more than this one.
  //
  // The skip covers a real use of a deliberately fake value: `DUMMY_HASH` is a
  // valid argon2 hash that sign-in verifies against when the account does not
  // exist, so that a missing account costs the same time as a wrong password
  // and the login form stops being an account-enumeration oracle. Removing it
  // would be a security regression, so the exemption is by stated reason.
  {
    kind: "sample",
    pattern: /\b(MOCK|DUMMY|FAKE|SAMPLE|SEED|DEMO|EXAMPLE|TEST|STUB|PLACEHOLDER)_[A-Z0-9_]{2,}\b/,
    skip: /enumeration|timing|constant.?time|oracle/i,
  },
  { kind: "sample", pattern: /\/\/\s*(TODO|FIXME|HACK)\b/i },

  // Work that is pretended rather than done.
  //
  // `useSearchStore.search()` awaited a 200ms timer described as "simulate
  // search delay" and then returned three invented people. The delay is the
  // tell: nobody waits for a computation they already have the answer to, so
  // the timer exists only to make a fabrication feel like a round trip.
  //
  // Backoff and debounce use the same idiom for a real reason, so those are
  // exempted by name.
  {
    kind: "pretend",
    pattern: /await\s+new\s+Promise\s*\(\s*\(?\s*\w*\s*\)?\s*=>\s*setTimeout/,
    skip: /retry|backoff|debounce|throttle|poll|rate.?limit|animation|transition/i,
  },
  { kind: "pretend", pattern: /\/\/\s*(simulate|mock|fake|pretend)\b/i },
];

/**
 * A hook or function that answers from a literal instead of a source.
 *
 * `findHardcodedRecordArrays` looks for `const X = [...]` at module level, and
 * that shape is only one of the two ways this codebase fabricated data. The
 * other is a hook that returns the fabrication directly:
 *
 *     export function useLeaveSummary(): LeaveSummary {
 *       return useMemo(() => ({ pendingApprovals: 3, todayOnLeave: ["Amit Shah"] }), []);
 *     }
 *
 * There is no array to find, the name is honest, and the return type is real —
 * so every lexical rule passes it. What gives it away is the absence of a
 * source: a function that reports the state of the tenant must read the tenant
 * from somewhere, and this one never calls anything.
 *
 * So the test is the conjunction of two things: the body carries values that
 * could only belong to a tenant, and the body contains no way of having
 * learned them.
 */
const DATA_SOURCE =
  /\bfetch\s*\(|startSync|useQuery|genericService|\bawait\s+(?!new\s+Promise)|use[A-Z]\w*Store\s*\(|repository|\.select\s*\(|props\.|\bparams\b/;

const FABRICATED_VALUE =
  /:\s*\d+(?:\.\d+)?\s*[,\n}]|["'`]\d{4}-\d{2}-\d{2}["'`]|["'`][₹$]\s?[\d,]+|["'`][A-Z][a-z]+\s+[A-Z][a-z]+["'`]/;

function findFabricatedReturns(source: string, file: string): Finding[] {
  const found: Finding[] = [];
  const lines = source.split("\n");
  const declaration =
    /^(?:export\s+)?(?:async\s+)?function\s+(use[A-Z]\w*|get[A-Z]\w*|fetch[A-Z]\w*|load[A-Z]\w*)\s*\(([^)]*)\)/;

  for (let i = 0; i < lines.length; i++) {
    const match = declaration.exec(lines[i]);
    if (!match) continue;

    let depth = 0;
    let body = "";
    let end = i;
    for (; end < lines.length && end < i + 300; end++) {
      body += lines[end] + "\n";
      for (const ch of lines[end]) {
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
      }
      if (depth <= 0 && end > i) break;
    }

    if (!/\breturn\b/.test(body)) continue;
    if (DATA_SOURCE.test(body)) continue;

    // A function that computes from its arguments is not fabricating, whatever
    // literals it contains. `useCountdown(targetDate)` initialises days, hours,
    // minutes and seconds to zero and then derives them from the date it was
    // handed; the zeros are an initial state, not an answer. The hooks this
    // rule exists to catch — `useLeaveSummary`, `usePayrollSummary` — take no
    // arguments at all, because there is nothing they could compute from.
    const params = match[2]
      .split(",")
      .map((p) => p.trim().split(/[:=\s]/)[0].replace(/[{}[\]]/g, ""))
      .filter(Boolean);
    if (params.some((p) => new RegExp(`\\b${p}\\b`).test(body.slice(body.indexOf("{"))))) {
      continue;
    }

    const signals = body.match(new RegExp(FABRICATED_VALUE, "g"))?.length ?? 0;
    if (signals < 4) continue;

    found.push({
      file: file.replace(/\\/g, "/"),
      line: i + 1,
      kind: "answers",
      text: `${match[1]} — returns ${signals} literal values and reads no source`,
    });
  }

  return found;
}

/**
 * A hardcoded array of record-shaped objects.
 *
 * This is the structural rule, and the one that would have caught
 * `DEMO_NOTIFICATIONS` regardless of what it was called. A module-level array
 * of objects each carrying an `id` and several record-ish fields is a table of
 * rows typed into the source — someone's leave request, someone's tax
 * declaration, someone's invoice — and it renders identically to real data.
 *
 * The hard part is that a *catalogue* looks the same to a regex. The product
 * legitimately ships lists of things it offers: report templates, letter
 * templates, the modules in settings, the integrations it supports. Those
 * describe the product; the fabrications describe a tenant.
 *
 * The signal that separates them is whether the objects carry values that
 * could only belong to somebody: an amount, a date, a person's name, a status
 * that moves. A catalogue entry has a key, a label, an icon and a description;
 * it has no ₹12,500 and no "Mar 1, 2026".
 */
const RECORD_KEYS = /\b(id|employeeId|userId)\s*:\s*["'`]/;

/** Values that can only belong to a person or a tenant, never to a catalogue. */
const TENANT_VALUE =
  /\b(amount|balance|salary|total|paid|due)\s*:\s*[₹$]?\s*[\d"']|\b(date|time|createdAt|submittedAt|uploadedAt)\s*:\s*["'`]\d|["'`]\d{1,2}\s+(min|hour|hr|day)s?\s+ago["'`]|["'`][₹$]\s?[\d,]+["'`]/i;

function findHardcodedRecordArrays(source: string, file: string): Finding[] {
  const found: Finding[] = [];
  const lines = source.split("\n");

  const declaration = /^(?:export\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?::[^=]+)?=\s*\[/;

  for (let i = 0; i < lines.length; i++) {
    const match = declaration.exec(lines[i]);
    if (!match) continue;

    let depth = 0;
    let body = "";
    let end = i;
    for (; end < lines.length && end < i + 400; end++) {
      body += lines[end] + "\n";
      for (const ch of lines[end]) {
        if (ch === "[") depth++;
        else if (ch === "]") depth--;
      }
      if (depth <= 0 && end > i) break;
    }

    const objects = (body.match(/\{/g) ?? []).length;
    if (objects < 3) continue;
    if (!RECORD_KEYS.test(body)) continue;
    if (!TENANT_VALUE.test(body)) continue;

    found.push({
      file: file.replace(/\\/g, "/"),
      line: i + 1,
      kind: "records",
      text: `${match[1]} — ${objects} hardcoded rows carrying tenant-shaped values`,
    });
  }

  return found;
}

/**
 * Removes comments before scanning.
 *
 * Comments legitimately describe these patterns — several say "this used to
 * use Math.random()" — and reporting them means the audit gets louder the more
 * carefully a fix is explained, which teaches people to stop explaining.
 *
 * Line positions are preserved by replacing comment bodies with blank lines
 * rather than deleting them.
 *
 * The line-comment pattern uses `[^\S\n]*` and not `\s*`, which is not a
 * detail. `\s` matches newlines, so `^\s*\/\/.*$` would start at a blank line,
 * consume the newlines between it and the next comment, and replace the lot
 * with nothing — collapsing several lines into one. Every finding after the
 * first blank-line-then-comment in a file then carried a line number that was
 * too low, and the reader was sent to the wrong place: this rule reported a
 * retry backoff at line 105, where the file actually holds a header literal.
 * An audit that points at innocent code is worse than one that stays quiet,
 * because the next person learns to distrust it.
 */
function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/^[^\S\n]*\/\/.*$/gm, "");
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (EXCLUDED.some((rule) => rule.test(path))) continue;
    if (statSync(path).isDirectory()) walk(path, acc);
    else if (/\.tsx?$/.test(entry) && !/\.test\./.test(entry)) acc.push(path);
  }
  return acc;
}

const findings: Finding[] = [];

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const raw = readFileSync(file, "utf8");
    const stripped = stripComments(raw);
    const lines = stripped.split("\n");
    const rawLines = raw.split("\n");

    findings.push(...findHardcodedRecordArrays(stripped, file));
    findings.push(...findFabricatedReturns(stripped, file));

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      // A few exemptions depend on what encloses the line rather than the line
      // itself: `return \`${Math.random() ...}%\`` says nothing about being a
      // skeleton width, but the function five lines above does.
      //
      // Detection reads the stripped source so that a comment describing a
      // fabrication can never be reported as one. Exemption reads the raw
      // source, because a stated reason is exactly what should excuse a match —
      // `DUMMY_HASH` is only defensible because the lines above it explain that
      // sign-in verifies against it to keep a missing account from being
      // measurably faster than a wrong password.
      const context = rawLines.slice(Math.max(0, index - 8), index + 2).join("\n");

      for (const rule of RULES) {
        if (!rule.pattern.test(line)) continue;
        if (rule.skip?.test(context)) continue;

        findings.push({
          file: file.replace(/\\/g, "/"),
          line: index + 1,
          kind: rule.kind,
          text: trimmed.slice(0, 96),
        });
        break;
      }
    });
  }
}

const byKind = new Map<string, Finding[]>();
for (const f of findings) {
  const list = byKind.get(f.kind);
  if (list) list.push(f);
  else byKind.set(f.kind, [f]);
}

const ORDER = ["records", "answers", "pretend", "invented", "identity", "people", "sample"];

console.log(`Scanned ${ROOTS.join(", ")}\n`);

for (const kind of ORDER) {
  const list = byKind.get(kind);
  if (!list?.length) continue;

  console.log(`── ${kind}  (${list.length})`);
  for (const f of list) {
    console.log(`   ${f.file.replace("src/app/(dashboard)/", "")}:${f.line}`);
    console.log(`      ${f.text}`);
  }
  console.log("");
}

console.log(`${findings.length} finding${findings.length === 1 ? "" : "s"}.`);
process.exit(findings.length === 0 ? 0 : 1);
