// Finds fabricated data across the dashboard.
//
// The distinction that matters is between a *constant* and a *fabrication*.
// A list of Indian state names is a constant. A hardcoded PAN number rendered
// under the heading "PAN Number" is a fabrication: it looks like a fact about
// the person on screen, and nobody reading it can tell that it is not.
//
// Categories, roughly in order of how much damage they do:
//
//   records    a module-level array of record-shaped objects, rendered as data
//   answers    a hook or function that returns a fabrication and reads no source
//   hollow     a success toast fired with nothing behind it that could succeed
//   dead       a button styled and iconed for an action it has no handler for
//   pretend    a delay or comment dressing up fabricated work as a real one
//   invented   Math.random() rendered as a measurement
//   identity   fake PAN/Aadhaar/account numbers on a person's record
//   people     hardcoded names, emails and photos posing as records
//   sample     placeholder text left in a shipping surface
//
// Known gaps, left to review rather than automated: a KPI computed by a
// formula with a fixed floor or ceiling (`wellness/page.tsx` used to divide
// active programmes by its own 5 category tiles and call the result a
// "Wellness Score") reads the same as a real ratio to a regex — telling them
// apart needs knowing what the numerator and denominator mean, not what they
// match. A short hardcoded string list nested inside an otherwise-real
// record's detail view (`vault/page.tsx` used to invent a three-entry
// "Version History" for documents that only ever store one version) is
// exactly the same shape as legitimate small string lists — quick-reply
// chips, filter options — so a rule for it would flag far more of those than
// it would ever catch of it. Both stay a code-review concern.

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

  // A button built and iconed for a real action that has no handler at all.
  //
  // `vault/page.tsx` rendered `<Button variant="ghost" size="icon"><Download
  // className="h-4 w-4" /></Button>` in three places — the document list, the
  // shared-documents tab, and the detail dialog's footer — none of them with
  // an `onClick`. Every document's `url` is always `""`; nothing in the app
  // ever stores a file to download or share, so the buttons could not have
  // worked even if wired up. A hollow toast at least renders a message; this
  // rendered a control that does nothing at all when clicked, which reads as
  // broken rather than dishonest but erodes trust the same way.
  //
  // Scoped to the icons actually found doing this — Download, Share2, Upload
  // — rather than every icon button, because most icon buttons in this
  // codebase correctly open a dialog or toggle state and would otherwise
  // flood the report. `disabled` is exempted: a control honestly marked
  // unavailable (see `calculator/page.tsx`'s "Export PDF (not available
  // yet)") is the fix for this category, not another instance of it.
  {
    kind: "dead",
    pattern: /<Button\b[^>]*>\s*<(Download|Share2|Upload)\b/,
    skip: /onClick|disabled/,
  },

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

/**
 * The other shape a fabricated record array took: no `id`, no money, no date
 * — a category label next to an invented number out of 100. `COMPLIANCE_SCORES`
 * was `{ category: "Data Privacy", score: 92 }` eight times, rendered as a
 * radar chart and averaged into "Overall Compliance Score: 91%"; nothing on
 * the page had ever measured a single one of those numbers. `RECORD_KEYS` and
 * `TENANT_VALUE` both miss it — there is no row identifier and no currency —
 * so it needs its own pair of gates, checked as an alternative to those two,
 * not instead of them.
 *
 * Each half is common enough alone that neither should trigger anything by
 * itself: a settings catalogue has an `area`, a chart config has a
 * `dimension`, a progress step has a `percent`. It is a label field and a
 * scored-out-of-100 field on the same objects that is specific to a
 * scorecard someone typed in rather than computed.
 */
const SCORE_ROW = /\b(category|area|metric|dimension)\s*:\s*["'`]/i;
const SCORE_VALUE = /\b(score|rating|percent(?:age)?|compliance|completion|utilization)\s*:\s*\d{1,3}\b/i;

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

    const isTenantRecord = RECORD_KEYS.test(body) && TENANT_VALUE.test(body);
    const isScoredCatalogue = SCORE_ROW.test(body) && SCORE_VALUE.test(body);
    if (!isTenantRecord && !isScoredCatalogue) continue;

    const reason = isTenantRecord ? "carrying tenant-shaped values" : "carrying an invented score per row";
    found.push({
      file: file.replace(/\\/g, "/"),
      line: i + 1,
      kind: "records",
      text: `${match[1]} — ${objects} hardcoded rows ${reason}`,
    });
  }

  return found;
}

/**
 * A label sitting next to an invented recurrence: `{ title: "Fun Friday",
 * date: "Every Friday" }`, `{ title: "Town Hall", date: "Last Friday of
 * Month" }`. `culturehub/page.tsx`'s "Events" tab was four of these, and
 * `findHardcodedRecordArrays` above never had a chance at it — the array was
 * never assigned to a name, just opened inline inside the JSX it rendered
 * (`{[ ... ].map(event => (`), so the `const X = [` anchor that check relies
 * on does not exist here. Rather than teach the array walker to chase
 * anonymous brackets through arbitrary JSX and risk it snagging the dozens of
 * legitimate inline `{[...].map(...)}` lists this codebase uses for KPI cards
 * built from real variables, this checks the one thing that was actually
 * wrong: a real-looking name typed next to a schedule nobody configured,
 * wherever the two sit on the same line.
 *
 * This codebase does have real recurring facts — `compliance-engine.ts`'s
 * statutory filing calendar carries monthly and quarterly EPF deadlines —
 * but they live in a lowercase, type-checked enum (`frequency: "monthly"`)
 * that code branches on, never as the Title Case phrase written for a screen
 * to print (`"Every Friday"`, `"Last Friday of Month"`). Matching only the
 * display-prose shape is what keeps that file out of this report without a
 * name-based exemption, and an empty label (a form's `title: ""` default) is
 * excluded by requiring the label actually say something.
 *
 * The bar is two hits per file, not one: a single hardcoded schedule next to
 * a label could be an odd one-off; several together is a calendar someone
 * typed in and is asking a customer to trust.
 */
const LABEL_FIELD = /\b(title|label|name)\s*:\s*["'`][^"'`]+["'`]/;
const CADENCE_VALUE =
  /\b(date|cadence|frequency|schedule|recurrence)\s*:\s*["'`]\s*(Daily|Weekly|Monthly|Quarterly|Annually|Every \w+|Last \w+ of \w+)/;

function findScheduledClaims(source: string, file: string): Finding[] {
  const lines = source.split("\n");
  const hitLines = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => LABEL_FIELD.test(line) && CADENCE_VALUE.test(line));

  if (hitLines.length < 2) return [];

  return hitLines.map(({ line, index }) => ({
    file: file.replace(/\\/g, "/"),
    line: index + 1,
    kind: "records",
    text: `hardcoded label with an invented recurrence — ${line.trim().slice(0, 88)}`,
  }));
}

/**
 * Anything that could actually make a success toast true.
 *
 * Reuses the same signal `findFabricatedReturns` uses to tell a computed
 * value from a fabricated one — `await` of anything but a fake timer, a
 * `fetch`, a store — and adds the write-side calls a read-only hook would
 * never need: `.mutate(`, `useMutation`, `axios.`. If a handler awaited
 * nothing and called none of these before announcing success, nothing ran
 * that could have failed, which means the toast is not reporting an outcome.
 *
 * Also covers the two real actions that succeed or fail without a network
 * round trip: building a downloadable file with `new Blob(` /
 * `URL.createObjectURL(`, and writing to the clipboard with
 * `navigator.clipboard.`. Both can genuinely fail — a browser can refuse a
 * clipboard write — and both were being reported as hollow: the audit log
 * export in `audit/page.tsx` builds its CSV from data already on screen, and
 * `chatbot/page.tsx` and `letters/page.tsx` copy real text to the clipboard,
 * none of which needed a server round trip to be a genuine action.
 */
const MUTATION_SOURCE =
  /\bfetch\s*\(|\.mutate\s*\(|useMutation|\baxios\.|\bawait\s+(?!new\s+Promise)|new\s+Blob\s*\(|URL\.createObjectURL\s*\(|navigator\.clipboard\./;

/**
 * `toast.success(...)` with nothing behind it that could have succeeded.
 *
 * This is how "Download Sample", "Export" and "Upload proof now" on the
 * import screen worked: the button's entire handler was the toast call, so
 * clicking it always "succeeded" whether or not a file existed to export.
 * The toast is indistinguishable from a real one — same text, same colour,
 * same position — which is what makes it worse than an error: an error at
 * least tells the user something happened.
 *
 * The scope checked is the block enclosing the toast call, found by
 * scanning backward for the nearest unmatched `{` — the mirror image of how
 * `findFabricatedReturns` scans forward from a declaration. That block's own
 * opening line is included in the text searched, not just what follows the
 * brace, so `somePromise.then(() => { ... toast.success(...) })` still sees
 * the `.then(` that precedes its own `{`.
 *
 * A single enclosing block is not always enough. `submit()` in
 * `holidays/page.tsx` reads:
 *
 *     try {
 *       const response = await fetch("/api/holidays/bulk", { ... });
 *       ...
 *       if (payload.imported > 0) {
 *         toast.success(`Imported ${payload.imported} holidays`);
 *       }
 *     }
 *
 * and the immediate enclosing block is the `if`, not the `try` — so a
 * single-level scan never sees the `fetch` sitting one block further out,
 * as a sibling statement of the `if` rather than something inside it. The
 * scan below keeps stepping one enclosing block further out, re-checking the
 * accumulated scope for a mutation source after each step, and stops the
 * moment it finds one — so it also sees a `try` around the `if`, or a
 * `switch` case around a `try`. The step count and the 200-line window are
 * shared across every step combined, so a toast that is genuinely hollow
 * several blocks deep cannot be excused by an unrelated fetch call that
 * belongs to a different function much further up the same file.
 *
 * A handler whose entire body is the toast call — `onClick={() =>
 * toast.success(...)}, no braces at all — is reported directly, since there
 * is no enclosing block to search.
 *
 * This does not know that a named helper called two lines above actually
 * did the work if that helper is invoked without `await` — a fire-and-forget
 * call with no `await`, no `fetch`, and no `.mutate` in sight is rare enough
 * in this codebase's async-first style that the false negative is an
 * acceptable trade for not having to model call graphs.
 */
function findFakeSuccessToasts(source: string, file: string): Finding[] {
  const found: Finding[] = [];
  const lines = source.split("\n");
  const call = /\btoast\.success\s*\(/;
  const isHandlerBody = /=>\s*toast\.success\s*\(/;

  /** The line holding the nearest unmatched `{` scanning backward from
   *  `from`, down to (and including) `earliest`. -1 if none is found. */
  const enclosingBraceLine = (from: number, earliest: number): number => {
    let depth = 0;
    for (let start = from; start >= earliest; start--) {
      for (let c = lines[start].length - 1; c >= 0; c--) {
        if (lines[start][c] === "}") depth++;
        else if (lines[start][c] === "{") depth--;
      }
      if (depth < 0) return start;
    }
    return -1;
  };

  for (let i = 0; i < lines.length; i++) {
    if (!call.test(lines[i])) continue;

    if (isHandlerBody.test(lines[i])) {
      found.push({
        file: file.replace(/\\/g, "/"),
        line: i + 1,
        kind: "hollow",
        text: lines[i].trim().slice(0, 96),
      });
      continue;
    }

    const earliest = Math.max(0, i - 200);
    let boundary = i;
    let sawEnclosingBrace = false;
    let sawSource = false;
    for (let step = 0; step < 3; step++) {
      const brace = enclosingBraceLine(boundary, earliest);
      if (brace < 0) break;
      sawEnclosingBrace = true;
      boundary = brace;
      if (MUTATION_SOURCE.test(lines.slice(boundary, i + 1).join("\n"))) {
        sawSource = true;
        break;
      }
      boundary -= 1;
    }
    if (!sawEnclosingBrace || sawSource) continue;

    found.push({
      file: file.replace(/\\/g, "/"),
      line: i + 1,
      kind: "hollow",
      text: lines[i].trim().slice(0, 96),
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
    findings.push(...findScheduledClaims(stripped, file));
    findings.push(...findFabricatedReturns(stripped, file));
    findings.push(...findFakeSuccessToasts(stripped, file));

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

const ORDER = ["records", "answers", "hollow", "dead", "pretend", "invented", "identity", "people", "sample"];

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
