// ═══════════════════════════════════════════════════════════════
// Who is an employee, and who is a mailbox
// ═══════════════════════════════════════════════════════════════
// The case that motivated all of this: the staff directory listed `abuse@`,
// `accounts@` and `billing@` as employees, designation "Owner", counted in
// headcount. They are role mailboxes. Mail may create any address the company
// needs — groups, aliases, catch-alls — and none of them is a colleague.

import { describe, expect, it } from "vitest";
import {
  DESIGNATION_PATTERN,
  EMPLOYMENT_TYPE_OPTIONS,
  EMPLOYMENT_TYPE_VALUES,
  companyEmailDomains,
  isCompanyAddress,
  isRoleAddress,
  normaliseEmploymentType,
  todayLocalIso,
  validateEmployeeFields,
} from "./employee-rules";

/** A submission with nothing wrong with it, to vary one field at a time. */
function good(overrides: Record<string, string> = {}) {
  return {
    firstName: "Meenakshi",
    lastName: "Racha",
    email: "meenakshi.racha@circuvent.com",
    designation: "Business Analyst",
    joiningDate: "2099-01-08",
    employmentType: "consultant",
    salary: "1200000",
    ...overrides,
  };
}

const messages = (values: Parameters<typeof validateEmployeeFields>[0]) =>
  validateEmployeeFields(values).map((i) => i.message);

const fields = (values: Parameters<typeof validateEmployeeFields>[0]) =>
  validateEmployeeFields(values).map((i) => i.field);

describe("a valid submission", () => {
  it("passes", () => {
    expect(validateEmployeeFields(good())).toEqual([]);
  });
});

describe("role and group mailboxes", () => {
  it("recognises the addresses that were in the directory", () => {
    // The three the user actually saw.
    for (const local of ["abuse", "accounts", "billing"]) {
      expect(isRoleAddress(`${local}@circuvent.com`), local).toBe(true);
    }
  });

  it("recognises the usual functional addresses", () => {
    for (const local of ["info", "support", "noreply", "postmaster", "hr", "careers", "payroll"]) {
      expect(isRoleAddress(`${local}@circuvent.com`), local).toBe(true);
    }
  });

  it("recognises distribution lists", () => {
    for (const local of ["all", "all-staff", "everyone", "dl_finance", "team-india", "eng-all"]) {
      expect(isRoleAddress(`${local}@circuvent.com`), local).toBe(true);
    }
  });

  it("does not mistake a person for a mailbox", () => {
    for (const local of [
      "hema.bonthada",
      "meenakshi.racha",
      "lkolli",
      "nadia.farouk",
      "salesforce.admin", // contains "sales" but is not "sales"
      "billingsley", // a surname, not "billing"
    ]) {
      expect(isRoleAddress(`${local}@circuvent.com`), local).toBe(false);
    }
  });

  it("refuses one on the employee form, and says why", () => {
    const issues = validateEmployeeFields(good({ email: "billing@circuvent.com" }));
    expect(issues.map((i) => i.field)).toContain("email");
    expect(issues[0].message).toMatch(/shared or role mailbox, not a person/);
  });
});

describe("the work address", () => {
  it("accepts the company domain", () => {
    expect(isCompanyAddress("someone@circuvent.com")).toBe(true);
  });

  it("rejects a personal address", () => {
    // The exact address from the screenshot.
    expect(isCompanyAddress("meenakshiracha1@gmail.com")).toBe(false);
    const issues = validateEmployeeFields(good({ email: "meenakshiracha1@gmail.com" }));
    expect(issues.map((i) => i.field)).toContain("email");
    expect(issues[0].message).toMatch(/work address on circuvent\.com/);
    // And explains where a personal address does belong.
    expect(issues[0].message).toMatch(/candidate record/);
  });

  it("is not fooled by a lookalike domain", () => {
    for (const email of [
      "a@notcircuvent.com",
      "a@circuvent.com.evil.net",
      "a@circuvent.co",
      "a@sub.circuvent.com",
    ]) {
      expect(isCompanyAddress(email), email).toBe(false);
    }
  });

  it("can be configured for another deployment", () => {
    expect(companyEmailDomains({ COMPANY_EMAIL_DOMAINS: "example.test, other.test" })).toEqual([
      "example.test",
      "other.test",
    ]);
    expect(companyEmailDomains({})).toEqual(["circuvent.com"]);
  });

  it("still catches a malformed address before anything else", () => {
    expect(messages(good({ email: "not-an-address" }))[0]).toBe("Enter a valid email address");
  });
});

describe("the joining date", () => {
  it("refuses a date that has already passed", () => {
    const issues = validateEmployeeFields(good({ joiningDate: "2020-01-01" }), {
      now: new Date("2026-08-19T10:00:00"),
    } as never);
    expect(issues.map((i) => i.field)).toContain("joiningDate");
    expect(issues[0].message).toMatch(/cannot be in the past/);
  });

  it("accepts today", () => {
    const now = new Date("2026-08-19T10:00:00");
    expect(
      validateEmployeeFields(good({ joiningDate: todayLocalIso(now) }), { now } as never)
    ).toEqual([]);
  });

  it("accepts a future date", () => {
    expect(
      validateEmployeeFields(good({ joiningDate: "2026-12-01" }), {
        now: new Date("2026-08-19T10:00:00"),
      } as never)
    ).toEqual([]);
  });

  it("uses local time, so a date-picker's idea of today is never refused", () => {
    // 2am in a UTC+5:30 timezone is still the previous day in UTC. A rule
    // written in UTC would reject the date the picker had just offered.
    const earlyMorning = new Date(2026, 7, 19, 2, 0, 0);
    expect(todayLocalIso(earlyMorning)).toBe("2026-08-19");
  });

  it("allows a past date when backfilling is asked for explicitly", () => {
    expect(
      validateEmployeeFields(good({ joiningDate: "2020-01-01" }), {
        now: new Date("2026-08-19T10:00:00"),
        allowPastJoiningDate: true,
      } as never)
    ).toEqual([]);
  });
});

describe("the designation", () => {
  it("refuses digits", () => {
    // Straight from the screenshot.
    const issues = validateEmployeeFields(good({ designation: "Business Analyst123456789" }));
    expect(issues.map((i) => i.field)).toContain("designation");
    expect(issues[0].message).toMatch(/letters only/);
  });

  it("refuses symbols", () => {
    for (const bad of ["Analyst!!!", "Dev@Home", "Eng#1", "<script>"]) {
      expect(DESIGNATION_PATTERN.test(bad), bad).toBe(false);
    }
  });

  it("accepts the punctuation real job titles contain", () => {
    for (const title of [
      "Software Engineer",
      "Sr. Engineer (Backend)",
      "Head of People & Culture",
      "Analyst, Risk",
      "Full-stack Developer",
      "Manager - Operations",
      "Engineer/Architect",
      "O'Brien Chair of Design",
    ]) {
      expect(DESIGNATION_PATTERN.test(title), title).toBe(true);
    }
  });

  it("accepts a title that is not written in ASCII", () => {
    expect(DESIGNATION_PATTERN.test("Ingénieur Logiciel")).toBe(true);
    expect(DESIGNATION_PATTERN.test("अभियंता")).toBe(true);
  });
});

describe("the salary", () => {
  it("refuses a negative amount", () => {
    // Straight from the screenshot.
    const issues = validateEmployeeFields(good({ salary: "-12345678" }));
    expect(issues.map((i) => i.field)).toContain("salary");
    expect(issues[0].message).toBe("Salary cannot be negative");
  });

  it("accepts zero and blank", () => {
    expect(validateEmployeeFields(good({ salary: "0" }))).toEqual([]);
    expect(validateEmployeeFields(good({ salary: "" }))).toEqual([]);
  });

  it("refuses something that is not a number", () => {
    expect(messages(good({ salary: "lots" }))).toContain("Salary must be a number");
  });
});

describe("employment types", () => {
  it("accepts Consultant, which the dropdown offers", () => {
    // The reported bug: the form offered it and the server refused it.
    expect(normaliseEmploymentType("Consultant")).toBe("consultant");
    expect(validateEmployeeFields(good({ employmentType: "Consultant" }))).toEqual([]);
  });

  it("accepts every label the dropdown shows", () => {
    for (const option of EMPLOYMENT_TYPE_OPTIONS) {
      expect(normaliseEmploymentType(option.label), option.label).toBe(option.value);
      expect(normaliseEmploymentType(option.value), option.value).toBe(option.value);
    }
  });

  it("names the alternatives when it refuses one", () => {
    const issues = validateEmployeeFields(good({ employmentType: "Wizard" }));
    expect(issues[0].message).toMatch(/"Wizard" is not an employment type/);
    expect(issues[0].message).toMatch(/Consultant/);
  });

  it("exposes its values for a schema to be built from", () => {
    expect(EMPLOYMENT_TYPE_VALUES).toEqual(EMPLOYMENT_TYPE_OPTIONS.map((o) => o.value));
    expect(EMPLOYMENT_TYPE_VALUES).toContain("consultant");
  });
});

describe("reporting", () => {
  it("returns every problem at once, not just the first", () => {
    // The submission from the screenshots: personal address, digits in the
    // title, a past joining date and a negative salary, all at the same time.
    const issues = validateEmployeeFields({
      firstName: "Meenakshi",
      lastName: "Racha",
      email: "meenakshiracha1@gmail.com",
      designation: "Business Analyst123456789",
      joiningDate: "2026-08-01",
      employmentType: "Consultant",
      salary: "-12345678",
    }, { now: new Date("2026-08-19T10:00:00") } as never);

    expect(issues.map((i) => i.field).sort()).toEqual([
      "designation",
      "email",
      "joiningDate",
      "salary",
    ]);
    // A form that reveals one fault per submission takes as many round trips
    // as there are mistakes.
    expect(issues).toHaveLength(4);
  });

  it("says nothing vague", () => {
    const all = messages({ email: "x@gmail.com", designation: "A1", salary: "-1" });
    for (const message of all) {
      expect(message).not.toBe("Validation failed");
      expect(message.length).toBeGreaterThan(15);
    }
  });

  it("names the required fields when the form is empty", () => {
    expect(fields({}).sort()).toEqual([
      "designation",
      "email",
      "firstName",
      "joiningDate",
      "lastName",
    ]);
  });
});
