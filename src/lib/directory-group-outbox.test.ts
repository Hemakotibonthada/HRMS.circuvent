// `queueGroupLeaves`, `drainDueGroupLeaves` and `outstandingGroupLeaves` all
// talk to Postgres through `withTenant`, exactly like `drainDueGroupJoins`
// next to them and every `*.neon.ts` repository — none of those have a
// dedicated unit test here, because there is no live database in this run.
// That composition is proven at the layers above instead: `outbox-sweep.test.ts`
// covers a leave-drain failure not stopping the sweep for other tenants, and
// `offboarding-exit.test.ts` covers a failed removal surfacing in the exit
// report rather than being reported as done.
//
// What belongs in this file is `removeGroupMember` itself, the one part of
// the leave path this codebase does not already test anywhere: it shares
// `directory-sdk.ts`'s `post()` helper and token-scrubbing with `addGroupMember`,
// which `onboarding-groups.test.ts` exercises, but `removeGroupMember` is a
// distinct export with its own behaviour to get right — a failure has to come
// back as a failure, not a swallowed exception, or the leave outbox has
// nothing to retry in the first place.

import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_TOKEN = process.env.DIRECTORY_SERVICE_TOKEN;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  if (ORIGINAL_TOKEN === undefined) delete process.env.DIRECTORY_SERVICE_TOKEN;
  else process.env.DIRECTORY_SERVICE_TOKEN = ORIGINAL_TOKEN;
});

async function loadSdk(token: string | undefined) {
  if (token === undefined) delete process.env.DIRECTORY_SERVICE_TOKEN;
  else process.env.DIRECTORY_SERVICE_TOKEN = token;
  vi.resetModules();
  return import("@/lib/directory-sdk");
}

describe("removing somebody from a group", () => {
  it("reports failure rather than failing soft, so the leave outbox has something to retry", async () => {
    // If this ever returned a fallback the way the read helpers in this
    // module do, a leaver would sit in `directory_group_leave_outbox` as
    // `succeeded` while still on the list at the identity provider — the
    // exact shape of "reported as done, actually not" the task warns about.
    const sdk = await loadSdk("leaver-service-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({ error: "upstream down" }) })
    );

    const result = await sdk.removeGroupMember("all@circuvent.com", "gone@circuvent.com");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("upstream down");
  });

  it("refuses to pretend when no service token is configured, and never fires the request", async () => {
    const sdk = await loadSdk(undefined);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await sdk.removeGroupMember("all@circuvent.com", "gone@circuvent.com");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/DIRECTORY_SERVICE_TOKEN/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("treats somebody already out of the group as success, so a retry after a partial success settles", async () => {
    // The upstream response has no `removed` flag distinct from "already
    // gone" the way `addGroupMember` distinguishes `alreadyMember` — any 2xx
    // here means the identity provider agrees they are not a member, which is
    // exactly the state a removal is trying to reach either way.
    const sdk = await loadSdk("leaver-service-token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }));

    const result = await sdk.removeGroupMember("all@circuvent.com", "gone@circuvent.com");
    expect(result.ok).toBe(true);
  });

  it("lower-cases the group and member addresses it sends", async () => {
    const sdk = await loadSdk("leaver-service-token");
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ removed: true }) });
    vi.stubGlobal("fetch", fetchSpy);

    await sdk.removeGroupMember("  All@Circuvent.com ", "Gone.Employee@Circuvent.COM");

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body).toEqual({ group: "all@circuvent.com", email: "gone.employee@circuvent.com" });
  });

  it("posts to the removal endpoint, not the join one", async () => {
    // A copy-paste of `addGroupMember`'s path here would add the leaver back
    // instead of removing them — the two must never resolve to the same URL.
    const sdk = await loadSdk("leaver-service-token");
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ removed: true }) });
    vi.stubGlobal("fetch", fetchSpy);

    await sdk.removeGroupMember("all@circuvent.com", "gone@circuvent.com");

    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toContain("/api/groups/members/remove");
  });

  it("never lets the service token's header name reach a stored error", async () => {
    // The error is written to `directory_group_leave_outbox.last_error`,
    // which is read by anybody who can see the table — the same reasoning
    // `onboarding-groups.test.ts` applies to the join side's stored error.
    const sdk = await loadSdk("leaver-service-token");
    vi.stubGlobal(
      "fetch",
      // `scrubToken`'s pattern matches the header name plus everything
      // attached to it up to the next space, comma or `)` — this mirrors an
      // upstream proxy error that echoes the offending header verbatim.
      vi.fn().mockRejectedValue(new Error("connect failed while sending X-Service-Token:abc123secret to upstream"))
    );

    const result = await sdk.removeGroupMember("all@circuvent.com", "gone@circuvent.com");
    expect(result.ok).toBe(false);
    expect(result.error).not.toContain("abc123secret");
    expect(result.error).toContain("[redacted]");
  });
});
