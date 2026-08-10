// ═══════════════════════════════════════════════════════════════
// GEOFENCE — location validation for attendance
// ═══════════════════════════════════════════════════════════════
// Pure, so it tests without a device. Shared by the mobile app and the server:
// the phone checks so it can tell the user *before* they try, and the server
// checks because a phone is an untrusted client.
//
// The thing to understand about this module is that it is adversarial. Clock-in
// location decides pay. There are published apps whose only purpose is to feed
// a fake location to attendance software, and they work by setting the mock
// provider flag that Android exposes and iOS does not. So:
//
//   - Accuracy is treated as a radius, not a decoration. A fix accurate to
//     500 m "inside" a 100 m fence tells you nothing.
//   - A suspiciously perfect fix is more concerning than a rough one. Real GPS
//     is never accurate to 1 m outdoors on a phone.
//   - Implausible movement between two fixes is flagged, because that is what
//     a spoofed jump looks like and a genuine one cannot.
//
// None of these are certainties. They are reasons for a human to look, which
// is why the result carries a reason string rather than a verdict.

export interface Coordinates {
  latitude: number;
  longitude: number;
  /** Reported accuracy radius in metres. */
  accuracyMetres?: number;
  /** Epoch milliseconds. */
  capturedAt?: number;
  /** Android exposes this; iOS does not, so absence proves nothing. */
  isMocked?: boolean;
}

export interface Geofence {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMetres: number;
}

const EARTH_RADIUS_METRES = 6_371_008.8;

/**
 * Great-circle distance between two points, in metres.
 *
 * Haversine rather than the equirectangular approximation: the approximation
 * is faster and wrong by enough to matter at the edge of a 50 m office fence,
 * which is exactly where the answer is contested.
 */
export function distanceMetres(a: Coordinates, b: Coordinates): number {
  assertCoordinates(a);
  assertCoordinates(b);

  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const deltaLat = toRadians(b.latitude - a.latitude);
  const deltaLon = toRadians(b.longitude - a.longitude);

  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;

  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function assertCoordinates(point: Coordinates): void {
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) {
    throw new Error("Coordinates must be finite numbers");
  }
  if (point.latitude < -90 || point.latitude > 90) {
    throw new Error("Latitude must be between -90 and 90");
  }
  if (point.longitude < -180 || point.longitude > 180) {
    throw new Error("Longitude must be between -180 and 180");
  }
}

export type FenceConfidence = "inside" | "probably_inside" | "uncertain" | "outside";

export interface FenceResult {
  fence: Geofence | null;
  distanceMetres: number | null;
  confidence: FenceConfidence;
  /** Shown to the user, so it says what to do rather than what went wrong. */
  message: string;
}

/**
 * Which fence a position falls in, accounting for accuracy.
 *
 * Accuracy is a radius of uncertainty, so there are three cases, not two:
 * definitely inside, definitely outside, and a fix too imprecise to say. The
 * third is common indoors and near tall buildings, and collapsing it into
 * either of the others is how an office worker gets marked absent for standing
 * next to a window.
 */
export function locateWithin(
  position: Coordinates,
  fences: Geofence[],
  options: { maxAccuracyMetres?: number } = {}
): FenceResult {
  if (fences.length === 0) {
    return {
      fence: null,
      distanceMetres: null,
      confidence: "uncertain",
      message: "No work locations are configured",
    };
  }

  const accuracy = position.accuracyMetres ?? 0;
  const maxAccuracy = options.maxAccuracyMetres ?? 200;

  // A fix this rough cannot place someone inside anything smaller than a
  // postcode, and pretending otherwise is worse than asking them to move.
  if (accuracy > maxAccuracy) {
    return {
      fence: null,
      distanceMetres: null,
      confidence: "uncertain",
      message: `Your location is only accurate to about ${Math.round(accuracy)} m. Step outside or near a window and try again.`,
    };
  }

  const ranked = fences
    .map((fence) => ({ fence, distance: distanceMetres(position, fence) }))
    .sort((a, b) => a.distance - b.distance);

  const nearest = ranked[0];

  // Unreachable — `fences.length === 0` returned above — but stated rather
  // than assumed. Under noUncheckedIndexedAccess an array index is possibly
  // undefined, and the alternative is a non-null assertion that would keep
  // being correct only for as long as the guard above stays where it is.
  if (!nearest) {
    return {
      fence: null,
      distanceMetres: null,
      confidence: "uncertain",
      message: "No work locations are configured",
    };
  }

  // Certainly inside: even the far edge of the uncertainty circle is within
  // the fence.
  if (nearest.distance + accuracy <= nearest.fence.radiusMetres) {
    return {
      fence: nearest.fence,
      distanceMetres: Math.round(nearest.distance),
      confidence: "inside",
      message: `At ${nearest.fence.name}`,
    };
  }

  // Certainly outside: even the near edge is beyond the fence.
  if (nearest.distance - accuracy > nearest.fence.radiusMetres) {
    return {
      fence: null,
      distanceMetres: Math.round(nearest.distance),
      confidence: "outside",
      message: `You are about ${formatDistance(nearest.distance - nearest.fence.radiusMetres)} from ${nearest.fence.name}`,
    };
  }

  // The circle straddles the boundary. The centre reading decides which way to
  // lean, but the caller is told it is a lean.
  return {
    fence: nearest.distance <= nearest.fence.radiusMetres ? nearest.fence : null,
    distanceMetres: Math.round(nearest.distance),
    confidence: nearest.distance <= nearest.fence.radiusMetres ? "probably_inside" : "uncertain",
    message: `You seem to be at the edge of ${nearest.fence.name}. Move a little closer if this is refused.`,
  };
}

function formatDistance(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres)} m`;
}

// ─── Spoofing signals ────────────────────────────────────────

export interface SpoofSignal {
  code: "mock_provider" | "impossible_speed" | "implausible_accuracy" | "stale_fix";
  severity: "high" | "medium";
  detail: string;
}

/**
 * Reasons to distrust a position.
 *
 * Signals, not a verdict. Every one of these has an innocent explanation —
 * a developer with mock locations left on, a passenger on a train, a fix
 * cached while the app was backgrounded. The output is for a human reviewing
 * an exception report, and treating any of it as proof would deny someone
 * their pay on a heuristic.
 */
export function spoofSignals(
  position: Coordinates,
  previous?: Coordinates,
  now = Date.now()
): SpoofSignal[] {
  const signals: SpoofSignal[] = [];

  if (position.isMocked) {
    // The only signal the operating system asserts rather than something we
    // inferred, so it is the only high-severity one on its own.
    signals.push({
      code: "mock_provider",
      severity: "high",
      detail: "The device reported this location came from a mock provider",
    });
  }

  if (position.accuracyMetres !== undefined && position.accuracyMetres > 0 && position.accuracyMetres < 3) {
    // Consumer GPS does not achieve sub-3 m outdoors. A fabricated fix often
    // reports an implausibly confident accuracy because the faker picked a
    // number that sounded good.
    signals.push({
      code: "implausible_accuracy",
      severity: "medium",
      detail: `Reported accuracy of ${position.accuracyMetres} m is better than consumer GPS achieves`,
    });
  }

  if (position.capturedAt !== undefined) {
    const ageMs = now - position.capturedAt;
    // Five minutes. A fix older than that was taken somewhere the user may no
    // longer be.
    if (ageMs > 5 * 60_000) {
      signals.push({
        code: "stale_fix",
        severity: "medium",
        detail: `This location was captured ${Math.round(ageMs / 60_000)} minutes ago`,
      });
    }
  }

  // Compared against undefined rather than tested for truthiness: a timestamp
  // of 0 is a real value, and `if (previous?.capturedAt)` skips the whole
  // check for it. The same shape of bug as treating Number("") as absent.
  if (previous?.capturedAt !== undefined && position.capturedAt !== undefined) {
    const seconds = (position.capturedAt - previous.capturedAt) / 1000;

    if (seconds > 0) {
      const metres = distanceMetres(previous, position);
      const kmh = (metres / seconds) * 3.6;

      // 900 km/h is airliner cruise. Below that, "impossible" would flag
      // anyone on a flight, and people do clock in from airports.
      if (kmh > 900) {
        signals.push({
          code: "impossible_speed",
          severity: "high",
          detail: `${Math.round(metres)} m in ${Math.round(seconds)} s implies ${Math.round(kmh)} km/h`,
        });
      }
    }
  }

  return signals;
}

export interface ClockInVerdict {
  allowed: boolean;
  requiresReview: boolean;
  fence: Geofence | null;
  confidence: FenceConfidence;
  signals: SpoofSignal[];
  message: string;
}

/**
 * Whether a clock-in should be accepted.
 *
 * `requiresReview` rather than a refusal on a spoofing signal. Someone whose
 * phone reports a mock provider because a developer tool is installed still
 * turned up for work, and refusing them costs a day's pay on a guess. Flagging
 * it puts the decision in front of a person who can ask.
 *
 * An uncertain fix is allowed and flagged for the same reason: indoor GPS is
 * genuinely poor, and the alternative is that everyone in the middle of a
 * building is marked absent.
 */
export function evaluateClockIn(
  position: Coordinates,
  fences: Geofence[],
  options: {
    previous?: Coordinates;
    now?: number;
    maxAccuracyMetres?: number;
    /** Allows clocking in from anywhere, for field and remote staff. */
    allowAnywhere?: boolean;
  } = {}
): ClockInVerdict {
  const signals = spoofSignals(position, options.previous, options.now);

  if (options.allowAnywhere) {
    return {
      allowed: true,
      requiresReview: signals.some((s) => s.severity === "high"),
      fence: null,
      confidence: "inside",
      signals,
      message: "Clocked in",
    };
  }

  const located = locateWithin(position, fences, {
    maxAccuracyMetres: options.maxAccuracyMetres,
  });

  if (located.confidence === "outside") {
    return {
      allowed: false,
      requiresReview: false,
      fence: null,
      confidence: "outside",
      signals,
      message: located.message,
    };
  }

  return {
    allowed: true,
    requiresReview:
      signals.some((s) => s.severity === "high") ||
      located.confidence !== "inside",
    fence: located.fence,
    confidence: located.confidence,
    signals,
    message: located.message,
  };
}
