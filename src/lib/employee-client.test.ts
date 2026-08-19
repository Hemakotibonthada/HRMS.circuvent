// Pins the form-to-API contract that made "Add Employee" fail with an
// unexplained "Validation failed".
//
// The form and `POST /api/employees` disagreed about three fields, and the
// toast reported none of them. These tests assert the mapping, so a rename on
// either side fails here rather than in production with four useless words.

import { describe, expect, it } from "vitest";
import {
  ValidationError,
  normaliseEmploymentType,
  normaliseStatus,
  validateEmployeeForm,
  type EmployeeFormValues,
} from "@/lib/employee-client";

function form(overrides: Partial<EmployeeFormValues> = {}): EmployeeFormValues {
  return {
    firstName: "Meera",
    lastName: "Nair",
    email: "meera@circuvent.com",
    phone: "9876543210",
    department: "Engineering",
    designation: "Senior Engineer",
    // Far enough ahead to stay valid however long this test lives. A joining
    // date in the past is now refused — see `employee-rules.test.ts` — so a
    // fixture with a fixed near date would start failing on its own one day,
    // which is the worst kind of test.
    joiningDate: "2099-08-01",
    employmentType: "Full-time",
    location: "Hyderabad",
    status: "active",
    salary: "1200000",
    ...overrides,
  };
}

describe("normaliseEmploymentType", () => {
  it("maps the form's display labels to the API's enum", () => {
    // The form sent "Full-time" straight into an enum of snake_case values,
    // so every submission failed on this field alone.
    expect(normaliseEmploymentType("Full-time")).toBe("full_time");
    expect(normaliseEmploymentType("Part-time")).toBe("part_time");
    expect(normaliseEmploymentType("Contract")).toBe("contract");
    expect(normaliseEmploymentType("Intern")).toBe("intern");
  });

  it("accepts the API's own values unchanged", () => {
    expect(normaliseEmploymentType("full_time")).toBe("full_time");
    expect(normaliseEmploymentType("part_time")).toBe("part_time");
  });

  it("ignores case and spacing", () => {
    expect(normaliseEmploymentType("  FULL TIME ")).toBe("full_time");
  });

  it("returns null for something it does not recognise", () => {
    // Loudly, rather than guessing. A silent fallback to full_time would put
    // a contractor on the payroll as staff.
    expect(normaliseEmploymentType("Permanent")).toBeNull();
    expect(normaliseEmploymentType("")).toBeNull();
  });

  it("only ever emits values the API enum accepts", () => {
    const allowed = new Set(["full_time", "part_time", "contract", "intern", "freelance"]);
    for (const label of ["Full-time", "Part-time", "Contract", "Intern", "Freelance"]) {
      expect(allowed.has(normaliseEmploymentType(label)!)).toBe(true);
    }
  });
});

describe("normaliseStatus", () => {
  it("maps the statuses the form offers", () => {
    expect(normaliseStatus("active")).toBe("active");
    expect(normaliseStatus("Notice Period")).toBe("notice_period");
    expect(normaliseStatus("on-leave")).toBe("on_leave");
  });

  it("returns null for an unknown status", () => {
    expect(normaliseStatus("retired")).toBeNull();
  });
});

describe("validateEmployeeForm", () => {
  it("accepts a complete form", () => {
    expect(validateEmployeeForm(form())).toEqual([]);
  });

  it("requires a joining date", () => {
    // The form called it `joiningDate` and the API requires `joinDate`. The
    // field was never sent, so this failed on every single submission — and
    // the page never checked for it either.
    const issues = validateEmployeeForm(form({ joiningDate: "" }));
    expect(issues.map((i) => i.field)).toContain("joiningDate");
  });

  it("rejects a joining date in the wrong format", () => {
    const issues = validateEmployeeForm(form({ joiningDate: "01/08/2026" }));
    expect(issues[0].message).toMatch(/YYYY-MM-DD/);
  });

  it("requires a designation", () => {
    // Required by the API schema; the page only checked first name, last
    // name, email and department, so a blank one reached the server.
    const issues = validateEmployeeForm(form({ designation: "  " }));
    expect(issues.map((i) => i.field)).toContain("designation");
  });

  it("requires a valid email", () => {
    expect(validateEmployeeForm(form({ email: "" }))[0].field).toBe("email");
    expect(validateEmployeeForm(form({ email: "meera@" }))[0].message).toMatch(/valid email/);
  });

  it("rejects an employment type the API would refuse", () => {
    const issues = validateEmployeeForm(form({ employmentType: "Permanent" }));
    expect(issues.map((i) => i.field)).toContain("employmentType");
  });

  it("rejects a negative salary", () => {
    expect(validateEmployeeForm(form({ salary: "-1" }))[0].field).toBe("salary");
  });

  it("allows a blank salary", () => {
    // Not everyone's pay is known at the point of creation.
    expect(validateEmployeeForm(form({ salary: "" }))).toEqual([]);
  });

  it("does not require a department", () => {
    // The old page did require one, then dropped it on the way out because it
    // sent a name where a uuid was expected. Requiring something that cannot
    // be delivered is worse than not requiring it.
    expect(validateEmployeeForm(form({ department: "" }))).toEqual([]);
  });

  it("reports every problem at once, each naming its field", () => {
    const issues = validateEmployeeForm(
      form({ firstName: "", email: "nope", designation: "", joiningDate: "" })
    );
    expect(issues.length).toBeGreaterThanOrEqual(4);
    for (const issue of issues) {
      expect(issue.field).toBeTruthy();
      expect(issue.message).toBeTruthy();
    }
  });
});

describe("ValidationError", () => {
  it("carries the reasons rather than saying 'Validation failed'", () => {
    // The whole reason this bug was hard to diagnose: the API returned
    // `issues: [{ field, message }]` and the page discarded it.
    //
    // The field *names* are deliberately not in the message any more. They are
    // code identifiers — `joinDate`, `employmentType` — and prefixing them onto
    // a sentence adds jargon to something somebody has to read and act on. The
    // structured `issues` are still there for a form that wants to highlight an
    // input.
    const error = new ValidationError([
      { field: "joinDate", message: "Joining date is required" },
      { field: "employmentType", message: '"Wizard" is not an employment type' },
    ]);
    expect(error.message).toContain("Joining date is required");
    expect(error.message).toContain('"Wizard" is not an employment type');
    expect(error.issues).toHaveLength(2);
    expect(error.issues[0].field).toBe("joinDate");
  });

  it("says something honest when the server sends no issues", () => {
    // "Validation failed" was the string this whole change exists to remove.
    const message = new ValidationError([]).message;
    expect(message).not.toBe("Validation failed");
    expect(message).toBe("The details could not be saved, but no reason was given");
  });
});
