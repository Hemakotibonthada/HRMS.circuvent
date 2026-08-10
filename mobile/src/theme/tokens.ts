// ═══════════════════════════════════════════════════════════════
// THEME TOKENS
// ═══════════════════════════════════════════════════════════════
// The web app defines its palette in oklch (src/app/globals.css). React
// Native cannot parse oklch, so these are the sRGB conversions of the same
// brand hue — violet at roughly 290° — kept deliberately close so the two
// products look like one company.
//
// Four values are NOT straight conversions, because converting them faithfully
// would have shipped colours that fail WCAG AA. Measured from the web tokens:
//
//   dark card on dark background   1.04:1   a surface that is not visibly there
//   dark muted foreground on card  4.09:1   secondary text below AA
//   light destructive on white     4.11:1   error text below AA
//   light success on white         3.02:1   status text well below AA
//
// On a desktop in an office those are bad. On a phone held at arm's length in
// daylight they are unusable, and the things they colour are error messages
// and pay figures. The dark surfaces are lifted and the semantic colours
// darkened in light mode; the hue is preserved so the brand still reads.
//
// tokens.test.ts asserts every one of these ratios. If someone adjusts a
// colour to taste and drops below AA, the test fails and says which pair.
//
// The same defects exist in the web palette and are recorded in docs/ROADMAP.md
// — they are not fixed here because changing the web theme is a separate change
// with its own visual review.

import { contrastRatio, WCAG } from "./contrast";

export interface ColorScheme {
  /** App background, behind everything. */
  background: string;
  /** Raised surface: cards, sheets, list rows. */
  surface: string;
  /** Surface raised above `surface`: menus, dialogs, sticky headers. */
  surfaceElevated: string;
  /** Primary body text. */
  text: string;
  /** Secondary text: dates, captions, helper text. Still real text, still AA. */
  textMuted: string;
  /** Brand colour for primary actions. */
  primary: string;
  /** Text and icons drawn on top of `primary`. */
  onPrimary: string;
  /** Tinted background for selected or emphasised regions. */
  primarySubtle: string;
  /** Destructive actions and error messages. */
  danger: string;
  /** Backdrop for an error banner; `danger` text sits on it. */
  dangerSubtle: string;
  /** Success and approved states. */
  success: string;
  successSubtle: string;
  /** Pending, awaiting action, requires review. */
  warning: string;
  warningSubtle: string;
  /**
   * Borders that separate content and outline controls.
   *
   * Held to 3:1 because an input's outline is the only thing telling the user
   * where the field is — WCAG 1.4.11 applies. Use `borderSubtle` for hairlines
   * inside a component, where the separation really is decorative and a 3:1
   * line would look like a table from 1997.
   */
  border: string;
  /** Decorative hairlines inside a component. No contrast floor. */
  borderSubtle: string;
  /** Focus ring. Never removed — see pro-rules; keyboard and switch-control
   *  users navigate this app too. */
  focus: string;
  /** Scrim behind modals. */
  scrim: string;
}

export const lightColors: ColorScheme = {
  // Not pure white. The background sits a step below the cards so that
  // elevation reads without a border doing all the work — the inverse of the
  // dark scheme, where the background is the darkest thing on screen.
  background: "#F4F4F7",
  surface: "#FAFAFC",
  surfaceElevated: "#FFFFFF",
  text: "#10111A",
  textMuted: "#535461",
  primary: "#783FF5",
  onPrimary: "#FFFFFF",
  primarySubtle: "#EFEAFE",
  // Converted #F51E2C measures 4.11:1 on white. Darkened to clear AA while
  // staying the same red.
  danger: "#C2101C",
  dangerSubtle: "#FDECEE",
  // Converted #3BA946 measures 3.02:1 — barely more than half of AA.
  success: "#157A31",
  successSubtle: "#E7F6EB",
  warning: "#8A5A00",
  warningSubtle: "#FDF3E2",
  border: "#8A8A99",
  borderSubtle: "#E3E4EB",
  focus: "#7E55F0",
  scrim: "rgba(16, 17, 26, 0.45)",
};

export const darkColors: ColorScheme = {
  // The web token converts to #020202 — effectively pure black, which leaves
  // no room to raise a surface above it. Lifted just enough that elevation
  // has somewhere to go.
  background: "#0B0B10",
  surface: "#191922",
  surfaceElevated: "#24242F",
  text: "#EDEDF2",
  // The web value (#707177) measures 4.09:1 on the card colour. Lightened.
  textMuted: "#9A9AA6",
  primary: "#A98CFF",
  onPrimary: "#12071F",
  primarySubtle: "#231A3B",
  danger: "#FF6B75",
  dangerSubtle: "#331419",
  success: "#4ED16A",
  successSubtle: "#102A18",
  warning: "#F0B03E",
  warningSubtle: "#2E2210",
  border: "#74748A",
  borderSubtle: "#26262F",
  focus: "#A98CFF",
  scrim: "rgba(0, 0, 0, 0.6)",
};

/**
 * Every colour pair that must stay readable, with the rule that applies.
 *
 * Exported so the test iterates the real list rather than a copy of it that
 * can drift out of date — a stale assertion list is how a palette passes its
 * own tests while failing in the app.
 */
export const contrastContract: {
  name: string;
  foreground: keyof ColorScheme;
  background: keyof ColorScheme;
  minimum: number;
}[] = [
  { name: "body text on background", foreground: "text", background: "background", minimum: WCAG.bodyText },
  { name: "body text on surface", foreground: "text", background: "surface", minimum: WCAG.bodyText },
  { name: "body text on raised surface", foreground: "text", background: "surfaceElevated", minimum: WCAG.bodyText },
  { name: "muted text on background", foreground: "textMuted", background: "background", minimum: WCAG.bodyText },
  { name: "muted text on surface", foreground: "textMuted", background: "surface", minimum: WCAG.bodyText },
  { name: "primary on background", foreground: "primary", background: "background", minimum: WCAG.bodyText },
  { name: "primary on surface", foreground: "primary", background: "surface", minimum: WCAG.bodyText },
  { name: "label on primary", foreground: "onPrimary", background: "primary", minimum: WCAG.bodyText },
  { name: "primary on its own tint", foreground: "primary", background: "primarySubtle", minimum: WCAG.bodyText },
  { name: "danger on background", foreground: "danger", background: "background", minimum: WCAG.bodyText },
  { name: "danger on its own tint", foreground: "danger", background: "dangerSubtle", minimum: WCAG.bodyText },
  { name: "success on background", foreground: "success", background: "background", minimum: WCAG.bodyText },
  { name: "success on its own tint", foreground: "success", background: "successSubtle", minimum: WCAG.bodyText },
  { name: "warning on background", foreground: "warning", background: "background", minimum: WCAG.bodyText },
  { name: "warning on its own tint", foreground: "warning", background: "warningSubtle", minimum: WCAG.bodyText },
  // 3:1, not 4.5 — a border is not text. But it is the only thing telling the
  // user where one card ends and the next begins, so it is not decorative
  // either and the non-text minimum applies.
  { name: "border against background", foreground: "border", background: "background", minimum: WCAG.nonText },
  { name: "border against surface", foreground: "border", background: "surface", minimum: WCAG.nonText },
  { name: "border against raised surface", foreground: "border", background: "surfaceElevated", minimum: WCAG.nonText },
  { name: "focus ring against background", foreground: "focus", background: "background", minimum: WCAG.nonText },
  { name: "focus ring against surface", foreground: "focus", background: "surface", minimum: WCAG.nonText },
];

export function auditScheme(scheme: ColorScheme): {
  name: string;
  ratio: number;
  minimum: number;
  passes: boolean;
}[] {
  return contrastContract.map((rule) => {
    const ratio = contrastRatio(scheme[rule.foreground], scheme[rule.background]);
    return {
      name: rule.name,
      ratio: Math.round(ratio * 100) / 100,
      minimum: rule.minimum,
      passes: ratio >= rule.minimum,
    };
  });
}

// ─── Spacing ─────────────────────────────────────────────────
// A 4px base. Density 6/10 — an HRMS home screen shows a lot at once and
// spacious scales push the third card below the fold, but a dashboard-tight
// scale makes tap targets collide.

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
} as const;

/**
 * Minimum interactive size.
 *
 * 44pt is Apple's guidance and the WCAG 2.2 target-size minimum; Android's is
 * 48dp. Taking the larger of the two costs four points of layout and removes
 * a whole class of complaint about mis-taps, which on the clock-in button is
 * someone's attendance record.
 */
export const MIN_TOUCH_TARGET = 48;

// ─── Typography ──────────────────────────────────────────────
// The system font, not a downloaded one. San Francisco and Roboto ship with
// the OS, respect the user's own text-size setting, and have the digit
// spacing that makes a column of pay figures line up. A brand webfont here
// would cost a network round-trip before first paint and lose dynamic type.

export const fontSize = {
  caption: 12,
  footnote: 13,
  body: 15,
  callout: 17,
  title3: 20,
  title2: 24,
  title1: 30,
  display: 36,
} as const;

export const fontWeight = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
} as const;

/**
 * Line heights as absolute numbers, not multipliers.
 *
 * React Native's `lineHeight` is in points, not a ratio, and passing 1.5
 * silently produces 1.5-point line height — text drawn on top of itself.
 */
export const lineHeight = {
  caption: 16,
  footnote: 18,
  body: 22,
  callout: 24,
  title3: 26,
  title2: 30,
  title1: 36,
  display: 42,
} as const;

// ─── Motion ──────────────────────────────────────────────────
// Motion dial 3/10: subtle. This is an app people open to clock in while
// walking into a building. Animation here is for continuity — showing where a
// sheet came from — never for delight.

export const duration = {
  /** State changes: press, toggle, colour. */
  instant: 120,
  /** The default. Long enough to follow, short enough not to wait for. */
  short: 200,
  /** Sheets and screen transitions. */
  medium: 280,
} as const;

export const elevation = {
  card: {
    shadowColor: "#000000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  sheet: {
    shadowColor: "#000000",
    shadowOpacity: 0.14,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
} as const;

export interface Theme {
  colors: ColorScheme;
  spacing: typeof spacing;
  radius: typeof radius;
  fontSize: typeof fontSize;
  fontWeight: typeof fontWeight;
  lineHeight: typeof lineHeight;
  duration: typeof duration;
  elevation: typeof elevation;
  isDark: boolean;
}

export function buildTheme(isDark: boolean): Theme {
  return {
    colors: isDark ? darkColors : lightColors,
    spacing,
    radius,
    fontSize,
    fontWeight,
    lineHeight,
    duration,
    elevation,
    isDark,
  };
}
