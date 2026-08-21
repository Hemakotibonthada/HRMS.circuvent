/**
 * Finds the defect that broke five Paystub pages, everywhere it exists.
 *
 * A React Server Component cannot pass a function to a Client Component. Doing
 * it throws "Event handlers cannot be passed to Client Component props" at
 * render time, which an error boundary turns into a generic failure page. It
 * type-checks, it lints, and it passes every unit test, because nothing in
 * these codebases renders a page.
 *
 * A file is a Server Component unless it says "use client". This reports every
 * inline arrow or function expression passed to a prop from such a file.
 *
 * Two things it deliberately does NOT flag:
 *   - `action={...}` on a <form>, which is the supported Server Action shape.
 *   - Props on plain DOM elements, which never cross a boundary. Distinguishing
 *     those needs the component's own definition, so instead the report names
 *     the receiving element and a human reads it.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.argv[2];
if (!ROOT) {
  console.error("usage: node rsc-handler-scan.mjs <app-root>");
  process.exit(2);
}

const SKIP = new Set(["node_modules", ".next", ".git", "android", "mobile", "dist", "build", ".turbo"]);

/**
 * A file using React hooks cannot be a Server Component whatever it declares —
 * importing it from one already fails on `useState`. Such a file is only ever
 * reachable through client code, so a handler in it crosses no boundary.
 *
 * Tests are excluded for the same reason: they render in a test environment,
 * not through the RSC pipeline.
 */
const HOOKS = /\buse(State|Effect|Context|Reducer|Ref|Memo|Callback|Transition|Router|Render|FormStatus|Optimistic|SyncExternalStore|LayoutEffect|Id)\b/;

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (entry.endsWith(".tsx") && !/\.(test|spec)\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

/** Lowercase first letter means a DOM element; capitalised means a component. */
function receivingElement(text, index) {
  const before = text.slice(Math.max(0, index - 4000), index);
  const open = before.lastIndexOf("<");
  if (open === -1) return "?";
  const match = /^<([A-Za-z][\w.]*)/.exec(before.slice(open));
  return match ? match[1] : "?";
}

const findings = [];
for (const file of walk(ROOT)) {
  const text = readFileSync(file, "utf8");
  if (/^\s*["']use client["']/m.test(text)) continue;
  if (HOOKS.test(text)) continue;

  // A prop whose value begins a function: onX={() => …} or onX={async (…) => …}
  // or onX={function …}. `action={…}` is excluded on purpose.
  const re = /\b(on[A-Z]\w*)=\{\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>|\b(on[A-Z]\w*)=\{\s*(?:async\s*)?function\b/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const prop = m[1] ?? m[2];
    const line = text.slice(0, m.index).split("\n").length;
    const el = receivingElement(text, m.index);
    // A lowercase tag is a DOM element — the handler never crosses a boundary.
    if (/^[a-z]/.test(el)) continue;
    findings.push({ file: relative(ROOT, file), line, prop, el });
  }
}

if (findings.length === 0) {
  console.log("clean");
} else {
  for (const f of findings) {
    console.log(`${f.file}:${f.line}  <${f.el} ${f.prop}={...}>`);
  }
  console.log(`\n${findings.length} suspect prop(s) in ${new Set(findings.map((f) => f.file)).size} server component file(s)`);
  console.log(
    "\nA Server Component cannot pass a function to a Client Component. Bind the\n" +
      "Server Action instead — action.bind(null, id) — or move the handler into a\n" +
      "component that declares \"use client\"."
  );
  // Exits non-zero, or this is a check that reports a fault and lets the build
  // through — which is worse than no check, because it looks like coverage.
  process.exit(1);
}
