// ═══════════════════════════════════════════════════════════════
// CUSTOM FIELD RULES
// ═══════════════════════════════════════════════════════════════
// Every company wants fields the vendor did not ship. This validates and
// coerces them. Pure, so it tests without a database.
//
// The hard part of custom fields is not storing them, it is that the schema
// changes underneath data that already exists. A field made required in March
// must not retroactively invalidate a record created in January; a field whose
// type is changed must not silently reinterpret the values already stored.
// Both cases are handled explicitly below rather than left to coincidence.

export type FieldDataType =
  | "text"
  | "textarea"
  | "number"
  | "currency"
  | "date"
  | "boolean"
  | "select"
  | "multiselect"
  | "email"
  | "phone"
  | "url";

export interface FieldValidation {
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  /** Anchored and length-capped before use; see compilePattern. */
  pattern?: string;
  patternMessage?: string;
}

export interface FieldDefinition {
  id: string;
  entityType: string;
  key: string;
  label: string;
  dataType: FieldDataType;
  isRequired: boolean;
  /** Choices for select and multiselect. */
  options?: { value: string; label: string; isActive?: boolean }[];
  validation?: FieldValidation;
  /** Only required when this other field has one of these values. */
  requiredWhen?: { key: string; equals: (string | number | boolean)[] };
  isUnique?: boolean;
  /** Holds personal data, so erasure and export must find it. */
  isPii?: boolean;
  isActive: boolean;
}

export type FieldValue = string | number | boolean | string[] | null;

export interface FieldError {
  key: string;
  label: string;
  message: string;
}

export type CoerceResult =
  | { ok: true; value: FieldValue }
  | { ok: false; error: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const URL_LIKE = /^https?:\/\/[^\s]+$/;
// Deliberately permissive: phone formats vary by country and rejecting a valid
// number is a worse failure than accepting an odd one.
const PHONE = /^[+]?[\d\s()-]{6,20}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Coerces and validates one submitted value against its definition.
 *
 * Coercion is explicit rather than relying on JavaScript's. `Number("")` is 0
 * and `Boolean("false")` is true — both would store a confident wrong answer
 * where the user actually entered nothing or said no.
 */
export function coerceValue(definition: FieldDefinition, raw: unknown): CoerceResult {
  if (raw === null || raw === undefined || raw === "") {
    return { ok: true, value: null };
  }

  switch (definition.dataType) {
    case "text":
    case "textarea": {
      const value = String(raw).trim();
      if (value === "") return { ok: true, value: null };
      return checkLength(definition, value);
    }

    case "email": {
      const value = String(raw).trim().toLowerCase();
      if (!EMAIL.test(value)) return { ok: false, error: "Enter a valid email address" };
      return checkLength(definition, value);
    }

    case "url": {
      const value = String(raw).trim();
      if (!URL_LIKE.test(value)) {
        return { ok: false, error: "Enter a URL starting with http:// or https://" };
      }
      return checkLength(definition, value);
    }

    case "phone": {
      const value = String(raw).trim();
      if (!PHONE.test(value)) return { ok: false, error: "Enter a valid phone number" };
      return { ok: true, value };
    }

    case "number":
    case "currency": {
      if (typeof raw === "boolean") return { ok: false, error: "Enter a number" };

      // Thousands separators are how people actually type money.
      const cleaned = typeof raw === "string" ? raw.replace(/,/g, "").trim() : raw;
      const value = Number(cleaned);

      if (!Number.isFinite(value)) return { ok: false, error: "Enter a number" };

      const { min, max } = definition.validation ?? {};
      if (min !== undefined && value < min) {
        return { ok: false, error: `Must be ${min} or more` };
      }
      if (max !== undefined && value > max) {
        return { ok: false, error: `Must be ${max} or less` };
      }
      if (definition.dataType === "currency" && value < 0 && min === undefined) {
        return { ok: false, error: "Enter a positive amount" };
      }

      return { ok: true, value };
    }

    case "date": {
      const value = String(raw).trim();
      if (!DATE_ONLY.test(value)) return { ok: false, error: "Enter a date as YYYY-MM-DD" };

      // A well-formed but impossible date — 2026-02-31 — parses to March.
      const parsed = new Date(`${value}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
        return { ok: false, error: "That date does not exist" };
      }
      return { ok: true, value };
    }

    case "boolean": {
      if (typeof raw === "boolean") return { ok: true, value: raw };
      const text = String(raw).trim().toLowerCase();
      if (["true", "yes", "1"].includes(text)) return { ok: true, value: true };
      if (["false", "no", "0"].includes(text)) return { ok: true, value: false };
      return { ok: false, error: "Enter yes or no" };
    }

    case "select": {
      const value = String(raw).trim();
      const options = definition.options ?? [];
      const match = options.find((o) => o.value === value);

      if (!match) {
        return { ok: false, error: `Choose one of: ${activeLabels(options).join(", ")}` };
      }
      // A retired option cannot be newly chosen, but a record that already
      // holds it stays readable — see isValueStillValid.
      if (match.isActive === false) {
        return { ok: false, error: `"${match.label}" is no longer available` };
      }
      return { ok: true, value };
    }

    case "multiselect": {
      const values = Array.isArray(raw) ? raw.map((v) => String(v).trim()) : [String(raw).trim()];
      const options = definition.options ?? [];

      const unknown = values.filter((v) => !options.some((o) => o.value === v));
      if (unknown.length > 0) {
        return { ok: false, error: `Unknown choice: ${unknown.join(", ")}` };
      }

      const retired = values.filter((v) =>
        options.some((o) => o.value === v && o.isActive === false)
      );
      if (retired.length > 0) {
        return { ok: false, error: `No longer available: ${retired.join(", ")}` };
      }

      // Duplicates are a client bug, not a user choice.
      const unique = [...new Set(values)];

      const { min, max } = definition.validation ?? {};
      if (min !== undefined && unique.length < min) {
        return { ok: false, error: `Choose at least ${min}` };
      }
      if (max !== undefined && unique.length > max) {
        return { ok: false, error: `Choose no more than ${max}` };
      }

      return { ok: true, value: unique };
    }

    default: {
      // An unrecognised type means a definition written by a newer version.
      // Refusing is safer than storing something nothing knows how to read.
      return { ok: false, error: "This field type is not supported" };
    }
  }
}

function activeLabels(options: { value: string; label: string; isActive?: boolean }[]): string[] {
  return options.filter((o) => o.isActive !== false).map((o) => o.label);
}

function checkLength(definition: FieldDefinition, value: string): CoerceResult {
  const { minLength, maxLength, pattern, patternMessage } = definition.validation ?? {};

  if (minLength !== undefined && value.length < minLength) {
    return { ok: false, error: `Must be at least ${minLength} characters` };
  }
  if (maxLength !== undefined && value.length > maxLength) {
    return { ok: false, error: `Must be ${maxLength} characters or fewer` };
  }

  if (pattern) {
    const regex = compilePattern(pattern);
    if (!regex) return { ok: false, error: "This field has an invalid validation rule" };
    if (!regex.test(value)) {
      return { ok: false, error: patternMessage ?? "That value is not in the expected format" };
    }
  }

  return { ok: true, value };
}

/**
 * Compiles a tenant-supplied pattern, or returns null if it is unusable.
 *
 * Tenant-authored regexes are attacker-adjacent input: an administrator can
 * save one, and it then runs against every submitted value. The length cap
 * and the rejection of nested unbounded quantifiers are there to keep a
 * catastrophically backtracking pattern from pinning a request thread.
 */
export function compilePattern(pattern: string): RegExp | null {
  if (pattern.length > 200) return null;
  // (a+)+ and (a*)* and similar are the classic catastrophic-backtracking
  // shapes; a pattern needing them is better expressed another way.
  if (/\([^()]*[+*][^()]*\)\s*[+*]/.test(pattern)) return null;

  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

/**
 * Whether a field is required given the rest of the record.
 *
 * `requiredWhen` exists because "reason for leaving" is mandatory only when
 * "has left" is true, and making it always-required would block every ordinary
 * edit to an active employee.
 */
export function isRequired(definition: FieldDefinition, record: Record<string, FieldValue>): boolean {
  if (definition.requiredWhen) {
    const other = record[definition.requiredWhen.key];
    return definition.requiredWhen.equals.some((v) => v === other);
  }
  return definition.isRequired;
}

export interface ValidateOptions {
  /**
   * Only validate the keys actually submitted.
   *
   * A field made required in March must not block an unrelated edit to a
   * record created in January. Partial validation is what makes an incremental
   * edit possible at all; use `auditRecord` to find the historic gaps.
   */
  partial?: boolean;
}

export interface ValidationOutcome {
  valid: boolean;
  values: Record<string, FieldValue>;
  errors: FieldError[];
}

/** Validates and coerces a whole submission. */
export function validateRecord(
  definitions: FieldDefinition[],
  submitted: Record<string, unknown>,
  options: ValidateOptions = {}
): ValidationOutcome {
  const active = definitions.filter((d) => d.isActive);
  const values: Record<string, FieldValue> = {};
  const errors: FieldError[] = [];

  const unknownKeys = Object.keys(submitted).filter(
    (key) => !active.some((d) => d.key === key)
  );
  for (const key of unknownKeys) {
    // Silently dropping an unknown key hides a client that is writing to a
    // field that was renamed or retired, and the data quietly stops arriving.
    errors.push({ key, label: key, message: "There is no such field" });
  }

  for (const definition of active) {
    const submittedThis = Object.prototype.hasOwnProperty.call(submitted, definition.key);
    if (options.partial && !submittedThis) continue;

    const result = coerceValue(definition, submitted[definition.key]);

    if (!result.ok) {
      errors.push({ key: definition.key, label: definition.label, message: result.error });
      continue;
    }

    values[definition.key] = result.value;
  }

  // Requiredness is checked after coercion so `requiredWhen` can read the
  // coerced value of the field it depends on rather than the raw input.
  for (const definition of active) {
    if (options.partial && !Object.prototype.hasOwnProperty.call(submitted, definition.key)) {
      continue;
    }
    const value = values[definition.key];
    const empty = value === null || value === undefined || (Array.isArray(value) && value.length === 0);

    if (empty && isRequired(definition, values)) {
      errors.push({
        key: definition.key,
        label: definition.label,
        message: `${definition.label} is required`,
      });
    }
  }

  return { valid: errors.length === 0, values, errors };
}

/**
 * Reports which required fields an existing record is missing.
 *
 * Separate from validation on purpose. Adding a required field should surface
 * a list of records to backfill, not make every one of them unsaveable.
 */
export function auditRecord(
  definitions: FieldDefinition[],
  stored: Record<string, FieldValue>
): FieldError[] {
  return definitions
    .filter((d) => d.isActive)
    .filter((d) => {
      const value = stored[d.key];
      const empty =
        value === null || value === undefined || (Array.isArray(value) && value.length === 0);
      return empty && isRequired(d, stored);
    })
    .map((d) => ({ key: d.key, label: d.label, message: `${d.label} has not been filled in` }));
}

/**
 * Whether a stored value is still readable under the current definition.
 *
 * A select option retired last year must not make an old record unreadable —
 * the value was valid when it was entered, and erasing history to tidy a
 * dropdown is not an improvement.
 */
export function isValueStillValid(definition: FieldDefinition, value: FieldValue): boolean {
  if (value === null) return true;

  if (definition.dataType === "select") {
    return (definition.options ?? []).some((o) => o.value === value);
  }
  if (definition.dataType === "multiselect" && Array.isArray(value)) {
    return value.every((v) => (definition.options ?? []).some((o) => o.value === v));
  }
  return true;
}

export type TypeChangeVerdict =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Whether a field's type may be changed.
 *
 * Refused once values exist. Reinterpreting "12/01" as a number, or a free
 * text answer as one of four options, is data corruption presented as a
 * configuration change — and it is irreversible by the time anyone notices.
 */
export function canChangeType(
  from: FieldDataType,
  to: FieldDataType,
  storedValueCount: number
): TypeChangeVerdict {
  if (from === to) return { allowed: true };
  if (storedValueCount === 0) return { allowed: true };

  // Widening within the text family keeps every existing value readable.
  const textLike: FieldDataType[] = ["text", "textarea"];
  if (textLike.includes(from) && textLike.includes(to)) return { allowed: true };
  if (from === "select" && to === "multiselect") return { allowed: true };

  return {
    allowed: false,
    reason: `${storedValueCount} ${storedValueCount === 1 ? "record already holds" : "records already hold"} a value for this field. Create a new field instead of changing this one's type.`,
  };
}

/** Keys holding personal data, for export and erasure. */
export function piiKeys(definitions: FieldDefinition[]): string[] {
  return definitions.filter((d) => d.isPii).map((d) => d.key);
}

/**
 * A stable text form of a value, for indexing and uniqueness.
 *
 * Multiselect values are sorted so ["a","b"] and ["b","a"] collide as they
 * should; without it a uniqueness constraint would be trivially bypassed by
 * reordering.
 */
export function toIndexText(value: FieldValue): string | null {
  if (value === null) return null;
  if (Array.isArray(value)) return [...value].sort().join("\u001f");
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}
