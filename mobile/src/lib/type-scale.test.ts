import { describe, expect, it } from "vitest";
import { fontSize, lineHeight } from "../theme/tokens";
import { leading, scaledLineHeight } from "./type-scale";

describe("scaledLineHeight", () => {
  it("leaves the design alone at the default text size", () => {
    expect(scaledLineHeight(22, 1)).toBe(22);
  });

  it("grows the line with the text", () => {
    expect(scaledLineHeight(22, 2)).toBe(44);
    expect(scaledLineHeight(22, 1.5)).toBe(33);
  });

  it("rounds to whole points", () => {
    // 22 × 1.35 is 29.7. A fractional line height lands on different physical
    // pixels row to row, which reads as uneven spacing down a long list.
    expect(scaledLineHeight(22, 1.35)).toBe(30);
    expect(Number.isInteger(scaledLineHeight(18, 1.31))).toBe(true);
  });

  it("never tightens below the design when the text is shrunk", () => {
    // React Native does shrink the glyphs below a scale of 1, but pulling the
    // leading in with them clips descenders for the people with the least
    // margin for it.
    expect(scaledLineHeight(22, 0.85)).toBe(22);
    expect(scaledLineHeight(22, 0.5)).toBe(22);
  });

  it("leaves the design alone when the scale cannot be read", () => {
    // The value on the first frame on some platforms. Guessing would make the
    // text jump on launch.
    expect(scaledLineHeight(22, Number.NaN)).toBe(22);
    expect(scaledLineHeight(22, 0)).toBe(22);
    expect(scaledLineHeight(22, -1)).toBe(22);
    expect(scaledLineHeight(22, Number.POSITIVE_INFINITY)).toBe(22);
  });

  it("passes an unusable line height straight back rather than computing on it", () => {
    expect(scaledLineHeight(Number.NaN, 2)).toBeNaN();
    expect(scaledLineHeight(0, 2)).toBe(0);
    expect(scaledLineHeight(-4, 2)).toBe(-4);
  });

  it("applies a font cap to the line as well, when one is given", () => {
    // The invariant: whatever multiplier the glyphs got, the line gets. A cap
    // on one and not the other is the overlap this module exists to prevent.
    expect(scaledLineHeight(22, 3, 1.5)).toBe(33);
    expect(scaledLineHeight(22, 1.2, 1.5)).toBe(26);
  });

  it("ignores a cap that is not a usable number", () => {
    expect(scaledLineHeight(22, 2, Number.NaN)).toBe(44);
    expect(scaledLineHeight(22, 2, 0)).toBe(44);
  });
});

describe("the leading of every theme variant survives scaling", () => {
  const variants = ["caption", "footnote", "body", "callout", "title3", "title2", "title1", "display"] as const;

  // The property the module exists for. If a future change caps the line
  // height "because it looks airy", these fail and name the variant.
  it.each(variants)("keeps %s readable at 200%%", (variant) => {
    const designed = leading(lineHeight[variant], fontSize[variant]);
    const scaled = leading(scaledLineHeight(lineHeight[variant], 2), fontSize[variant] * 2);

    // Within a rounding of a whole point at the scaled size.
    expect(Math.abs(scaled - designed)).toBeLessThan(0.02);
  });

  it("keeps every variant's line taller than its glyphs at 200%", () => {
    // The failure being prevented, stated directly: at 200% the unscaled
    // line height of body text is 22 against 30-point glyphs.
    for (const variant of variants) {
      const glyphs = fontSize[variant] * 2;
      const line = scaledLineHeight(lineHeight[variant], 2);
      expect(line).toBeGreaterThan(glyphs);
    }
  });

  it("would fail without the fix, which is the point", () => {
    // Pinning the bug itself: the unscaled line height is shorter than the
    // scaled glyphs for body text, which is what clipped.
    expect(lineHeight.body).toBeLessThan(fontSize.body * 2);
  });
});
