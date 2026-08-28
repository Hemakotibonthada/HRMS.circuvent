// ═══════════════════════════════════════════════════════════════
// AUDIT: THINGS BUILT TO BE DISPATCHED, THAT NOTHING DISPATCHES
// ═══════════════════════════════════════════════════════════════
//
// Three times in this codebase the same defect has appeared, at three
// different scales, and each time it survived review because everything about
// it looked finished:
//
//   - `/api/expenses` and `/api/recruitment` answered `201 Submitted` and
//     wrote nothing.
//   - Five offer emails were written with thirty-three tests; one was wired to
//     a route and the other four were exported into a vacuum.
//   - The whole notification subsystem — engine, transports, templates, about
//     twelve hundred lines with fifty passing tests — was imported by nothing
//     but its own test files. Leave was approved and the employee found out by
//     refreshing the page.
//
// A test suite cannot catch this. Every one of those modules had good tests,
// and the tests passed, because the tests import the module directly. What is
// missing is not correctness but connection.
//
// So this audit asks a different question: for modules whose entire purpose is
// to have an effect somewhere else, is each export reachable from something
// that is not a test?
//
// It is deliberately not run over all of `src`. Most of a codebase is made of
// things that are legitimately used in one place, or not yet used, or exported
// for a type. Applied everywhere this rule produces so much noise that it gets
// switched off — so it names the modules that exist to be called, and those
// only. Adding a module here is a statement that its exports are meant to
// reach production.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Modules whose exports exist to be dispatched, and by whom they may be used. */
const EFFECT_MODULES = [
  "src/lib/document-mail.ts",
  "src/lib/document-notify.ts",
  "src/lib/document-dispatch.ts",
  "src/lib/notifications/engine.ts",
  "src/lib/notifications/transport.ts",
  "src/lib/notifications/notify.ts",
];

/** Where a legitimate caller may live. */
const CALLER_ROOTS = ["src/app", "src/lib", "src/db", "src/components", "src/hooks", "scripts"];

interface Finding {
  module: string;
  symbol: string;
  detail: string;
}

/**
 * Exported symbols, by name.
 *
 * Types and interfaces are excluded. A type is used at compile time and
 * erased; requiring one to have a runtime caller would flag every shared shape
 * in the codebase, and a type nobody uses costs nothing at runtime anyway.
 */
function exportsOf(source: string): string[] {
  const names: string[] = [];
  const patterns = [
    /^export\s+(?:async\s+)?function\s+([A-Za-z_]\w*)/gm,
    /^export\s+const\s+([A-Za-z_]\w*)/gm,
    /^export\s+class\s+([A-Za-z_]\w*)/gm,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) names.push(match[1]);
  }

  return [...new Set(names)];
}

function walk(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }

  for (const entry of entries) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, acc);
    else if (/\.tsx?$/.test(entry)) acc.push(path);
  }
  return acc;
}

const callers = CALLER_ROOTS.flatMap((root) => walk(root))
  .filter((file) => !/\.test\.[tj]sx?$/.test(file))
  .map((file) => ({ file: file.replace(/\\/g, "/"), source: readFileSync(file, "utf8") }));

const findings: Finding[] = [];

for (const modulePath of EFFECT_MODULES) {
  let source: string;
  try {
    source = readFileSync(modulePath, "utf8");
  } catch {
    findings.push({
      module: modulePath,
      symbol: "(the file)",
      detail: "listed as an effect module but does not exist",
    });
    continue;
  }

  const normalised = modulePath.replace(/\\/g, "/");

  for (const symbol of exportsOf(source)) {
    // Word-boundary match so `render` does not count `renderTemplate`, and a
    // symbol mentioned only in prose does not count either — comments are not
    // callers.
    const pattern = new RegExp(`\\b${symbol}\\b`);

    const used = callers.some(
      ({ file, source: text }) =>
        file !== normalised && pattern.test(stripComments(text))
    );

    if (used) continue;

    // Exported but used inside its own module is a helper that was exported so
    // a test could reach it directly. That is a normal and useful pattern, and
    // flagging it is how an audit like this gets switched off: `formatDateForEmail`
    // is called by `offerIssuedEmail` three lines down, and nothing is wrong.
    //
    // What this audit is for is the symbol used *nowhere* — not by a caller,
    // not by its own module. `offerReminderEmail` was exactly that: a complete,
    // tested email body that no code path could ever produce. So internal use
    // is the discriminator, and only a symbol with none of it is reported.
    if (usedWithin(source, symbol)) continue;

    findings.push({
      module: normalised,
      symbol,
      detail: "exported, used nowhere — not by a caller, not by its own module",
    });
  }
}

/**
 * Whether a module uses its own export, ignoring the line that declares it.
 *
 * The declaration itself always mentions the name, so a naive count is never
 * zero.
 */
function usedWithin(source: string, symbol: string): boolean {
  const withoutComments = stripComments(source);
  const declaration = new RegExp(
    `^export\\s+(?:async\\s+)?(?:function|const|class)\\s+${symbol}\\b`
  );

  return withoutComments
    .split("\n")
    .filter((line) => !declaration.test(line))
    .some((line) => new RegExp(`\\b${symbol}\\b`).test(line));
}

/** Comments describe callers; they are not callers. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/^[^\S\n]*\/\/.*$/gm, "");
}

console.log(`Checked ${EFFECT_MODULES.length} effect modules\n`);

if (findings.length === 0) {
  console.log("Everything built to be dispatched is dispatched.\n");
} else {
  for (const finding of findings) {
    console.log(`   ${finding.module} → ${finding.symbol}`);
    console.log(`      ${finding.detail}`);
  }
  console.log("");
}

console.log(`${findings.length} unwired export${findings.length === 1 ? "" : "s"}.`);
process.exit(findings.length === 0 ? 0 : 1);
