import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { employees } from "@/db/schema/hrms";
import {
  PaystubSyncConfigError,
  employeeToPaystubSyncBody,
  resolvePaystubTenant,
} from "@/lib/paystub-client";
import { deliverPaystubEmployeeSync } from "@/lib/paystub-sync-outbox";
import { encryptField } from "@/lib/crypto/field-encryption";

type EmployeeRow = typeof employees.$inferSelect;

function employee(overrides: Partial<EmployeeRow> = {}): EmployeeRow {
  return {
    id: "employee-1",
    orgId: "hrms-org-1",
    userId: null,
    employeeCode: "EMP-001",
    previousEmployeeCode: null,
    codeChangedAt: null,
    firstName: "Asha",
    lastName: "Rao",
    workEmail: "employee@example.com",
    personalEmail: "personal@example.com",
    phone: "9999999999",
    avatarUrl: null,
    gender: "female",
    dateOfBirth: "1990-01-01",
    bloodGroup: null,
    maritalStatus: "single",
    addressLine1: "Line 1",
    city: "Bengaluru",
    state: "Karnataka",
    country: "India",
    postalCode: "560001",
    departmentId: "department-1",
    locationId: "location-1",
    designation: "Engineer",
    reportingToId: "manager-1",
    employmentType: "freelance",
    status: "active",
    joinDate: "2026-08-01",
    confirmationDate: null,
    exitDate: null,
    exitReason: null,
    noticePeriodDays: 60,
    internshipEndDate: null,
    contractedHoursPerWeek: "40.00",
    ctcMinor: null,
    currency: "INR",
    bankDetails: null,
    emergencyContact: null,
    skills: [],
    qualifications: [],
    panNumber: null,
    aadhaarNumber: null,
    uanNumber: null,
    pfNumber: null,
    esiNumber: null,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    updatedAt: new Date("2026-08-01T00:00:00Z"),
    deletedAt: null,
    ...overrides,
  };
}

describe("employeeToPaystubSyncBody", () => {
  it("maps HRMS employee fields into Paystub's sync contract", () => {
    const body = employeeToPaystubSyncBody({ employee: employee() }, {
      orgId: "paystub-org-1",
      entityId: "paystub-entity-1",
    });

    expect(body).toMatchObject({
      orgId: "paystub-org-1",
      entityId: "paystub-entity-1",
      hrmsEmployeeId: "employee-1",
      employeeCode: "EMP-001",
      firstName: "Asha",
      lastName: "Rao",
      workEmail: "employee@example.com",
      designation: "Engineer",
      joinDate: "2026-08-01",
      gender: "female",
      employmentType: "consultant",
      address: {
        line1: "Line 1",
        city: "Bengaluru",
        state: "Karnataka",
        country: "India",
        postalCode: "560001",
      },
    });
  });

  it("does not send HRMS-only relationship ids as Paystub ids", () => {
    const body = employeeToPaystubSyncBody({ employee: employee() }, {
      orgId: "paystub-org-1",
      entityId: "paystub-entity-1",
    });

    expect(body).not.toHaveProperty("departmentId");
    expect(body).not.toHaveProperty("locationId");
    expect(body).not.toHaveProperty("reportingToId");
  });

  it("sends the department and location by code and name", () => {
    // HRMS's department_id is a key into HRMS's own table; Paystub has its own
    // with different ids and a foreign key that would reject it. The code is
    // the only identifier the two systems can share.
    const body = employeeToPaystubSyncBody(
      {
        employee: employee(),
        department: { code: "ENG", name: "Engineering" },
        location: { code: "HHR", name: "Hyderabad (Hybrid / Remote)" },
      },
      { orgId: "paystub-org-1", entityId: "paystub-entity-1" }
    );

    expect(body.departmentCode).toBe("ENG");
    expect(body.departmentName).toBe("Engineering");
    expect(body.locationCode).toBe("HHR");
    expect(body.locationName).toBe("Hyderabad (Hybrid / Remote)");
  });

  it("sends the statutory identifiers an Indian payslip has to carry", () => {
    const body = employeeToPaystubSyncBody(
      {
        employee: employee({
          panNumber: "ABCDE1234F",
          uanNumber: "100200300400",
          pfNumber: "TN/MAS/12345/678",
          esiNumber: null,
        }),
      },
      { orgId: "paystub-org-1", entityId: "paystub-entity-1" }
    );

    expect(body.statutoryIds).toEqual({
      pan: "ABCDE1234F",
      uan: "100200300400",
      pf_number: "TN/MAS/12345/678",
    });
  });

  it("omits statutory identifiers entirely when HRMS holds none", () => {
    // An empty bag would read as an instruction to clear them.
    const body = employeeToPaystubSyncBody(
      { employee: employee() },
      { orgId: "paystub-org-1", entityId: "paystub-entity-1" }
    );

    expect(body).not.toHaveProperty("statutoryIds");
  });

  it("refuses to guess Paystub tenant ids", () => {
    expect(() => resolvePaystubTenant("hrms-org-1", {})).toThrow(PaystubSyncConfigError);
    expect(() =>
      resolvePaystubTenant("hrms-org-1", { "hrms-org-1": { orgId: "paystub-org-1", entityId: "" } })
    ).toThrow(/entityId/);
  });
});

describe("panNumber is stored encrypted", () => {
  // Fixed 32-byte key so encryption is deterministic to set up — not to
  // compare ciphertexts, which are randomised on purpose. Same idiom as
  // field-encryption.test.ts.
  const KEY = Buffer.alloc(32, 1).toString("base64");
  const originalKey = process.env.ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
  });

  it("decrypts panNumber before handing it to Paystub", () => {
    // The bug this guards against: employeeToPaystubSyncBody used to forward
    // row.panNumber untouched under a comment claiming "HRMS masks on
    // capture" — it never had, because nothing wrote to this column at all
    // until the bank-details self-service form. Once the bank-details route
    // started encrypting it (lib/crypto/field-encryption.ts), that untouched
    // forwarding would have sent Paystub a ciphertext envelope like
    // "enc.v1.3f2a9c1e...." to print on a payslip in place of a PAN.
    const body = employeeToPaystubSyncBody(
      { employee: employee({ panNumber: encryptField("ABCDE1234F") }) },
      { orgId: "paystub-org-1", entityId: "paystub-entity-1" }
    );

    expect(body.statutoryIds?.pan).toBe("ABCDE1234F");
  });

  it("still accepts a row written before encryption existed", () => {
    // decryptNullable passes an already-plaintext value through unchanged,
    // so a PAN captured before this feature shipped is not suddenly
    // unreadable the day encryption is turned on.
    const body = employeeToPaystubSyncBody(
      { employee: employee({ panNumber: "ABCDE1234F" }) },
      { orgId: "paystub-org-1", entityId: "paystub-entity-1" }
    );

    expect(body.statutoryIds?.pan).toBe("ABCDE1234F");
  });
});

describe("deliverPaystubEmployeeSync", () => {
  it("records a failed push for retry instead of throwing", async () => {
    const save = {
      success: vi.fn<(_: boolean) => Promise<void>>(),
      failure: vi.fn<(_: string) => Promise<void>>(),
    };

    const result = await deliverPaystubEmployeeSync(
      { employee: employee() },
      save,
      async () => {
        throw new Error("Paystub is unavailable");
      }
    );

    expect(result.ok).toBe(false);
    expect(save.success).not.toHaveBeenCalled();
    expect(save.failure).toHaveBeenCalledWith(expect.stringContaining("Paystub is unavailable"));
  });
});
