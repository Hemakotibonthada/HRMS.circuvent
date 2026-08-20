import { describe, expect, it } from "vitest";
import {
  COMPANY_MAIL_DOMAIN,
  INTERN_ADDRESS_PREFIX,
  MailHandleError,
  addressFor,
  domainOf,
  isInternAddress,
  localPartOf,
  mailIdentityKindFor,
  normaliseHandle,
  permanentAddressFor,
  planMailConversion,
} from "@/lib/mail-identity";

describe("which kind of address someone gets", () => {
  it("marks only interns", () => {
    expect(mailIdentityKindFor("intern")).toBe("intern");
    expect(mailIdentityKindFor("INTERN")).toBe("intern");
    expect(mailIdentityKindFor(" intern ")).toBe("intern");
  });

  it("does not mark contractors, consultants or freelancers", () => {
    // They are not interns and are not here on an internship. Marking them in
    // an address every correspondent sees would be both wrong and permanent.
    for (const type of ["full_time", "part_time", "contract", "consultant", "freelance"]) {
      expect(mailIdentityKindFor(type)).toBe("permanent");
    }
  });

  it("treats an unknown or missing type as permanent", () => {
    expect(mailIdentityKindFor(null)).toBe("permanent");
    expect(mailIdentityKindFor(undefined)).toBe("permanent");
    expect(mailIdentityKindFor("")).toBe("permanent");
  });
});

describe("forming an address", () => {
  it("prefixes an intern and leaves everyone else alone", () => {
    expect(addressFor("rahul", "intern")).toBe(`cvi-rahul@${COMPANY_MAIL_DOMAIN}`);
    expect(addressFor("rahul", "permanent")).toBe(`rahul@${COMPANY_MAIL_DOMAIN}`);
  });

  it("lower-cases and trims what was typed", () => {
    expect(addressFor("  Rahul.Kumar  ", "permanent")).toBe(`rahul.kumar@${COMPANY_MAIL_DOMAIN}`);
  });

  it("accepts dots, underscores and hyphens", () => {
    expect(addressFor("a.b_c-d", "permanent")).toBe(`a.b_c-d@${COMPANY_MAIL_DOMAIN}`);
  });
});

describe("refusing a handle", () => {
  it("refuses an empty one", () => {
    expect(() => normaliseHandle("   ")).toThrow(MailHandleError);
  });

  it("refuses characters the mail server would reject anyway", () => {
    // Passing here and failing at provisioning is the worst outcome: the
    // request looks approved and then cannot be fulfilled.
    for (const bad of ["ra hul", "rahul@x", "rahul+tag", "-rahul", ".rahul", "rah/ul", "rahÜl"]) {
      expect(() => normaliseHandle(bad), bad).toThrow(MailHandleError);
    }
  });

  it("refuses a handle that already carries the intern prefix", () => {
    // Otherwise an intern typing "cvi-rahul" gets cvi-cvi-rahul@, and
    // converting them later strips one prefix and leaves the other.
    expect(() => normaliseHandle("cvi-rahul", "intern")).toThrow(/added automatically/i);
    expect(() => normaliseHandle("cvi-rahul", "permanent")).toThrow(MailHandleError);
  });

  it("refuses shared and system mailboxes", () => {
    for (const reserved of ["postmaster", "admin", "hr", "careers", "payroll", "noreply", "all"]) {
      expect(() => normaliseHandle(reserved), reserved).toThrow(/reserved/i);
    }
  });

  it("counts the intern prefix towards the length limit", () => {
    // 63 is the effective ceiling. A 60-character handle is fine for somebody
    // permanent and four characters too long once "cvi-" is added, and the
    // intern must be told now rather than at provisioning time.
    const sixty = "a".repeat(60);
    expect(() => normaliseHandle(sixty, "permanent")).not.toThrow();
    expect(() => normaliseHandle(sixty, "intern")).toThrow(/too long/i);
  });
});

describe("recognising an intern address", () => {
  it("matches only the real prefix", () => {
    expect(isInternAddress(`cvi-rahul@${COMPANY_MAIL_DOMAIN}`)).toBe(true);
    expect(isInternAddress(`rahul@${COMPANY_MAIL_DOMAIN}`)).toBe(false);
    // No hyphen: a different person, not an intern.
    expect(isInternAddress(`cvirahul@${COMPANY_MAIL_DOMAIN}`)).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isInternAddress(`CVI-Rahul@${COMPANY_MAIL_DOMAIN.toUpperCase()}`)).toBe(true);
  });
});

describe("becoming permanent", () => {
  it("drops the prefix and keeps everything else", () => {
    expect(permanentAddressFor(`cvi-rahul@${COMPANY_MAIL_DOMAIN}`)).toBe(`rahul@${COMPANY_MAIL_DOMAIN}`);
    expect(permanentAddressFor(`cvi-rahul.kumar@${COMPANY_MAIL_DOMAIN}`)).toBe(
      `rahul.kumar@${COMPANY_MAIL_DOMAIN}`
    );
  });

  it("drops only the first prefix", () => {
    // Guarded against at input, but if one ever reached the database, removing
    // both would hand somebody an address they never chose.
    expect(permanentAddressFor(`cvi-cvi-rahul@${COMPANY_MAIL_DOMAIN}`)).toBe(
      `cvi-rahul@${COMPANY_MAIL_DOMAIN}`
    );
  });

  it("reports no change for somebody already permanent", () => {
    // The ordinary case: conversion does not know in advance how the person
    // was hired, so "nothing to do" must be an outcome, not an error.
    expect(permanentAddressFor(`rahul@${COMPANY_MAIL_DOMAIN}`)).toBeNull();
  });

  it("leaves other domains alone", () => {
    expect(permanentAddressFor("cvi-rahul@example.com")).toBeNull();
  });

  it("refuses to invent a handle from a bare prefix", () => {
    // "cvi-@" has no handle underneath it; moving them would mean choosing an
    // address on their behalf.
    expect(permanentAddressFor(`${INTERN_ADDRESS_PREFIX}@${COMPANY_MAIL_DOMAIN}`)).toBeNull();
  });

  it("survives malformed input rather than throwing", () => {
    for (const bad of ["", "   ", "no-at-sign", "@nolocal.com", null as never, undefined as never]) {
      expect(() => permanentAddressFor(bad)).not.toThrow();
      expect(permanentAddressFor(bad)).toBeNull();
    }
  });
});

describe("the conversion plan", () => {
  it("keeps the old address delivering", () => {
    // Mail sent to the old address afterwards is ordinary correspondence from
    // people who have not heard, not a mistake to bounce.
    const plan = planMailConversion(`cvi-rahul@${COMPANY_MAIL_DOMAIN}`);
    expect(plan).toEqual({
      from: `cvi-rahul@${COMPANY_MAIL_DOMAIN}`,
      to: `rahul@${COMPANY_MAIL_DOMAIN}`,
      aliasOldAddress: true,
    });
  });

  it("is null when there is nothing to do", () => {
    expect(planMailConversion(`rahul@${COMPANY_MAIL_DOMAIN}`)).toBeNull();
  });

  it("round-trips: an intern address converts back to the handle they chose", () => {
    const handle = "priya.sharma";
    const intern = addressFor(handle, "intern");
    expect(permanentAddressFor(intern)).toBe(addressFor(handle, "permanent"));
  });
});

describe("address parsing helpers", () => {
  it("splits on the last @", () => {
    expect(localPartOf("a@b@circuvent.com")).toBe("a@b");
    expect(domainOf("a@b@circuvent.com")).toBe("circuvent.com");
  });

  it("returns empty rather than throwing on nonsense", () => {
    expect(localPartOf("")).toBe("");
    expect(localPartOf("@x.com")).toBe("");
    expect(domainOf("no-at")).toBe("");
  });
});
