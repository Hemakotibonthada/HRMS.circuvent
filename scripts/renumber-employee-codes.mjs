// ═══════════════════════════════════════════════════════════════
// Renumber employee codes as CV-NNN, and seat the founder
// ═══════════════════════════════════════════════════════════════
// One-off. Kept in the repository because it is the record of how the existing
// rows got their numbers, and because it has to be safe to re-run.
//
//   node scripts/renumber-employee-codes.mjs [--apply]
//
// Without --apply it prints the plan and changes nothing.
//
// ── Ordering ──
// By join date, then by when the row was created. An employee code that runs in
// the order people arrived is the only kind anybody can reason about; ordering
// by anything else makes CV-004 senior to CV-002 and the number stops meaning
// anything.
//
// ── admin@circuvent.com ──
// Retired as an *employee*, not as an account. It is a role mailbox — the same
// category as abuse@ and billing@, which is exactly the complaint that started
// this — and it duplicated the founder, who is a real person with a named
// address. The identity user, its logins and its roles are untouched, so
// nothing about signing in changes; only the row that put a shared mailbox in
// the staff directory goes.

import { readFileSync } from "node:fs";
import pg from "pg";

const APPLY = process.argv.includes("--apply");

const env = readFileSync(".env.local", "utf8");
const url = env
  .split(/\r?\n/)
  .find((l) => l.startsWith("DATABASE_URL="))
  .slice(13)
  .trim()
  .replace(/^["']|["']$/g, "");

const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query("SELECT set_config('app.superuser','on',false)");

const ROLE_MAILBOXES = ["admin@circuvent.com"];

await client.query("BEGIN");
try {
  // ── 1. Retire the role mailbox ──
  const retired = await client.query(
    `UPDATE hrms.employees
        SET deleted_at = now(), status = 'inactive', updated_at = now()
      WHERE work_email = ANY($1) AND deleted_at IS NULL
      RETURNING employee_code, work_email, designation`,
    [ROLE_MAILBOXES]
  );
  for (const r of retired.rows) {
    console.log(`retire  ${r.employee_code.padEnd(14)} ${r.work_email}  (${r.designation})`);
  }

  // ── 2. Renumber everybody who is left, in arrival order ──
  //
  // Two passes through a temporary prefix. Going straight from EMP-0001 to
  // CV-001 risks colliding with a code already taken by a row later in the
  // list, and the unique index would refuse it half way through.
  const people = await client.query(
    `SELECT e.id::text, e.employee_code, e.first_name, e.last_name, e.work_email, e.org_id::text
       FROM hrms.employees e
       JOIN identity.organizations o ON o.id = e.org_id
      WHERE o.slug = 'circuvent' AND e.deleted_at IS NULL
      ORDER BY e.join_date NULLS LAST, e.created_at`
  );

  const plan = people.rows.map((row, index) => ({
    ...row,
    next: `CV-${String(index + 1).padStart(3, "0")}`,
  }));

  console.log("");
  for (const p of plan) {
    const name = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
    console.log(`${p.employee_code.padEnd(14)} -> ${p.next.padEnd(8)} ${name.padEnd(30)} ${p.work_email}`);
  }

  for (const p of plan) {
    await client.query(`UPDATE hrms.employees SET employee_code = $2 WHERE id = $1::uuid`, [
      p.id,
      `TMP-${p.id.slice(0, 8)}`,
    ]);
  }
  for (const p of plan) {
    await client.query(
      `UPDATE hrms.employees SET employee_code = $2, updated_at = now() WHERE id = $1::uuid`,
      [p.id, p.next]
    );
  }

  // ── 3. Seat the founder ──
  //
  // Every fact below was entered by this person themselves, in the six-section
  // registration on the careers portal. Copying it across rather than retyping
  // it is the point: the candidate record and the employee record describe the
  // same human, and a second hand-typed copy is a second thing to be wrong.
  const founderEmail = "vema@circuvent.com";
  const candidateEmail = "hemakotibonthada@gmail.com";

  const { rows: candidateRows } = await client.query(
    `SELECT c.id::text, c.first_name, c.last_name, c.phone, c.skills, c.linkedin_url,
            r.date_of_birth, r.gender, r.blood_group, r.marital_status,
            r.present_line1, r.present_line2, r.present_city, r.present_state,
            r.present_pin, r.present_country, r.personal_email,
            r.emergency_contact_name, r.emergency_contact_relationship, r.emergency_contact_phone,
            r.pan_masked, r.aadhaar_masked, r.uan_masked
       FROM hrms.candidates c
       LEFT JOIN hrms.candidate_registration r ON r.candidate_id = c.id
      WHERE lower(c.email) = $1`,
    [candidateEmail]
  );
  const cand = candidateRows[0];
  if (!cand) throw new Error(`No candidate profile found for ${candidateEmail}`);

  const { rows: eduRows } = await client.query(
    `SELECT degree, specialisation, institution, board_university, end_year, score, score_type
       FROM hrms.candidate_registration_education
      WHERE candidate_id = $1::uuid ORDER BY seq`,
    [cand.id]
  );

  const qualifications = eduRows.map((e) => ({
    degree: e.degree ?? null,
    specialisation: e.specialisation ?? null,
    institution: e.institution ?? null,
    board: e.board_university ?? null,
    completedYear: e.end_year ?? null,
    score: e.score ? `${e.score}${e.score_type === "percentage" ? "%" : ""}` : null,
  }));

  const emergencyContact = cand.emergency_contact_name
    ? {
        name: cand.emergency_contact_name,
        relationship: cand.emergency_contact_relationship ?? null,
        phone: cand.emergency_contact_phone ?? null,
      }
    : null;

  const addressLine = [cand.present_line1, cand.present_line2].filter(Boolean).join(", ") || null;

  const updated = await client.query(
    `UPDATE hrms.employees
        SET first_name         = $2,
            last_name          = $3,
            designation        = 'Founder & Chief Executive Officer',
            personal_email     = coalesce($4, personal_email),
            phone              = coalesce($5, phone),
            date_of_birth      = coalesce($6::date, date_of_birth),
            gender             = coalesce($7, gender),
            blood_group        = coalesce($8, blood_group),
            marital_status     = coalesce($9, marital_status),
            address_line1      = coalesce($10, address_line1),
            city               = coalesce($11, city),
            state              = coalesce($12, state),
            postal_code        = coalesce($13, postal_code),
            country            = coalesce($14, country),
            emergency_contact  = coalesce($15::jsonb, emergency_contact),
            skills             = coalesce($16::jsonb, skills),
            qualifications     = coalesce($17::jsonb, qualifications),
            pan_number         = coalesce($18, pan_number),
            aadhaar_number     = coalesce($19, aadhaar_number),
            uan_number         = coalesce($20, uan_number),
            employment_type    = 'full_time',
            status             = 'active',
            updated_at         = now()
      WHERE work_email = $1 AND deleted_at IS NULL
      RETURNING employee_code, first_name, last_name, designation`,
    [
      founderEmail,
      cand.first_name,
      cand.last_name,
      cand.personal_email,
      cand.phone,
      cand.date_of_birth,
      cand.gender,
      cand.blood_group,
      cand.marital_status,
      addressLine,
      cand.present_city,
      cand.present_state,
      cand.present_pin,
      cand.present_country,
      emergencyContact ? JSON.stringify(emergencyContact) : null,
      cand.skills ? JSON.stringify(cand.skills) : null,
      qualifications.length ? JSON.stringify(qualifications) : null,
      // The masked forms. The registration stores these encrypted, and an
      // employee directory has no business holding a decryptable copy of
      // somebody's Aadhaar — the masked value is what a payroll clerk needs to
      // confirm they are looking at the right document.
      cand.pan_masked,
      cand.aadhaar_masked,
      cand.uan_masked,
      // `candidate_id` is deliberately not set here. `employees_candidate_unique_idx`
      // allows one employee per candidate, and that link already belongs to the
      // row the ATS hire created from this person's application. The constraint
      // is right, and it is pointing at something real: this human currently has
      // two employee records. Copying the facts across is safe; claiming the
      // same application twice is not.
    ]
  );

  console.log("");
  for (const r of updated.rows) {
    console.log(`founder ${r.employee_code}  ${r.first_name} ${r.last_name} — ${r.designation}`);
  }

  if (APPLY) {
    await client.query("COMMIT");
    console.log("\napplied.");
  } else {
    await client.query("ROLLBACK");
    console.log("\ndry run — nothing was changed. Re-run with --apply.");
  }
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
