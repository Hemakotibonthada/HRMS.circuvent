// End-to-end check of the billing screen, against a running server with a real
// signed-in session. Everything here goes through the browser, because the
// point is to test what a customer touches rather than what a unit test mocks.
//
// ── Running it ──
//
//   BASE=http://localhost:3002 STATE_PATH=./state.json node scripts/billing-e2e.mjs
//
// `STATE_PATH` is a Playwright storage state produced by signing in first.
// Playwright is deliberately not a dependency of this package — it would add a
// browser download to every install for a script that is run by hand — so run
// this from a checkout that has it, or install it locally first.
//
// A note on the credentials it writes: they are nonsense, and the last check
// removes them again. Leaving them behind would make a deployment report
// itself configured while being unable to take a single payment.
//
// It exits non-zero on any failure.

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3311";
const STATE_PATH = process.env.STATE_PATH;

const results = [];
const record = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch();
const context = await browser.newContext(
  STATE_PATH ? { storageState: STATE_PATH } : {}
);
const page = await context.newPage();

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

try {
  // ── The billing page renders at all ──
  await page.goto(`${BASE}/billing`, { waitUntil: "networkidle", timeout: 60000 });
  if (page.url().includes("/login")) {
    throw new Error(`not signed in — landed on ${page.url()}`);
  }
  record("reaches the billing page with a session", true, page.url());

  /*
   * Console errors are counted at page load only. Several checks below post
   * deliberately-bad requests and expect a 400, and the browser logs each one
   * — so a running total would report this script's own probes as page faults.
   */
  const loadErrors = [...consoleErrors];

  const body = await page.textContent("body");
  const broken =
    body.includes("Event handlers cannot be passed") ||
    body.includes("Application error") ||
    body.includes("Unhandled Runtime Error");
  record("billing page renders", !broken, broken ? body.slice(0, 200) : "");

  // ── The payment gateway card is on the screen ──
  const hasCard = body.includes("Payment gateway");
  record("payment gateway card is visible to an admin", hasCard);

  const hasKeyField = (await page.locator("#rzp-key-id").count()) > 0;
  record("key id field is present", hasKeyField);

  // ── The status endpoint answers, and never returns a secret ──
  const status = await page.evaluate(async () => {
    const r = await fetch("/api/billing/settings", { credentials: "include" });
    return { status: r.status, body: await r.text() };
  });
  record("settings endpoint answers", status.status === 200, `HTTP ${status.status}`);
  record(
    "settings endpoint returns no ciphertext",
    !status.body.includes("enc.v1."),
    status.body.slice(0, 120)
  );

  // ── Saving without verification stores the configuration ──
  const saved = await page.evaluate(async () => {
    const r = await fetch("/api/billing/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        keyId: "rzp_test_smokecheck",
        keySecret: "smoke-secret",
        webhookSecret: "smoke-hook",
        mode: "test",
        enabled: false,
        verify: false,
      }),
    });
    return { status: r.status, body: await r.text() };
  });
  record("saves credentials", saved.status === 200, `HTTP ${saved.status} ${saved.body.slice(0, 120)}`);
  record("save response hides the secret", !saved.body.includes("smoke-secret"));

  // ── A live key with the mode set to test is refused ──
  const mismatch = await page.evaluate(async () => {
    const r = await fetch("/api/billing/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ keyId: "rzp_live_x", mode: "test", enabled: false }),
    });
    return { status: r.status, body: await r.text() };
  });
  record("refuses a live key in test mode", mismatch.status === 400, mismatch.body.slice(0, 120));

  // ── Blank secret leaves the stored one alone ──
  const blank = await page.evaluate(async () => {
    const r = await fetch("/api/billing/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ keyId: "rzp_test_smokecheck", mode: "test", enabled: false }),
    });
    return { status: r.status, body: await r.json() };
  });
  record(
    "a blank secret does not erase the stored one",
    blank.status === 200 && blank.body.razorpay?.hasKeySecret === true,
    JSON.stringify(blank.body.razorpay ?? {})
  );

  // ── The connection test really reaches Razorpay ──
  // These credentials are nonsense, so Razorpay must reject them. A pass here
  // proves the request left the building and the failure was reported honestly.
  const tested = await page.evaluate(async () => {
    const r = await fetch("/api/billing/settings", { method: "POST", credentials: "include" });
    return { status: r.status, body: await r.text() };
  });
  record(
    "test connection reaches Razorpay and reports rejection",
    tested.status === 400 && !tested.body.includes("smoke-secret"),
    tested.body.slice(0, 160)
  );

  // ── Checkout refuses while payments are switched off ──
  const offCheckout = await page.evaluate(async () => {
    const r = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ plan: "starter" }),
    });
    return { status: r.status, body: await r.text() };
  });
  record(
    "checkout refuses while payments are off",
    offCheckout.status === 503,
    offCheckout.body.slice(0, 140)
  );

  // ── Verify rejects an unsigned payment ──
  const forged = await page.evaluate(async () => {
    const r = await fetch("/api/billing/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        razorpay_order_id: "order_forged",
        razorpay_payment_id: "pay_forged",
        razorpay_signature: "not-a-real-signature",
      }),
    });
    return { status: r.status, body: await r.text() };
  });
  record("verify rejects a forged payment", forged.status === 400, forged.body.slice(0, 140));

  // ── Removing the credentials leaves the deployment unable to charge ──
  // Also puts the database back as it was found: the smoke credentials above
  // are nonsense, and leaving them behind would make a real deployment look
  // configured when it cannot take a payment.
  const removed = await page.evaluate(async () => {
    const r = await fetch("/api/billing/settings", { method: "DELETE", credentials: "include" });
    return { status: r.status, body: await r.json() };
  });
  record(
    "removes the stored credentials",
    removed.status === 200 && removed.body.razorpay?.configured === false,
    JSON.stringify(removed.body.razorpay ?? {})
  );

  record(
    "no console errors when the billing page loads",
    loadErrors.length === 0,
    loadErrors.slice(0, 2).join(" | ")
  );
} catch (error) {
  record("run completed", false, error.message);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
// Exits non-zero on any failure. A check that reports a fault and passes the
// build is not a check.
process.exit(failed.length === 0 ? 0 : 1);
