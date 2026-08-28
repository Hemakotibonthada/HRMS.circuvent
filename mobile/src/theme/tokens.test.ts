import { describe, expect, it } from "vitest";
import { contrastRatio, meetsContrast, parseHex, relativeLuminance, WCAG } from "@shared/color/contrast";
import {
  auditScheme,
  buildTheme,
  contrastContract,
  darkColors,
  lightColors,
  lineHeight,
  fontSize,
  MIN_TOUCH_TARGET,
  spacing,
} from "./tokens";

describe("parseHex", () => {
  it("reads a six-digit hex", () => {
    expect(parseHex("#ffffff")).toEqual({ r: 1, g: 1, b: 1 });
    expect(parseHex("#000000")).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("expands a three-digit hex", () => {
    expect(parseHex("#fff")).toEqual(parseHex("#ffffff"));
    expect(parseHex("#08f")).toEqual(parseHex("#0088ff"));
  });

  it("does not require the hash", () => {
    expect(parseHex("ffffff")).toEqual(parseHex("#ffffff"));
  });

  it("is case-insensitive", () => {
    expect(parseHex("#AABBCC")).toEqual(parseHex("#aabbcc"));
  });

  it("rejects anything that is not a colour", () => {
    // Silently returning black would make every contrast check pass against a
    // white background, which is the worst possible failure mode for a
    // function whose entire job is catching unreadable text.
    expect(() => parseHex("#12345")).toThrow();
    expect(() => parseHex("rebeccapurple")).toThrow();
    expect(() => parseHex("#gggggg")).toThrow();
    expect(() => parseHex("")).toThrow();
  });
});

describe("relativeLuminance", () => {
  it("puts black at 0 and white at 1", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
  });

  it("weights green above red above blue", () => {
    // The coefficients are not equal thirds, and using equal thirds is a
    // common shortcut that makes blue text look far more readable than it is.
    const red = relativeLuminance("#ff0000");
    const green = relativeLuminance("#00ff00");
    const blue = relativeLuminance("#0000ff");
    expect(green).toBeGreaterThan(red);
    expect(red).toBeGreaterThan(blue);
  });

  it("uses the linear segment near black rather than a pure power curve", () => {
    // #050505 sits below the 0.03928 threshold where the transfer is linear.
    // A plain c**2.4 approximation gives a materially different answer here.
    expect(relativeLuminance("#050505")).toBeCloseTo(0.001518, 5);
  });
});

describe("contrastRatio", () => {
  it("gives 21 for black on white", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 2);
  });

  it("gives 1 for a colour against itself", () => {
    expect(contrastRatio("#783ff5", "#783ff5")).toBeCloseTo(1, 5);
  });

  it("does not depend on argument order", () => {
    expect(contrastRatio("#101010", "#efefef")).toBeCloseTo(
      contrastRatio("#efefef", "#101010"),
      10
    );
  });

  it("matches a known published pair", () => {
    // #767676 on white is the canonical "exactly passes AA" grey.
    expect(contrastRatio("#767676", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#777777", "#ffffff")).toBeLessThan(4.6);
  });
});

describe("meetsContrast", () => {
  it("defaults to the body-text threshold", () => {
    expect(meetsContrast("#767676", "#ffffff")).toBe(true);
    expect(meetsContrast("#999999", "#ffffff")).toBe(false);
  });

  it("accepts a lower bar when asked for one", () => {
    expect(meetsContrast("#949494", "#ffffff", WCAG.largeText)).toBe(true);
  });
});

// The point of the exercise. These ran against the converted web palette and
// four of them failed, which is why several tokens here are not straight
// conversions.
describe.each([
  ["light", lightColors],
  ["dark", darkColors],
])("%s scheme meets its contrast contract", (_name, scheme) => {
  const results = auditScheme(scheme);

  it.each(results)("$name is $ratio:1, needs $minimum:1", ({ passes, ratio, minimum, name }) => {
    expect(passes, `${name} measured ${ratio}:1 but needs ${minimum}:1`).toBe(true);
  });
});

describe("the contrast contract itself", () => {
  it("covers every pair the audit reports", () => {
    expect(auditScheme(lightColors)).toHaveLength(contrastContract.length);
  });

  it("names only real tokens", () => {
    // A typo'd key would read as undefined, parseHex would throw, and the
    // failure would look like a broken test rather than a broken palette.
    for (const rule of contrastContract) {
      expect(lightColors[rule.foreground], rule.name).toBeTypeOf("string");
      expect(lightColors[rule.background], rule.name).toBeTypeOf("string");
    }
  });

  it("checks the surfaces text actually sits on", () => {
    const covered = new Set(contrastContract.map((r) => `${r.foreground}/${r.background}`));
    expect(covered.has("text/background")).toBe(true);
    expect(covered.has("text/surface")).toBe(true);
    expect(covered.has("textMuted/surface")).toBe(true);
  });
});

describe("surface elevation is visible", () => {
  // The web palette's dark card sat at 1.04:1 against its own background — a
  // card nobody can see is not a card. But the fix is mode-specific, and an
  // earlier version of this test got that wrong by demanding a luminance step
  // in both modes.
  //
  // Dark mode has no other option. A drop shadow is black on near-black and
  // simply does not render, so the only way to raise a surface is to make it
  // lighter. Hence a real luminance step is required here.
  it.each([
    ["surface above background", darkColors.surface, darkColors.background],
    ["raised surface above surface", darkColors.surfaceElevated, darkColors.surface],
  ])("dark mode lifts each %s by luminance, since shadows do not render on black", (_n, a, b) => {
    expect(contrastRatio(a, b)).toBeGreaterThan(1.1);
  });

  // Light mode cannot do the same. Forcing a perceptible luminance step
  // between three stacked light surfaces means going grey, and by the third
  // level the "white" card is beige. Shadow and border carry elevation
  // instead, which is what both platform design languages do — so what must
  // be asserted is that the step exists at all and that the border is
  // genuinely visible (covered by the 3:1 border rules above).
  it("light mode still orders its surfaces, even if the step is small", () => {
    expect(relativeLuminance(lightColors.surfaceElevated)).toBeGreaterThan(
      relativeLuminance(lightColors.surface)
    );
    expect(relativeLuminance(lightColors.surface)).toBeGreaterThan(
      relativeLuminance(lightColors.background)
    );
  });

  it("light mode has a border strong enough to carry the separation", () => {
    // This is the load-bearing assertion for light mode: if the border is
    // weak *and* the luminance step is small, the cards disappear.
    expect(contrastRatio(lightColors.border, lightColors.surfaceElevated)).toBeGreaterThanOrEqual(
      WCAG.nonText
    );
  });
});

describe("scale sanity", () => {
  it("keeps the touch target at or above both platform minimums", () => {
    // 44pt on iOS, 48dp on Android. The larger wins; anything smaller is a
    // mis-tap on the clock-in button, which is someone's attendance record.
    expect(MIN_TOUCH_TARGET).toBeGreaterThanOrEqual(48);
  });

  it("keeps body text at a size people can read without zooming", () => {
    expect(fontSize.body).toBeGreaterThanOrEqual(15);
    expect(fontSize.caption).toBeGreaterThanOrEqual(12);
  });

  it("expresses line height in points, not multipliers", () => {
    // React Native's lineHeight is absolute. A 1.5 here would draw every line
    // on top of the last, and it is an easy mistake to make coming from CSS.
    for (const [key, value] of Object.entries(lineHeight)) {
      expect(value, `lineHeight.${key}`).toBeGreaterThan(10);
    }
  });

  it("gives every line height room for its font size", () => {
    for (const key of Object.keys(fontSize) as (keyof typeof fontSize)[]) {
      const size: number = fontSize[key];
      const height: number = lineHeight[key];
      expect(height, `lineHeight.${key}`).toBeGreaterThan(size);
    }
  });

  it("ascends monotonically", () => {
    const values: number[] = Object.values(spacing);
    for (let i = 1; i < values.length; i++) {
      const current = values[i];
      const previous = values[i - 1];
      if (current === undefined || previous === undefined) continue;
      expect(current).toBeGreaterThan(previous);
    }
  });
});

describe("buildTheme", () => {
  it("selects the scheme matching the mode", () => {
    expect(buildTheme(false).colors).toBe(lightColors);
    expect(buildTheme(true).colors).toBe(darkColors);
    expect(buildTheme(true).isDark).toBe(true);
  });

  it("shares the non-colour scales across both modes", () => {
    expect(buildTheme(true).spacing).toBe(buildTheme(false).spacing);
  });
});
