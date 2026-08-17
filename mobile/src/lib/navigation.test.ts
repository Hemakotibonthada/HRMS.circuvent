import { describe, expect, it } from "vitest";
import {
  activeSegment,
  destinationFor,
  isTabRoot,
  TAB_DESTINATIONS,
} from "./navigation";

describe("TAB_DESTINATIONS", () => {
  it("holds five destinations, which is the quality bar's ceiling", () => {
    expect(TAB_DESTINATIONS).toHaveLength(5);
  });

  it("gives every destination a visible label", () => {
    // An icon-only tab is a guess, and the guess is made worst by the people
    // who open the app least often.
    for (const destination of TAB_DESTINATIONS) {
      expect(destination.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate routes or segments", () => {
    const hrefs = new Set(TAB_DESTINATIONS.map((d) => d.href));
    const segments = new Set(TAB_DESTINATIONS.map((d) => d.segment));
    expect(hrefs.size).toBe(TAB_DESTINATIONS.length);
    expect(segments.size).toBe(TAB_DESTINATIONS.length);
  });

  it("keeps each segment consistent with its route", () => {
    // The selected state is derived from the path, so a segment that does not
    // match its own href would leave a tab that never highlights itself.
    for (const destination of TAB_DESTINATIONS) {
      const expected = destination.href === "/" ? "" : destination.href.slice(1);
      expect(destination.segment).toBe(expected);
    }
  });
});

describe("isTabRoot", () => {
  it("is true for every tab destination", () => {
    for (const destination of TAB_DESTINATIONS) {
      expect(isTabRoot(destination.href)).toBe(true);
    }
  });

  it("is true for the root", () => {
    expect(isTabRoot("/")).toBe(true);
    expect(isTabRoot("")).toBe(true);
  });

  it("is false on a pushed detail screen", () => {
    // A bar under a half-finished form is an invitation to leave it.
    expect(isTabRoot("/leave/apply")).toBe(false);
    expect(isTabRoot("/leave/abc-123")).toBe(false);
    expect(isTabRoot("/payslips/abc-123")).toBe(false);
  });

  it("is false on a screen that is not a tab", () => {
    expect(isTabRoot("/settings")).toBe(false);
    expect(isTabRoot("/approvals")).toBe(false);
    expect(isTabRoot("/attendance")).toBe(false);
  });

  it("is false on sign-in", () => {
    // Navigation offered to somebody who has none.
    expect(isTabRoot("/sign-in")).toBe(false);
  });

  it("tolerates a trailing slash", () => {
    expect(isTabRoot("/leave/")).toBe(true);
    expect(isTabRoot("/profile/")).toBe(true);
  });
});

describe("activeSegment", () => {
  it("names the current tab", () => {
    expect(activeSegment("/")).toBe("");
    expect(activeSegment("/leave")).toBe("leave");
    expect(activeSegment("/payslips")).toBe("payslips");
  });

  it("keeps the parent tab selected on a pushed child", () => {
    expect(activeSegment("/leave/apply")).toBe("leave");
    expect(activeSegment("/payslips/abc-123")).toBe("payslips");
  });

  it("selects nothing rather than the wrong thing on an unrelated screen", () => {
    // "" is Today, so this deliberately does *not* mark a tab as current for
    // a screen that is not one — settings is reached from Profile, and
    // highlighting Today while sitting in settings is a lie about where you are.
    expect(activeSegment("/settings")).toBe("");
    expect(activeSegment("/sign-in")).toBe("");
  });
});

describe("destinationFor", () => {
  it("finds the destination for each root", () => {
    expect(destinationFor("/")?.label).toBe("Today");
    expect(destinationFor("/shifts")?.label).toBe("Shifts");
  });

  it("finds nothing for a pushed screen", () => {
    expect(destinationFor("/leave/apply")).toBeUndefined();
    expect(destinationFor("/settings")).toBeUndefined();
  });
});
