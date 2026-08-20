import { describe, expect, it } from "vitest";
import { checkHireProvenance, provenanceAuditNote, type HireProvenance } from "@/lib/hire-provenance";

/**
 * The ATS handoff already refuses to create an employee without an accepted
 * offer, and stamps candidate_id/application_id when it does. `POST
 * /api/employees` — the dialog HR uses daily — did none of that: it created a
 * row with both link columns NULL from a typed name and address.
 *
 * So the pipeline was enforced on the path nobody uses by hand, and unenforced
 * on the one everybody does.
 */

function hired(overrides: Partial<HireProvenance> = {}): HireProvenance {
  return {
    candidateId: "cand-1",
    applicationId: "app-1",
    offerStatus: "accepted",
    registrationSubmittedAt: new Date("2026-08-01T00:00:00Z"),
    ...overrides,
  };
}

describe("a real hire", () => {
  it("is allowed", () => {
    const decision = checkHireProvenance(hired());
    expect(decision.ok).toBe(true);
    expect(decision.overridden).toBe(false);
    expect(decision.issues).toEqual([]);
  });

  it("is allowed with the joining form recorded as a string timestamp", () => {
    // The column comes back as a string on some drivers; a hire must not be
    // refused over its representation.
    expect(checkHireProvenance(hired({ registrationSubmittedAt: "2026-08-01" })).ok).toBe(true);
  });
});

describe("refusing an employee with nothing behind them", () => {
  it("refuses one conjured from a name and address", () => {
    const decision = checkHireProvenance({
      candidateId: null,
      applicationId: null,
      offerStatus: null,
      registrationSubmittedAt: null,
    });

    expect(decision.ok).toBe(false);
    expect(decision.issues.map((i) => i.field).sort()).toEqual([
      "candidateId",
      "offerStatus",
      "registrationSubmittedAt",
    ]);
  });

  it("reports every problem at once rather than the first", () => {
    // Same reason validateEmployeeFields collects issues: a form that reveals
    // one problem per submission takes three round trips to fix.
    const decision = checkHireProvenance({
      candidateId: null,
      applicationId: null,
      offerStatus: "sent",
      registrationSubmittedAt: null,
    });
    expect(decision.issues.length).toBeGreaterThan(1);
  });

  it("refuses an offer that was made but not accepted", () => {
    for (const status of ["draft", "pending_approval", "approved", "sent", "declined", "expired", "withdrawn"]) {
      const decision = checkHireProvenance(hired({ offerStatus: status }));
      expect(decision.ok, status).toBe(false);
      expect(decision.issues.some((i) => i.field === "offerStatus"), status).toBe(true);
    }
  });

  it("names the offer's actual state so the reader knows what to fix", () => {
    const decision = checkHireProvenance(hired({ offerStatus: "declined" }));
    expect(decision.issues.find((i) => i.field === "offerStatus")?.message).toContain("declined");
  });

  it("says something different when there is no offer at all", () => {
    const decision = checkHireProvenance(hired({ offerStatus: null }));
    expect(decision.issues.find((i) => i.field === "offerStatus")?.message).toMatch(/no offer/i);
  });

  it("refuses when the joining form has not been submitted", () => {
    const decision = checkHireProvenance(hired({ registrationSubmittedAt: null }));
    expect(decision.ok).toBe(false);
    expect(decision.issues.some((i) => i.field === "registrationSubmittedAt")).toBe(true);
  });

  it("can be configured to accept paperwork after joining", () => {
    // The softer of the two checks: an unaccepted offer means this is not a
    // hire, whereas an unsubmitted form means the paperwork is behind.
    const decision = checkHireProvenance(hired({ registrationSubmittedAt: null }), {
      requireSubmittedRegistration: false,
    });
    expect(decision.ok).toBe(true);
  });
});

describe("the documented exception", () => {
  it("allows a founder, a transfer or a correction when justified", () => {
    // Refusing outright would mean the first person to hit one edits the
    // database directly, which is worse than an audited exception.
    const decision = checkHireProvenance(
      { candidateId: null, applicationId: null, offerStatus: null, registrationSubmittedAt: null },
      { overrideReason: "Founder; predates the ATS by two years. Confirmed with the board." }
    );

    expect(decision.ok).toBe(true);
    expect(decision.overridden).toBe(true);
    expect(decision.overrideReason).toMatch(/^Founder/);
  });

  it("refuses a reason too short to have said anything", () => {
    const decision = checkHireProvenance(
      { candidateId: null, applicationId: null, offerStatus: null, registrationSubmittedAt: null },
      { overrideReason: "founder" }
    );

    expect(decision.ok).toBe(false);
    expect(decision.issues[0].field).toBe("overrideReason");
  });

  it("treats whitespace as no reason at all", () => {
    const decision = checkHireProvenance(
      { candidateId: null, applicationId: null, offerStatus: null, registrationSubmittedAt: null },
      { overrideReason: "                              " }
    );
    // Falls through to the ordinary checks rather than passing on padding.
    expect(decision.ok).toBe(false);
    expect(decision.issues.some((i) => i.field === "candidateId")).toBe(true);
  });

  it("trims the reason it records", () => {
    const decision = checkHireProvenance(
      { candidateId: null, applicationId: null, offerStatus: null, registrationSubmittedAt: null },
      { overrideReason: "   Acquisition of Northwind; staff arrived as a spreadsheet.   " }
    );
    expect(decision.overrideReason).toBe("Acquisition of Northwind; staff arrived as a spreadsheet.");
  });
});

describe("what the audit trail records", () => {
  it("records the candidate for an ordinary hire", () => {
    const p = hired();
    const note = provenanceAuditNote(checkHireProvenance(p), p);
    expect(note).toContain("cand-1");
    expect(note).toContain("app-1");
  });

  it("records the justification for an exception", () => {
    const p: HireProvenance = {
      candidateId: null,
      applicationId: null,
      offerStatus: null,
      registrationSubmittedAt: null,
    };
    const decision = checkHireProvenance(p, {
      overrideReason: "Record deleted in error on 12 August; recreating from the payroll file.",
    });
    const note = provenanceAuditNote(decision, p);
    expect(note).toMatch(/without a hire record/i);
    expect(note).toContain("deleted in error");
  });
});
