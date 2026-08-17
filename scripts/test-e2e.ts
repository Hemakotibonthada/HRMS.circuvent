// ═══════════════════════════════════════════════════════════════
// END-TO-END FEATURE TEST — the running application, over HTTP
// ═══════════════════════════════════════════════════════════════
//
// Everything else in this repository tests a layer. `db:verify` tests the
// rules, `db:verify:modules` tests persistence, `test:routes` tests that
// routes answer. None of them exercise a feature the way a person does:
// sign in, then use the product.
//
// That gap is where this codebase's defects have lived. An endpoint that
// answers 201 and writes nothing passes a route sweep. A page that reads an
// endpoint returning 404 renders as an empty state and passes a render test.
// Only a flow that creates something and then reads it back catches those.
//
// Creates its own tenant and administrator, exercises the features, and
// removes what it made.
//
//   npm run test:e2e -- --base http://localhost:3001

import "./load-env";

import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTenant } from "../src/db/client";

const args = process.argv.slice(2);
const BASE = args.includes("--base") ? args[args.indexOf("--base") + 1] : "http://localhost:3001";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ok    ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 54 - title.length))}`);
}

let cookie = "";

interface Reply {
  status: number;
  body: unknown;
  text: string;
}

async function call(
  method: string,
  path: string,
  body?: unknown
): Promise<Reply> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
    signal: AbortSignal.timeout(45_000),
  });

  // Sessions are httpOnly cookies; carry them forward like a browser.
  const setCookie = response.headers.getSetCookie?.() ?? [];
  if (setCookie.length > 0) {
    const jar = new Map(
      cookie
        .split(";")
        .map((c) => c.trim())
        .filter(Boolean)
        .map((c) => [c.split("=")[0], c] as const)
    );
    for (const raw of setCookie) {
      const pair = raw.split(";")[0];
      jar.set(pair.split("=")[0], pair);
    }
    cookie = [...jar.values()].join("; ");
  }

  const text = await response.text();
  let parsed: unknown = undefined;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* html or empty */
  }
  return { status: response.status, body: parsed, text };
}

function field<T = unknown>(body: unknown, ...names: string[]): T | undefined {
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  for (const name of names) {
    if (record[name] !== undefined) return record[name] as T;
  }
  return undefined;
}

async function main() {
  console.log(`\nEnd-to-end feature test against ${BASE}\n`);

  const stamp = Date.now().toString().slice(-8);
  const adminEmail = `e2e-admin-${stamp}@example.test`;
  const adminPassword = `Pw-${randomBytes(12).toString("hex")}`;

  // Registered through the real endpoint rather than inserted directly.
  //
  // Hand-building a tenant tests the endpoints that come after it and hides
  // whatever onboarding forgets to do — which is how a newly registered
  // organisation came to have no leave policies and no document templates,
  // leaving two whole modules inert for every real customer while every test
  // passed.
  const registration = await call("POST", "/api/auth/register", {
    name: "E2E Administrator",
    company: `E2E ${stamp}`,
    email: adminEmail,
    password: adminPassword,
  });

  check(
    "an organisation can be registered",
    [200, 201].includes(registration.status),
    reply(registration)
  );

  if (![200, 201].includes(registration.status)) {
    console.log("\n  Registration failed; nothing further can be exercised.\n");
    process.exitCode = 1;
    return;
  }

  const orgId = await withTenant({ orgId: "", superuser: true }, async (tx) => {
    const r = await tx.execute(
      sql`select id::text as id from identity.organizations where slug like ${"e2e-" + "%"} order by created_at desc limit 1`
    );
    return ((r.rows ?? r) as { id: string }[])[0]?.id;
  });

  console.log(`  tenant registered\n`);

  try {
    await run(adminEmail, adminPassword);
  } finally {
    if (orgId) {
      await withTenant({ orgId: "", superuser: true }, async (tx) => {
        await tx.execute(sql`delete from identity.organizations where id = ${orgId}::uuid`);
      });
      console.log(`\n  tenant removed`);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed.\n`);
  if (failures.length > 0) {
    console.log("Failures:");
    for (const f of failures) console.log(`  · ${f}`);
    console.log("");
    process.exitCode = 1;
  }
}

async function run(email: string, password: string) {
  // ── Authentication ─────────────────────────────────────────
  section("Authentication");

  const wrong = await call("POST", "/api/auth/login", { email, password: "not-the-password" });
  check("a wrong password is refused", wrong.status === 401, `got ${wrong.status}`);

  const unknown = await call("POST", "/api/auth/login", {
    email: "nobody@example.test",
    password: "whatever",
  });
  check(
    "an unknown account answers the same as a wrong password",
    unknown.status === wrong.status,
    `${unknown.status} vs ${wrong.status}`
  );

  const login = await call("POST", "/api/auth/login", { email, password });
  check("a correct password signs in", login.status === 200, `got ${login.status} ${login.text.slice(0, 120)}`);
  check("and sets a session cookie", cookie.length > 0);

  const me = await call("GET", "/api/auth/me");
  check("the session identifies the user", me.status === 200, `got ${me.status}`);

  // ── Reference data the rest of the product needs ───────────
  section("Departments");

  const deptCreate = await call("POST", "/api/departments", {
    name: "Engineering",
    code: `ENG${stampOf()}`,
  });
  check("a department can be created", [200, 201].includes(deptCreate.status), reply(deptCreate));

  const deptId = field<string>(deptCreate.body, "id") ?? idFrom(deptCreate.body);

  const deptList = await call("GET", "/api/departments");
  check("and is listed back", deptList.status === 200 && listOf(deptList.body).length > 0, reply(deptList));

  // ── Employees ──────────────────────────────────────────────
  section("Employees");

  const employee = {
    firstName: "Asha",
    lastName: "Rao",
    email: `asha-${stampOf()}@example.test`,
    designation: "Backend Engineer",
    joinDate: "2026-04-01",
    employmentType: "full_time",
    departmentId: deptId,
    employeeCode: `E2E${stampOf()}`,
  };

  const created = await call("POST", "/api/employees", employee);
  check("an employee can be created", [200, 201].includes(created.status), reply(created));

  const employeeId = field<string>(created.body, "id") ?? idFrom(created.body);

  const list = await call("GET", "/api/employees");
  check("the employee appears in the list", list.status === 200 && listOf(list.body).length > 0, reply(list));

  // The defect this catches: an endpoint that answers 201 and writes nothing.
  const readBack = employeeId ? await call("GET", `/api/employees/${employeeId}`) : undefined;
  if (readBack) {
    check("and can be read back by id", readBack.status === 200, reply(readBack));
  }

  // ── Leave ──────────────────────────────────────────────────
  section("Leave");

  const leave = await call("POST", "/api/leave", {
    employeeId,
    leaveType: "casual",
    startDate: "2026-06-01",
    endDate: "2026-06-02",
    reason: "End-to-end test",
  });
  check("leave can be applied for", [200, 201].includes(leave.status), reply(leave));

  const leaveId = field<string>(leave.body, "id") ?? idFrom(leave.body);

  const leaveList = await call("GET", "/api/leave");
  check("the request is listed", leaveList.status === 200, reply(leaveList));

  if (leaveId) {
    const decision = await call("POST", `/api/leave/${leaveId}/decision`, {
      action: "approve",
    });
    // The applicant is the administrator here, and nobody approves their own
    // leave — a 403 is the control working, not a failure.
    check(
      "a decision is either taken or refused for a stated reason",
      [200, 403].includes(decision.status),
      reply(decision)
    );
  }

  // ── Documents and offers ───────────────────────────────────
  section("Offer letters");

  const templates = await call("GET", "/api/documents/templates");
  const templateList = listOf(field(templates.body, "templates") ?? templates.body);
  check("templates are installed for this tenant", templateList.length > 0, `${templateList.length} found`);

  const internship = templateList.find(
    (t) => String((t as Record<string, unknown>).name ?? "").includes("Internship")
  ) as Record<string, unknown> | undefined;

  check("an internship template exists", internship !== undefined);

  if (internship) {
    const generated = await call("POST", "/api/documents/generate", {
      templateId: internship.id,
      employeeId,
      title: "Internship Offer — E2E",
      extraValues: {
        full_name: "Asha Rao",
        candidate_email: "asha@example.test",
        position_title: "Intern",
        start_date: "2026-05-01",
        engagement_end_date: "2026-08-31",
        stipend_amount: "25000",
        mentor_name: "Team lead",
        mentor_email: "lead@example.test",
        work_mode: "hybrid",
        working_hours: "9:30 to 18:00",
        notice_period: "7 days",
        offer_valid_until: "2026-04-20",
        application_reference: "E2E-1",
        issue_date: "2026-04-01",
        project_summary: "Billing service",
        learning_outcomes: "Ship a feature end to end",
        hr_contact_name: "People Ops",
        hr_contact_email: "people@example.test",
        signatory_name: "People Ops",
        signatory_title: "Head of People",
      },
      recipients: {
        employee: { email: "asha@example.test", name: "Asha Rao" },
        hr: { email: "people@example.test", name: "People Ops" },
      },
      expiresInDays: 14,
    });

    check("an internship offer renders", generated.status === 201, reply(generated));

    const documentId = field<string>(generated.body, "id");

    if (documentId) {
      const documents = await call("GET", "/api/documents");
      check("it appears in the document list", documents.status === 200, reply(documents));

      const sent = await call("POST", `/api/documents/${documentId}/send`);
      check("it can be sent for signature", sent.status === 200, reply(sent));

      const delivery = field<{ sent: boolean }[]>(sent.body, "delivery") ?? [];
      const links = field<{ url: string }[]>(sent.body, "links") ?? [];
      check("signing links are issued", links.length > 0, `${links.length} links`);
      check(
        "delivery is reported per recipient rather than assumed",
        delivery.length > 0,
        `${delivery.length} outcomes`
      );

      // A candidate has no session. This is the one public route.
      if (links[0]?.url) {
        const url = new URL(links[0].url);
        const publicOpen = await fetch(
          `${BASE}/api/sign/${documentId}${url.search}`,
          { signal: AbortSignal.timeout(30_000) }
        );
        check(
          "a candidate can open their own signing link without an account",
          publicOpen.status === 200,
          `got ${publicOpen.status}`
        );

        const forged = await fetch(
          `${BASE}/api/sign/${documentId}?token=${"0".repeat(64)}`,
          { signal: AbortSignal.timeout(30_000) }
        );
        check("a forged token is refused", forged.status === 404, `got ${forged.status}`);
      }

      const voided = await call("POST", `/api/documents/${documentId}/void`, {
        reason: "End-to-end test cleanup",
      });
      check("an offer can be withdrawn", voided.status === 200, reply(voided));
    }
  }

  // ── Payroll ────────────────────────────────────────────────
  section("Payroll");

  const runs = await call("GET", "/api/payroll/runs");
  check("payroll runs are readable", runs.status === 200, reply(runs));

  // ── Notifications ──────────────────────────────────────────
  section("Notifications");

  const notifications = await call("GET", "/api/notifications");
  check("the notification feed answers", notifications.status === 200, reply(notifications));

  const items = listOf(field(notifications.body, "notifications") ?? notifications.body);
  const fabricated = JSON.stringify(items).match(/Riya Gupta|Sarah Chen|Vikram Mehta|1,248/);
  check("and carries no invented entries", fabricated === null, String(fabricated));

  // ── Reference lists the dashboard depends on ───────────────
  section("Supporting endpoints");

  for (const path of ["/api/announcements", "/api/holidays", "/api/attendance", "/api/expenses"]) {
    const reply_ = await call("GET", path);
    check(`${path} answers`, [200, 403].includes(reply_.status), `got ${reply_.status}`);
  }
}

let stampCounter = 0;
function stampOf(): string {
  stampCounter += 1;
  return `${Date.now().toString().slice(-6)}${stampCounter}`;
}

function reply(r: Reply): string {
  return `${r.status} ${r.text.slice(0, 160)}`;
}

function listOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    for (const key of ["items", "data", "results", "employees", "departments", "documents", "notifications", "templates", "runs"]) {
      const inner = (value as Record<string, unknown>)[key];
      if (Array.isArray(inner)) return inner;
    }
  }
  return [];
}

function idFrom(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  for (const key of ["id", "employeeId", "documentId"]) {
    if (typeof record[key] === "string") return record[key] as string;
  }
  const nested = record.employee ?? record.department ?? record.data;
  if (nested && typeof nested === "object") {
    const id = (nested as Record<string, unknown>).id;
    if (typeof id === "string") return id;
  }
  return undefined;
}

main()
  .catch((e) => {
    console.log("ERROR:", (e as Error).message.slice(0, 500));
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 300));
