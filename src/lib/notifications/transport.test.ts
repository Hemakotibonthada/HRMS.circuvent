// @vitest-environment node
//
// Transports fail in production for reasons a unit test can reproduce exactly:
// a provider is down, a token is stale, a name contains markup. These tests
// pin the failure handling, since that is what determines whether one bad
// channel loses the whole notification.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deliver, transportFor, type Recipient } from "@/lib/notifications/transport";
import type { DispatchDecision } from "@/lib/notifications/engine";
import { mailConfigured, sendMail } from "@/lib/mailer";

// Email goes over the same SMTP path as password resets and offer letters, so
// it is mocked at the mailer rather than at `fetch`. It used to POST to the
// Resend API on a key that appears in no example configuration — the tests
// passed because they mocked the provider, and production would have sent
// nothing at all.
vi.mock("@/lib/mailer", () => ({
  mailConfigured: vi.fn(() => true),
  sendMail: vi.fn(async () => true),
}));

const mockedSendMail = vi.mocked(sendMail);
const mockedMailConfigured = vi.mocked(mailConfigured);

/** The message handed to the mail server on the last email send. */
function lastEmail(): { subject: string; html: string; text?: string } {
  const call = mockedSendMail.mock.calls.at(-1);
  if (!call) throw new Error("No email was sent");
  return call[0];
}

const recipient: Recipient = {
  userId: "u1",
  email: "asha@circuvent.com",
  pushTokens: ["ExponentPushToken[abc]"],
};

function decision(over: Partial<DispatchDecision> = {}): DispatchDecision {
  return {
    recipientId: "u1",
    type: "leave.approved",
    priority: "high",
    channels: ["in_app", "email", "push"],
    subject: "Your leave has been approved",
    body: "Your casual leave from 2026-04-10 to 2026-04-12 was approved.",
    actionUrl: "/leave",
    sendAt: new Date(),
    ...over,
  };
}

const originalFetch = global.fetch;

beforeEach(() => {
  delete process.env.EXPO_PUSH_ENABLED;
  mockedSendMail.mockReset();
  mockedSendMail.mockResolvedValue(true);
  mockedMailConfigured.mockReset();
  mockedMailConfigured.mockReturnValue(true);
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)
  ) as unknown as typeof fetch;
}

describe("deliver", () => {
  it("sends over every planned channel", async () => {
    mockFetch(() => Response.json({ data: [{ status: "ok", id: "push-1" }] }));

    const results = await deliver(decision(), recipient);

    expect(results.map((r) => r.channel).sort()).toEqual(["email", "in_app", "push"]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(mockedSendMail).toHaveBeenCalledTimes(1);
  });

  it("keeps other channels working when one provider fails", async () => {
    // An email outage must not lose the push notification, and neither must
    // lose the in-app record.
    mockedSendMail.mockResolvedValue(false);
    mockFetch(() => Response.json({ data: [{ status: "ok", id: "push-1" }] }));

    const results = await deliver(decision(), recipient);
    const byChannel = Object.fromEntries(results.map((r) => [r.channel, r]));

    expect(byChannel.email.ok).toBe(false);
    expect(byChannel.email.error).toMatch(/rejected/i);
    expect(byChannel.push.ok).toBe(true);
    expect(byChannel.in_app.ok).toBe(true);
  });

  it("does not let a transport that throws take down the batch", async () => {
    mockedSendMail.mockRejectedValue(new Error("socket hang up"));
    mockFetch(() => Response.json({ data: [{ status: "ok" }] }));

    const results = await deliver(decision(), recipient);
    expect(results.find((r) => r.channel === "email")?.ok).toBe(false);
    expect(results.find((r) => r.channel === "push")?.ok).toBe(true);
  });

  it("skips an unconfigured channel without calling it", async () => {
    // A tenant with no mail server simply does not get email; that is not an
    // error worth alerting on.
    mockedMailConfigured.mockReturnValue(false);

    const results = await deliver(decision({ channels: ["email"] }), recipient);

    expect(results[0].ok).toBe(false);
    expect(results[0].error).toContain("not configured");
    expect(mockedSendMail).not.toHaveBeenCalled();
  });

  it("reports a missing address rather than calling the provider", async () => {
    const results = await deliver(decision({ channels: ["email"] }), { userId: "u1" });

    expect(results[0].ok).toBe(false);
    expect(results[0].error).toMatch(/no email address/i);
    expect(mockedSendMail).not.toHaveBeenCalled();
  });

  it("sends nothing for a suppressed decision", async () => {
    const fetchSpy = vi.fn(async () => Response.json({}));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const results = await deliver(decision({ suppressedReason: "muted_type" }), recipient);

    expect(results).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockedSendMail).not.toHaveBeenCalled();
  });

  it("treats a partially rejected push as delivered", async () => {
    // One stale token on a phone the user replaced must not fail the whole
    // notification.
    mockFetch(() =>
      Response.json({
        data: [
          { status: "ok", id: "push-1" },
          { status: "error" },
        ],
      })
    );

    const results = await deliver(
      decision({ channels: ["push"] }),
      { ...recipient, pushTokens: ["a", "b"] }
    );

    expect(results[0].ok).toBe(true);
    expect(results[0].error).toContain("1 of 2");
  });

  it("reports a device-less recipient rather than calling Expo", async () => {
    const fetchSpy = vi.fn(async () => Response.json({}));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const results = await deliver(decision({ channels: ["push"] }), {
      userId: "u1",
      pushTokens: [],
    });

    expect(results[0].ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("email content", () => {
  it("sends both a plain-text and an HTML part", async () => {
    // HTML-only mail scores worse with spam filters and renders badly in
    // clients that prefer text.
    await deliver(decision({ channels: ["email"] }), recipient);

    const mail = lastEmail();
    expect(typeof mail.text).toBe("string");
    expect(typeof mail.html).toBe("string");
    expect(String(mail.text)).toContain("casual leave");
  });

  it("escapes markup in the subject and body", async () => {
    await deliver(
      decision({
        channels: ["email"],
        subject: `O'Brien & Co <script>alert(1)</script>`,
        body: "<img src=x onerror=alert(1)>",
      }),
      recipient
    );

    const mail = lastEmail();
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain("<img src=x");
    expect(mail.html).toContain("&lt;script&gt;");
  });

  it("turns a relative action URL into an absolute one", async () => {
    // A relative link in an email client goes nowhere.
    await deliver(decision({ channels: ["email"], actionUrl: "/leave" }), recipient);

    expect(lastEmail().text).toContain("https://hrms.circuvent.com/leave");
  });

  it("addresses the message to the recipient", async () => {
    await deliver(decision({ channels: ["email"] }), recipient);
    expect(mockedSendMail.mock.calls.at(-1)?.[0].to).toBe("asha@circuvent.com");
  });
});

describe("push content", () => {
  it("truncates a long body to what a banner can show", async () => {
    let body: { body: string }[] = [];
    mockFetch((url, init) => {
      if (url.includes("exp.host")) body = JSON.parse(String(init?.body));
      return Response.json({ data: [{ status: "ok" }] });
    });

    await deliver(
      decision({ channels: ["push"], body: "x".repeat(500) }),
      recipient
    );

    expect(body[0].body.length).toBeLessThanOrEqual(178);
    expect(body[0].body.endsWith("…")).toBe(true);
  });

  it("raises priority for critical alerts", async () => {
    let body: { priority: string; sound?: string }[] = [];
    mockFetch((url, init) => {
      if (url.includes("exp.host")) body = JSON.parse(String(init?.body));
      return Response.json({ data: [{ status: "ok" }] });
    });

    await deliver(decision({ channels: ["push"], priority: "critical" }), recipient);

    expect(body[0].priority).toBe("high");
    expect(body[0].sound).toBe("default");
  });

  it("sends one message per registered device", async () => {
    let body: unknown[] = [];
    mockFetch((url, init) => {
      if (url.includes("exp.host")) body = JSON.parse(String(init?.body));
      return Response.json({ data: [{ status: "ok" }, { status: "ok" }] });
    });

    await deliver(decision({ channels: ["push"] }), {
      ...recipient,
      pushTokens: ["a", "b"],
    });

    expect(body).toHaveLength(2);
  });
});

describe("transportFor", () => {
  it("resolves the implemented channels", () => {
    expect(transportFor("in_app")?.channel).toBe("in_app");
    expect(transportFor("email")?.channel).toBe("email");
    expect(transportFor("push")?.channel).toBe("push");
  });

  it("returns null for a channel with no implementation yet", () => {
    expect(transportFor("sms")).toBeNull();
    expect(transportFor("slack")).toBeNull();
  });

  it("reports an unimplemented channel as a failure rather than silently dropping it", async () => {
    const results = await deliver(decision({ channels: ["sms"] }), recipient);
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toContain("No transport");
  });

  it("always has in_app available", () => {
    expect(transportFor("in_app")?.isConfigured()).toBe(true);
  });
});
