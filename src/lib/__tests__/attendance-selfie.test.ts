import { describe, expect, it } from "vitest";
import {
  DEFAULT_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  MAX_SELFIE_BYTES,
  MIN_RETENTION_DAYS,
  checkSelfie,
  clampRetention,
  selfieExpired,
  selfieExpiresAt,
  selfieNotice,
  selfieObjectKey,
  selfieRequired,
} from "@/lib/attendance-selfie";

const jpeg = (extra = 16) => {
  const bytes = new Uint8Array(3 + extra);
  bytes.set([0xff, 0xd8, 0xff]);
  return bytes;
};

const webp = () => {
  const bytes = new Uint8Array(16);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };
  write(0, "RIFF");
  write(8, "WEBP");
  return bytes;
};

const ON = { requireSelfieOnPunch: true, selfieRetentionDays: 90 };
const OFF = { requireSelfieOnPunch: false, selfieRetentionDays: 90 };

describe("whether a photograph is required", () => {
  it("is not required when no policy exists", () => {
    // The whole design rests on this: an organisation that has never heard of
    // the feature must not be photographing anybody.
    expect(selfieRequired(null)).toBe(false);
    expect(selfieRequired(undefined)).toBe(false);
  });

  it("is not required when a policy exists with it switched off", () => {
    expect(selfieRequired(OFF)).toBe(false);
  });

  it("is required only when explicitly switched on", () => {
    expect(selfieRequired(ON)).toBe(true);
  });
});

describe("checking a photograph that arrived", () => {
  it("accepts a punch with no photograph when none is required", () => {
    expect(checkSelfie(OFF, null)).toEqual({ ok: true, extension: "" });
    expect(checkSelfie(null, null)).toEqual({ ok: true, extension: "" });
  });

  it("refuses a punch with no photograph when one is required", () => {
    expect(checkSelfie(ON, null)).toEqual({ ok: false, reason: "missing" });
  });

  it("refuses a photograph nobody asked for", () => {
    // Storing a face under a policy that was never switched on is the same
    // harm as storing one with no policy at all.
    const result = checkSelfie(OFF, { bytes: jpeg(), contentType: "image/jpeg" });
    expect(result).toEqual({ ok: false, reason: "not_required" });
  });

  it("refuses an empty body", () => {
    const result = checkSelfie(ON, { bytes: new Uint8Array(0), contentType: "image/jpeg" });
    expect(result).toEqual({ ok: false, reason: "missing" });
  });

  it("refuses anything over the size limit", () => {
    const bytes = jpeg(MAX_SELFIE_BYTES);
    const result = checkSelfie(ON, { bytes, contentType: "image/jpeg" });
    expect(result).toEqual({ ok: false, reason: "too_large", limit: MAX_SELFIE_BYTES });
  });

  it("accepts jpeg and webp", () => {
    expect(checkSelfie(ON, { bytes: jpeg(), contentType: "image/jpeg" })).toEqual({
      ok: true,
      extension: "jpg",
    });
    expect(checkSelfie(ON, { bytes: webp(), contentType: "image/webp" })).toEqual({
      ok: true,
      extension: "webp",
    });
  });

  it("ignores case and surrounding space in the content type", () => {
    expect(checkSelfie(ON, { bytes: jpeg(), contentType: " IMAGE/JPEG " })).toEqual({
      ok: true,
      extension: "jpg",
    });
  });

  it("refuses a format that is not offered", () => {
    const result = checkSelfie(ON, { bytes: jpeg(), contentType: "application/pdf" });
    expect(result).toMatchObject({ ok: false, reason: "unsupported_type" });
  });

  it("refuses bytes that do not match the declared type", () => {
    // A content type is whatever the sender says. Without this the punch
    // endpoint is arbitrary file storage wearing an image/jpeg label.
    const notAnImage = new TextEncoder().encode("MZ\u0090\u0000 this is an executable");
    const result = checkSelfie(ON, { bytes: notAnImage, contentType: "image/jpeg" });
    expect(result).toEqual({ ok: false, reason: "not_an_image" });
  });

  it("refuses a truncated webp header", () => {
    const result = checkSelfie(ON, { bytes: new Uint8Array(8), contentType: "image/webp" });
    expect(result).toEqual({ ok: false, reason: "not_an_image" });
  });
});

describe("where the image is stored", () => {
  it("puts the organisation first, so a tenant is one prefix", () => {
    const key = selfieObjectKey({
      orgId: "org-1",
      captureId: "cap-9",
      direction: "in",
      sha256Hex: "abc123",
      extension: "jpg",
    });
    expect(key).toBe("orgs/org-1/attendance-selfies/cap-9/in-abc123.jpg");
    expect(key.startsWith("orgs/org-1/")).toBe(true);
  });

  it("separates the two punches of one day", () => {
    const base = {
      orgId: "o",
      captureId: "c",
      sha256Hex: "d",
      extension: "jpg",
    } as const;
    expect(selfieObjectKey({ ...base, direction: "in" })).not.toBe(
      selfieObjectKey({ ...base, direction: "out" })
    );
  });
});

describe("retention", () => {
  it("counts from when the photograph was taken, not when it arrived", () => {
    // A queued offline punch can reach the server days later. Counting from
    // arrival silently keeps the image longer than was agreed.
    const taken = new Date("2026-03-01T09:00:00Z");
    expect(selfieExpiresAt(taken, 30).toISOString()).toBe("2026-03-31T09:00:00.000Z");
  });

  it("expires at the boundary, not after it", () => {
    const taken = new Date("2026-03-01T09:00:00Z");
    const exactly = new Date("2026-03-31T09:00:00Z");
    expect(selfieExpired(taken, 30, exactly)).toBe(true);
  });

  it("has not expired a moment before", () => {
    const taken = new Date("2026-03-01T09:00:00Z");
    const justBefore = new Date("2026-03-31T08:59:59Z");
    expect(selfieExpired(taken, 30, justBefore)).toBe(false);
  });

  it("clamps out-of-range values towards keeping less", () => {
    expect(clampRetention(0)).toBe(MIN_RETENTION_DAYS);
    expect(clampRetention(-5)).toBe(MIN_RETENTION_DAYS);
    expect(clampRetention(10_000)).toBe(MAX_RETENTION_DAYS);
    expect(clampRetention(45.9)).toBe(45);
  });

  it("falls back to the default rather than never expiring", () => {
    expect(clampRetention(Number.NaN)).toBe(DEFAULT_RETENTION_DAYS);
    expect(clampRetention(Number.POSITIVE_INFINITY)).toBe(DEFAULT_RETENTION_DAYS);
  });
});

describe("what the employee is told", () => {
  it("quotes the organisation's own retention period", () => {
    // A notice quoting the wrong number is worse than no notice: it is a
    // specific false assurance.
    expect(selfieNotice({ requireSelfieOnPunch: true, selfieRetentionDays: 30 })).toContain(
      "deleted after 30 days"
    );
  });

  it("says who can see it, not only that it is stored", () => {
    const notice = selfieNotice(ON);
    expect(notice).toContain("HR and payroll");
  });

  it("does not say days for a one-day period", () => {
    expect(selfieNotice({ requireSelfieOnPunch: true, selfieRetentionDays: 1 })).toContain(
      "deleted after 1 day."
    );
  });

  it("quotes a clamped period rather than an impossible one", () => {
    const notice = selfieNotice({ requireSelfieOnPunch: true, selfieRetentionDays: 99_999 });
    expect(notice).toContain(`deleted after ${MAX_RETENTION_DAYS} days`);
  });
});
