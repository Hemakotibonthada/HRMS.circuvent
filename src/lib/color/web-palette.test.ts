// ═══════════════════════════════════════════════════════════════
// WEB PALETTE — contrast contract
// ═══════════════════════════════════════════════════════════════
// Reads src/app/globals.css and asserts a contrast ratio for every pair the
// app actually renders.
//
// It parses the real stylesheet rather than a copy of the values, on purpose.
// A duplicated palette in a test file is a second home for one concept: it
// passes while the shipped colours drift away from it, which is precisely the
// failure this is meant to catch.
//
// Four of these pairs failed when the file was first written, and the numbers
// are in docs/ROADMAP.md.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, isOklch, toHex, WCAG } from "./contrast";

const CSS = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");

/**
 * Custom properties declared inside one selector block.
 *
 * `.dark` overrides only some of `:root`, so the dark palette is the light one
 * with the overrides applied. Reading `.dark` alone would leave tokens
 * undefined and quietly skip the pairs that use them.
 */
function readBlock(selector: string): Record<string, string> {
  const start = CSS.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`No ${selector} block in globals.css`);

  const open = CSS.indexOf("{", start);
  const end = CSS.indexOf("\n}", open);
  const body = CSS.slice(open + 1, end);

  const tokens: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const match = /^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/i.exec(line);
    if (match?.[1] && match[2]) tokens[match[1]] = match[2].trim();
  }
  return tokens;
}

const light = readBlock(":root");
const dark = { ...light, ...readBlock(".dark") };

interface Pair {
  name: string;
  foreground: string;
  background: string;
  minimum: number;
}

/** Text pairs are held to 4.5:1; borders and rings to the 3:1 non-text rule. */
const PAIRS: Pair[] = [
  { name: "body text on the page", foreground: "--foreground", background: "--background", minimum: WCAG.bodyText },
  { name: "card text on a card", foreground: "--card-foreground", background: "--card", minimum: WCAG.bodyText },
  { name: "popover text on a popover", foreground: "--popover-foreground", background: "--popover", minimum: WCAG.bodyText },
  { name: "muted text on the page", foreground: "--muted-foreground", background: "--background", minimum: WCAG.bodyText },
  { name: "muted text on a card", foreground: "--muted-foreground", background: "--card", minimum: WCAG.bodyText },
  { name: "muted text on a muted surface", foreground: "--muted-foreground", background: "--muted", minimum: WCAG.bodyText },
  { name: "label on a primary button", foreground: "--primary-foreground", background: "--primary", minimum: WCAG.bodyText },
  { name: "label on a secondary button", foreground: "--secondary-foreground", background: "--secondary", minimum: WCAG.bodyText },
  { name: "accent text on accent", foreground: "--accent-foreground", background: "--accent", minimum: WCAG.bodyText },
  { name: "label on a destructive button", foreground: "--destructive-foreground", background: "--destructive", minimum: WCAG.bodyText },
  { name: "label on a success surface", foreground: "--success-foreground", background: "--success", minimum: WCAG.bodyText },
  { name: "label on a warning surface", foreground: "--warning-foreground", background: "--warning", minimum: WCAG.bodyText },
  { name: "sidebar text on the sidebar", foreground: "--sidebar-foreground", background: "--sidebar", minimum: WCAG.bodyText },
  // Not text, so 3:1 — but a field outline is the only thing telling someone
  // where the input is, and a focus ring is the only thing telling a keyboard
  // user where they are.
  { name: "border against the page", foreground: "--border", background: "--background", minimum: WCAG.nonText },
  { name: "border against a card", foreground: "--border", background: "--card", minimum: WCAG.nonText },
  { name: "focus ring against the page", foreground: "--ring", background: "--background", minimum: WCAG.nonText },
  { name: "focus ring against a card", foreground: "--ring", background: "--card", minimum: WCAG.nonText },
];

describe.each([
  ["light", light],
  ["dark", dark],
])("the %s palette in globals.css", (mode, tokens) => {
  it.each(PAIRS)("$name meets $minimum:1", ({ name, foreground, background, minimum }) => {
    const fg = tokens[foreground];
    const bg = tokens[background];

    // A missing token would otherwise throw from inside the colour parser and
    // read as a broken test rather than a missing custom property.
    expect(fg, `${foreground} is not declared for ${mode}`).toBeTypeOf("string");
    expect(bg, `${background} is not declared for ${mode}`).toBeTypeOf("string");

    const ratio = contrastRatio(fg as string, bg as string);
    expect(
      ratio,
      `${name} in ${mode} is ${ratio.toFixed(2)}:1 (${toHex(fg as string)} on ${toHex(bg as string)}) but needs ${minimum}:1`
    ).toBeGreaterThanOrEqual(minimum);
  });
});

describe("surfaces are distinguishable from the page behind them", () => {
  // Not a WCAG rule — a card is not text. But `--card` sat at 1.04:1 against
  // `--background` in dark mode, which is a surface nobody can see, and no
  // text rule catches that because both of its own text pairs passed.
  it.each([
    ["light", light],
    ["dark", dark],
  ])("%s cards are visible against the background", (mode, tokens) => {
    const ratio = contrastRatio(tokens["--card"] as string, tokens["--background"] as string);
    expect(ratio, `${mode} card is ${ratio.toFixed(2)}:1 against the background`).toBeGreaterThan(
      1.1
    );
  });
});

describe("the stylesheet itself", () => {
  it("declares its colours in oklch, as the conversion assumes", () => {
    // If someone switches a token to hex or hsl the parser still copes, but
    // the assumption is worth stating: a silent format change is how a
    // palette check starts measuring something other than what ships.
    const colours = Object.entries(light).filter(([name]) =>
      /^--(background|foreground|card|primary|border|ring|muted|destructive|success|warning)$/.test(
        name
      )
    );
    expect(colours.length).toBeGreaterThan(5);
    for (const [name, value] of colours) {
      expect(isOklch(value), `${name} is ${value}`).toBe(true);
    }
  });

  it("gives the dark block a real override for every surface it changes", () => {
    const overrides = readBlock(".dark");
    for (const token of ["--background", "--foreground", "--card", "--border"]) {
      expect(overrides[token], `${token} is not overridden for dark mode`).toBeTypeOf("string");
    }
  });
});
