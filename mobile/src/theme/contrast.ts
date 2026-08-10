// ═══════════════════════════════════════════════════════════════
// CONTRAST — WCAG relative luminance and contrast ratios
// ═══════════════════════════════════════════════════════════════
// Here rather than in a dependency because the theme tests assert against it,
// and a palette that claims to be accessible while nothing checks the claim is
// how the web app ended up shipping cards at 1.04:1 against their own
// background — a surface that is, to the eye, simply not there.
//
// The formulas are from WCAG 2.2 (relative luminance and contrast ratio).
// They are worth having in-tree and tested because every judgement about
// whether a colour is readable rests on them.

/** `#rgb` or `#rrggbb`, case-insensitive. */
export function parseHex(hex: string): { r: number; g: number; b: number } {
  const value = hex.trim().replace(/^#/, "");

  const expanded =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;

  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
    throw new Error(`Not a hex colour: ${hex}`);
  }

  return {
    r: parseInt(expanded.slice(0, 2), 16) / 255,
    g: parseInt(expanded.slice(2, 4), 16) / 255,
    b: parseInt(expanded.slice(4, 6), 16) / 255,
  };
}

/**
 * Relative luminance, 0 (black) to 1 (white).
 *
 * The channel transfer is not a plain gamma: it is linear below a small
 * threshold and a power curve above it. Approximating the whole thing as
 * `c ** 2.2` shifts ratios by enough to move a colour across the 4.5
 * boundary, which is the only number anyone actually cares about.
 */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast ratio between two colours, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * WCAG thresholds.
 *
 * `largeText` is 3:1 and applies from 18.66px bold or 24px regular. Most of an
 * HRMS is neither — it is dates, amounts and status labels at 13-15px — so
 * `bodyText` is the one that matters and the one the tests assert.
 *
 * `nonText` (3:1) covers borders and icons that carry meaning. A purely
 * decorative divider is exempt; a border that is the only thing separating
 * two cards is not decorative.
 */
export const WCAG = {
  bodyText: 4.5,
  largeText: 3,
  nonText: 3,
  /** AAA. Used for the one number people squint at outdoors: net pay. */
  enhanced: 7,
} as const;

export function meetsContrast(
  foreground: string,
  background: string,
  minimum: number = WCAG.bodyText
): boolean {
  return contrastRatio(foreground, background) >= minimum;
}
