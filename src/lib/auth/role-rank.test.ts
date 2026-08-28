import { describe, expect, it } from "vitest";
import { effectiveRole, ROLE_RANK } from "./role-rank";

/**
 * Which role applies when the identity service and HRMS disagree.
 *
 * Groups in auth.circuvent.com grant roles across the suite and assert them in
 * the SSO token; HRMS keeps its own grants as well. Getting this wrong is
 * silent in both directions — somebody quietly gains powers nobody granted, or
 * quietly keeps ones that were taken away and nobody finds out until an
 * audit.
 */

describe("effectiveRole", () => {
  it("takes the asserted role when it is stronger", () => {
    // The point of group-based access: joining a group in the identity service
    // is what grants the access, and HRMS has to honour it.
    expect(effectiveRole("employee", "hr")).toBe("hr");
    expect(effectiveRole("manager", "admin")).toBe("admin");
  });

  it("takes the asserted role when it is weaker, so revocation revokes", () => {
    /*
     * The regression this function exists to prevent, and the reason it no
     * longer returns the stronger of the two.
     *
     * A founder removed their own administrator role in auth.circuvent.com,
     * signed out, signed back in, and tried a private window; HRMS kept
     * showing "Administrator" every time, because a local `owner` row outranked
     * the `employee` the directory was asserting. Access that cannot be taken
     * away from the place that grants it is not access control.
     */
    expect(effectiveRole("owner", "employee")).toBe("employee");
    expect(effectiveRole("admin", "employee")).toBe("employee");
    expect(effectiveRole("hr", "manager")).toBe("manager");
  });

  it("agrees with itself when the two match", () => {
    expect(effectiveRole("manager", "manager")).toBe("manager");
  });

  it("falls back to the local role when the token asserts none", () => {
    // Password sign-in has no directory assertion to defer to.
    expect(effectiveRole("hr", null)).toBe("hr");
    expect(effectiveRole("hr", undefined)).toBe("hr");
    expect(effectiveRole("hr", "")).toBe("hr");
    expect(effectiveRole("owner", null)).toBe("owner");
  });

  it("defaults to the least privilege, never the most", () => {
    // No grant anywhere has to mean `employee`. Any other default turns a
    // missing row into an escalation.
    expect(effectiveRole(null, null)).toBe("employee");
    expect(effectiveRole(undefined, undefined)).toBe("employee");
  });

  it("ignores a role it cannot place", () => {
    /*
     * A role this app has no definition for cannot be enforced by it. Treating
     * it as valid would grant undefined powers, so the local answer stands —
     * an answer HRMS knows how to apply.
     */
    expect(effectiveRole("manager", "superuser")).toBe("manager");
    expect(effectiveRole("manager", "../../etc/passwd")).toBe("manager");
    expect(effectiveRole(null, "superuser")).toBe("employee");
  });

  it("is not confused by case or padding", () => {
    expect(effectiveRole("employee", "  ADMIN  ")).toBe("admin");
    expect(effectiveRole("owner", "  EMPLOYEE  ")).toBe("employee");
  });

  it("still ranks HRMS's own vocabulary, owner highest", () => {
    // The ranking is no longer used to pick between the two, but `owner`
    // remains HRMS-only vocabulary and other code orders by it.
    const order = Object.entries(ROLE_RANK).sort((a, b) => a[1] - b[1]).map(([r]) => r);
    expect(order).toEqual(["employee", "manager", "hr", "admin", "owner"]);
  });
});
