// ═══════════════════════════════════════════════════════════════
// Delivering to a customer-supplied URL
// ═══════════════════════════════════════════════════════════════
// Everything that leaves for a webhook goes through `deliver`, so the rules it
// enforces are the rules, and each one below is here because skipping it has a
// specific consequence rather than because it is tidy.

import { describe, it, expect, vi } from "vitest";
import { deliver, signBody, signatureMatches } from "./deliver";

const message = {
  event: "integration.test",
  sentAt: "2026-08-19T00:00:00.000Z",
  data: { message: "hello" },
};

/** A fetch that records what it was asked to do and answers with `status`. */
function recordingFetch(status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    // 204 and 304 must carry no body; constructing one with a body throws.
    const body = status === 204 || status === 304 ? null : "";
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("where it will and will not send", () => {
  it("refuses a private address without making a request", async () => {
    const attempted = vi.fn();
    const result = await deliver(
      "https://10.0.0.1/hook",
      message,
      null,
      attempted as unknown as typeof fetch
    );

    expect(result.ok).toBe(false);
    // The point: it did not connect and then decide. It never connected.
    expect(attempted).not.toHaveBeenCalled();
  });

  it("refuses the cloud metadata address", async () => {
    const attempted = vi.fn();
    const result = await deliver(
      "https://169.254.169.254/latest/meta-data/iam/security-credentials/",
      message,
      null,
      attempted as unknown as typeof fetch
    );
    expect(result.ok).toBe(false);
    expect(attempted).not.toHaveBeenCalled();
  });

  it("refuses plain http", async () => {
    const attempted = vi.fn();
    const result = await deliver("http://example.com/hook", message, null, attempted as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    expect(attempted).not.toHaveBeenCalled();
  });
});

describe("the request it makes", () => {
  it("does not follow redirects", async () => {
    // A 302 to somewhere private is a second request that nothing validated,
    // which would walk straight past the check just made.
    const { impl, calls } = recordingFetch();
    await deliver("https://hooks.slack.com/services/x", message, null, impl);
    expect(calls[0].init.redirect).toBe("manual");
  });

  it("reports a redirect as a failure rather than a success", async () => {
    const impl = (async () => new Response("", { status: 302 })) as unknown as typeof fetch;
    const result = await deliver("https://hooks.slack.com/services/x", message, null, impl);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/redirect/i);
  });

  it("carries an abort signal, so a silent receiver cannot hold a worker open", async () => {
    const { impl, calls } = recordingFetch();
    await deliver("https://hooks.slack.com/services/x", message, null, impl);
    expect(calls[0].init.signal).toBeDefined();
  });

  it("signs the body when a secret is set, and omits the header when it is not", async () => {
    const { impl, calls } = recordingFetch();

    await deliver("https://hooks.slack.com/services/x", message, "a-shared-secret", impl);
    const signed = calls[0].init.headers as Record<string, string>;
    expect(signed["x-circuvent-signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);

    await deliver("https://hooks.slack.com/services/x", message, null, impl);
    const unsigned = calls[1].init.headers as Record<string, string>;
    expect(unsigned["x-circuvent-signature"]).toBeUndefined();
  });

  it("signs the exact bytes it sends", async () => {
    // A signature over anything other than the transmitted body cannot be
    // verified by the receiver, which makes it worse than no signature: it
    // looks like integrity and is not.
    const { impl, calls } = recordingFetch();
    await deliver("https://hooks.slack.com/services/x", message, "a-shared-secret", impl);

    const sentBody = calls[0].init.body as string;
    const header = (calls[0].init.headers as Record<string, string>)["x-circuvent-signature"];
    expect(header).toBe(signBody(sentBody, "a-shared-secret"));
  });

  it("reports a non-2xx answer as a failure with its status", async () => {
    const impl = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const result = await deliver("https://hooks.slack.com/services/x", message, null, impl);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
  });

  it("succeeds on a 2xx", async () => {
    const { impl } = recordingFetch(204);
    const result = await deliver("https://hooks.slack.com/services/x", message, null, impl);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(204);
  });
});

describe("signature comparison", () => {
  it("accepts the right signature and rejects a wrong one", () => {
    const signature = signBody("{}", "secret");
    expect(signatureMatches(signature, signature)).toBe(true);
    expect(signatureMatches(signature, signBody("{}", "other"))).toBe(false);
  });

  it("does not throw on a length mismatch", () => {
    // timingSafeEqual throws when the buffers differ in length, and an
    // exception on the verification path is a denial of service.
    expect(() => signatureMatches(signBody("{}", "secret"), "short")).not.toThrow();
    expect(signatureMatches(signBody("{}", "secret"), "short")).toBe(false);
  });
});
