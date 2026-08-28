import { describe, expect, it } from "vitest";
import {
  formatMinor,
  minorToDecimalString,
  minorToMajor,
  parseMinor,
  subtractMinor,
  sumMinor,
  toMinor,
} from "./minor";

describe("parseMinor", () => {
  it("parses a positive amount", () => {
    expect(parseMinor("123456789")).toBe(123456789n);
  });

  it("parses a negative amount", () => {
    expect(parseMinor("-500")).toBe(-500n);
  });

  it("parses zero", () => {
    expect(parseMinor("0")).toBe(0n);
  });

  it("passes a bigint straight through", () => {
    expect(parseMinor(42n)).toBe(42n);
  });

  it("treats null and undefined as zero, so a missing amount is not NaN", () => {
    expect(parseMinor(null)).toBe(0n);
    expect(parseMinor(undefined)).toBe(0n);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseMinor("  700  ")).toBe(700n);
  });

  it("rejects a fractional value — minor units are whole by definition", () => {
    expect(() => parseMinor("12.5")).toThrow(RangeError);
  });

  it("rejects anything that is not a number", () => {
    expect(() => parseMinor("abc")).toThrow(RangeError);
    expect(() => parseMinor("")).toThrow(RangeError);
    expect(() => parseMinor("1e5")).toThrow(RangeError);
  });
});

describe("toMinor", () => {
  it("serialises a bigint", () => {
    expect(toMinor(123n)).toBe("123");
  });

  it("serialises null as zero", () => {
    expect(toMinor(null)).toBe("0");
    expect(toMinor(undefined)).toBe("0");
  });

  it("round-trips through parseMinor", () => {
    expect(parseMinor(toMinor(-98765n))).toBe(-98765n);
  });
});

describe("sumMinor", () => {
  it("adds a list exactly", () => {
    expect(sumMinor(["100", "200", "300"])).toBe("600");
  });

  it("returns zero for an empty list", () => {
    expect(sumMinor([])).toBe("0");
  });

  it("skips nulls rather than producing NaN", () => {
    expect(sumMinor(["100", null, undefined, "50"])).toBe("150");
  });

  it("gets 0.1 + 0.2 right, which is the whole point", () => {
    // In paise: 10 + 20 = 30, exactly. As floats, 0.1 + 0.2 is
    // 0.30000000000000004 and never equals 0.3.
    expect(sumMinor(["10", "20"])).toBe("30");
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(minorToMajor(sumMinor(["10", "20"]))).toBe(0.3);
  });

  it("stays exact above the float integer limit", () => {
    // 2^53 = 9007199254740992 paise ≈ ₹90,071,992,547,409.92. It is the last
    // integer a double can hold before it starts skipping odd numbers, so
    // 2^53 + 1 is not representable and rounds straight back down to 2^53.
    // A large company's annual gross in paise reaches this range.
    const a = "9007199254740992";
    const b = "1";
    expect(sumMinor([a, b])).toBe("9007199254740993");

    // The float route cannot tell the sum from the original.
    expect(Number(a) + Number(b)).toBe(Number(a));
  });

  it("accumulates a payroll without drift", () => {
    // 3,000 payslips of ₹33,333.33 each. Summed as floats this drifts; summed
    // as paise it cannot.
    const one = "3333333";
    const many = Array.from({ length: 3000 }, () => one);
    expect(sumMinor(many)).toBe("9999999000");

    const floatTotal = many.reduce((s, v) => s + Number(v) / 100, 0);
    expect(floatTotal).not.toBe(99999990);
  });

  it("handles negatives", () => {
    expect(sumMinor(["500", "-200"])).toBe("300");
  });
});

describe("subtractMinor", () => {
  it("subtracts exactly", () => {
    expect(subtractMinor("1000", "250")).toBe("750");
  });

  it("goes negative when it should", () => {
    expect(subtractMinor("100", "250")).toBe("-150");
  });

  it("computes net pay from gross and deductions", () => {
    expect(subtractMinor("5000000", "750000")).toBe("4250000");
  });
});

describe("minorToDecimalString", () => {
  it("inserts the decimal point", () => {
    expect(minorToDecimalString("123456789")).toBe("1234567.89");
  });

  it("pads a single-digit paise value", () => {
    expect(minorToDecimalString("105")).toBe("1.05");
  });

  it("pads zero paise", () => {
    expect(minorToDecimalString("100")).toBe("1.00");
  });

  it("handles amounts below one rupee", () => {
    expect(minorToDecimalString("7")).toBe("0.07");
    expect(minorToDecimalString("0")).toBe("0.00");
  });

  it("keeps the sign on the rupee side", () => {
    expect(minorToDecimalString("-105")).toBe("-1.05");
    expect(minorToDecimalString("-7")).toBe("-0.07");
  });

  it("is exact where a float is not", () => {
    // 90071992547409.91 is not representable as a double.
    expect(minorToDecimalString("9007199254740991")).toBe("90071992547409.91");
    expect(String(Number("9007199254740991") / 100)).not.toBe("90071992547409.91");
  });
});

describe("minorToMajor", () => {
  it("converts for display", () => {
    expect(minorToMajor("123456789")).toBe(1234567.89);
  });

  it("converts zero", () => {
    expect(minorToMajor("0")).toBe(0);
  });

  it("converts negatives", () => {
    expect(minorToMajor("-105")).toBe(-1.05);
  });
});

describe("formatMinor", () => {
  it("groups in the Indian style, not the Western one", () => {
    // 12,34,567 — twelve lakh thirty-four thousand. Grouping every three
    // digits would render 1,234,567 and read as a different amount.
    expect(formatMinor("123456789")).toBe("₹12,34,567.89");
  });

  it("keeps paise that a float would round away", () => {
    expect(formatMinor("9007199254740991")).toBe("₹9,00,71,99,25,47,409.91");
  });

  it("formats zero", () => {
    expect(formatMinor("0")).toBe("₹0.00");
  });

  it("formats a negative amount", () => {
    expect(formatMinor("-123456")).toBe("-₹1,234.56");
  });

  it("accepts a bigint", () => {
    expect(formatMinor(500000n)).toBe("₹5,000.00");
  });

  it("honours another currency and locale", () => {
    expect(formatMinor("123456", "USD", "en-US")).toBe("$1,234.56");
  });

  it("renders an em dash rather than NaN for a malformed amount", () => {
    expect(formatMinor("not-a-number")).toBe("—");
  });

  it("always shows exactly two decimal places", () => {
    expect(formatMinor("100")).toBe("₹1.00");
    expect(formatMinor("110")).toBe("₹1.10");
  });
});
