// ═══════════════════════════════════════════════════════════════
// Settings visibility
// ═══════════════════════════════════════════════════════════════
// An employee opening /settings saw the whole administrator console: company
// details, the organisation-wide security policy, the role matrix with
// headcounts, data retention volumes and billing. Nothing was gated, even
// though RBAC already distinguishes `settings.view` (everyone) from
// `settings.manage` (administrators only).

import { describe, it, expect } from "vitest";
import {
  SETTING_SECTIONS,
  visibleSections,
  resolveSection,
} from "./settings-sections";
import { hasPermission } from "./rbac";

const ADMIN_ONLY = ["organization", "modules", "roles", "data", "integrations", "billing"];
const EVERYONE = ["security", "notifications"];

describe("section visibility", () => {
  it("shows an administrator everything", () => {
    expect(visibleSections(true)).toHaveLength(SETTING_SECTIONS.length);
  });

  it("hides every organisation-level panel from someone without settings.manage", () => {
    const ids = visibleSections(false).map((s) => s.id);
    for (const id of ADMIN_ONLY) {
      expect(ids, `"${id}" is organisation configuration and must be gated`).not.toContain(id);
    }
  });

  it("still shows the panels that are about the person reading them", () => {
    const ids = visibleSections(false).map((s) => s.id);
    for (const id of EVERYONE) expect(ids).toContain(id);
  });

  it("never leaves a non-admin with nothing to open", () => {
    expect(visibleSections(false).length).toBeGreaterThan(0);
  });
});

describe("section resolution", () => {
  it("keeps the requested panel when it is allowed", () => {
    expect(resolveSection("notifications", false)).toBe("notifications");
    expect(resolveSection("billing", true)).toBe("billing");
  });

  it("redirects a non-admin away from an admin panel", () => {
    // The default landing section is "organization", which is admin-only, so
    // without this an employee opened Settings on a blank page.
    expect(resolveSection("organization", false)).not.toBe("organization");
    expect(resolveSection("billing", false)).not.toBe("billing");
  });

  it("resolves to a section that is actually visible", () => {
    for (const section of SETTING_SECTIONS) {
      const resolved = resolveSection(section.id, false);
      expect(visibleSections(false).map((s) => s.id)).toContain(resolved);
    }
  });

  it("cannot be talked into an admin panel with an unknown id", () => {
    expect(ADMIN_ONLY).not.toContain(resolveSection("../billing", false));
    expect(ADMIN_ONLY).not.toContain(resolveSection("", false));
  });
});

describe("agreement with the permission model", () => {
  it("matches who actually holds settings.manage", () => {
    // If a role gains settings.manage later, the gate follows automatically —
    // this asserts the two have not drifted apart.
    expect(hasPermission("admin", "settings.manage")).toBe(true);
    for (const role of ["hr", "manager", "employee"] as const) {
      expect(
        hasPermission(role, "settings.manage"),
        `${role} must not hold settings.manage while these panels are gated on it`,
      ).toBe(false);
    }
  });

  it("lets every role reach the settings route at all", () => {
    for (const role of ["admin", "hr", "manager", "employee"] as const) {
      expect(hasPermission(role, "settings.view")).toBe(true);
    }
  });
});
