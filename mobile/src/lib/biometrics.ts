// ═══════════════════════════════════════════════════════════════
// BIOMETRIC UNLOCK
// ═══════════════════════════════════════════════════════════════
// Face ID / Touch ID / fingerprint as a lock on an *existing* session, not as
// a way of signing in.
//
// That distinction is the whole design. A biometric check proves the person
// holding the phone is the person who enrolled — it does not prove anything to
// the server, which has never seen the fingerprint and cannot. So this gates
// access to a session that already exists locally; the credential that
// actually authenticates is the refresh token in the keystore.
//
// Treating a local biometric as authentication is a real and common mistake:
// it makes the phone the authority, which means anyone who can bypass the
// prompt — and on a rooted device that is a solved problem — gets in.
//
// Off by default. Enrolling someone's face in an HR app without asking is not
// a decision to make on their behalf.

import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

const ENABLED_KEY = "circuvent.hrms.biometric_enabled";

export type BiometricSupport =
  | { available: true; kind: "face" | "fingerprint" | "iris" | "unknown" }
  | { available: false; reason: "no_hardware" | "not_enrolled" };

export async function checkSupport(): Promise<BiometricSupport> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  if (!hasHardware) return { available: false, reason: "no_hardware" };

  // Hardware present but nothing enrolled is a different problem with a
  // different fix, and telling someone "not supported" when they simply have
  // not set up Face ID sends them looking in the wrong place.
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  if (!enrolled) return { available: false, reason: "not_enrolled" };

  const types = await LocalAuthentication.supportedAuthenticationTypesAsync();

  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
    return { available: true, kind: "face" };
  }
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
    return { available: true, kind: "fingerprint" };
  }
  if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
    return { available: true, kind: "iris" };
  }
  return { available: true, kind: "unknown" };
}

export async function isEnabled(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(ENABLED_KEY)) === "true";
  } catch {
    // A keystore read failure must not lock someone out of their own app.
    // Failing open here is safe: the session token is still required, and
    // this only ever gates a session that already exists.
    return false;
  }
}

export async function setEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(ENABLED_KEY, enabled ? "true" : "false");
}

export type UnlockResult = "unlocked" | "failed" | "cancelled" | "unavailable";

/**
 * Prompts for the biometric.
 *
 * `disableDeviceFallback` is false, so the device passcode is offered when the
 * biometric fails. Without a fallback, a cut finger or a mask locks someone
 * out of clocking in entirely, and the passcode is not a weaker credential —
 * it is the thing protecting the keystore the session lives in.
 */
export async function unlock(reason = "Unlock Circuvent HR"): Promise<UnlockResult> {
  const support = await checkSupport();
  if (!support.available) return "unavailable";

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    cancelLabel: "Use password",
    disableDeviceFallback: false,
  });

  if (result.success) return "unlocked";

  // A deliberate cancel and a failed match are different: one is the user
  // choosing another route, the other may be someone else holding the phone.
  // Only the first should quietly return to the sign-in screen.
  const error = "error" in result ? result.error : undefined;
  if (error === "user_cancel" || error === "system_cancel" || error === "app_cancel") {
    return "cancelled";
  }
  return "failed";
}
