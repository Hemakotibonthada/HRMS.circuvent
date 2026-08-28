// ═══════════════════════════════════════════════════════════════
// LOCATION
// ═══════════════════════════════════════════════════════════════
// Wraps expo-location so screens deal with one shape and never with the
// three-way permission dance.
//
// Foreground only. `getForegroundPermissionsAsync`, never background, and
// background location is blocked outright in app.json. An HR app that can
// follow someone home is a surveillance tool, and the only credible promise
// that it does not is one the OS enforces.

import * as Location from "expo-location";
import type { Coordinates } from "./contracts";

export type LocationOutcome =
  | { ok: true; position: Coordinates }
  | { ok: false; reason: "denied" | "denied_forever" | "disabled" | "unavailable"; message: string };

/**
 * Reads the current position, asking for permission if it has not been
 * decided yet.
 *
 * The distinction between "denied" and "denied for ever" matters: the first is
 * fixed by asking again, the second only in Settings, and prompting someone
 * who has permanently denied does nothing at all — the OS returns denied
 * without showing a dialog, so the app appears to hang on a button.
 */
export async function readPosition(): Promise<LocationOutcome> {
  const servicesEnabled = await Location.hasServicesEnabledAsync();
  if (!servicesEnabled) {
    return {
      ok: false,
      reason: "disabled",
      message: "Location services are turned off on this device. Turn them on to clock in.",
    };
  }

  const existing = await Location.getForegroundPermissionsAsync();
  let granted = existing.granted;

  if (!granted) {
    if (!existing.canAskAgain) {
      return {
        ok: false,
        reason: "denied_forever",
        message:
          "Location permission is turned off for Circuvent HR. Open Settings to allow it, then try again.",
      };
    }
    const requested = await Location.requestForegroundPermissionsAsync();
    granted = requested.granted;
    if (!granted) {
      return {
        ok: false,
        reason: requested.canAskAgain ? "denied" : "denied_forever",
        message: "Circuvent HR needs your location to confirm you are at work when you clock in.",
      };
    }
  }

  try {
    const fix = await Location.getCurrentPositionAsync({
      // Balanced, not Highest. `Highest` engages the GPS chip and can take
      // 20-30 seconds indoors while someone stands in a doorway waiting;
      // balanced resolves in about a second and the geofence logic already
      // treats the accuracy figure as an uncertainty radius rather than
      // pretending the reading is exact.
      accuracy: Location.Accuracy.Balanced,
    });

    return {
      ok: true,
      position: {
        latitude: fix.coords.latitude,
        longitude: fix.coords.longitude,
        accuracyMetres: fix.coords.accuracy ?? undefined,
        capturedAt: fix.timestamp,
        // Android only. Absent on iOS, which is why the server treats its
        // absence as no evidence either way rather than as proof of honesty.
        isMocked: fix.mocked ?? undefined,
      },
    };
  } catch {
    return {
      ok: false,
      reason: "unavailable",
      message: "Could not get your location. Move somewhere with a clearer view of the sky.",
    };
  }
}
