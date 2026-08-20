// This is the one piece of the signature pad that can be unit tested at all:
// `renderAtWidth` stands in for a real `<canvas>`, which jsdom does not
// implement, so these tests only ever exercise the shrink policy — try
// widths largest-to-smallest, stop at the first that fits, fail loudly
// (never silently) when nothing does — never real pixels.

import { describe, expect, it, vi } from "vitest";
import {
  SIGNATURE_CANDIDATE_WIDTHS,
  SignatureTooComplexError,
  shrinkSignatureToFit,
} from "./signature-image";

/** A fake `renderAtWidth`: pretends every extra pixel of width costs one character, so shrinking the width predictably shrinks the "data URI". */
function fakeRenderer(charsPerWidthUnit: number, prefixLength = 0) {
  return vi.fn((width: number) => "x".repeat(prefixLength + Math.round(width * charsPerWidthUnit)));
}

describe("shrinkSignatureToFit", () => {
  it("returns the first (largest) width that already fits, without trying smaller ones", async () => {
    const render = fakeRenderer(1);
    const result = await shrinkSignatureToFit(render, { maxDataUrlLength: 1000 });

    expect(result.length).toBe(SIGNATURE_CANDIDATE_WIDTHS[0]);
    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith(SIGNATURE_CANDIDATE_WIDTHS[0]);
  });

  it("falls through to a smaller width when the largest candidates do not fit", async () => {
    // At 10 chars/unit, widths 480/360/280/220 all exceed the default 2000
    // budget (2200 or more) and only 160 (1600) and below fit.
    const render = fakeRenderer(10);
    const result = await shrinkSignatureToFit(render);

    expect(result.length).toBe(1600);
    // Tried every larger candidate, in order, before landing on 160.
    expect(render).toHaveBeenCalledTimes(5);
    [480, 360, 280, 220, 160].forEach((width, index) => {
      expect(render).toHaveBeenNthCalledWith(index + 1, width);
    });
  });

  it("tries widths in strictly descending order", async () => {
    const seen: number[] = [];
    const render = vi.fn((width: number) => {
      seen.push(width);
      return "x".repeat(5000); // never fits, so every candidate gets tried
    });

    await expect(shrinkSignatureToFit(render)).rejects.toThrow(SignatureTooComplexError);
    expect(seen).toEqual(SIGNATURE_CANDIDATE_WIDTHS);
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]).toBeLessThan(seen[i - 1]);
  });

  it("throws SignatureTooComplexError — never silently returns an oversized data URI — when nothing fits", async () => {
    const render = fakeRenderer(1000);
    await expect(shrinkSignatureToFit(render, { maxDataUrlLength: 500 })).rejects.toThrow(
      SignatureTooComplexError
    );
  });

  it("names the limit and the smallest size actually reached in the failure message", async () => {
    const render = fakeRenderer(1000);
    await expect(shrinkSignatureToFit(render, { maxDataUrlLength: 500 })).rejects.toThrow(
      /500.*90000|90000.*500/
    );
  });

  it("honours a caller-supplied candidate width list instead of the default", async () => {
    const render = fakeRenderer(1);
    const result = await shrinkSignatureToFit(render, {
      maxDataUrlLength: 1000,
      candidateWidths: [50, 25],
    });
    expect(result.length).toBe(50);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("accepts a synchronous renderAtWidth as well as an async one", async () => {
    const syncRender = (width: number) => "x".repeat(width);
    await expect(shrinkSignatureToFit(syncRender, { maxDataUrlLength: 10000 })).resolves.toEqual(
      expect.any(String)
    );
  });

  it("respects a caller-supplied maxDataUrlLength that is tighter than the default", async () => {
    const render = fakeRenderer(1);
    // The largest candidate's "length" (480) fits the default 2000 budget
    // easily, so this only proves a tighter override is actually honoured
    // rather than the default silently winning.
    const result = await shrinkSignatureToFit(render, {
      maxDataUrlLength: SIGNATURE_CANDIDATE_WIDTHS[0] - 1,
    });
    expect(result.length).toBeLessThanOrEqual(SIGNATURE_CANDIDATE_WIDTHS[0] - 1);
    expect(result.length).not.toBe(SIGNATURE_CANDIDATE_WIDTHS[0]);
  });
});
