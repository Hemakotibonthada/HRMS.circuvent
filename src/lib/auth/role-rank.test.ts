import { describe, expect, it } from "vitest";
import { strongestRole, ROLE_RANK } from "./role-rank";

/**
 * Which role applies when the identity service and HRMS disagree.
 *
 * Groups in auth.circuvent.com grant roles across the suite and assert them in
 * the SSO token; HRMS keeps its own grants as well. Getting this wrong is
 * silent in both directions — somebody quietly gains powers nobody granted, or
 * quietly loses ones they had and only finds out when a page refuses them.
 */

describe("strongestRole", () => {
  it("takes the token's role when it is stronger", () => {
    // The point of the feature: joining a group in the identity service is what
    // grants the access, and HRMS has to honour it.
    expect(strongestRole("employee", "hr")).toBe("hr");
    expect(strongestRole("manager", "admin")).toBe("admin");
  });

  it("keeps the local role when it is stronger", () => {
    /*
     * The direction that would be a silent regression. An HRMS administrator
     * who joins a group of ordinary employees must not be demoted by it.
     */
    expect(strongestRole("admin", "employee")).toBe("admin");
    expect(strongestRole("owner", "admin")).toBe("owner");
  });

  it("keeps the local role when the two are equal", () => {
    expect(strongestRole("manager", "manager")).toBe("manager");
  });

  it("falls back to the local role when the token asserts none", () => {
    expect(strongestRole("hr", null)).toBe("hr");
    expect(strongestRole("hr", undefined)).toBe("hr");
    expect(strongestRole("hr", "")).toBe("hr");
  });

  it("defaults to the least privilege, never the most", () => {
    // No grant anywhere has to mean `employee`. Any other default turns a
    // missing row into an escalation.
    expect(strongestRole(null, null)).toBe("employee");
    expect(strongestRole(undefined, undefined)).toBe("employee");
  });

  it("ignores a role it cannot place", () => {
    /*
     * A role this app has no definition for cannot be enforced by it. Treating
     * it as strong would grant undefined powers; treating it as weak would
     * demote somebody. Ignoring it leaves an answer HRMS knows how to apply.
     */
    expect(strongestRole("manager", "superuser")).toBe("manager");
    expect(strongestRole("manager", "../../etc/passwd")).toBe("manager");
    expect(strongestRole(null, "superuser")).toBe("employee");
  });

  it("is not confused by case or padding", () => {
    expect(strongestRole("employee", "  ADMIN  ")).toBe("admin");
  });

  it("ranks HRMS's own vocabulary, owner highest", () => {
    // `owner` exists only in HRMS; nothing the identity service asserts should
    // ever outrank it.
    const order = Object.entries(ROLE_RANK).sort((a, b) => a[1] - b[1]).map(([r]) => r);
    expect(order).toEqual(["employee", "manager", "hr", "admin", "owner"]);
    expect(strongestRole("owner", "admin")).toBe("owner");
  });
});
