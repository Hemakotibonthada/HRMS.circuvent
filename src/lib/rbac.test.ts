// RBAC decides who can see payroll, approve leave and delete employees.
// These tests pin the privilege boundaries so a future edit to the permission
// arrays cannot silently widen access.

import { describe, expect, it } from "vitest";
import {
  MODULE_PERMISSION_MAP,
  ROLE_PERMISSIONS,
  canAccessModule,
  getRoleLabel,
  hasAnyPermission,
  hasPermission,
  type Permission,
  type Role,
} from "@/lib/rbac";

const ROLES: Role[] = ["admin", "hr", "manager", "employee"];

describe("role permission sets", () => {
  it("gives admin every permission any other role holds", () => {
    const adminPerms = new Set(ROLE_PERMISSIONS.admin);
    for (const role of ROLES) {
      for (const perm of ROLE_PERMISSIONS[role]) {
        expect(adminPerms.has(perm), `admin is missing ${perm} held by ${role}`).toBe(true);
      }
    }
  });

  it("contains no duplicate permissions within a role", () => {
    for (const role of ROLES) {
      const perms = ROLE_PERMISSIONS[role];
      expect(new Set(perms).size, `${role} has duplicate permissions`).toBe(perms.length);
    }
  });

  it("grants managers a strict superset of employee permissions", () => {
    const managerPerms = new Set(ROLE_PERMISSIONS.manager);
    for (const perm of ROLE_PERMISSIONS.employee) {
      expect(managerPerms.has(perm), `manager is missing employee permission ${perm}`).toBe(
        true
      );
    }
    expect(ROLE_PERMISSIONS.manager.length).toBeGreaterThan(
      ROLE_PERMISSIONS.employee.length
    );
  });
});

describe("privilege boundaries", () => {
  it("does not let employees read other people's payroll", () => {
    expect(hasPermission("employee", "payroll.view")).toBe(false);
    expect(hasPermission("employee", "payroll.process")).toBe(false);
    // They can still see their own payslip.
    expect(hasPermission("employee", "payslip.view_own")).toBe(true);
  });

  it("does not let employees approve their own requests", () => {
    const approvals: Permission[] = [
      "leave.approve",
      "expenses.approve",
      "overtime.approve",
      "wfh.approve",
      "travel.approve",
    ];
    for (const perm of approvals) {
      expect(hasPermission("employee", perm), `employee should not hold ${perm}`).toBe(false);
      expect(hasPermission("manager", perm), `manager should hold ${perm}`).toBe(true);
    }
  });

  it("reserves employee deletion and billing management for admins", () => {
    for (const role of ["hr", "manager", "employee"] as Role[]) {
      expect(hasPermission(role, "employees.delete")).toBe(false);
      expect(hasPermission(role, "billing.manage")).toBe(false);
      expect(hasPermission(role, "settings.manage")).toBe(false);
    }
    expect(hasPermission("admin", "employees.delete")).toBe(true);
    expect(hasPermission("admin", "billing.manage")).toBe(true);
  });

  it("reserves the audit trail for admins", () => {
    expect(hasPermission("admin", "audit.view")).toBe(true);
    for (const role of ["hr", "manager", "employee"] as Role[]) {
      expect(hasPermission(role, "audit.view")).toBe(false);
    }
  });

  it("lets HR run payroll but not manage billing", () => {
    expect(hasPermission("hr", "payroll.process")).toBe(true);
    expect(hasPermission("hr", "billing.manage")).toBe(false);
  });
});

describe("hasAnyPermission", () => {
  it("is true when at least one permission is held", () => {
    expect(hasAnyPermission("employee", ["payroll.process", "leave.apply"])).toBe(true);
  });

  it("is false when none are held", () => {
    expect(hasAnyPermission("employee", ["payroll.process", "employees.delete"])).toBe(false);
  });

  it("is false for an empty list", () => {
    expect(hasAnyPermission("admin", [])).toBe(false);
  });
});

describe("canAccessModule", () => {
  it("fails closed for an unknown module", () => {
    // An unmapped module must not be reachable by accident when a new route is
    // added without a permission entry.
    for (const role of ["hr", "manager", "employee"] as Role[]) {
      expect(canAccessModule(role, "module-that-does-not-exist")).toBe(false);
    }
    expect(canAccessModule("admin", "module-that-does-not-exist")).toBe(true);
  });

  it("maps every module to a permission that some role actually holds", () => {
    const granted = new Set<Permission>(ROLES.flatMap((r) => ROLE_PERMISSIONS[r]));
    for (const [moduleId, permission] of Object.entries(MODULE_PERMISSION_MAP)) {
      expect(
        granted.has(permission),
        `module "${moduleId}" requires "${permission}", which no role holds`
      ).toBe(true);
    }
  });

  it("keeps payroll and audit modules away from employees", () => {
    expect(canAccessModule("employee", "payroll")).toBe(false);
    expect(canAccessModule("employee", "audit")).toBe(false);
    expect(canAccessModule("employee", "billing")).toBe(false);
    expect(canAccessModule("employee", "compensation")).toBe(false);
  });

  it("lets every role reach the dashboard and directory", () => {
    for (const role of ROLES) {
      expect(canAccessModule(role, "dashboard")).toBe(true);
      expect(canAccessModule(role, "directory")).toBe(true);
    }
  });

  it("resolves every module id to a mapped permission", () => {
    // Guards against a typo in MODULE_PERMISSION_MAP silently sending a real
    // module down the admin-only fallback path.
    const unmapped = Object.keys(MODULE_PERMISSION_MAP).filter(
      (m) => !MODULE_PERMISSION_MAP[m]
    );
    expect(unmapped).toEqual([]);
  });
});

describe("getRoleLabel", () => {
  it("returns a human label for every role", () => {
    for (const role of ROLES) {
      expect(getRoleLabel(role)).toBeTruthy();
      expect(getRoleLabel(role)).not.toBe(role);
    }
  });
});
