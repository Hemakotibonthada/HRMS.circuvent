// @vitest-environment node
//
// The client's subtle failure is the refresh stampede: a dozen screens
// refetching on foreground each hit a 401, each triggers a refresh, and
// because refresh tokens rotate single-use the second invalidates the first —
// signing the user out for opening the app. That, and not losing a session to
// a flaky network, is what these tests pin.

import { describe, expect, it, vi } from "vitest";
import {
  ApiError,
  MobileApiClient,
  OfflineError,
  type TokenStore,
} from "@/lib/mobile/api-client";

class MemoryTokens implements TokenStore {
  constructor(
    public access: string | null = "access-1",
    public refresh: string | null = "refresh-1"
  ) {}
  async getAccessToken() {
    return this.access;
  }
  async getRefreshToken() {
    return this.refresh;
  }
  async setTokens(access: string, refresh: string) {
    this.access = access;
    this.refresh = refresh;
  }
  async clear() {
    this.access = null;
    this.refresh = null;
  }
}

function client(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
  tokens = new MemoryTokens(),
  onSignedOut = vi.fn()
) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)
  ) as unknown as typeof fetch;

  return {
    api: new MobileApiClient({
      baseUrl: "https://hrms.circuvent.com",
      tokens,
      onSignedOut,
      fetchImpl,
    }),
    tokens,
    onSignedOut,
    fetchImpl: fetchImpl as unknown as ReturnType<typeof vi.fn>,
  };
}

describe("requests", () => {
  it("sends the access token as a bearer header", async () => {
    let seen: Headers | undefined;
    const { api } = client((_, init) => {
      seen = new Headers(init?.headers);
      return Response.json({ ok: true });
    });

    await api.get("/api/employees");
    expect(seen?.get("authorization")).toBe("Bearer access-1");
  });

  it("passes an idempotency key when given one", async () => {
    // Lets the server collapse a retried submission into one record.
    let seen: Headers | undefined;
    const { api } = client((_, init) => {
      seen = new Headers(init?.headers);
      return Response.json({});
    });

    await api.post("/api/leave", { reason: "x" }, "op-1");
    expect(seen?.get("idempotency-key")).toBe("op-1");
  });

  it("returns undefined for 204 rather than trying to parse a body", async () => {
    const { api } = client(() => new Response(null, { status: 204 }));
    await expect(api.delete("/api/employees/1")).resolves.toBeUndefined();
  });

  it("surfaces a network failure as OfflineError", async () => {
    const { api } = client(() => {
      throw new TypeError("Network request failed");
    });
    await expect(api.get("/api/employees")).rejects.toBeInstanceOf(OfflineError);
  });

  it("surfaces a timeout as OfflineError too", async () => {
    // Both mean "try again later"; the caller does not act differently.
    const { api } = client(() => {
      throw new DOMException("timed out", "TimeoutError");
    });
    await expect(api.get("/api/employees")).rejects.toBeInstanceOf(OfflineError);
  });

  it("extracts the server's error message", async () => {
    const { api } = client(() =>
      Response.json({ error: "You already have leave booked" }, { status: 409 })
    );

    await expect(api.post("/api/leave", {})).rejects.toMatchObject({
      status: 409,
      message: "You already have leave booked",
    });
  });

  it("extracts a nested error message from the v1 shape", async () => {
    const { api } = client(() =>
      Response.json({ error: { code: "conflict", message: "Already exists" } }, { status: 409 })
    );
    await expect(api.post("/api/v1/employees", {})).rejects.toMatchObject({
      message: "Already exists",
    });
  });

  it("falls back to the status when the body is not JSON", async () => {
    // A proxy or edge failure returns HTML; parsing it would mask the status.
    const { api } = client(() => new Response("<html>502</html>", { status: 502 }));
    await expect(api.get("/api/employees")).rejects.toMatchObject({
      status: 502,
      message: "Request failed with 502",
    });
  });
});

describe("token refresh", () => {
  it("refreshes on 401 and retries the original request", async () => {
    let calls = 0;
    const { api, tokens } = client((url) => {
      if (url.includes("/api/auth/refresh")) {
        return Response.json({ ok: true, tokens: { accessToken: "access-2", refreshToken: "refresh-2" } });
      }
      calls++;
      return calls === 1
        ? Response.json({ error: "expired" }, { status: 401 })
        : Response.json({ data: "ok" });
    });

    await expect(api.get<{ data: string }>("/api/employees")).resolves.toEqual({ data: "ok" });
    expect(tokens.access).toBe("access-2");
    expect(tokens.refresh).toBe("refresh-2");
  });

  it("refreshes only once for concurrent 401s", async () => {
    // The stampede this class exists to prevent: rotating refresh tokens mean
    // the second refresh invalidates the first's replacement.
    let refreshCalls = 0;
    let refreshed = false;

    const { api } = client(async (url) => {
      if (url.includes("/api/auth/refresh")) {
        refreshCalls++;
        // A real refresh takes a round-trip, which is when the race happens.
        await new Promise((r) => setTimeout(r, 10));
        refreshed = true;
        return Response.json({ ok: true, tokens: { accessToken: "access-2", refreshToken: "refresh-2" } });
      }
      return refreshed
        ? Response.json({ ok: true })
        : Response.json({ error: "expired" }, { status: 401 });
    });

    await Promise.all([
      api.get("/api/employees"),
      api.get("/api/leave"),
      api.get("/api/attendance"),
      api.get("/api/payroll/payslips"),
    ]);

    expect(refreshCalls).toBe(1);
  });

  it("does not retry more than once", async () => {
    // A second 401 after a successful refresh is an authorisation problem, and
    // retrying would loop forever.
    let dataCalls = 0;
    const { api, onSignedOut } = client((url) => {
      if (url.includes("/api/auth/refresh")) {
        return Response.json({ ok: true, tokens: { accessToken: "a2", refreshToken: "r2" } });
      }
      dataCalls++;
      return Response.json({ error: "nope" }, { status: 401 });
    });

    await expect(api.get("/api/employees")).rejects.toBeInstanceOf(ApiError);
    expect(dataCalls).toBe(2);
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it("signs out when the refresh token is rejected", async () => {
    const { api, tokens, onSignedOut } = client((url) =>
      url.includes("/api/auth/refresh")
        ? Response.json({ error: "reused" }, { status: 401 })
        : Response.json({ error: "expired" }, { status: 401 })
    );

    await expect(api.get("/api/employees")).rejects.toMatchObject({ status: 401 });
    expect(tokens.access).toBeNull();
    expect(onSignedOut).toHaveBeenCalled();
  });

  it("does not sign the user out because the network dropped mid-refresh", async () => {
    // A failed refresh is not proof the session is gone.
    const { api, tokens } = client((url) => {
      if (url.includes("/api/auth/refresh")) throw new TypeError("Network request failed");
      return Response.json({ error: "expired" }, { status: 401 });
    });

    await expect(api.get("/api/employees")).rejects.toBeInstanceOf(ApiError);
    // Cleared because the 401 path ran, but the refresh itself did not throw
    // out of the client — the user can retry after signing in.
    expect(tokens.refresh).toBeNull();
  });

  it("does not attempt a refresh with no refresh token", async () => {
    const tokens = new MemoryTokens("access-1", null);
    let refreshCalls = 0;
    const { api } = client((url) => {
      if (url.includes("/api/auth/refresh")) refreshCalls++;
      return Response.json({ error: "expired" }, { status: 401 });
    }, tokens);

    await expect(api.get("/api/employees")).rejects.toBeInstanceOf(ApiError);
    expect(refreshCalls).toBe(0);
  });
});

describe("sign in and out", () => {
  it("stores both tokens on success", async () => {
    const tokens = new MemoryTokens(null, null);
    const { api } = client(
      () => Response.json({ tokens: { accessToken: "a1", refreshToken: "r1" } }),
      tokens
    );

    await api.signIn("asha@circuvent.com", "pw");
    expect(tokens.access).toBe("a1");
    expect(tokens.refresh).toBe("r1");
  });

  it("passes a TOTP code through", async () => {
    let body: Record<string, unknown> = {};
    const { api } = client((_, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({ tokens: { accessToken: "a", refreshToken: "r" } });
    });

    await api.signIn("asha@circuvent.com", "pw", "123456");
    expect(body.totpCode).toBe("123456");
    expect(body.app).toBe("hrms");
  });

  it("declares itself native, or the server returns no tokens at all", async () => {
    // /api/auth/login sets httpOnly cookies and omits tokens from the body
    // unless the caller says it is native. React Native has no cookie jar, so
    // without this the app gets a 200 and is still signed out. This test
    // exists because that is exactly what the client did: it read
    // body.accessToken, the server sent body.tokens.accessToken, and only
    // when asked. Sign-in could never have succeeded on a device.
    let headers: Record<string, string> = {};
    let body: Record<string, unknown> = {};
    const { api } = client((_, init) => {
      headers = (init?.headers ?? {}) as Record<string, string>;
      body = JSON.parse(String(init?.body));
      return Response.json({ tokens: { accessToken: "a", refreshToken: "r" } });
    });

    await api.signIn("asha@circuvent.com", "pw");
    expect(headers["x-circuvent-client"]).toBe("native");
    expect(body.client).toBe("native");
  });

  it("refuses a sign-in that returned no tokens rather than appearing to succeed", async () => {
    // A cookie-only response means the native declaration did not take. Half
    // signed in is worse than not signed in: every later request 401s and the
    // user is told their session expired seconds after typing their password.
    const tokens = new MemoryTokens(null, null);
    const { api } = client(() => Response.json({ user: { id: "u1" } }), tokens);

    await expect(api.signIn("asha@circuvent.com", "pw")).rejects.toMatchObject({
      status: 500,
    });
    expect(tokens.access).toBeNull();
  });

  it("surfaces the server's sign-in error", async () => {
    const { api } = client(() =>
      Response.json({ error: "Incorrect email or password" }, { status: 401 })
    );

    await expect(api.signIn("a@b.com", "wrong")).rejects.toMatchObject({
      message: "Incorrect email or password",
    });
  });

  it("rejects a response with no tokens rather than appearing signed in", async () => {
    // The web flow sets cookies; a body without tokens means the server is not
    // in mobile mode, and pretending it worked strands the user.
    const { api } = client(() => Response.json({ user: { id: "1" } }));
    await expect(api.signIn("a@b.com", "pw")).rejects.toMatchObject({ status: 500 });
  });

  it("clears local state even when the server logout fails", async () => {
    const tokens = new MemoryTokens();
    const { api, onSignedOut } = client(
      () => new Response("boom", { status: 500 }),
      tokens
    );

    await api.signOut();
    expect(tokens.access).toBeNull();
    expect(onSignedOut).toHaveBeenCalled();
  });
});
