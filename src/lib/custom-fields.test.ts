// The hard part of custom fields is that the schema changes underneath data
// that already exists. These tests pin the two cases that go wrong quietly:
// a field made required later, and a field whose type is changed.

import { describe, expect, it } from "vitest";
import {
  auditRecord,
  canChangeType,
  coerceValue,
  compilePattern,
  isRequired,
  isValueStillValid,
  piiKeys,
  toIndexText,
  validateRecord,
  type FieldDefinition,
} from "@/lib/custom-fields";

function field(over: Partial<FieldDefinition> = {}): FieldDefinition {
  return {
    id: "f1",
    entityType: "employee",
    key: "shirt_size",
    label: "Shirt size",
    dataType: "text",
    isRequired: false,
    isActive: true,
    ...over,
  };
}

describe("coerceValue", () => {
  it("treats an empty string as no value", () => {
    expect(coerceValue(field(), "")).toEqual({ ok: true, value: null });
  });

  it("treats null and undefined as no value", () => {
    expect(coerceValue(field(), null)).toEqual({ ok: true, value: null });
    expect(coerceValue(field(), undefined)).toEqual({ ok: true, value: null });
  });

  it("trims text", () => {
    expect(coerceValue(field(), "  L  ")).toEqual({ ok: true, value: "L" });
  });

  it("treats whitespace-only text as no value", () => {
    expect(coerceValue(field(), "   ")).toEqual({ ok: true, value: null });
  });

  describe("number", () => {
    const number = field({ dataType: "number", key: "headcount" });

    it("parses a numeric string", () => {
      expect(coerceValue(number, "42")).toEqual({ ok: true, value: 42 });
    });

    it("accepts thousands separators, which is how people type money", () => {
      expect(coerceValue(number, "1,200,000")).toEqual({ ok: true, value: 1_200_000 });
    });

    it("does not turn an empty string into zero", () => {
      // Number("") is 0. Storing that is a confident wrong answer where the
      // user actually entered nothing.
      expect(coerceValue(number, "")).toEqual({ ok: true, value: null });
    });

    it("rejects text", () => {
      expect(coerceValue(number, "twelve")).toEqual({ ok: false, error: "Enter a number" });
    });

    it("rejects a boolean, which Number() would happily turn into 1", () => {
      expect(coerceValue(number, true).ok).toBe(false);
    });

    it("rejects Infinity", () => {
      expect(coerceValue(number, Infinity).ok).toBe(false);
    });

    it("enforces min and max", () => {
      const bounded = field({ dataType: "number", validation: { min: 1, max: 10 } });
      expect(coerceValue(bounded, 0)).toEqual({ ok: false, error: "Must be 1 or more" });
      expect(coerceValue(bounded, 11)).toEqual({ ok: false, error: "Must be 10 or less" });
      expect(coerceValue(bounded, 5).ok).toBe(true);
    });

    it("rejects a negative currency amount by default", () => {
      expect(coerceValue(field({ dataType: "currency" }), -5).ok).toBe(false);
    });

    it("allows a negative currency amount when a min says so", () => {
      const adjustment = field({ dataType: "currency", validation: { min: -1000 } });
      expect(coerceValue(adjustment, -5)).toEqual({ ok: true, value: -5 });
    });
  });

  describe("boolean", () => {
    const flag = field({ dataType: "boolean", key: "has_car" });

    it("accepts a real boolean", () => {
      expect(coerceValue(flag, false)).toEqual({ ok: true, value: false });
    });

    it("does not treat the string 'false' as true", () => {
      // Boolean("false") is true, which is the single most common coercion bug.
      expect(coerceValue(flag, "false")).toEqual({ ok: true, value: false });
    });

    it("accepts yes and no", () => {
      expect(coerceValue(flag, "yes")).toEqual({ ok: true, value: true });
      expect(coerceValue(flag, "NO")).toEqual({ ok: true, value: false });
    });

    it("rejects anything else rather than guessing", () => {
      expect(coerceValue(flag, "maybe").ok).toBe(false);
    });
  });

  describe("date", () => {
    const date = field({ dataType: "date", key: "visa_expiry" });

    it("accepts an ISO date", () => {
      expect(coerceValue(date, "2026-04-01")).toEqual({ ok: true, value: "2026-04-01" });
    });

    it("rejects another format rather than guessing day or month first", () => {
      expect(coerceValue(date, "01/04/2026").ok).toBe(false);
    });

    it("rejects a well-formed but impossible date", () => {
      // 2026-02-31 parses to 3 March, which would be stored as a real date
      // nobody entered.
      expect(coerceValue(date, "2026-02-31")).toEqual({
        ok: false,
        error: "That date does not exist",
      });
    });

    it("accepts a genuine leap day", () => {
      expect(coerceValue(date, "2028-02-29").ok).toBe(true);
    });
  });

  describe("email, url and phone", () => {
    it("lowercases and validates an email", () => {
      const email = field({ dataType: "email" });
      expect(coerceValue(email, " Asha@Example.COM ")).toEqual({
        ok: true,
        value: "asha@example.com",
      });
      expect(coerceValue(email, "not-an-email").ok).toBe(false);
    });

    it("requires a scheme on a URL", () => {
      const url = field({ dataType: "url" });
      expect(coerceValue(url, "https://example.com").ok).toBe(true);
      expect(coerceValue(url, "example.com").ok).toBe(false);
    });

    it("accepts international phone formats", () => {
      const phone = field({ dataType: "phone" });
      expect(coerceValue(phone, "+91 98765 43210").ok).toBe(true);
      expect(coerceValue(phone, "(020) 7946-0018").ok).toBe(true);
      expect(coerceValue(phone, "abc").ok).toBe(false);
    });
  });

  describe("select", () => {
    const select = field({
      dataType: "select",
      key: "tshirt",
      options: [
        { value: "s", label: "Small" },
        { value: "m", label: "Medium" },
        { value: "xl", label: "Extra large", isActive: false },
      ],
    });

    it("accepts an active option", () => {
      expect(coerceValue(select, "m")).toEqual({ ok: true, value: "m" });
    });

    it("rejects an unknown option and lists the active ones", () => {
      const result = coerceValue(select, "xxl");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("Choose one of: Small, Medium");
    });

    it("refuses a newly chosen retired option", () => {
      const result = coerceValue(select, "xl");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/no longer available/);
    });
  });

  describe("multiselect", () => {
    const multi = field({
      dataType: "multiselect",
      key: "languages",
      options: [
        { value: "en", label: "English" },
        { value: "hi", label: "Hindi" },
        { value: "ta", label: "Tamil" },
      ],
    });

    it("accepts a list", () => {
      expect(coerceValue(multi, ["en", "ta"])).toEqual({ ok: true, value: ["en", "ta"] });
    });

    it("accepts a single value as a list of one", () => {
      expect(coerceValue(multi, "en")).toEqual({ ok: true, value: ["en"] });
    });

    it("removes duplicates, which are a client bug not a user choice", () => {
      expect(coerceValue(multi, ["en", "en"])).toEqual({ ok: true, value: ["en"] });
    });

    it("rejects an unknown choice", () => {
      expect(coerceValue(multi, ["en", "xx"]).ok).toBe(false);
    });

    it("enforces a minimum and maximum number of choices", () => {
      const bounded = { ...multi, validation: { min: 2, max: 2 } };
      expect(coerceValue(bounded, ["en"]).ok).toBe(false);
      expect(coerceValue(bounded, ["en", "hi", "ta"]).ok).toBe(false);
      expect(coerceValue(bounded, ["en", "hi"]).ok).toBe(true);
    });
  });

  it("refuses an unrecognised field type rather than storing something unreadable", () => {
    const future = field({ dataType: "hologram" as never });
    expect(coerceValue(future, "x").ok).toBe(false);
  });
});

describe("length and pattern validation", () => {
  it("enforces minimum and maximum length", () => {
    const bounded = field({ validation: { minLength: 2, maxLength: 4 } });
    expect(coerceValue(bounded, "a").ok).toBe(false);
    expect(coerceValue(bounded, "abcde").ok).toBe(false);
    expect(coerceValue(bounded, "abc").ok).toBe(true);
  });

  it("applies a pattern and uses its custom message", () => {
    const code = field({
      validation: { pattern: "^[A-Z]{3}$", patternMessage: "Three capital letters" },
    });
    const result = coerceValue(code, "ab");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Three capital letters");
    expect(coerceValue(code, "ABC").ok).toBe(true);
  });

  it("reports an unusable pattern instead of throwing", () => {
    const broken = field({ validation: { pattern: "([" } });
    const result = coerceValue(broken, "x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/invalid validation rule/);
  });
});

describe("compilePattern", () => {
  it("compiles a normal pattern", () => {
    expect(compilePattern("^[a-z]+$")).toBeInstanceOf(RegExp);
  });

  it("rejects an invalid pattern", () => {
    expect(compilePattern("([")).toBeNull();
  });

  it("rejects an over-long pattern", () => {
    expect(compilePattern("a".repeat(201))).toBeNull();
  });

  it("rejects a catastrophically backtracking shape", () => {
    // A tenant administrator can save one of these, and it then runs against
    // every submitted value.
    expect(compilePattern("(a+)+$")).toBeNull();
    expect(compilePattern("(x*)*")).toBeNull();
  });
});

describe("isRequired", () => {
  it("honours a plain required flag", () => {
    expect(isRequired(field({ isRequired: true }), {})).toBe(true);
  });

  it("is conditional when requiredWhen is set", () => {
    // "Reason for leaving" is mandatory only when "has left" is true; making
    // it always required would block every ordinary edit to an active employee.
    const conditional = field({
      key: "leaving_reason",
      requiredWhen: { key: "has_left", equals: [true] },
    });

    expect(isRequired(conditional, { has_left: false })).toBe(false);
    expect(isRequired(conditional, { has_left: true })).toBe(true);
  });

  it("ignores the plain flag when a condition is present", () => {
    const conditional = field({
      isRequired: true,
      requiredWhen: { key: "has_left", equals: [true] },
    });
    expect(isRequired(conditional, { has_left: false })).toBe(false);
  });
});

describe("validateRecord", () => {
  const definitions = [
    field({ id: "a", key: "shirt_size", label: "Shirt size" }),
    field({ id: "b", key: "headcount", label: "Headcount", dataType: "number", isRequired: true }),
  ];

  it("coerces every field", () => {
    const result = validateRecord(definitions, { shirt_size: " L ", headcount: "3" });
    expect(result.valid).toBe(true);
    expect(result.values).toEqual({ shirt_size: "L", headcount: 3 });
  });

  it("reports a missing required field by its label", () => {
    const result = validateRecord(definitions, { shirt_size: "L" });
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toBe("Headcount is required");
  });

  it("reports every error, not just the first", () => {
    const result = validateRecord(definitions, { headcount: "abc" });
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects an unknown key rather than silently dropping it", () => {
    // Dropping it hides a client writing to a field that was renamed, and the
    // data quietly stops arriving.
    const result = validateRecord(definitions, { headcount: 1, nonsense: "x" });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatchObject({ key: "nonsense", message: "There is no such field" });
  });

  it("ignores inactive definitions", () => {
    const withRetired = [...definitions, field({ id: "c", key: "old", isActive: false })];
    const result = validateRecord(withRetired, { headcount: 1 });
    expect(result.values).not.toHaveProperty("old");
  });

  it("does not enforce a newly required field on an unrelated partial edit", () => {
    // A field made required in March must not block an edit to a record
    // created in January.
    const result = validateRecord(definitions, { shirt_size: "M" }, { partial: true });
    expect(result.valid).toBe(true);
  });

  it("still validates the fields a partial edit does submit", () => {
    const result = validateRecord(definitions, { headcount: "abc" }, { partial: true });
    expect(result.valid).toBe(false);
  });

  it("enforces a conditional requirement using the coerced dependency", () => {
    // The dependency arrives as the string "true"; the condition compares
    // against a real boolean, so coercion has to happen first.
    const conditional = [
      field({ id: "x", key: "has_left", label: "Has left", dataType: "boolean" }),
      field({
        id: "y",
        key: "leaving_reason",
        label: "Leaving reason",
        requiredWhen: { key: "has_left", equals: [true] },
      }),
    ];

    const left = validateRecord(conditional, { has_left: "true", leaving_reason: "" });
    expect(left.valid).toBe(false);

    const stayed = validateRecord(conditional, { has_left: "false", leaving_reason: "" });
    expect(stayed.valid).toBe(true);
  });

  it("treats an empty multiselect as missing when required", () => {
    const required = [
      field({
        id: "m",
        key: "languages",
        label: "Languages",
        dataType: "multiselect",
        isRequired: true,
        options: [{ value: "en", label: "English" }],
      }),
    ];
    expect(validateRecord(required, { languages: [] }).valid).toBe(false);
  });
});

describe("auditRecord", () => {
  const definitions = [
    field({ id: "b", key: "headcount", label: "Headcount", isRequired: true }),
    field({ id: "a", key: "shirt_size", label: "Shirt size" }),
  ];

  it("lists required fields an existing record has not filled in", () => {
    // Separate from validation on purpose: adding a required field should
    // produce a backfill list, not make every record unsaveable.
    const gaps = auditRecord(definitions, { shirt_size: "L" });
    expect(gaps.map((g) => g.key)).toEqual(["headcount"]);
  });

  it("reports nothing for a complete record", () => {
    expect(auditRecord(definitions, { headcount: "3", shirt_size: "L" })).toEqual([]);
  });
});

describe("isValueStillValid", () => {
  const select = field({
    dataType: "select",
    options: [
      { value: "s", label: "Small" },
      { value: "xl", label: "Extra large", isActive: false },
    ],
  });

  it("keeps a retired option readable on an existing record", () => {
    // The value was valid when it was entered. Erasing history to tidy a
    // dropdown is not an improvement.
    expect(isValueStillValid(select, "xl")).toBe(true);
  });

  it("reports a value whose option was deleted outright", () => {
    expect(isValueStillValid(select, "gone")).toBe(false);
  });

  it("treats no value as valid", () => {
    expect(isValueStillValid(select, null)).toBe(true);
  });
});

describe("canChangeType", () => {
  it("allows any change when no values exist", () => {
    expect(canChangeType("text", "number", 0)).toEqual({ allowed: true });
  });

  it("refuses a change once values exist", () => {
    // Reinterpreting "12/01" as a number is corruption presented as a
    // configuration change, and it is irreversible by the time anyone notices.
    const verdict = canChangeType("text", "number", 40);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/40 records already hold a value/);
  });

  it("allows a no-op", () => {
    expect(canChangeType("text", "text", 100)).toEqual({ allowed: true });
  });

  it("allows widening text to textarea, which keeps every value readable", () => {
    expect(canChangeType("text", "textarea", 100)).toEqual({ allowed: true });
  });

  it("allows select to multiselect but not the reverse", () => {
    expect(canChangeType("select", "multiselect", 100).allowed).toBe(true);
    expect(canChangeType("multiselect", "select", 100).allowed).toBe(false);
  });

  it("uses singular wording for one record", () => {
    const verdict = canChangeType("text", "number", 1);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/1 record already holds/);
  });
});

describe("piiKeys", () => {
  it("lists the fields holding personal data", () => {
    const definitions = [
      field({ id: "a", key: "passport_no", isPii: true }),
      field({ id: "b", key: "shirt_size" }),
    ];
    expect(piiKeys(definitions)).toEqual(["passport_no"]);
  });
});

describe("toIndexText", () => {
  it("returns null for no value", () => {
    expect(toIndexText(null)).toBeNull();
  });

  it("stringifies scalars", () => {
    expect(toIndexText(42)).toBe("42");
    expect(toIndexText(true)).toBe("true");
    expect(toIndexText(false)).toBe("false");
  });

  it("sorts a multiselect so reordering cannot bypass a uniqueness rule", () => {
    expect(toIndexText(["b", "a"])).toBe(toIndexText(["a", "b"]));
  });
});
