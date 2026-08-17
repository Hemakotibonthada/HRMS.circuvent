import { describe, expect, it } from "vitest";
import {
  canBeginEnrolment,
  canConfirmEnrolment,
  canDisable,
  mfaRequiredAtSignIn,
  mfaState,
  type MfaState,
} from "@/lib/auth/mfa-enrolment";

const ENABLED_AT = new Date("2026-06-15T10:00:00Z");
const SECRET = "JBSWY3DPEHPK3PXP";

describe("mfaState", () => {
  it("is off with no secret", () => {
    expect(mfaState(null, null)).toBe("off");
    expect(mfaState(undefined, undefined)).toBe("off");
    expect(mfaState("", null)).toBe("off");
  });

  it("is pending with a secret that was never confirmed", () => {
    expect(mfaState(SECRET, null)).toBe("pending");
    expect(mfaState(SECRET, undefined)).toBe("pending");
  });

  it("is active once confirmed", () => {
    expect(mfaState(SECRET, ENABLED_AT)).toBe("active");
  });

  it("accepts a timestamp string, since a raw SQL row returns one", () => {
    expect(mfaState(SECRET, "2026-06-15T10:00:00Z")).toBe("active");
  });

  it("treats an enabled timestamp with no secret as off rather than trusting it", () => {
    // An impossible row. Reading it as active would demand a code from an
    // authenticator that does not exist — an unrecoverable lockout.
    expect(mfaState(null, ENABLED_AT)).toBe("off");
  });
});

describe("mfaRequiredAtSignIn", () => {
  it("does not demand a code when MFA is off", () => {
    expect(mfaRequiredAtSignIn(null, null)).toBe(false);
  });

  it("does not demand a code for a pending enrolment", () => {
    // The regression this whole state machine exists to prevent. The secret is
    // written the moment a QR code is shown; enforcing from that instant locks
    // out anyone who does not finish enrolling.
    expect(mfaRequiredAtSignIn(SECRET, null)).toBe(false);
  });

  it("demands a code once enrolment is confirmed", () => {
    expect(mfaRequiredAtSignIn(SECRET, ENABLED_AT)).toBe(true);
  });

  it("agrees with mfaState for every combination", () => {
    const secrets = [null, undefined, "", SECRET];
    const stamps = [null, undefined, ENABLED_AT];
    for (const secret of secrets) {
      for (const stamp of stamps) {
        expect(mfaRequiredAtSignIn(secret, stamp)).toBe(mfaState(secret, stamp) === "active");
      }
    }
  });
});

describe("transition guards", () => {
  const states: MfaState[] = ["off", "pending", "active"];

  it("allows enrolment to begin unless MFA is already active", () => {
    expect(canBeginEnrolment("off")).toBe(true);
    // Restarting a pending enrolment is safe — nothing depends on that secret.
    expect(canBeginEnrolment("pending")).toBe(true);
    // Overwriting an active secret would invalidate a working authenticator.
    expect(canBeginEnrolment("active")).toBe(false);
  });

  it("allows confirmation only from pending", () => {
    expect(canConfirmEnrolment("off")).toBe(false);
    expect(canConfirmEnrolment("pending")).toBe(true);
    expect(canConfirmEnrolment("active")).toBe(false);
  });

  it("allows disabling anything that has a secret", () => {
    expect(canDisable("off")).toBe(false);
    expect(canDisable("pending")).toBe(true);
    expect(canDisable("active")).toBe(true);
  });

  it("leaves no state where every transition is refused", () => {
    // A state nothing can move out of is a permanent lockout.
    for (const state of states) {
      const moves = [canBeginEnrolment(state), canConfirmEnrolment(state), canDisable(state)];
      expect(moves.some(Boolean), `${state} should permit at least one transition`).toBe(true);
    }
  });
});

describe("the enrolment lifecycle", () => {
  it("walks off → pending → active → off", () => {
    let secret: string | null = null;
    let enabledAt: Date | null = null;

    expect(mfaState(secret, enabledAt)).toBe("off");
    expect(mfaRequiredAtSignIn(secret, enabledAt)).toBe(false);

    // Begin: a secret is stored, but sign-in is untouched.
    expect(canBeginEnrolment(mfaState(secret, enabledAt))).toBe(true);
    secret = SECRET;
    expect(mfaState(secret, enabledAt)).toBe("pending");
    expect(mfaRequiredAtSignIn(secret, enabledAt)).toBe(false);

    // Confirm: now, and only now, sign-in demands a code.
    expect(canConfirmEnrolment(mfaState(secret, enabledAt))).toBe(true);
    enabledAt = ENABLED_AT;
    expect(mfaState(secret, enabledAt)).toBe("active");
    expect(mfaRequiredAtSignIn(secret, enabledAt)).toBe(true);

    // Disable: back to the start.
    expect(canDisable(mfaState(secret, enabledAt))).toBe(true);
    secret = null;
    enabledAt = null;
    expect(mfaState(secret, enabledAt)).toBe("off");
    expect(mfaRequiredAtSignIn(secret, enabledAt)).toBe(false);
  });

  it("an abandoned enrolment never blocks sign-in", () => {
    // Someone opens the settings page, scans nothing, and closes the tab.
    const secret = SECRET;
    const enabledAt = null;
    expect(mfaRequiredAtSignIn(secret, enabledAt)).toBe(false);
    expect(canBeginEnrolment(mfaState(secret, enabledAt))).toBe(true);
  });
});
