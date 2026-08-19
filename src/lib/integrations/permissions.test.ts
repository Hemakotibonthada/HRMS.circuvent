// ═══════════════════════════════════════════════════════════════
// Who may manage integrations
// ═══════════════════════════════════════════════════════════════
// These endpoints let a caller point the server at a URL of their choosing and
// read where company notifications go. The permission is therefore the whole
// security boundary, and it is asserted here rather than left to a review of
// four separate route files.

import { describe, it, expect } from "vitest";
import { canManageIntegrations, toRbacRole } from "./permissions";
import { hasPermission } from "@/lib/rbac";

describe("role mapping", () => {
  it("treats an owner as an administrator", () => {
    // The API knows about "owner"; the permission model does not, because an
    // owner outranks every application role. If these two disagreed, an owner
    // would be refused by their own deployment.
    expect(toRbacRole("owner")).toBe("admin");
    expect(canManageIntegrations("owner")).toBe(true);
  });

  it("passes every other role through unchanged", () => {
    for (const role of ["admin", "hr", "manager", "employee"] as const) {
      expect(toRbacRole(role)).toBe(role);
    }
  });
});

describe("the boundary", () => {
  it("admits an administrator", () => {
    expect(canManageIntegrations("admin")).toBe(true);
  });

  it("refuses everyone else, including HR", () => {
    // HR holds settings.view — enough to open the Settings page — and that is
    // deliberately not enough to add a destination for company data.
    for (const role of ["hr", "manager", "employee"] as const) {
      expect(canManageIntegrations(role), `${role} must not manage integrations`).toBe(false);
    }
  });

  it("agrees with the permission it is derived from", () => {
    // If settings.manage is ever granted to another role, this follows
    // automatically — the check is not a second, drifting copy of the rule.
    for (const role of ["admin", "hr", "manager", "employee"] as const) {
      expect(canManageIntegrations(role)).toBe(hasPermission(role, "settings.manage"));
    }
  });

  it("matches what the settings screen shows", () => {
    // The client gates the Integrations panel on the same permission. If the
    // two drifted, the screen would offer a control the API then refuses.
    expect(canManageIntegrations("employee")).toBe(false);
    expect(hasPermission("employee", "settings.view")).toBe(true);
  });
});
