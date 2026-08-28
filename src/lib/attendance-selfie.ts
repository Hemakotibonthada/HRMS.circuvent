/**
 * Rules for photographing somebody at the moment they clock in.
 *
 * Kept as pure functions with no database and no storage, because the
 * decisions here are the ones worth being able to read and test in isolation:
 * whether a photograph is required at all, whether one that arrived is
 * acceptable, and when it has to be deleted.
 *
 * The default is off. Not "off until configured" or "off in this environment"
 * — off, as the absence of a policy row, so that an organisation which has
 * never heard of this feature cannot be opted into photographing its staff by
 * a migration running or a default changing.
 */

/** What an organisation has decided. Absent means it has decided nothing. */
export interface AttendancePolicy {
  requireSelfieOnPunch: boolean;
  /** Days. Bounded 1..365 by the database, and re-checked here. */
  selfieRetentionDays: number;
}

export const DEFAULT_RETENTION_DAYS = 90;
export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 365;

/**
 * The largest image accepted, in bytes.
 *
 * A punch selfie is a face at arm's length. 2 MB is generous for that even
 * before compression, and the limit exists so a client cannot turn the punch
 * endpoint into arbitrary file storage by sending something else entirely.
 */
export const MAX_SELFIE_BYTES = 2 * 1024 * 1024;

/** Formats the app is willing to store. */
const ACCEPTED = new Map<string, string>([
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
]);

/**
 * Whether this punch has to carry a photograph.
 *
 * `null` policy is the common case and means no, deliberately: reading "no
 * policy" as "capture anyway" would be the worst possible failure direction
 * for a feature like this.
 */
export function selfieRequired(policy: AttendancePolicy | null | undefined): boolean {
  return policy?.requireSelfieOnPunch === true;
}

export type SelfieRejection =
  | { ok: false; reason: "not_required" }
  | { ok: false; reason: "missing" }
  | { ok: false; reason: "too_large"; limit: number }
  | { ok: false; reason: "unsupported_type"; accepted: string[] }
  | { ok: false; reason: "not_an_image" };

export type SelfieCheck = { ok: true; extension: string } | SelfieRejection;

/**
 * Checks a photograph that arrived with a punch.
 *
 * Refuses an image when none was asked for. Storing a face nobody required is
 * the same harm as storing one under a policy that was never switched on, and
 * a client that sends one is either misconfigured or malicious — neither is a
 * reason to keep the picture.
 *
 * The magic-byte check exists because a content type is whatever the sender
 * says it is. It does not make the file safe, but it does mean the thing in
 * the bucket is the kind of thing the column claims.
 */
export function checkSelfie(
  policy: AttendancePolicy | null | undefined,
  selfie: { bytes: Uint8Array; contentType: string } | null | undefined
): SelfieCheck {
  const required = selfieRequired(policy);

  if (!selfie) {
    return required ? { ok: false, reason: "missing" } : { ok: true, extension: "" };
  }
  if (!required) return { ok: false, reason: "not_required" };

  if (selfie.bytes.byteLength === 0) return { ok: false, reason: "missing" };
  if (selfie.bytes.byteLength > MAX_SELFIE_BYTES) {
    return { ok: false, reason: "too_large", limit: MAX_SELFIE_BYTES };
  }

  const extension = ACCEPTED.get(selfie.contentType.toLowerCase().trim());
  if (!extension) {
    return { ok: false, reason: "unsupported_type", accepted: [...ACCEPTED.keys()] };
  }
  if (!looksLikeImage(selfie.bytes, extension)) return { ok: false, reason: "not_an_image" };

  return { ok: true, extension };
}

/** JPEG starts FF D8 FF; WebP is "RIFF" .... "WEBP". */
function looksLikeImage(bytes: Uint8Array, extension: string): boolean {
  if (extension === "jpg") {
    return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (extension === "webp") {
    if (bytes.length < 12) return false;
    const ascii = (i: number) => String.fromCharCode(bytes[i]);
    return (
      ascii(0) + ascii(1) + ascii(2) + ascii(3) === "RIFF" &&
      ascii(8) + ascii(9) + ascii(10) + ascii(11) === "WEBP"
    );
  }
  return false;
}

/**
 * Where the image goes.
 *
 * Organisation first so that everything belonging to one tenant shares a
 * prefix — which is what makes "delete this customer" a prefix delete rather
 * than a search. The digest is in the name so the same photograph stored twice
 * is one object, and so a key cannot be guessed from a punch id alone.
 *
 * Keyed on a capture id rather than the attendance record's id, because the
 * image is stored *before* the punch is recorded. A punch that required a
 * photograph must never exist without one, and the only way to guarantee that
 * is to fail before writing the punch rather than after.
 */
export function selfieObjectKey(params: {
  orgId: string;
  captureId: string;
  direction: "in" | "out";
  sha256Hex: string;
  extension: string;
}): string {
  const { orgId, captureId, direction, sha256Hex, extension } = params;
  return `orgs/${orgId}/attendance-selfies/${captureId}/${direction}-${sha256Hex}.${extension}`;
}

/**
 * The moment a photograph stops being allowed to exist.
 *
 * Computed from when the photograph was taken, not from when the punch was
 * recorded. A queued offline punch can arrive days later, and retention that
 * started on arrival would quietly keep the image longer than the
 * organisation agreed to.
 */
export function selfieExpiresAt(takenAt: Date, retentionDays: number): Date {
  const days = clampRetention(retentionDays);
  return new Date(takenAt.getTime() + days * 24 * 60 * 60 * 1000);
}

export function selfieExpired(takenAt: Date, retentionDays: number, now: Date): boolean {
  return selfieExpiresAt(takenAt, retentionDays).getTime() <= now.getTime();
}

/**
 * Keeps retention inside the bounds the database enforces.
 *
 * A value outside them means something upstream is wrong, and the safe
 * direction is the shorter one: over-keeping faces is the harm, under-keeping
 * them costs an audit trail.
 */
export function clampRetention(days: number): number {
  if (!Number.isFinite(days)) return DEFAULT_RETENTION_DAYS;
  return Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, Math.floor(days)));
}

/**
 * What to tell somebody before the first photograph is taken.
 *
 * Returned from the server rather than written into the app, because the
 * retention period is per organisation and a notice quoting the wrong number
 * is worse than no notice: it is a specific false assurance.
 */
export function selfieNotice(policy: AttendancePolicy): string {
  const days = clampRetention(policy.selfieRetentionDays);
  const period = days === 1 ? "1 day" : `${days} days`;
  return (
    `Your employer records a photograph each time you clock in or out. ` +
    `It is stored with the punch, is visible to your HR and payroll team, and ` +
    `is deleted after ${period}.`
  );
}
