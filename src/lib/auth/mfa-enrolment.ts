// ═══════════════════════════════════════════════════════════════
// MFA ENROLMENT STATE
// ═══════════════════════════════════════════════════════════════
// Two columns encode three states, and the difference between two of them is
// a lockout. Pulled out of the route handlers so the rule is stated once and
// can be tested without a database.
//
//   off      no secret                        → nothing to enforce
//   pending  secret, but never confirmed      → NOT enforced at sign-in
//   active   secret, confirmed                → enforced
//
// The pending state exists because a secret is created the moment someone is
// shown a QR code, which is well before they have proved they can read it.
// Enforcing from that instant locks out anyone whose camera failed, whose
// clock is skewed, or who simply closed the tab — and the only way back is an
// administrator disabling MFA out of band, which is its own attack path.

export type MfaState = "off" | "pending" | "active";

/**
 * The state implied by the two stored columns.
 *
 * `enabledAt` without a secret is treated as `off` rather than trusted: it is
 * an impossible row, and the safe reading of an impossible row is the one that
 * does not lock anybody out of an authenticator that does not exist.
 */
export function mfaState(
  secret: string | null | undefined,
  enabledAt: Date | string | null | undefined
): MfaState {
  if (!secret) return "off";
  return enabledAt ? "active" : "pending";
}

/**
 * Whether sign-in must demand a second factor.
 *
 * This is the security-critical one. Keying it off the secret alone — which is
 * what the code did before enrolment existed — enforces MFA on every pending
 * enrolment.
 */
export function mfaRequiredAtSignIn(
  secret: string | null | undefined,
  enabledAt: Date | string | null | undefined
): boolean {
  return mfaState(secret, enabledAt) === "active";
}

/**
 * Whether enrolment may begin.
 *
 * Refused while active: overwriting the secret would silently invalidate the
 * authenticator the user still depends on, and a failure partway through
 * leaves them with neither. Restarting a pending enrolment is fine — nothing
 * depends on that secret yet.
 */
export function canBeginEnrolment(state: MfaState): boolean {
  return state !== "active";
}

/** Only a pending enrolment can be confirmed. */
export function canConfirmEnrolment(state: MfaState): boolean {
  return state === "pending";
}

/**
 * Whether MFA can be turned off.
 *
 * A pending enrolment counts, so an abandoned one can be cleared away rather
 * than lingering as a secret nobody holds.
 */
export function canDisable(state: MfaState): boolean {
  return state !== "off";
}
