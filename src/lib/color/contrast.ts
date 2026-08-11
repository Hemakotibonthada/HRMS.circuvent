// ═══════════════════════════════════════════════════════════════
// CONTRAST — WCAG relative luminance and contrast ratios
// ═══════════════════════════════════════════════════════════════
// Shared by the web app and the Expo app. It started in mobile/src/theme and
// moved here when the web palette needed the same checks: a second copy would
// have drifted, and the two products would have disagreed about whether a
// colour was readable.
//
// It exists at all because a palette that claims to be accessible while
// nothing checks the claim is how the web app came to ship cards at 1.04:1
// against their own background — a surface that is, to the eye, not there.
//
// The formulas are from WCAG 2.2 (relative luminance and contrast ratio) and
// the oklch conversion is the CSS Color 4 definition. Both are worth having
// in-tree and tested, because every judgement about whether text is readable
// rests on them.

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
export function relativeLuminance(color: string): number {
  const { r, g, b } = parseColor(color);
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

// ─── oklch ───────────────────────────────────────────────────
// The web app declares its palette in oklch, which is perceptually uniform
// and pleasant to author. Nothing else in the stack understands it: React
// Native cannot parse it, and neither can a contrast check, so it has to be
// converted before either can say anything about it.

const OKLCH = /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)\s*\)$/i;

/** True when a string looks like an `oklch(L C H)` declaration. */
export function isOklch(value: string): boolean {
  return OKLCH.test(value.trim());
}

/**
 * Converts `oklch(L C H)` to sRGB channels in 0–1.
 *
 * Out-of-gamut results are clamped per channel. That is what a browser does
 * when asked to display an unrepresentable colour, so clamping here measures
 * the contrast of the colour people actually see rather than of a
 * mathematical one they do not.
 */
export function oklchToRgb(value: string): { r: number; g: number; b: number } {
  const match = OKLCH.exec(value.trim());
  if (!match?.[1] || !match[2] || !match[3]) {
    throw new Error(`Not an oklch colour: ${value}`);
  }

  const lightness = match[1].endsWith("%")
    ? Number(match[1].slice(0, -1)) / 100
    : Number(match[1]);
  const chroma = Number(match[2]);
  const hue = (Number(match[3]) * Math.PI) / 180;

  if (!Number.isFinite(lightness) || !Number.isFinite(chroma) || !Number.isFinite(hue)) {
    throw new Error(`Not an oklch colour: ${value}`);
  }

  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);

  // Oklab to LMS, cubed, then LMS to linear sRGB (CSS Color 4).
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const linear = {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };

  const encode = (c: number) => {
    const gamma = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055;
    return Math.min(1, Math.max(0, gamma));
  };

  return { r: encode(linear.r), g: encode(linear.g), b: encode(linear.b) };
}

/** Accepts either a hex string or an `oklch()` declaration. */
export function parseColor(value: string): { r: number; g: number; b: number } {
  return isOklch(value) ? oklchToRgb(value) : parseHex(value);
}

/** The nearest hex equivalent, for a palette that has to leave CSS. */
export function toHex(value: string): string {
  const { r, g, b } = parseColor(value);
  const channel = (c: number) =>
    Math.round(c * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** Contrast ratio between two colours, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  // Math.max/min rather than destructuring a sorted array: with
  // noUncheckedIndexedAccess an index into an array is possibly undefined,
  // and the compiler is right to say so even when the array is a literal
  // pair. This says the same thing without a claim TypeScript has to trust.
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
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
