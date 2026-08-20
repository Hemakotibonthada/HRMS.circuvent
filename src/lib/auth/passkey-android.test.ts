import { describe, expect, it } from "vitest";
import { androidOrigins } from "./passkey-ceremony";

/**
 * The encoding is the whole risk here.
 *
 * Credential Manager sends `android:apk-key-hash:` followed by the base64url of
 * the certificate's raw SHA-256 bytes. Play and keytool print the same
 * fingerprint as uppercase colon-separated hex. Getting the conversion wrong
 * does not fail loudly — every Android passkey is simply refused with "Origin
 * is not allowed", which reads like a configuration problem somewhere else
 * entirely.
 */
describe("androidOrigins", () => {
  // The upload certificate this project actually signs with.
  const fingerprint =
    "2A:23:FA:CA:40:31:83:5E:83:0C:DA:1F:A4:33:EA:B3:31:DF:A1:06:EE:63:6B:19:9F:2F:93:F4:10:D5:D6:1B";
  const origin = "android:apk-key-hash:KiP6ykAxg16DDNofpDPqszHfoQbuY2sZny-T9BDV1hs";

  it("converts a colon-hex fingerprint to the origin Credential Manager sends", () => {
    expect(androidOrigins({ ASSETLINKS_SHA256: fingerprint })).toEqual([
      origin,
    ]);
  });

  it("uses base64url, not base64", () => {
    // The distinction matters: a standard-base64 `+` or `/` in the value never
    // matches, and this particular fingerprint contains a `-` in its base64url
    // form, so the two encodings genuinely differ here.
    const [only] = androidOrigins({ ASSETLINKS_SHA256: fingerprint });
    expect(only).not.toContain("+");
    expect(only).not.toContain("/");
    expect(only).not.toContain("=");
  });

  it("accepts lowercase, because keytool and Play disagree about case", () => {
    expect(
      androidOrigins({ ASSETLINKS_SHA256: fingerprint.toLowerCase() })
    ).toEqual([origin]);
  });

  it("takes several certificates, since upload and Play signing keys differ", () => {
    const second =
      "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99";
    expect(
      androidOrigins({ ASSETLINKS_SHA256: `${fingerprint}, ${second}` })
    ).toHaveLength(2);
  });

  it("ignores anything that is not a 32-byte fingerprint", () => {
    // A truncated or SHA-1 fingerprint pasted by mistake must not become an
    // origin: a malformed entry that is quietly accepted widens the allow-list
    // with a value nobody chose.
    expect(
      androidOrigins({ ASSETLINKS_SHA256: "AA:BB:CC, not-a-fingerprint, " })
    ).toEqual([]);
  });

  it("is empty when nothing is configured, rather than guessing", () => {
    expect(androidOrigins({})).toEqual([]);
  });
});
