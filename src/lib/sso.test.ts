// @vitest-environment node
//
// SSO is an authentication boundary, so these tests concentrate on the ways it
// can be made to let the wrong person in: an unverified email linked to an
// existing account, a replayed token, a forged callback, a plaintext endpoint.

import { describe, expect, it } from "vitest";
import {
  SsoError,
  assertHttps,
  buildAuthorizationRequest,
  connectionForEmail,
  createPkce,
  decideLink,
  mapClaims,
  randomToken,
  roleFromGroups,
  timingSafeEqual,
  validateCallback,
  type OidcConnection,
  type SsoIdentity,
  type StoredAuthState,
} from "@/lib/sso";

function connection(over: Partial<OidcConnection> = {}): OidcConnection {
  return {
    id: "conn-1",
    domains: ["example.com"],
    issuer: "https://idp.test",
    clientId: "client-1",
    clientSecret: "secret",
    authorizationEndpoint: "https://idp.test/authorize",
    tokenEndpoint: "https://idp.test/token",
    jwksUri: "https://idp.test/jwks",
    scopes: [],
    allowJitProvisioning: true,
    defaultRole: "employee",
    isActive: true,
    ...over,
  };
}

function identity(over: Partial<SsoIdentity> = {}): SsoIdentity {
  return {
    subject: "sub-1",
    email: "asha@example.com",
    emailVerified: true,
    firstName: "Asha",
    lastName: "Rao",
    groups: [],
    ...over,
  };
}

describe("connectionForEmail", () => {
  const connections = [
    connection(),
    connection({ id: "conn-2", domains: ["other.test"] }),
  ];

  it("routes on the email domain", () => {
    expect(connectionForEmail("asha@example.com", connections)?.id).toBe("conn-1");
    expect(connectionForEmail("bob@other.test", connections)?.id).toBe("conn-2");
  });

  it("matches case-insensitively", () => {
    // A capital letter must not produce an unexplained failure the user
    // cannot work around.
    expect(connectionForEmail("Asha@Example.COM", connections)?.id).toBe("conn-1");
  });

  it("uses the last @ so a plus-addressed local part cannot spoof a domain", () => {
    expect(connectionForEmail("a@evil.test@example.com", connections)?.id).toBe("conn-1");
  });

  it("returns null for an unknown domain", () => {
    expect(connectionForEmail("x@nowhere.test", connections)).toBeNull();
  });

  it("ignores a disabled connection", () => {
    expect(connectionForEmail("asha@example.com", [connection({ isActive: false })])).toBeNull();
  });

  it("returns null for something that is not an email", () => {
    expect(connectionForEmail("asha", connections)).toBeNull();
    expect(connectionForEmail("asha@", connections)).toBeNull();
  });
});

describe("createPkce", () => {
  it("produces a verifier and a different challenge", async () => {
    const { verifier, challenge } = await createPkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).not.toBe(verifier);
  });

  it("produces a different verifier each time", async () => {
    const a = await createPkce();
    const b = await createPkce();
    expect(a.verifier).not.toBe(b.verifier);
  });

  it("emits base64url with no padding", async () => {
    const { challenge } = await createPkce();
    expect(challenge).not.toContain("=");
    expect(challenge).not.toContain("+");
    expect(challenge).not.toContain("/");
  });
});

describe("assertHttps", () => {
  it("accepts https", () => {
    expect(() => assertHttps("https://idp.test/authorize", "endpoint")).not.toThrow();
  });

  it("refuses plaintext http", () => {
    // An authorization code travelling over HTTP is readable by anything on
    // the path.
    expect(() => assertHttps("http://idp.test/authorize", "endpoint")).toThrow(/must use HTTPS/);
  });

  it("allows localhost so a local provider can be used in development", () => {
    expect(() => assertHttps("http://localhost:8080/authorize", "endpoint")).not.toThrow();
    expect(() => assertHttps("http://127.0.0.1:8080/authorize", "endpoint")).not.toThrow();
  });

  it("refuses something that is not a URL", () => {
    expect(() => assertHttps("not a url", "endpoint")).toThrow(/not a valid URL/);
  });
});

describe("buildAuthorizationRequest", () => {
  it("builds a conformant authorization URL", async () => {
    const request = await buildAuthorizationRequest(connection(), "https://app.test/callback");
    const url = new URL(request.url);

    expect(url.origin + url.pathname).toBe("https://idp.test/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-1");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
  });

  it("always requests the openid scope", () => {
    return buildAuthorizationRequest(connection({ scopes: ["groups"] }), "https://app.test/cb").then(
      (request) => {
        const scope = new URL(request.url).searchParams.get("scope")!.split(" ");
        expect(scope).toContain("openid");
        expect(scope).toContain("groups");
      }
    );
  });

  it("does not duplicate a scope the caller also listed", async () => {
    const request = await buildAuthorizationRequest(
      connection({ scopes: ["openid", "email"] }),
      "https://app.test/cb"
    );
    const scope = new URL(request.url).searchParams.get("scope")!.split(" ");
    expect(scope.filter((s) => s === "openid")).toHaveLength(1);
  });

  it("uses separate values for state and nonce", async () => {
    // They have separate jobs: state stops a forged callback, nonce stops a
    // token from another session being replayed. Reusing one leaves whichever
    // attack it is not being checked against.
    const request = await buildAuthorizationRequest(connection(), "https://app.test/cb");
    expect(request.state).not.toBe(request.nonce);
  });

  it("passes a login hint through when given", async () => {
    const request = await buildAuthorizationRequest(
      connection(),
      "https://app.test/cb",
      "asha@example.com"
    );
    expect(new URL(request.url).searchParams.get("login_hint")).toBe("asha@example.com");
  });

  it("appends correctly to an endpoint that already has a query string", async () => {
    const request = await buildAuthorizationRequest(
      connection({ authorizationEndpoint: "https://idp.test/authorize?tenant=x" }),
      "https://app.test/cb"
    );
    const url = new URL(request.url);
    expect(url.searchParams.get("tenant")).toBe("x");
    expect(url.searchParams.get("client_id")).toBe("client-1");
  });

  it("refuses a disabled connection", async () => {
    await expect(
      buildAuthorizationRequest(connection({ isActive: false }), "https://app.test/cb")
    ).rejects.toThrow(/disabled/);
  });

  it("refuses a plaintext redirect URI", async () => {
    await expect(
      buildAuthorizationRequest(connection(), "http://app.test/cb")
    ).rejects.toThrow(/HTTPS/);
  });
});

describe("validateCallback", () => {
  const stored: StoredAuthState = {
    state: "state-value",
    nonce: "nonce-value",
    codeVerifier: "verifier",
    connectionId: "conn-1",
    expiresAt: 2_000,
  };

  it("accepts a matching state", () => {
    const result = validateCallback({ state: "state-value", code: "abc" }, stored, 1_000);
    expect(result).toMatchObject({ code: "abc", nonce: "nonce-value" });
  });

  it("refuses a mismatched state", () => {
    // State is the only thing standing between the callback and a forged
    // sign-in.
    expect(() =>
      validateCallback({ state: "wrong", code: "abc" }, stored, 1_000)
    ).toThrow(/could not be verified/);
  });

  it("refuses a missing state", () => {
    expect(() => validateCallback({ code: "abc" }, stored, 1_000)).toThrow(/could not be verified/);
  });

  it("refuses an expired session", () => {
    expect(() =>
      validateCallback({ state: "state-value", code: "abc" }, stored, 3_000)
    ).toThrow(/expired/);
  });

  it("refuses when nothing was stored", () => {
    expect(() => validateCallback({ state: "x", code: "abc" }, null, 1_000)).toThrow(/expired/);
  });

  it("refuses a callback with no code", () => {
    expect(() => validateCallback({ state: "state-value" }, stored, 1_000)).toThrow(
      /no authorization code/
    );
  });

  it("surfaces a provider error rather than swallowing it", () => {
    // "access_denied" means the user cancelled and should be told so, not
    // shown a generic failure.
    expect(() =>
      validateCallback(
        { error: "access_denied", errorDescription: "User cancelled" },
        stored,
        1_000
      )
    ).toThrow(/access_denied: User cancelled/);
  });

  it("reports a provider error before anything else", () => {
    let thrown: unknown;
    try {
      validateCallback({ error: "server_error" }, null, 1_000);
    } catch (e) {
      thrown = e;
    }
    expect((thrown as SsoError).message).toBe("server_error");
  });
});

describe("timingSafeEqual", () => {
  it("accepts identical strings", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
  });

  it("rejects a difference in the first character", () => {
    expect(timingSafeEqual("zbc", "abc")).toBe(false);
  });

  it("rejects different lengths", () => {
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});

describe("mapClaims", () => {
  it("maps standard OIDC claims", () => {
    const result = mapClaims({
      sub: "sub-1",
      email: "asha@example.com",
      email_verified: true,
      given_name: "Asha",
      family_name: "Rao",
    });

    expect(result).toMatchObject({
      subject: "sub-1",
      email: "asha@example.com",
      emailVerified: true,
      firstName: "Asha",
      lastName: "Rao",
    });
  });

  it("falls back to preferred_username and upn, which Entra sends", () => {
    expect(mapClaims({ sub: "s", preferred_username: "asha@example.com" }).email).toBe(
      "asha@example.com"
    );
    expect(mapClaims({ sub: "s", upn: "bob@example.com" }).email).toBe("bob@example.com");
  });

  it("splits a display name when no name parts are sent", () => {
    const result = mapClaims({ sub: "s", email: "a@b.com", name: "Asha Rao" });
    expect(result).toMatchObject({ firstName: "Asha", lastName: "Rao" });
  });

  it("falls back to the local part rather than storing an empty name", () => {
    // The account still has to be findable by a human.
    expect(mapClaims({ sub: "s", email: "asha@example.com" }).firstName).toBe("asha");
  });

  it("honours a custom claim mapping", () => {
    const result = mapClaims(
      { sub: "s", mail: "asha@example.com", firstname: "Asha" },
      { email: "mail", firstName: "firstname" }
    );
    expect(result).toMatchObject({ email: "asha@example.com", firstName: "Asha" });
  });

  it("carries email_verified through rather than assuming it", () => {
    // A provider letting a user set an unverified address, matched by email
    // against an existing account, is an account takeover.
    expect(mapClaims({ sub: "s", email: "a@b.com" }).emailVerified).toBe(false);
    expect(mapClaims({ sub: "s", email: "a@b.com", email_verified: "true" }).emailVerified).toBe(
      true
    );
  });

  it("reads groups as an array or a comma-separated string", () => {
    expect(mapClaims({ sub: "s", email: "a@b.com", groups: ["hr", "admin"] }).groups).toEqual([
      "hr",
      "admin",
    ]);
    expect(mapClaims({ sub: "s", email: "a@b.com", groups: "hr, admin" }).groups).toEqual([
      "hr",
      "admin",
    ]);
  });

  it("refuses a payload with no subject", () => {
    expect(() => mapClaims({ email: "a@b.com" })).toThrow(/no subject/);
  });

  it("refuses a payload with no email", () => {
    expect(() => mapClaims({ sub: "s" })).toThrow(/no email/);
  });

  it("lowercases the email so matching is stable", () => {
    expect(mapClaims({ sub: "s", email: " Asha@Example.COM " }).email).toBe("asha@example.com");
  });
});

describe("decideLink", () => {
  it("signs in an already-linked account", () => {
    const verdict = decideLink(
      identity(),
      { userId: "u1", ssoSubject: "sub-1", emailDomain: "example.com" },
      connection()
    );
    expect(verdict).toEqual({ action: "sign_in", userId: "u1" });
  });

  it("refuses when the subject no longer matches", () => {
    // The subject is the stable identifier. An email change at the provider
    // must not silently point the login at a different account.
    const verdict = decideLink(
      identity({ subject: "sub-2" }),
      { userId: "u1", ssoSubject: "sub-1", emailDomain: "example.com" },
      connection()
    );
    expect(verdict).toMatchObject({ action: "refuse" });
  });

  it("links an existing unlinked account when the email is verified", () => {
    const verdict = decideLink(
      identity(),
      { userId: "u1", emailDomain: "example.com" },
      connection()
    );
    expect(verdict).toEqual({ action: "sign_in", userId: "u1" });
  });

  it("refuses to link an existing account on an unverified email", () => {
    // Otherwise anyone able to set an arbitrary email at any federated
    // provider could sign in as an existing user of this system.
    const verdict = decideLink(
      identity({ emailVerified: false }),
      { userId: "u1", emailDomain: "example.com" },
      connection()
    );
    expect(verdict).toMatchObject({ action: "refuse" });
    if (verdict.action === "refuse") expect(verdict.reason).toMatch(/not verified/);
  });

  it("provisions a new account when allowed and verified", () => {
    expect(decideLink(identity(), null, connection())).toEqual({ action: "provision" });
  });

  it("refuses to provision on an unverified email", () => {
    const verdict = decideLink(identity({ emailVerified: false }), null, connection());
    expect(verdict).toMatchObject({ action: "refuse" });
  });

  it("refuses to provision when automatic creation is off", () => {
    const verdict = decideLink(identity(), null, connection({ allowJitProvisioning: false }));
    expect(verdict).toMatchObject({ action: "refuse" });
    if (verdict.action === "refuse") expect(verdict.reason).toMatch(/automatic account creation/);
  });
});

describe("roleFromGroups", () => {
  const map = { "hr-team": "hr", "it-admins": "admin", everyone: "employee" };

  it("maps a group onto a role", () => {
    expect(roleFromGroups(["hr-team"], map, "employee")).toBe("hr");
  });

  it("matches case-insensitively", () => {
    expect(roleFromGroups(["HR-Team"], map, "employee")).toBe("hr");
  });

  it("gives the most privileged role when several match", () => {
    // The lesser of the two would be a confusing, silent downgrade.
    expect(roleFromGroups(["hr-team", "it-admins"], map, "employee")).toBe("admin");
  });

  it("falls back when nothing matches", () => {
    expect(roleFromGroups(["random"], map, "employee")).toBe("employee");
  });

  it("falls back when there are no groups at all", () => {
    expect(roleFromGroups([], map, "employee")).toBe("employee");
  });
});

describe("randomToken", () => {
  it("is unpredictable and unpadded", () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
