import { describe, expect, it, vi } from "vitest";
import type { employees } from "@/db/schema/hrms";
import {
  PaystubSyncConfigError,
  employeeToPaystubSyncBody,
  resolvePaystubTenant,
} from "@/lib/paystub-client";
import { deliverPaystubEmployeeSync } from "@/lib/paystub-sync-outbox";

type EmployeeRow = typeof employees.$inferSelect;

function employee(overrides: Partial<EmployeeRow> = {}): EmployeeRow {
  return {
    id: "employee-1",
    orgId: "hrms-org-1",
    userId: null,
    employeeCode: "EMP-001",
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
    const body = employeeToPaystubSyncBody(employee(), {
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
    const body = employeeToPaystubSyncBody(employee(), {
      orgId: "paystub-org-1",
      entityId: "paystub-entity-1",
    });

    expect(body).not.toHaveProperty("departmentId");
    expect(body).not.toHaveProperty("locationId");
    expect(body).not.toHaveProperty("reportingToId");
  });

  it("refuses to guess Paystub tenant ids", () => {
    expect(() => resolvePaystubTenant("hrms-org-1", {})).toThrow(PaystubSyncConfigError);
    expect(() =>
      resolvePaystubTenant("hrms-org-1", { "hrms-org-1": { orgId: "paystub-org-1", entityId: "" } })
    ).toThrow(/entityId/);
  });
});

describe("deliverPaystubEmployeeSync", () => {
  it("records a failed push for retry instead of throwing", async () => {
    const save = {
      success: vi.fn<(_: boolean) => Promise<void>>(),
      failure: vi.fn<(_: string) => Promise<void>>(),
    };

    const result = await deliverPaystubEmployeeSync(
      employee(),
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
