// Reports user-facing text still written inline in Kotlin.
//
// Run with `npm run android:strings`.
//
// The point is to make the size of the translation job a number somebody can
// look at, rather than a guess. It only reports; it never rewrites. Extracting
// strings automatically sounds appealing and is how you end up translating a
// log message, a route name or a JSON key — and a bad automated edit across
// twenty screens is far more expensive than doing it by hand.
//
// Deliberately conservative. It looks only at arguments to parameters that are
// known to be shown to a person, so what it reports is worth acting on. It will
// miss things; the count is a floor, not a total.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = "android/app/src/main/java/com/circuvent/hrms";

/** Parameters whose value is read by a human. */
const UI_PARAMS = [
  "label",
  "title",
  "description",
  "contentDescription",
  "supporting",
  "placeholder",
  "actionLabel",
  "optionLabel",
];

const paramPattern = new RegExp(
  String.raw`\b(?:${UI_PARAMS.join("|")})\s*=\s*"((?:[^"\\]|\\.)*)"`,
  "g"
);

// AppText's first argument, positional. `AppText("Hello")` is by far the most
// common way text reaches the screen in this codebase.
const appTextPattern = /\bAppText\(\s*(?:text\s*=\s*)?"((?:[^"\\]|\\.)*)"/g;

// Things that look like text but are not: route names, ids, format patterns.
const NOT_TEXT = /^[a-z0-9_.\-/{}]*$/;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (entry.endsWith(".kt")) yield full;
  }
}

const perFile = new Map();
let total = 0;

for (const file of walk(ROOT)) {
  const source = readFileSync(file, "utf8");
  const found = new Set();

  for (const pattern of [paramPattern, appTextPattern]) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(source)) !== null) {
      const text = m[1];
      // A bare word with no spaces and no capital is almost always a key.
      if (text.length < 3 || NOT_TEXT.test(text)) continue;
      found.add(text);
    }
  }

  if (found.size > 0) {
    perFile.set(relative(ROOT, file).replace(/\\/g, "/"), found.size);
    total += found.size;
  }
}

const ranked = [...perFile.entries()].sort((a, b) => b[1] - a[1]);

console.log(`Strings still inline: ${total} across ${ranked.length} files\n`);
for (const [file, n] of ranked) {
  console.log(`${String(n).padStart(4)}  ${file}`);
}
console.log(
  "\nExtract into res/values/strings.xml, then read TRANSLATING.md before\n" +
    "adding a language. Statutory terms must not be machine-translated."
);
