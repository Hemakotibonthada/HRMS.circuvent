// @vitest-environment node
//
// Clock-in location decides pay, and there are published apps whose only
// purpose is to feed a fake location to attendance software. These tests pin
// both halves of that: the spoofing signals that should be raised, and the
// innocent cases that must not cost someone a day's wages.

import { describe, expect, it } from "vitest";
import {
  distanceMetres,
  evaluateClockIn,
  locateWithin,
  spoofSignals,
  type Coordinates,
  type Geofence,
} from "@/lib/mobile/geofence";

/** Circuvent's Bangalore office, near Koramangala. */
const office: Geofence = {
  id: "blr",
  name: "Bangalore office",
  latitude: 12.9352,
  longitude: 77.6245,
  radiusMetres: 100,
};

const chennai: Geofence = {
  id: "maa",
  name: "Chennai office",
  latitude: 13.0827,
  longitude: 80.2707,
  radiusMetres: 100,
};

function at(over: Partial<Coordinates> = {}): Coordinates {
  return { latitude: office.latitude, longitude: office.longitude, ...over };
}

describe("distanceMetres", () => {
  it("is zero for the same point", () => {
    expect(distanceMetres(at(), at())).toBeCloseTo(0, 5);
  });

  it("measures a short distance accurately", () => {
    // 0.001 degrees of latitude is about 111 m anywhere on Earth.
    const north = at({ latitude: office.latitude + 0.001 });
    expect(distanceMetres(at(), north)).toBeGreaterThan(105);
    expect(distanceMetres(at(), north)).toBeLessThan(115);
  });

  it("measures a long distance accurately", () => {
    // Bangalore to Chennai is roughly 290 km.
    const km = distanceMetres(at(), chennai) / 1000;
    expect(km).toBeGreaterThan(280);
    expect(km).toBeLessThan(300);
  });

  it("is symmetric", () => {
    expect(distanceMetres(at(), chennai)).toBeCloseTo(distanceMetres(chennai, at()), 5);
  });

  it("handles the antimeridian without going the long way round", () => {
    const west = { latitude: 0, longitude: 179.9 };
    const east = { latitude: 0, longitude: -179.9 };
    // About 22 km apart, not most of the way round the planet.
    expect(distanceMetres(west, east) / 1000).toBeLessThan(30);
  });

  it("rejects impossible coordinates rather than returning NaN", () => {
    expect(() => distanceMetres(at({ latitude: 95 }), at())).toThrow(/between -90 and 90/);
    expect(() => distanceMetres(at({ longitude: 200 }), at())).toThrow(/between -180 and 180/);
    expect(() => distanceMetres(at({ latitude: NaN }), at())).toThrow(/finite/);
  });
});

describe("locateWithin", () => {
  it("places a precise fix inside the fence", () => {
    const result = locateWithin(at({ accuracyMetres: 5 }), [office]);
    expect(result.confidence).toBe("inside");
    expect(result.fence?.id).toBe("blr");
  });

  it("places a distant fix outside", () => {
    const result = locateWithin({ ...chennai, accuracyMetres: 5 }, [office]);
    expect(result.confidence).toBe("outside");
    expect(result.fence).toBeNull();
  });

  it("treats accuracy as a radius, not a decoration", () => {
    // Dead centre, but a fix accurate only to 500 m says nothing about a 100 m
    // fence.
    const result = locateWithin(at({ accuracyMetres: 500 }), [office]);
    expect(result.confidence).toBe("uncertain");
    expect(result.message).toMatch(/accurate to about 500 m/);
  });

  it("reports uncertainty when the error circle straddles the boundary", () => {
    // Indoors and near tall buildings this is the common case, and collapsing
    // it either way marks an office worker absent for standing by a window.
    const nearEdge = at({ latitude: office.latitude + 0.0009, accuracyMetres: 60 });
    const result = locateWithin(nearEdge, [office]);
    expect(["probably_inside", "uncertain"]).toContain(result.confidence);
  });

  it("requires the whole error circle inside before saying so with certainty", () => {
    const nearEdge = at({ latitude: office.latitude + 0.0007, accuracyMetres: 40 });
    const result = locateWithin(nearEdge, [office]);
    expect(result.confidence).not.toBe("inside");
  });

  it("picks the nearest of several fences", () => {
    const result = locateWithin(at({ accuracyMetres: 5 }), [chennai, office]);
    expect(result.fence?.id).toBe("blr");
  });

  it("says so when no fences are configured", () => {
    const result = locateWithin(at(), []);
    expect(result.confidence).toBe("uncertain");
    expect(result.message).toMatch(/No work locations/);
  });

  it("reports how far outside, in readable units", () => {
    const result = locateWithin({ ...chennai, accuracyMetres: 5 }, [office]);
    expect(result.message).toMatch(/km from Bangalore office/);
  });

  it("honours a custom accuracy ceiling", () => {
    const result = locateWithin(at({ accuracyMetres: 150 }), [office], {
      maxAccuracyMetres: 100,
    });
    expect(result.confidence).toBe("uncertain");
  });
});

describe("spoofSignals", () => {
  it("raises nothing for an ordinary fix", () => {
    expect(spoofSignals(at({ accuracyMetres: 12, capturedAt: 1_000 }), undefined, 1_000)).toEqual(
      []
    );
  });

  it("raises a high-severity signal for a mock provider", () => {
    // The only signal the operating system asserts rather than something we
    // inferred.
    const signals = spoofSignals(at({ isMocked: true }));
    expect(signals[0]).toMatchObject({ code: "mock_provider", severity: "high" });
  });

  it("flags implausibly perfect accuracy", () => {
    // Consumer GPS does not achieve sub-3 m; a faker often picks a number that
    // sounded good.
    const signals = spoofSignals(at({ accuracyMetres: 1 }));
    expect(signals.map((s) => s.code)).toContain("implausible_accuracy");
  });

  it("does not flag ordinary good accuracy", () => {
    expect(spoofSignals(at({ accuracyMetres: 5 })).map((s) => s.code)).not.toContain(
      "implausible_accuracy"
    );
  });

  it("flags a stale fix", () => {
    const signals = spoofSignals(at({ capturedAt: 0 }), undefined, 10 * 60_000);
    expect(signals.map((s) => s.code)).toContain("stale_fix");
  });

  it("does not flag a fresh fix", () => {
    const signals = spoofSignals(at({ capturedAt: 0 }), undefined, 60_000);
    expect(signals.map((s) => s.code)).not.toContain("stale_fix");
  });

  it("flags movement no vehicle could make", () => {
    // Bangalore to Chennai in one minute.
    const previous = at({ capturedAt: 0 });
    const now = { ...chennai, capturedAt: 60_000 };
    const signals = spoofSignals(now, previous, 60_000);

    expect(signals.map((s) => s.code)).toContain("impossible_speed");
  });

  it("checks speed even when the earlier timestamp is zero", () => {
    // A timestamp of 0 is a real value. Guarding with `if (previous.capturedAt)`
    // skips the whole check for it — the same shape of bug as treating
    // Number("") as absent, and the case above happens to exercise it.
    const previous = at({ capturedAt: 0 });
    const jump = { ...chennai, capturedAt: 1_000 };

    expect(spoofSignals(jump, previous, 1_000).map((s) => s.code)).toContain(
      "impossible_speed"
    );
  });

  it("does not flag air travel, because people clock in from airports", () => {
    // 290 km in an hour is about 290 km/h — fast, but a train manages it and a
    // plane far exceeds it. The threshold sits above airliner cruise.
    const previous = at({ capturedAt: 0 });
    const now = { ...chennai, capturedAt: 3_600_000 };

    expect(spoofSignals(now, previous, 3_600_000).map((s) => s.code)).not.toContain(
      "impossible_speed"
    );
  });

  it("does not divide by zero on two fixes at the same instant", () => {
    const previous = at({ capturedAt: 1_000 });
    expect(() => spoofSignals({ ...chennai, capturedAt: 1_000 }, previous)).not.toThrow();
  });

  it("raises several signals at once", () => {
    const signals = spoofSignals(at({ isMocked: true, accuracyMetres: 1, capturedAt: 0 }), undefined, 600_000);
    expect(signals.length).toBeGreaterThanOrEqual(3);
  });
});

describe("evaluateClockIn", () => {
  it("accepts someone at the office", () => {
    const verdict = evaluateClockIn(at({ accuracyMetres: 8 }), [office]);
    expect(verdict.allowed).toBe(true);
    expect(verdict.requiresReview).toBe(false);
  });

  it("refuses someone plainly elsewhere", () => {
    const verdict = evaluateClockIn({ ...chennai, accuracyMetres: 8 }, [office]);
    expect(verdict.allowed).toBe(false);
  });

  it("accepts but flags a mock provider rather than refusing", () => {
    // Someone whose phone reports a mock provider because a developer tool is
    // installed still turned up for work. Refusing costs a day's pay on a
    // guess; flagging puts it in front of a person who can ask.
    const verdict = evaluateClockIn(at({ accuracyMetres: 8, isMocked: true }), [office]);
    expect(verdict.allowed).toBe(true);
    expect(verdict.requiresReview).toBe(true);
    expect(verdict.signals.map((s) => s.code)).toContain("mock_provider");
  });

  it("accepts but flags an uncertain fix", () => {
    // Indoor GPS is genuinely poor, and the alternative is marking everyone in
    // the middle of a building absent.
    const verdict = evaluateClockIn(at({ accuracyMetres: 400 }), [office]);
    expect(verdict.allowed).toBe(true);
    expect(verdict.requiresReview).toBe(true);
    expect(verdict.confidence).toBe("uncertain");
  });

  it("allows field staff anywhere", () => {
    const verdict = evaluateClockIn({ ...chennai, accuracyMetres: 8 }, [office], {
      allowAnywhere: true,
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.requiresReview).toBe(false);
  });

  it("still flags a mock provider for field staff", () => {
    const verdict = evaluateClockIn({ ...chennai, isMocked: true }, [office], {
      allowAnywhere: true,
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.requiresReview).toBe(true);
  });

  it("refuses on distance before considering spoofing", () => {
    // Somebody plainly in another city does not need a review; they need a no.
    const verdict = evaluateClockIn(
      { ...chennai, accuracyMetres: 8, isMocked: true },
      [office]
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.requiresReview).toBe(false);
  });

  it("returns a message written for the person, not the log", () => {
    const verdict = evaluateClockIn({ ...chennai, accuracyMetres: 8 }, [office]);
    expect(verdict.message).toMatch(/from Bangalore office/);
  });
});
