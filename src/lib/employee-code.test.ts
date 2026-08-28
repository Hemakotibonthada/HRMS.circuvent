// Which prefix a hire draws from. The sequence itself — the advisory lock,
// the no-reuse scan — lives in Postgres and is exercised for real by
// employee-code.live.test.ts; this file only checks the mapping decision.

import { describe, expect, it } from "vitest";
import {
  INTERN_EMPLOYEE_CODE_PREFIX,
  PERMANENT_EMPLOYEE_CODE_PREFIX,
  employeeCodePrefixFor,
  isInternEmployeeCode,
} from "@/lib/employee-code";

describe("employeeCodePrefixFor", () => {
  it("gives interns the CVI- prefix", () => {
    expect(employeeCodePrefixFor("intern")).toBe(INTERN_EMPLOYEE_CODE_PREFIX);
  });

  it.each(["full_time", "part_time", "contract", "freelance"])(
    "gives %s the CV- prefix",
    (employmentType) => {
      expect(employeeCodePrefixFor(employmentType)).toBe(PERMANENT_EMPLOYEE_CODE_PREFIX);
    }
  );

  it("defaults anything unrecognised to CV-, never CVI-", () => {
    // A typo'd or future employment type must fail closed to the permanent
    // sequence, not silently start handing out intern codes.
    expect(employeeCodePrefixFor("sabbatical")).toBe(PERMANENT_EMPLOYEE_CODE_PREFIX);
    expect(employeeCodePrefixFor(null)).toBe(PERMANENT_EMPLOYEE_CODE_PREFIX);
    expect(employeeCodePrefixFor(undefined)).toBe(PERMANENT_EMPLOYEE_CODE_PREFIX);
  });

  it("produces two prefixes where neither is a string-prefix of the other's codes", () => {
    // If CV- were a prefix of every CVI- code (it is, as characters — "CV" is
    // the first two letters of "CVI" too) then a naive `startsWith("CV-")`
    // check elsewhere in the codebase could misclassify an intern's code as
    // permanent. What actually matters is the hyphen: CV-001 and CVI-001
    // diverge at the third character ('-' vs 'I'), so no code produced with
    // one prefix can ever equal, or be mistaken for, one produced with the
    // other.
    const permanent = `${PERMANENT_EMPLOYEE_CODE_PREFIX}001`;
    const intern = `${INTERN_EMPLOYEE_CODE_PREFIX}001`;
    expect(permanent).not.toBe(intern);
    expect(permanent.startsWith(INTERN_EMPLOYEE_CODE_PREFIX)).toBe(false);
    expect(intern.startsWith(PERMANENT_EMPLOYEE_CODE_PREFIX)).toBe(false);
  });
});

describe("isInternEmployeeCode", () => {
  it("recognises CVI- codes", () => {
    expect(isInternEmployeeCode("CVI-001")).toBe(true);
    expect(isInternEmployeeCode("CVI-999")).toBe(true);
  });

  it("does not mistake a CV- code for an intern one", () => {
    expect(isInternEmployeeCode("CV-001")).toBe(false);
  });

  it("is false for anything that is not a string", () => {
    expect(isInternEmployeeCode(null)).toBe(false);
    expect(isInternEmployeeCode(undefined)).toBe(false);
  });
});
