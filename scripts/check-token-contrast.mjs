// Measures WCAG contrast for the OKLCH tokens declared in a globals.css.
//
// Implements OKLab -> linear sRGB -> relative luminance directly rather than
// pulling a colour library in, so it can be pointed at any app in the suite
// without adding a dependency to it.
//
// This exists because the palette is the one part of the design system that
// cannot be checked by looking at it. Every app in the suite shipped with
// `--input` somewhere around 1.1:1 — field borders that were not merely subtle
// but literally the same colour as the surface behind them — and it survived
// review in four separate codebases because nobody can eyeball an OKLCH triple
// and know it is invisible.
//
// Usage: node scripts/check-token-contrast.mjs [path-to-globals.css]

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// ── OKLCH -> sRGB ────────────────────────────────────────────────────────────
function oklchToRgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => Math.min(1, Math.max(0, v))); // linear-light, gamut-clipped
}

/** WCAG relative luminance. Input is already linear-light, so no de-gamma. */
const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const contrast = (c1, c2) => {
  const [a, b] = [luminance(c1), luminance(c2)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
};

/**
 * Flattens a translucent foreground over a backdrop.
 * Composites in linear light, which is what a browser does.
 */
const over = (fg, bg, alpha) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));

// ── parse ────────────────────────────────────────────────────────────────────
const here = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] ?? resolve(here, "..", "src", "app", "globals.css");
const css = readFileSync(file, "utf8");

// Light tokens are everything before `.dark {`; dark tokens override after it.
const darkAt = css.search(/\.dark\s*\{/);
const parseBlock = (text) => {
  const out = {};
  const re = /--([a-z0-9-]+):\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/gi;
  let m;
  while ((m = re.exec(text))) out[m[1]] = oklchToRgb(+m[2], +m[3], +m[4]);
  return out;
};

const light = parseBlock(darkAt === -1 ? css : css.slice(0, darkAt));
const dark = { ...light, ...parseBlock(darkAt === -1 ? "" : css.slice(darkAt)) };

// ── checks ───────────────────────────────────────────────────────────────────
// [foreground, background, minimum, label]. 4.5 for body text, 3.0 for a UI
// boundary or large text (WCAG 1.4.3 / 1.4.11).
const CHECKS = [
  ["foreground", "background", 4.5, "body text on page"],
  ["foreground", "card", 4.5, "body text on card"],
  ["muted-foreground", "background", 4.5, "secondary text on page"],
  ["muted-foreground", "card", 4.5, "secondary text on card"],
  ["muted-foreground", "muted", 4.5, "secondary text on muted fill"],
  ["primary-foreground", "primary", 4.5, "primary button label"],
  ["secondary-foreground", "secondary", 4.5, "secondary button label"],
  ["accent-foreground", "accent", 4.5, "accent label"],
  ["destructive-foreground", "destructive", 4.5, "destructive button label"],
  ["success-foreground", "success", 4.5, "success fill label"],
  ["warning-foreground", "warning", 4.5, "warning fill label"],
  ["info-foreground", "info", 4.5, "info fill label"],
  ["sidebar-foreground", "sidebar", 4.5, "sidebar text"],
  ["sidebar-primary-foreground", "sidebar-primary", 4.5, "sidebar active label"],
  ["destructive", "background", 4.5, "destructive text on page"],
  ["primary", "background", 4.5, "link/primary text on page"],
  ["border", "background", 3.0, "border against page"],
  ["border", "card", 3.0, "border against card"],
  ["input", "background", 3.0, "input outline against page"],
  ["input", "card", 3.0, "input outline against card"],
  ["ring", "background", 3.0, "focus ring against page"],
];

// Tinted status pills: N% of the status colour over a card, with `-strong` text.
const TINTED = [
  ["success-strong", "success", 0.15, "card", "success pill text"],
  ["warning-strong", "warning", 0.2, "card", "warning pill text"],
  ["info-strong", "info", 0.15, "card", "info pill text"],
  ["destructive-strong", "destructive", 0.15, "card", "destructive pill text"],
];

let failures = 0;
for (const [themeName, tokens] of [["light", light], ["dark", dark]]) {
  console.log(`\n── ${themeName} ${"─".repeat(52)}`);
  for (const [fg, bg, min, label] of CHECKS) {
    if (!tokens[fg] || !tokens[bg]) continue; // token not defined in this app
    const ratio = contrast(tokens[fg], tokens[bg]);
    const ok = ratio >= min;
    if (!ok) failures++;
    console.log(
      `  ${ok ? "pass" : "FAIL"}  ${ratio.toFixed(2).padStart(6)}:1  (need ${min})  ${label}`
    );
  }
  for (const [fg, tint, alpha, bg, label] of TINTED) {
    if (!tokens[fg] || !tokens[tint] || !tokens[bg]) continue;
    const surface = over(tokens[tint], tokens[bg], alpha);
    const ratio = contrast(tokens[fg], surface);
    const ok = ratio >= 4.5;
    if (!ok) failures++;
    console.log(
      `  ${ok ? "pass" : "FAIL"}  ${ratio.toFixed(2).padStart(6)}:1  (need 4.5)  ${label}`
    );
  }
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} failing.`}`);
process.exit(failures === 0 ? 0 : 1);
