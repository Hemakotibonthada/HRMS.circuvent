// A new hire who is not put in the right group cannot sign in to Mail, is not
// on the all-staff list, and finds out on their first morning. A leaver who is
// wrongly put in one keeps company-wide access and receives every internal
// message. Both are decided here.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  STANDARD_GROUPS,
  autoJoinAddresses,
  groupAddress,
  resolveGroupDomain,
  retryDelayMinutes,
  shouldAutoJoin,
} from "@/lib/onboarding-groups";

describe("which groups a hire joins", () => {
  it("auto-joins exactly one group", () => {
    // A product that guesses at the others produces a company where the
    // finance list contains the whole company.
    const auto = STANDARD_GROUPS.filter((g) => g.autoJoin);
    expect(auto).toHaveLength(1);
    expect(auto[0].localPart).toBe("all");
  });

  it("builds the address on the organisation's own domain", () => {
    expect(autoJoinAddresses("circuvent.com")).toEqual(["all@circuvent.com"]);
  });

  it("lower-cases and strips a stray @ from the domain", () => {
    expect(groupAddress("All", "@Circuvent.COM")).toBe("all@circuvent.com");
  });
});

describe("which domain the group lives on", () => {
  it("takes it from an address the organisation already uses", () => {
    // Not from `organizations.website`, which is a marketing URL and regularly
    // a different domain from the mailboxes. A group address on the wrong
    // domain is a distribution list that silently reaches nobody.
    expect(resolveGroupDomain("hemakoti@circuvent.com")).toBe("circuvent.com");
  });

  it("prefers the first usable candidate", () => {
    expect(resolveGroupDomain(null, undefined, "", "owner@example.co.in")).toBe("example.co.in");
  });

  it("ignores something that is not an address", () => {
    expect(resolveGroupDomain("not-an-address", "real@circuvent.com")).toBe("circuvent.com");
    expect(resolveGroupDomain("bad@nodot", "real@circuvent.com")).toBe("circuvent.com");
    expect(resolveGroupDomain("trailing@dot.", "real@circuvent.com")).toBe("circuvent.com");
  });

  it("falls back rather than producing an unusable address", () => {
    expect(resolveGroupDomain(null)).toBe("circuvent.com");
  });
});

describe("who is auto-joined", () => {
  it("joins an ordinary new hire", () => {
    expect(shouldAutoJoin({ email: "hemakoti@circuvent.com", status: "active" })).toBe(true);
  });

  it("joins somebody still onboarding or on probation", () => {
    // The group is what grants the account they need on day one. Waiting until
    // they are confirmed is how a first day is spent waiting.
    expect(shouldAutoJoin({ email: "new@circuvent.com", status: "onboarding" })).toBe(true);
    expect(shouldAutoJoin({ email: "new@circuvent.com", status: "probation" })).toBe(true);
  });

  it("defaults to joining when no status is given", () => {
    expect(shouldAutoJoin({ email: "new@circuvent.com" })).toBe(true);
  });

  it("does not join a record being back-filled for somebody who has left", () => {
    // Adding them would put a leaver on the all-staff list and grant them
    // company-wide access.
    for (const status of ["resigned", "terminated", "retired", "absconded"]) {
      expect(shouldAutoJoin({ email: "gone@circuvent.com", status })).toBe(false);
    }
  });

  it("refuses an address that is not one", () => {
    for (const email of ["", "   ", "no-at-sign", "@circuvent.com", "name@", "a@b@c.com", "name@nodot"]) {
      expect(shouldAutoJoin({ email, status: "active" }), email).toBe(false);
    }
  });
});

describe("retrying a failed join", () => {
  it("backs off by doubling", () => {
    expect(retryDelayMinutes(1)).toBe(2);
    expect(retryDelayMinutes(2)).toBe(4);
    expect(retryDelayMinutes(5)).toBe(32);
  });

  it("stops doubling, so an outage is not made worse", () => {
    // The exponent cap binds before the 24-hour ceiling does: 2^10 is 1024
    // minutes, a little over seventeen hours. Asserting the real number rather
    // than the one the ceiling suggests, because a test that agreed with an
    // optimistic comment would hide the difference rather than pin it.
    expect(retryDelayMinutes(10)).toBe(1024);
    expect(retryDelayMinutes(20)).toBe(1024);
    expect(retryDelayMinutes(1000)).toBe(1024);
  });

  it("never waits longer than a day", () => {
    for (const attempt of [0, 1, 5, 11, 50, 10_000]) {
      expect(retryDelayMinutes(attempt)).toBeLessThanOrEqual(60 * 24);
    }
  });
});

describe("writing to the directory", () => {
  const ORIGINAL_TOKEN = process.env.DIRECTORY_SERVICE_TOKEN;

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    if (ORIGINAL_TOKEN === undefined) delete process.env.DIRECTORY_SERVICE_TOKEN;
    else process.env.DIRECTORY_SERVICE_TOKEN = ORIGINAL_TOKEN;
  });

  async function loadSdk(token: string | undefined) {
    if (token === undefined) delete process.env.DIRECTORY_SERVICE_TOKEN;
    else process.env.DIRECTORY_SERVICE_TOKEN = token;
    vi.resetModules();
    return import("@/lib/directory-sdk");
  }

  it("reports failure rather than failing soft, unlike the reads", () => {
    // Every read in that module returns a fallback: a mail client that cannot
    // draw an avatar is still a mail client. A write cannot be treated that
    // way — "the hire was not added" looks identical to success if swallowed.
    return loadSdk("service-token").then(async (sdk) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({ error: "upstream down" }) })
      );

      const result = await sdk.addGroupMember("all@circuvent.com", "new@circuvent.com");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("upstream down");
    });
  });

  it("refuses to pretend when no service token is configured", async () => {
    const sdk = await loadSdk(undefined);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await sdk.addGroupMember("all@circuvent.com", "new@circuvent.com");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/DIRECTORY_SERVICE_TOKEN/);
    // And does not fire a request it knows will be rejected.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("treats an already-present member as success so a retry settles", async () => {
    const sdk = await loadSdk("service-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ alreadyMember: true }) })
    );

    const result = await sdk.addGroupMember("all@circuvent.com", "new@circuvent.com");
    expect(result.ok).toBe(true);
    expect(result.alreadyMember).toBe(true);
  });

  it("lower-cases the addresses it sends", async () => {
    const sdk = await loadSdk("service-token");
    const fetchSpy = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ added: true }) });
    vi.stubGlobal("fetch", fetchSpy);

    await sdk.addGroupMember("  All@Circuvent.com ", "New.Hire@Circuvent.COM");

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body).toEqual({ group: "all@circuvent.com", email: "new.hire@circuvent.com" });
  });

  it("never lets the service token reach a stored error", async () => {
    // The error is written to `directory_group_join_outbox.last_error`, which
    // is read by anybody who can see the table.
    const sdk = await loadSdk("super-secret-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("connect failed with Bearer super-secret-token"))
    );

    const result = await sdk.addGroupMember("all@circuvent.com", "new@circuvent.com");
    expect(result.ok).toBe(false);
    expect(result.error).not.toContain("super-secret-token");
    expect(result.error).toContain("[redacted]");
  });
});
