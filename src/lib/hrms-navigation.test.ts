import { describe, it, expect } from "vitest";
import { MODULES } from "@/lib/constants";
import { navigationGroups, activeNavigationGroup } from "@/lib/hrms-navigation";
import { HRMS_PORTALS, portalAllowsModule, type HrmsPortal } from "@/lib/hrms-portals";

describe("focused HRMS navigation", () => {
  for (const portal of Object.keys(HRMS_PORTALS) as HrmsPortal[]) {
    for (const role of ["employee", "manager", "hr", "admin", "owner", "unknown"]) {
      it(`covers allowed tools exactly once for ${portal}/${role}`, () => {
        const groups = navigationGroups(portal, role);
        const actual = groups.flatMap(group => group.items.map(item => item.id));
        const expected = MODULES.filter(item => item.id !== "dashboard" && portalAllowsModule(portal, item.href.slice(1), role)).map(item => item.id);
        expect(new Set(actual).size).toBe(actual.length);
        expect(actual.sort()).toEqual(expected.sort());
        expect(groups.every(group => group.items.length > 0)).toBe(true);
      });
    }
  }
  it("keeps nested pages and hub aliases in the right section", () => {
    const groups = navigationGroups("hr", "hr");
    expect(activeNavigationGroup(groups, "/employees/example")?.id).toBe("people");
    expect(activeNavigationGroup(groups, "/attendancehub")?.id).toBe("time");
    expect(activeNavigationGroup(groups, "/workspace")).toBeUndefined();
    expect(activeNavigationGroup(groups, "/employees-other")).toBeUndefined();
  });
  it("never adds HR-only tools to an intern's tabs", () => {
    const items = navigationGroups("intern", "employee").flatMap(group => group.items.map(item => item.id));
    expect(items).toContain("timesheets");
    expect(items).not.toContain("interns");
    expect(items).not.toContain("payroll");
  });
});
