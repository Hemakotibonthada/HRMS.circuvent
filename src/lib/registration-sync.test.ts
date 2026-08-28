// This writes to personnel records from a form somebody filled in weeks
// earlier, so the tests that matter are the ones about restraint: what it
// refuses to copy, and what it refuses to overwrite.

import { describe, expect, it } from "vitest";

import {
  planRegistrationSync,
  type EmployeePersonalFields,
  type RegistrationSource,
} from "@/lib/registration-sync";

function registration(over: Partial<RegistrationSource> = {}): RegistrationSource {
  return {
    submittedAt: "2026-08-18T10:10:30Z",
    dateOfBirth: "1999-06-09",
    gender: "male",
    maritalStatus: "single",
    bloodGroup: "O+",
    personalEmail: "the.vema@icloud.com",
    mobile: "765 999 333 1",
    mobileCountryCode: "+91",
    presentLine1: "3-34, Bonthada Street",
    presentLine2: "Ravupalli",
    presentCity: "HYDERABAD",
    presentState: "Telangana",
    presentPin: "500049",
    presentCountry: "India",
    ...over,
  };
}

const emptyEmployee: Partial<EmployeePersonalFields> = {};

describe("filling an employee record from their joining form", () => {
  it("copies what the employee record is missing", () => {
    const plan = planRegistrationSync(emptyEmployee, registration());

    expect(plan.updates.dateOfBirth).toBe("1999-06-09");
    expect(plan.updates.gender).toBe("male");
    expect(plan.updates.city).toBe("HYDERABAD");
    expect(plan.updates.postalCode).toBe("500049");
    expect(plan.filled).toContain("dateOfBirth");
  });

  it("joins the address lines rather than losing the second one", () => {
    expect(planRegistrationSync(emptyEmployee, registration()).updates.addressLine1).toBe(
      "3-34, Bonthada Street, Ravupalli"
    );
  });

  it("puts the country code on the mobile number", () => {
    // Stored apart, as the form collects them, it is a number nobody can dial
    // from outside the country.
    expect(planRegistrationSync(emptyEmployee, registration()).updates.phone).toBe(
      "+91 765 999 333 1"
    );
  });

  it("does not double a country code the number already carries", () => {
    const plan = planRegistrationSync(emptyEmployee, registration({ mobile: "+91 76599933 31" }));
    expect(plan.updates.phone).toBe("+91 76599933 31");
  });

  it("reads a date column without shifting it a day", () => {
    // A `date` comes back from pg as a local Date. Through toISOString() it
    // becomes the previous day for anybody west of UTC — and this value is
    // what a payslip password is built from.
    const plan = planRegistrationSync(emptyEmployee, registration({ dateOfBirth: new Date(1999, 5, 9) }));
    expect(plan.updates.dateOfBirth).toBe("1999-06-09");
  });
});

describe("what it refuses to do", () => {
  it("never overwrites something already on the employee record", () => {
    // The registration is older information. A joining form completed weeks
    // ago must not revert an address somebody corrected yesterday.
    const employee: Partial<EmployeePersonalFields> = {
      dateOfBirth: "1990-01-01",
      city: "Bengaluru",
      personalEmail: "corrected@example.com",
    };
    const plan = planRegistrationSync(employee, registration());

    expect(plan.updates.dateOfBirth).toBeUndefined();
    expect(plan.updates.city).toBeUndefined();
    expect(plan.updates.personalEmail).toBeUndefined();
    // The genuinely empty ones are still filled.
    expect(plan.updates.state).toBe("Telangana");
  });

  it("treats whitespace on the employee record as empty, not as an answer", () => {
    const plan = planRegistrationSync({ city: "   " }, registration());
    expect(plan.updates.city).toBe("HYDERABAD");
  });

  it("ignores a form that has not been submitted", () => {
    // A draft is somebody halfway through typing. Copying a half-finished
    // answer onto a personnel record is worse than leaving the column empty.
    const plan = planRegistrationSync(emptyEmployee, registration({ submittedAt: null }));
    expect(plan.filled).toEqual([]);
    expect(plan.reason).toBe("not-submitted");
  });

  it("says so when there is no registration at all", () => {
    expect(planRegistrationSync(emptyEmployee, null).reason).toBe("no-registration");
  });

  it("reports a complete record as complete rather than as a change", () => {
    // The nightly sweep calls this for everybody; "nothing to do" has to be
    // distinguishable from "wrote something" or the log is meaningless.
    const complete: Partial<EmployeePersonalFields> = {
      dateOfBirth: "1999-06-09",
      gender: "male",
      maritalStatus: "single",
      bloodGroup: "O+",
      personalEmail: "x@y.com",
      phone: "+91 1",
      addressLine1: "a",
      city: "b",
      state: "c",
      postalCode: "d",
      country: "India",
    };
    const plan = planRegistrationSync(complete, registration());
    expect(plan.filled).toEqual([]);
    expect(plan.reason).toBe("already-complete");
  });

  it("drops a gender the column cannot hold", () => {
    // `gender` is a Postgres enum. A free-text answer that is not one of its
    // values would fail the update and take every other field with it.
    for (const value of ["Male please", "", "M", "unspecified"]) {
      expect(planRegistrationSync(emptyEmployee, registration({ gender: value })).updates.gender)
        .toBeUndefined();
    }
    expect(planRegistrationSync(emptyEmployee, registration({ gender: "FEMALE" })).updates.gender)
      .toBe("female");
  });

  it("skips a date that is not one", () => {
    for (const value of ["not-a-date", "09/06/1999", ""]) {
      expect(
        planRegistrationSync(emptyEmployee, registration({ dateOfBirth: value })).updates.dateOfBirth
      ).toBeUndefined();
    }
  });

  it("copies no statutory number, whatever the registration holds", () => {
    // PAN, Aadhaar and UAN are encrypted under ATS's key; HRMS reads its own
    // columns with a different one. Copying the ciphertext would store
    // something HRMS can never decrypt, and Paystub prints those columns on a
    // payslip. The plan must contain nothing of the sort.
    const plan = planRegistrationSync(emptyEmployee, registration());
    const written = Object.keys(plan.updates).join(",").toLowerCase();
    for (const forbidden of ["pan", "aadhaar", "uan", "esi", "pf"]) {
      expect(written).not.toContain(forbidden);
    }
  });
});
