/*
 * Seeds the letters HRMS had no template for, and removes the duplicates.
 *
 *   node scripts/seed-letter-templates.mjs
 *
 * ## Why this exists
 *
 * `hrms.document_templates` held twelve letters and, in the main organisation,
 * held every one of them twice. A generator selecting "the Offer Letter" got
 * whichever of the two the planner happened to return, so editing one and
 * generating from the other is a letter that changes between runs for no
 * visible reason. Nothing warns you: both rows are active, both are valid, and
 * the difference only shows up in the PDF somebody has already signed.
 *
 * Missing entirely were the letters that follow an offer -- the joining letter
 * the candidate actually reports to work on, the appointment and confirmation
 * letters, and the certificates people ask for on the way out. An internship
 * could be offered and never completed, in the sense that there was no document
 * to say it had been.
 *
 * ## Composition rather than copies
 *
 * Every letter here is built from one `shell()`, which carries the stylesheet
 * and the letterhead lifted verbatim from the existing Offer Letter. The
 * alternative -- twelve standalone HTML documents -- is twelve places for the
 * company address to be formatted differently, and it is how the first twelve
 * ended up subtly inconsistent.
 *
 * Idempotent: an existing template of the same name is left alone unless
 * --force is passed, so running this after somebody has edited a letter in the
 * product does not overwrite their wording.
 */
import { Client } from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const FORCE = process.argv.includes("--force");

function env() {
  const file = path.join(root, "..", ".env.local");
  if (!process.env.DATABASE_URL && fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/);
      if (m) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}

/** The stylesheet every Circuvent letter shares. */
const CSS = fs.readFileSync(path.join(root, "letter-shell.css"), "utf8");

/**
 * The document around a letter's content.
 *
 * The letterhead, the recipient block, the signature and the footer are the
 * same on every letter the company issues, so they are written once. A letter
 * supplies its title, an optional subtitle, and its sections.
 */
function shell({ title, subtitle, sections, closing, signatoryBlock = true }) {
  const body = sections
    .map(
      (s) => `
      <div class="section">
        <p class="section-title">${s.title}</p>
        <div class="section-body">${s.html}</div>
      </div>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>{{company_name}} · ${title}</title>
    <style>${CSS}</style>
  </head>
  <body>
    <div class="wrapper">
      <div class="wrapper-inner">
        <div class="letterhead">
          <div class="brand">
            <p class="brand-name">{{company_name}}</p>
            <p class="brand-info">{{company_address}}</p>
            <p class="brand-info">{{company_contact}}</p>
            <p class="brand-info">{{company_registration}}</p>
          </div>
          <div class="meta">
            <p><strong>Date</strong><br />{{issue_date}}</p>
            <p><strong>Reference</strong><br />{{document_reference}}</p>
          </div>
        </div>

        <div class="candidate-block">
          <p><strong>{{full_name}}</strong></p>
          <p>{{candidate_email}}</p>
        </div>

        <h1>${title}</h1>
        ${subtitle ? `<p class="lead">${subtitle}</p>` : ""}
        ${body}

        ${closing ? `<div class="note">${closing}</div>` : ""}

        ${
          signatoryBlock
            ? `<div class="signature">
          <div>
            <p>For and on behalf of {{company_name}}</p>
            <p><strong>{{signatory_name}}</strong><br />{{signatory_title}}</p>
          </div>
        </div>`
            : ""
        }

        <div class="footer">
          <p>{{company_name}} · {{company_address}} · {{company_registration}}</p>
          <p>Questions about this letter: {{hr_contact_name}}, {{hr_contact_email}}</p>
        </div>
      </div>
    </div>
  </body>
</html>`;
}

const row = (label, value) => `<tr><th>${label}</th><td>${value}</td></tr>`;
const table = (rows) => `<table class="data"><tbody>${rows.join("")}</tbody></table>`;

/* ───────────────────────────────────────────── the new letters ── */

const TEMPLATES = [
  {
    name: "Joining Letter",
    category: "letter",
    requiresSignature: true,
    signatoryRoles: ["employee", "hr"],
    build: () =>
      shell({
        title: "Joining Letter",
        subtitle:
          "This letter confirms the details of your joining. Please bring a signed copy with you on your first day.",
        sections: [
          {
            title: "Your joining",
            html: table([
              row("Position", "{{position_title}}"),
              row("Department", "{{department}}"),
              row("Reporting to", "{{reporting_manager}}"),
              row("Date of joining", "{{join_date}}"),
              row("Reporting time", "{{reporting_time}}"),
              row("Place of work", "{{work_location}}"),
              row("Employee code", "{{employee_code}}"),
            ]),
          },
          {
            title: "Where to report",
            html: `<p>Please report to {{reporting_manager}} at {{work_location}} at {{reporting_time}} on {{join_date}}. Ask for {{hr_contact_name}} at reception; they will be expecting you.</p>`,
          },
          {
            title: "What to bring",
            html: `<p>{{documents_to_bring}}</p><p>Originals are seen and returned the same day; we keep copies only.</p>`,
          },
          {
            title: "Your first day",
            html: `<p>{{first_day_plan}}</p>`,
          },
        ],
        closing:
          "If anything here is wrong, or if you cannot join on the date above, tell {{hr_contact_name}} at {{hr_contact_email}} before {{join_date}} rather than on the day.",
      }),
  },
  {
    name: "Appointment Letter",
    category: "letter",
    requiresSignature: true,
    signatoryRoles: ["employee", "hr"],
    build: () =>
      shell({
        title: "Letter of Appointment",
        subtitle:
          "This is the formal record of your appointment and the terms it is made on.",
        sections: [
          {
            title: "Appointment",
            html: table([
              row("Position", "{{position_title}}"),
              row("Department", "{{department}}"),
              row("Employee code", "{{employee_code}}"),
              row("Date of joining", "{{join_date}}"),
              row("Employment type", "{{employment_type}}"),
              row("Place of work", "{{work_location}}"),
            ]),
          },
          {
            title: "Remuneration",
            html: `${table([
              row("Annual cost to company", "{{annual_ctc}}"),
              row("Pay frequency", "Monthly, on the last working day of each month"),
            ])}<p>Your detailed salary structure is issued separately and forms part of this appointment.</p>`,
          },
          {
            title: "Probation and confirmation",
            html: `<p>Your appointment is subject to a probationary period of {{probation_months}} months from {{join_date}}. Confirmation follows a review at the end of that period and is communicated in writing.</p>`,
          },
          {
            title: "Notice",
            html: `<p>Either party may end this appointment by giving {{notice_period}} written notice, or salary in lieu. During probation the notice period is {{probation_notice_period}}.</p>`,
          },
          {
            title: "Terms you accept",
            html: `<p>{{policy_acknowledgements}}</p>`,
          },
        ],
        closing:
          "Please sign and return one copy. Retain the other for your records.",
      }),
  },
  {
    name: "Confirmation Letter",
    category: "letter",
    requiresSignature: true,
    signatoryRoles: ["hr"],
    build: () =>
      shell({
        title: "Confirmation of Employment",
        subtitle: "Your probationary period is complete and your employment is confirmed.",
        sections: [
          {
            title: "Confirmation",
            html: table([
              row("Position", "{{position_title}}"),
              row("Department", "{{department}}"),
              row("Employee code", "{{employee_code}}"),
              row("Date of joining", "{{join_date}}"),
              row("Confirmed with effect from", "{{confirmation_date}}"),
            ]),
          },
          {
            title: "What changes",
            html: `<p>Your notice period is now {{notice_period}}. Leave accrues under the confirmed-employee policy from {{confirmation_date}}, and you become eligible for {{benefits_on_confirmation}}.</p>`,
          },
          {
            title: "Review",
            html: `<p>{{review_summary}}</p>`,
          },
        ],
        closing: "Congratulations, and thank you for the work so far.",
      }),
  },
  {
    name: "Internship Completion Certificate",
    category: "letter",
    requiresSignature: true,
    signatoryRoles: ["hr"],
    build: () =>
      shell({
        title: "Internship Completion Certificate",
        subtitle: null,
        sections: [
          {
            title: "This is to certify",
            html: `<p>that <strong>{{full_name}}</strong> completed an internship with {{company_name}} as {{position_title}} in the {{department}} team, from {{start_date}} to {{engagement_end_date}}.</p>`,
          },
          {
            title: "The work",
            html: `<p>{{project_summary}}</p>`,
          },
          {
            title: "What was learned",
            html: `<p>{{learning_outcomes}}</p>`,
          },
          {
            title: "Conduct",
            html: `<p>{{conduct_remark}}</p>`,
          },
        ],
        closing:
          "Issued at the intern's request. This certificate records the engagement described above and nothing further.",
      }),
  },
  {
    name: "Training Completion Certificate",
    category: "letter",
    requiresSignature: true,
    signatoryRoles: ["hr"],
    build: () =>
      shell({
        title: "Certificate of Training",
        subtitle: null,
        sections: [
          {
            title: "This is to certify",
            html: `<p>that <strong>{{full_name}}</strong> ({{employee_code}}) completed <strong>{{course_name}}</strong>, delivered by {{trainer_name}}, between {{start_date}} and {{engagement_end_date}}.</p>`,
          },
          {
            title: "Covered",
            html: `<p>{{course_summary}}</p>`,
          },
          {
            title: "Assessment",
            html: table([
              row("Duration", "{{course_duration}}"),
              row("Result", "{{assessment_result}}"),
            ]),
          },
        ],
      }),
  },
  {
    name: "Relieving Letter",
    category: "letter",
    requiresSignature: true,
    signatoryRoles: ["hr"],
    build: () =>
      shell({
        title: "Relieving Letter",
        subtitle:
          "This letter confirms that you have been relieved of your duties and that nothing is outstanding.",
        sections: [
          {
            title: "Employment",
            html: table([
              row("Position held", "{{position_title}}"),
              row("Department", "{{department}}"),
              row("Employee code", "{{employee_code}}"),
              row("Date of joining", "{{join_date}}"),
              row("Last working day", "{{last_working_day}}"),
              row("Reason for leaving", "{{exit_reason}}"),
            ]),
          },
          {
            title: "Settlement",
            html: `<p>Your full and final settlement {{settlement_status}}. Company property recorded against you {{asset_status}}.</p>`,
          },
        ],
        closing:
          "We wish you well. A request to verify this employment may be sent to {{hr_contact_email}}.",
      }),
  },
  {
    name: "Experience Certificate",
    category: "letter",
    requiresSignature: true,
    signatoryRoles: ["hr"],
    build: () =>
      shell({
        title: "Experience Certificate",
        subtitle: null,
        sections: [
          {
            title: "This is to certify",
            html: `<p>that <strong>{{full_name}}</strong> ({{employee_code}}) was employed with {{company_name}} as {{position_title}} in the {{department}} team, from {{join_date}} to {{last_working_day}}.</p>`,
          },
          {
            title: "Conduct",
            html: `<p>{{conduct_remark}}</p>`,
          },
        ],
        closing:
          "Issued at the employee's request. This certificate records the period of employment described above and nothing further.",
      }),
  },
  {
    name: "Appreciation Certificate",
    category: "letter",
    requiresSignature: true,
    signatoryRoles: ["hr"],
    build: () =>
      shell({
        title: "Certificate of Appreciation",
        subtitle: null,
        sections: [
          {
            title: "Presented to",
            html: `<p><strong>{{full_name}}</strong> ({{employee_code}}), {{position_title}}, {{department}}.</p>`,
          },
          {
            title: "In recognition of",
            html: `<p>{{recognition_reason}}</p>`,
          },
          {
            title: "Period",
            html: `<p>{{recognition_period}}</p>`,
          },
        ],
      }),
  },
];

/** Every {{token}} a body actually contains, so the column is never a guess. */
function tokensIn(body) {
  return [...new Set([...body.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)].map((m) => m[1]))].sort();
}

const client = new Client({ connectionString: env() });
await client.connect();
await client.query("SELECT set_config('app.superuser','on',false)");

/* ── 1. Remove the duplicates ───────────────────────────────── */

const dupes = await client.query(
  `DELETE FROM hrms.document_templates t
    USING (
      SELECT id, row_number() OVER (
               PARTITION BY org_id, name ORDER BY updated_at DESC NULLS LAST, created_at DESC, id
             ) AS rn
        FROM hrms.document_templates
    ) ranked
    WHERE t.id = ranked.id AND ranked.rn > 1
    RETURNING t.name`
);
console.log(`Removed ${dupes.rowCount} duplicate template(s).`);

/* ── 2. Add the missing letters, per organisation ───────────── */

const orgs = await client.query(
  `SELECT DISTINCT org_id::text AS org_id FROM hrms.document_templates`
);

let added = 0;
let kept = 0;
for (const { org_id: orgId } of orgs.rows) {
  for (const template of TEMPLATES) {
    const body = template.build();
    const tokens = tokensIn(body);

    const existing = await client.query(
      `SELECT id FROM hrms.document_templates WHERE org_id = $1::uuid AND name = $2 LIMIT 1`,
      [orgId, template.name]
    );

    if (existing.rowCount > 0 && !FORCE) {
      kept += 1;
      continue;
    }

    if (existing.rowCount > 0) {
      await client.query(
        `UPDATE hrms.document_templates
            SET body = $3, required_tokens = $4::jsonb, requires_signature = $5,
                signatory_roles = $6::jsonb, version = version + 1, updated_at = now()
          WHERE id = $1::uuid AND org_id = $2::uuid`,
        [
          existing.rows[0].id,
          orgId,
          body,
          JSON.stringify(tokens),
          template.requiresSignature,
          JSON.stringify(template.signatoryRoles),
        ]
      );
    } else {
      await client.query(
        `INSERT INTO hrms.document_templates
           (org_id, name, category, body, required_tokens, requires_signature,
            signatory_roles, version, is_active)
         VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7::jsonb, 1, true)`,
        [
          orgId,
          template.name,
          template.category,
          body,
          JSON.stringify(tokens),
          template.requiresSignature,
          JSON.stringify(template.signatoryRoles),
        ]
      );
    }
    added += 1;
  }
}

console.log(`${added} template(s) written, ${kept} left as they were.`);

const summary = await client.query(
  `SELECT name, count(*)::int AS copies FROM hrms.document_templates
    GROUP BY name ORDER BY name`
);
console.log("\nTemplates now on file:");
for (const t of summary.rows) console.log(`  ${String(t.copies).padStart(2)} × ${t.name}`);

await client.end();
