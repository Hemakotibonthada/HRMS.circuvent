// The device control plane is a separate, already-deployed system this app
// only ever talks to over HTTP — a stale token, an unreachable terminal
// network, or nobody having configured the integration yet are all routine,
// expected states here, not bugs. These tests pin the three-way distinction
// `device-sync.ts` depends on to decide what to do next: "not configured"
// (nothing to fix), "unreachable" (worth a retry later), and "rejected"
// (retrying the same request will not help).
//
// `device-client.ts` reads its environment variables lazily, inside each
// function, rather than once at module load — so unlike `directory-sdk.ts`
// (see `onboarding-groups.test.ts`), these tests do not need
// `vi.resetModules()` or a dynamic `import()` per case. A plain top-level
// import plus mutating `process.env` directly before each call is enough,
// because every call re-reads the environment fresh.

import { afterEach, describe, expect, it, vi } from "vitest";

import { deviceConfigured, fetchRegister, fetchSites } from "@/lib/attendance/device-client";

const ORIGINAL_TOKEN = process.env.ATTENDANCE_DEVICE_TOKEN;
const ORIGINAL_URL = process.env.ATTENDANCE_DEVICE_URL;

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL_TOKEN === undefined) delete process.env.ATTENDANCE_DEVICE_TOKEN;
  else process.env.ATTENDANCE_DEVICE_TOKEN = ORIGINAL_TOKEN;
  if (ORIGINAL_URL === undefined) delete process.env.ATTENDANCE_DEVICE_URL;
  else process.env.ATTENDANCE_DEVICE_URL = ORIGINAL_URL;
});

describe("whether the integration is configured", () => {
  it("is false with no token set", () => {
    delete process.env.ATTENDANCE_DEVICE_TOKEN;
    expect(deviceConfigured()).toBe(false);
  });

  it("is false for a token that is only whitespace", () => {
    process.env.ATTENDANCE_DEVICE_TOKEN = "   ";
    expect(deviceConfigured()).toBe(false);
  });

  it("is true once a token is set", () => {
    process.env.ATTENDANCE_DEVICE_TOKEN = "secret-token";
    expect(deviceConfigured()).toBe(true);
  });
});

describe("calling out when nothing is configured", () => {
  it("fetchRegister reports not_configured without ever calling fetch", async () => {
    delete process.env.ATTENDANCE_DEVICE_TOKEN;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await fetchRegister(12, "2025-01-15");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_configured");
    // Firing a request it knows will fail would waste the 5s timeout budget
    // on a call nobody can answer.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetchSites reports not_configured without ever calling fetch", async () => {
    delete process.env.ATTENDANCE_DEVICE_TOKEN;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await fetchSites();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_configured");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("fetchRegister once a token is configured", () => {
  it("requests the register for the given site and day, bearing the token", async () => {
    process.env.ATTENDANCE_DEVICE_TOKEN = "secret-token";
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ day: "2025-01-15", timezone: "Asia/Kolkata", people: [], totals: {} }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await fetchRegister(12, "2025-01-15");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.day).toBe("2025-01-15");

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.circuvent.com/attendance/register?siteId=12&day=2025-01-15");
    expect(init.headers.Authorization).toBe("Bearer secret-token");
  });

  it("uses the default base URL when ATTENDANCE_DEVICE_URL is unset", async () => {
    process.env.ATTENDANCE_DEVICE_TOKEN = "secret-token";
    delete process.env.ATTENDANCE_DEVICE_URL;
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ day: "2025-01-15", timezone: "UTC", people: [], totals: {} }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await fetchRegister(1, "2025-01-15");

    expect(fetchSpy.mock.calls[0][0]).toMatch(/^https:\/\/api\.circuvent\.com\//);
  });

  it("honours a configured base URL and strips its trailing slash", async () => {
    process.env.ATTENDANCE_DEVICE_TOKEN = "secret-token";
    process.env.ATTENDANCE_DEVICE_URL = "https://staging.example.com/";
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ day: "2025-01-15", timezone: "UTC", people: [], totals: {} }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await fetchRegister(3, "2025-01-15");

    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://staging.example.com/attendance/register?siteId=3&day=2025-01-15"
    );
  });

  it("reports rejected, with the status, when the control plane answers with an error", async () => {
    process.env.ATTENDANCE_DEVICE_TOKEN = "secret-token";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "invalid token" })
    );

    const result = await fetchRegister(12, "2025-01-15");

    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "rejected") {
      expect(result.status).toBe(401);
      expect(result.detail).toContain("invalid token");
    } else {
      throw new Error("expected a rejected result");
    }
  });

  it("reports unreachable, not a crash, when the network throws", async () => {
    process.env.ATTENDANCE_DEVICE_TOKEN = "secret-token";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed")));

    const result = await fetchRegister(12, "2025-01-15");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unreachable");
  });

  it("reports unreachable when the request aborts, the same path the 5s timeout takes", async () => {
    // The real timeout is not worth waiting out in a test; aborting is
    // exactly what `AbortController` does when it fires, so a fetch that
    // rejects with an AbortError exercises the same catch branch.
    process.env.ATTENDANCE_DEVICE_TOKEN = "secret-token";
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    const result = await fetchRegister(12, "2025-01-15");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unreachable");
  });

  it("never lets the token reach a stored error message", async () => {
    // This message is a realistic shape for what a raw network error can
    // contain (some HTTP clients echo the request URL, which had the token in
    // a query string in an earlier version of this client) — the redaction
    // must catch it however it appears, not just in a header we control.
    process.env.ATTENDANCE_DEVICE_TOKEN = "super-secret-token";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED, token super-secret-token rejected"))
    );

    const result = await fetchRegister(12, "2025-01-15");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.detail).not.toContain("super-secret-token");
      expect(result.detail).toContain("[redacted]");
    }
  });
});

describe("fetchSites once a token is configured", () => {
  it("requests the sites endpoint and returns the parsed list", async () => {
    process.env.ATTENDANCE_DEVICE_TOKEN = "secret-token";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ sites: [{ id: 1, name: "HQ", timezone: "Asia/Kolkata" }] }),
      })
    );

    const result = await fetchSites();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.sites).toHaveLength(1);
  });
});
