/**
 * Which tenant somebody signing in through the directory lands in.
 *
 * The rule this replaced was "the organisation, if there is exactly one", which
 * is how Paystub does it and is right for Paystub. It was wrong here: this
 * deployment carries four organisations — two test tenants, and two both named
 * Circuvent Technologies (`circuvent` and `circuvent-technologies`) with one
 * person in each. Counting refused every sign-in; taking the first would have
 * filed half the company under the wrong tenant, where they would see none of
 * their own records and somebody would eventually have to unpick it.
 */
import { describe, it, expect } from "vitest";
import { directoryOrgSlug } from "./session";

describe("the organisation a directory sign-in resolves to", () => {
  it("is Circuvent by default", () => {
    expect(directoryOrgSlug({})).toBe("circuvent");
  });

  it("can be pointed at another tenant for a deployment that is not ours", () => {
    expect(directoryOrgSlug({ HRMS_ORG_SLUG: "acme" })).toBe("acme");
  });

  it("ignores an empty or blank setting rather than resolving to nothing", () => {
    // An empty string would match no organisation, and every sign-in would be
    // refused with nothing in the logs to say why.
    expect(directoryOrgSlug({ HRMS_ORG_SLUG: "" })).toBe("circuvent");
    expect(directoryOrgSlug({ HRMS_ORG_SLUG: "   " })).toBe("circuvent");
  });

  it("is case-insensitive and trimmed, because a slug is neither", () => {
    expect(directoryOrgSlug({ HRMS_ORG_SLUG: "  ACME  " })).toBe("acme");
  });

  /*
   * The near-miss that matters. `circuvent-technologies` is a real, separate
   * organisation in this database with its own people and records; resolving
   * to it instead of `circuvent` is a silent, plausible-looking mistake.
   */
  it("does not resolve to the other Circuvent organisation by accident", () => {
    expect(directoryOrgSlug({})).not.toBe("circuvent-technologies");
  });
});
