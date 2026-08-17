// Proves expense claims actually persist, against a real Postgres engine
// (PGlite) with the real migrations and real row-level security.
//
// This exists because the thing being replaced *looked* like it worked. The
// old `/api/expenses` returned 201 "Expense submitted" and wrote nothing, and
// no unit test would have caught it — the route was internally consistent, it
// just had no database behind it. So the check that matters is the boring one:
// submit a claim, then read it back in a separate transaction.

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { canTransition, formatClaimNumber, totalOfLineItems } from "../src/lib/expense-rules";
import {
  buildSlots,
  createAccessToken,
  hashContent,
  hashToken,
  render,
} from "../src/lib/document-rules";
import { ruleFor, validateOffer } from "../src/lib/offer-rules";

const MIGRATIONS_DIR = join(process.cwd(), "drizzle");

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ok    ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
  }
}

async function applyMigrations(db: PGlite) {
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
}

async function main() {
  console.log("Expense claims against a real Postgres\n");

  const db = new PGlite();
  await applyMigrations(db);

  const org = (
    await db.query<{ id: string }>(
      `INSERT INTO identity.organizations (name, slug) VALUES ('Acme', 'acme') RETURNING id`
    )
  ).rows[0].id;

  const other = (
    await db.query<{ id: string }>(
      `INSERT INTO identity.organizations (name, slug) VALUES ('Rival', 'rival') RETURNING id`
    )
  ).rows[0].id;

  const employee = (
    await db.query<{ id: string }>(
      `INSERT INTO hrms.employees (org_id, employee_code, first_name, last_name, work_email, designation, join_date)
       VALUES ($1, 'E-001', 'Asha', 'Rao', 'asha@acme.test', 'Engineer', '2024-01-01') RETURNING id`,
      [org]
    )
  ).rows[0].id;

  // ── Submission persists ────────────────────────────────────
  const lineItems = [
    { description: "Return flight", amountMinor: "1200000" },
    { description: "Airport taxi", amountMinor: "85050" },
  ];
  const total = totalOfLineItems(lineItems);
  check("line items total exactly", total === "1285050", `got ${total}`);

  const claimNumber = formatClaimNumber(2026, 1);
  const claimId = (
    await db.query<{ id: string }>(
      `INSERT INTO hrms.expense_claims
         (org_id, employee_id, claim_number, title, category, total_amount_minor, expense_date, line_items)
       VALUES ($1, $2, $3, 'Client visit, Pune', 'travel', $4, '2026-06-10', $5) RETURNING id`,
      [org, employee, claimNumber, total, JSON.stringify(lineItems)]
    )
  ).rows[0].id;

  // The whole point: read it back, in a separate statement.
  const readBack = (
    await db.query<{ total_amount_minor: string; status: string; claim_number: string }>(
      `SELECT total_amount_minor::text, status, claim_number FROM hrms.expense_claims WHERE id = $1`,
      [claimId]
    )
  ).rows[0];

  check("a submitted claim is still there afterwards", readBack !== undefined);
  check("with the amount it was filed for", readBack?.total_amount_minor === "1285050");
  check("and starts pending", readBack?.status === "pending");
  check("carrying a sortable claim number", readBack?.claim_number === "EXP-2026-000001");

  // ── Claim numbers are unique per org ───────────────────────
  let duplicateRejected = false;
  try {
    await db.query(
      `INSERT INTO hrms.expense_claims
         (org_id, employee_id, claim_number, title, category, total_amount_minor, expense_date)
       VALUES ($1, $2, $3, 'Duplicate', 'meals', 100, '2026-06-11')`,
      [org, employee, claimNumber]
    );
  } catch {
    duplicateRejected = true;
  }
  check("a duplicate claim number in the same org is rejected", duplicateRejected);

  // The same number in another organization is fine — they are separate books.
  const rivalEmployee = (
    await db.query<{ id: string }>(
      `INSERT INTO hrms.employees (org_id, employee_code, first_name, last_name, work_email, designation, join_date)
       VALUES ($1, 'E-001', 'Ravi', 'Iyer', 'ravi@rival.test', 'Engineer', '2024-01-01') RETURNING id`,
      [other]
    )
  ).rows[0].id;

  let crossOrgAllowed = true;
  try {
    await db.query(
      `INSERT INTO hrms.expense_claims
         (org_id, employee_id, claim_number, title, category, total_amount_minor, expense_date)
       VALUES ($1, $2, $3, 'Their claim', 'meals', 5000, '2026-06-11')`,
      [other, rivalEmployee, claimNumber]
    );
  } catch {
    crossOrgAllowed = false;
  }
  check("the same claim number in another org is allowed", crossOrgAllowed);

  // ── Tenant isolation ───────────────────────────────────────
  // PGlite connects as a superuser, which bypasses RLS unconditionally, so the
  // check runs as the application role the same way verify-migrations does.
  await db.exec(`SET ROLE hrms_app`);
  await db.exec(`SELECT set_config('app.org_id', '${org}', false)`);

  const visible = (
    await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM hrms.expense_claims`)
  ).rows[0].n;
  check("an org sees only its own claims", visible === "1", `saw ${visible}`);

  const leaked = (
    await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM hrms.expense_claims WHERE org_id = $1`,
      [other]
    )
  ).rows[0].n;
  check("and cannot reach another org's by asking for it", leaked === "0", `saw ${leaked}`);

  // Writing into another tenant is refused by the policy's WITH CHECK.
  let crossTenantWriteBlocked = false;
  try {
    await db.query(
      `INSERT INTO hrms.expense_claims
         (org_id, employee_id, claim_number, title, category, total_amount_minor, expense_date)
       VALUES ($1, $2, 'EXP-2026-000999', 'Planted', 'meals', 100, '2026-06-11')`,
      [other, rivalEmployee]
    );
  } catch {
    crossTenantWriteBlocked = true;
  }
  check("a claim cannot be planted in another org", crossTenantWriteBlocked);

  await db.exec(`RESET ROLE`);

  // ── The approval lifecycle ─────────────────────────────────
  check("pending -> approved is allowed", canTransition("pending", "approved"));
  check("approved -> reimbursed is allowed", canTransition("approved", "reimbursed"));
  check("pending -> reimbursed is refused", !canTransition("pending", "reimbursed"));
  check("approved -> approved is refused", !canTransition("approved", "approved"));

  await db.query(
    `UPDATE hrms.expense_claims SET status = 'approved', approved_at = now(), approved_amount_minor = $2 WHERE id = $1`,
    [claimId, "1200000"]
  );

  const partial = (
    await db.query<{ approved_amount_minor: string; total_amount_minor: string }>(
      `SELECT approved_amount_minor::text, total_amount_minor::text FROM hrms.expense_claims WHERE id = $1`,
      [claimId]
    )
  ).rows[0];

  check(
    "a partial approval keeps both the claimed and approved amounts",
    partial.total_amount_minor === "1285050" && partial.approved_amount_minor === "1200000"
  );

  await db.query(`UPDATE hrms.expense_claims SET reimbursed_at = now() WHERE id = $1`, [claimId]);
  const paid = (
    await db.query<{ reimbursed_at: Date | null; status: string }>(
      `SELECT reimbursed_at, status FROM hrms.expense_claims WHERE id = $1`,
      [claimId]
    )
  ).rows[0];

  check("reimbursement is recorded separately from approval", paid.reimbursed_at !== null);
  check("and does not overwrite the approval status", paid.status === "approved");

  // ═══════════════════════════════════════════════════════════
  // RECRUITMENT
  // ═══════════════════════════════════════════════════════════
  // `/api/recruitment` was the same kind of fake: "Job posted successfully",
  // "Candidate added", "Interview scheduled" — all 201, none of them writing.
  // `hrms.interviews` had no repository at all.

  console.log("\nRecruitment against a real Postgres\n");

  const job = (
    await db.query<{ id: string; slug: string }>(
      `INSERT INTO hrms.job_postings (org_id, title, slug, designation_placeholder)
       VALUES ($1, 'Senior Engineer', 'senior-engineer', NULL) RETURNING id, slug`,
      [org]
    ).catch(async () =>
      db.query<{ id: string; slug: string }>(
        `INSERT INTO hrms.job_postings (org_id, title, slug)
         VALUES ($1, 'Senior Engineer', 'senior-engineer') RETURNING id, slug`,
        [org]
      )
    )
  ).rows[0];

  check("a job posting persists", job?.id !== undefined);
  check("with a readable slug", job?.slug === "senior-engineer");

  // The slug is unique per org, which is what forces the -2 suffix rather than
  // a random one.
  let slugCollision = false;
  try {
    await db.query(
      `INSERT INTO hrms.job_postings (org_id, title, slug) VALUES ($1, 'Senior Engineer', 'senior-engineer')`,
      [org]
    );
  } catch {
    slugCollision = true;
  }
  check("a duplicate slug in the same org is rejected", slugCollision);

  const candidate = (
    await db.query<{ id: string }>(
      `INSERT INTO hrms.candidates (org_id, first_name, last_name, email)
       VALUES ($1, 'Meera', 'Nair', 'meera@example.test') RETURNING id`,
      [org]
    )
  ).rows[0].id;

  const application = (
    await db.query<{ id: string }>(
      `INSERT INTO hrms.applications (org_id, job_id, candidate_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [org, job.id, candidate]
    )
  ).rows[0].id;

  check("an application persists", application !== undefined);

  // ── Interviews: the orphaned table ─────────────────────────
  const interview = (
    await db.query<{ id: string }>(
      `INSERT INTO hrms.interviews (org_id, application_id, scheduled_at, panelist_ids)
       VALUES ($1, $2, '2026-07-01T10:00:00Z', '[]'::jsonb) RETURNING id`,
      [org, application]
    )
  ).rows[0].id;

  const bookedRow = (
    await db.query<{ status: string; duration_minutes: number; round: number }>(
      `SELECT status, duration_minutes, round FROM hrms.interviews WHERE id = $1`,
      [interview]
    )
  ).rows[0];

  check("a scheduled interview is still there afterwards", bookedRow !== undefined);
  check("defaulting to scheduled", bookedRow?.status === "scheduled");
  check("with a sane duration and round", bookedRow?.duration_minutes === 60 && bookedRow?.round === 1);

  // An interview must hang off a real application, or it is a calendar invite
  // nobody can act on — which is what writing nothing allowed.
  let orphanBlocked = false;
  try {
    await db.query(
      `INSERT INTO hrms.interviews (org_id, application_id, scheduled_at)
       VALUES ($1, '00000000-0000-0000-0000-000000000000', '2026-07-01T10:00:00Z')`,
      [org]
    );
  } catch {
    orphanBlocked = true;
  }
  check("an interview cannot be booked against a non-existent application", orphanBlocked);

  // ── Recruitment tenant isolation ───────────────────────────
  await db.exec(`SET ROLE hrms_app`);
  await db.exec(`SELECT set_config('app.org_id', '${other}', false)`);

  const jobsSeenByRival = (
    await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM hrms.job_postings`)
  ).rows[0].n;
  check("another org sees none of these job postings", jobsSeenByRival === "0", `saw ${jobsSeenByRival}`);

  const interviewsSeenByRival = (
    await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM hrms.interviews`)
  ).rows[0].n;
  check("nor any of the interviews", interviewsSeenByRival === "0", `saw ${interviewsSeenByRival}`);

  await db.exec(`RESET ROLE`);

  // ═══════════════════════════════════════════════════════════
  // EMPLOYEE LIFECYCLE
  // ═══════════════════════════════════════════════════════════
  // Onboarding and offboarding checklists had no storage at all: both pages
  // held tick state in React `useState`, and offboarding showed a
  // "Clearance updated" toast while saving nothing.

  console.log("\nLifecycle checklists against a real Postgres\n");

  const journey = (
    await db.query<{ id: string }>(
      `INSERT INTO hrms.lifecycle_journeys (org_id, employee_id, kind, anchor_date)
       VALUES ($1, $2, 'offboarding', '2026-07-31') RETURNING id`,
      [org, employee]
    )
  ).rows[0].id;

  await db.query(
    `INSERT INTO hrms.lifecycle_tasks (org_id, journey_id, task_key, title, phase, mandatory)
     VALUES
       ($1, $2, 'off_1', 'Laptop returned', 'assets', true),
       ($1, $2, 'off_2', 'Access revoked',  'it',     true),
       ($1, $2, 'off_3', 'Farewell lunch',  'social', false)`,
    [org, journey]
  );

  const stored = (
    await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM hrms.lifecycle_tasks WHERE journey_id = $1`,
      [journey]
    )
  ).rows[0].n;
  check("a checklist survives being written", stored === "3", `saw ${stored}`);

  // One journey of each kind per person, or two people tick different copies
  // of the same list and neither is the record.
  let duplicateJourneyBlocked = false;
  try {
    await db.query(
      `INSERT INTO hrms.lifecycle_journeys (org_id, employee_id, kind, anchor_date)
       VALUES ($1, $2, 'offboarding', '2026-08-31')`,
      [org, employee]
    );
  } catch {
    duplicateJourneyBlocked = true;
  }
  check("a second offboarding for the same person is rejected", duplicateJourneyBlocked);

  // But onboarding and offboarding can coexist — they are different journeys.
  let bothKindsAllowed = true;
  try {
    await db.query(
      `INSERT INTO hrms.lifecycle_journeys (org_id, employee_id, kind, anchor_date)
       VALUES ($1, $2, 'onboarding', '2024-01-01')`,
      [org, employee]
    );
  } catch {
    bothKindsAllowed = false;
  }
  check("onboarding and offboarding can coexist for one person", bothKindsAllowed);

  // A retried request must not duplicate a task and quietly drop the progress
  // percentage.
  let duplicateTaskBlocked = false;
  try {
    await db.query(
      `INSERT INTO hrms.lifecycle_tasks (org_id, journey_id, task_key, title, phase)
       VALUES ($1, $2, 'off_1', 'Laptop returned again', 'assets')`,
      [org, journey]
    );
  } catch {
    duplicateTaskBlocked = true;
  }
  check("the same task cannot be added twice to a journey", duplicateTaskBlocked);

  // ── Completion consistency ─────────────────────────────────
  // A clearance that looks done with no record of when answers nothing, which
  // is exactly the question an audit asks.
  let inconsistentBlocked = false;
  try {
    await db.query(
      `UPDATE hrms.lifecycle_tasks SET completed = true WHERE journey_id = $1 AND task_key = 'off_1'`,
      [journey]
    );
  } catch {
    inconsistentBlocked = true;
  }
  check("a task cannot be completed without recording when", inconsistentBlocked);

  await db.query(
    `UPDATE hrms.lifecycle_tasks SET completed = true, completed_at = now()
     WHERE journey_id = $1 AND task_key IN ('off_1','off_2')`,
    [journey]
  );

  const done = (
    await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM hrms.lifecycle_tasks WHERE journey_id = $1 AND completed`,
      [journey]
    )
  ).rows[0].n;
  check("ticking a task persists", done === "2", `saw ${done}`);

  let journeyInconsistentBlocked = false;
  try {
    await db.query(`UPDATE hrms.lifecycle_journeys SET status = 'completed' WHERE id = $1`, [
      journey,
    ]);
  } catch {
    journeyInconsistentBlocked = true;
  }
  check("a journey cannot be completed without recording when", journeyInconsistentBlocked);

  // ── Lifecycle tenant isolation ─────────────────────────────
  await db.exec(`SET ROLE hrms_app`);
  await db.exec(`SELECT set_config('app.org_id', '${other}', false)`);

  const journeysSeenByRival = (
    await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM hrms.lifecycle_journeys`)
  ).rows[0].n;
  check("another org sees no checklists", journeysSeenByRival === "0", `saw ${journeysSeenByRival}`);

  const tasksSeenByRival = (
    await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM hrms.lifecycle_tasks`)
  ).rows[0].n;
  check("nor any clearance tasks", tasksSeenByRival === "0", `saw ${tasksSeenByRival}`);

  await db.exec(`RESET ROLE`);

  // ── Offer documents: generation, dispatch and the token ────
  //
  // The offer pipeline is the one place in this product where an unauthenticated
  // stranger is given a working credential by email. The checks that matter are
  // that the document is really written, that the signing token is stored only
  // as a hash, and that neither escapes the tenant.
  console.log("\nOffer documents against a real Postgres\n");

  const template = (
    await db.query<{ id: string }>(
      `INSERT INTO hrms.document_templates (org_id, name, category, body, required_tokens, requires_signature, signatory_roles)
       VALUES ($1, 'Internship Offer Letter', 'letter', $2, $3, true, $4) RETURNING id`,
      [
        org,
        "<p>Dear {{full_name}}, your stipend is {{stipend_amount}} until {{engagement_end_date}}.</p>",
        JSON.stringify(["full_name", "stipend_amount", "engagement_end_date"]),
        JSON.stringify(["employee", "hr"]),
      ]
    )
  ).rows[0].id;

  check("an offer template persists", template !== undefined);

  const offerValues = {
    full_name: "Asha Rao",
    stipend_amount: "₹25,000",
    engagement_end_date: "2026-09-30",
  };
  const rendered = render(
    "<p>Dear {{full_name}}, your stipend is {{stipend_amount}} until {{engagement_end_date}}.</p>",
    offerValues
  );

  check("every token in the letter resolves", rendered.missing.length === 0, rendered.missing.join(", "));
  check("and nothing is left unrendered", !rendered.body.includes("{{"));

  const contentHash = await hashContent(rendered.body);

  const document = (
    await db.query<{ id: string; status: string }>(
      `INSERT INTO hrms.generated_documents (org_id, template_id, template_version, title, category, rendered_body, content_hash, status)
       VALUES ($1, $2, 1, 'Internship Offer Letter', 'letter', $3, $4, 'draft') RETURNING id, status`,
      [org, template, rendered.body, contentHash]
    )
  ).rows[0];

  check("a generated offer persists", document.id !== undefined);
  check("and starts as a draft", document.status === "draft");

  const storedBody = (
    await db.query<{ rendered_body: string; content_hash: string }>(
      `SELECT rendered_body, content_hash FROM hrms.generated_documents WHERE id = $1`,
      [document.id]
    )
  ).rows[0];

  check("the letter is frozen at generation", storedBody.rendered_body === rendered.body);
  check("under a hash that detects later tampering", storedBody.content_hash === contentHash);
  check(
    "and the hash changes if a single rupee does",
    (await hashContent(rendered.body.replace("25,000", "25,001"))) !== contentHash
  );

  // Signature slots, candidate first.
  const slots = buildSlots(["employee", "hr"], {
    employee: { email: "asha@example.test", name: "Asha Rao" },
    hr: { email: "people@acme.test", name: "People Ops" },
  });
  check("the candidate signs before the company", slots[0].signatoryRole === "employee");

  for (const slot of slots) {
    await db.query(
      `INSERT INTO hrms.document_signatures (org_id, document_id, signatory_email, signatory_name, signatory_role, sequence)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [org, document.id, slot.signatoryEmail, slot.signatoryName, slot.signatoryRole, slot.sequence]
    );
  }

  const slotCount = (
    await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM hrms.document_signatures WHERE document_id = $1`,
      [document.id]
    )
  ).rows[0].n;
  check("one signature slot per signatory", slotCount === "2", `got ${slotCount}`);

  // Dispatch: the plaintext token exists for exactly one moment.
  const { token, hash } = await createAccessToken();
  await db.query(
    `UPDATE hrms.document_signatures SET access_token_hash = $1 WHERE document_id = $2 AND signatory_role = 'employee'`,
    [hash, document.id]
  );
  await db.query(
    `UPDATE hrms.generated_documents SET status = 'sent', sent_at = now() WHERE id = $1`,
    [document.id]
  );

  const afterSend = (
    await db.query<{ status: string; sent_at: string | null }>(
      `SELECT status, sent_at FROM hrms.generated_documents WHERE id = $1`,
      [document.id]
    )
  ).rows[0];
  check("sending moves the offer out of draft", afterSend.status === "sent");
  check("and records when it went", afterSend.sent_at !== null);

  const storedToken = (
    await db.query<{ access_token_hash: string }>(
      `SELECT access_token_hash FROM hrms.document_signatures WHERE document_id = $1 AND signatory_role = 'employee'`,
      [document.id]
    )
  ).rows[0].access_token_hash;

  // A leaked database must not hand over working signing links for every
  // outstanding contract, so the plaintext must appear nowhere in the row.
  check("the signing token is stored hashed", storedToken !== token);
  check("the plaintext token is nowhere in the table", !storedToken.includes(token));
  check("and the hash verifies the token it was made from", (await hashToken(token)) === storedToken);
  check(
    "while a different token does not verify",
    (await hashToken(`${token}x`)) !== storedToken
  );

  // The rules that decide what an offer may say.
  check(
    "an internship offer stating a CTC is refused",
    !validateOffer({
      engagementType: "internship",
      values: { ...offerValues, mentor_name: "Lead", annual_ctc: "600000" },
    }).valid
  );
  check(
    "while a well-formed internship offer is accepted",
    validateOffer({
      engagementType: "internship",
      values: { ...offerValues, mentor_name: "Lead", start_date: "2026-04-01" },
    }).valid
  );
  check("and an intern is never told they get provident fund", !ruleFor("internship").statutory.providentFund);

  // ── Offer tenant isolation ─────────────────────────────────
  await db.exec(`SET ROLE hrms_app`);
  await db.exec(`SELECT set_config('app.org_id', '${other}', false)`);

  const offersSeenByRival = (
    await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM hrms.generated_documents`)
  ).rows[0].n;
  check("another org sees no offers", offersSeenByRival === "0", `saw ${offersSeenByRival}`);

  const signaturesSeenByRival = (
    await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM hrms.document_signatures`)
  ).rows[0].n;
  check(
    "nor any signing tokens",
    signaturesSeenByRival === "0",
    `saw ${signaturesSeenByRival}`
  );

  const templatesSeenByRival = (
    await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM hrms.document_templates`)
  ).rows[0].n;
  check("nor the templates they were written from", templatesSeenByRival === "0");

  await db.exec(`RESET ROLE`);

  await db.close();

  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Expense verification failed:", error);
  process.exit(1);
});
