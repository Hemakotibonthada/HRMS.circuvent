// ═══════════════════════════════════════════════════════════════
// DOCUMENT TEMPLATE CATALOG
// ═══════════════════════════════════════════════════════════════
// The eight templates carried over from Office.Circuvent
// (`backend/assets/templates/*.html`), ported to the token contract this
// product actually enforces.
//
// The design is theirs and is kept deliberately close — the two products should
// look like one company. Four things had to change, and each was a defect
// waiting to happen rather than a matter of taste:
//
//  1. **Tenant identity was hardcoded.** Seven of the eight templates carried
//     "#42, Innovation Park, Hyderabad", `www.circuvent.tech`, a phone number
//     and, on the offer letter, `CIN: U72900TG2019PTC000123`. Office is a
//     single-company deployment so that was harmless there. This product is
//     multi-tenant: importing them verbatim would put Circuvent's registered
//     company number on every customer's offer letters. A CIN identifies a
//     legal entity to the Registrar of Companies — the wrong one on a signed
//     contract is not a cosmetic error. Every such value is now a token.
//
//  2. **The logo was a `cid:` reference.** `cid:company_logo@circuvent`
//     resolves against a MIME part in an assembled email. These documents are
//     also rendered standalone — on the public signing page and into PDFs —
//     where a `cid:` URL is simply a broken image. The letterheads are now
//     typographic. That is not a downgrade for a legal document: what makes a
//     letterhead legally meaningful is the entity name, address and company
//     number, and `render()` has no conditionals, so a logo token would leave
//     `<img src="{{company_logo_url}}">` in a signed contract for any org that
//     had not set one.
//
//  3. **The offer letter injected eight raw HTML fragments.**
//     `{{compensation_breakdown_html}}`, `{{policies_html}}` and six more were
//     whole tables and lists pushed in as markup. `render()` in
//     `src/lib/document-rules.ts` HTML-escapes every value on purpose — a
//     candidate name or a termination reason must not be able to inject markup
//     into a document that is then signed — so those fragments would have
//     rendered as visible angle brackets. Widening the renderer to trust some
//     tokens would have reopened exactly the hole the escaping closes. Instead
//     the markup that is genuinely fixed is now part of the template, and the
//     parts that vary are plain tokens. Nothing is lost and the injection
//     surface is gone.
//
//  4. **Token syntax.** Office matched `[a-zA-Z0-9_.-]`, this product matches
//     `[a-zA-Z0-9_.]`. No template used a hyphen, so nothing needed renaming —
//     but a new one must not introduce it.
//
// `extractTokens` derives the token list from the body at read time, so nothing
// here needs to restate it; `catalog.test.ts` checks the bodies instead.

export interface TemplateSeed {
  /** Stable key, used to upsert without duplicating on a re-run. */
  templateType: string;
  name: string;
  /** `letter` is a document that may be signed; `mail` is an email body. */
  category: "letter" | "mail";
  description: string;
  body: string;
  requiresSignature: boolean;
  /** Ordered roles that must sign. Empty when nothing is signed. */
  signatoryRoles: string[];
}

// ─── Shared fragments ────────────────────────────────────────
// Kept as constants so eight templates cannot drift into eight different
// letterheads — which is what happened to the originals, where the same
// address appeared in four slightly different forms.

/** Tokens every template resolves, whatever else it needs. */
export const COMPANY_TOKENS = [
  "company_name",
  "company_address",
  "company_contact",
] as const;

const LETTER_STYLE = `
      :root { color-scheme: light; }
      @page { size: A4; margin: 20mm; }
      body {
        margin: 0;
        font-family: 'Calibri', 'Segoe UI', Arial, sans-serif;
        background: #ffffff;
        color: #1f2937;
        line-height: 1.6;
      }
      .wrapper { max-width: 760px; margin: 0 auto; background: #ffffff; }
      .wrapper-inner { padding: 32px 36px 40px; }
      .letterhead {
        display: flex; justify-content: space-between; gap: 32px;
        border-bottom: 1px solid #e2e8f0; padding-bottom: 20px; margin-bottom: 28px;
      }
      .brand-name {
        font-size: 18px; letter-spacing: 0.16em; text-transform: uppercase;
        font-weight: 700; color: #0f172a; margin: 0;
      }
      .brand-info { font-size: 13px; color: #475569; margin: 2px 0 0; letter-spacing: 0.04em; }
      .meta { min-width: 200px; text-align: right; font-size: 13px; color: #475569; }
      .meta-label {
        display: block; font-size: 11px; text-transform: uppercase;
        letter-spacing: 0.22em; color: #1e3a8a; margin-top: 10px;
      }
      .meta-value { display: block; font-weight: 600; color: #0f172a; margin-top: 4px; }
      p { margin: 16px 0; font-size: 16px; orphans: 3; widows: 3; }
      strong { color: #0f172a; }
      h1 { margin: 10px 0 22px; font-size: 28px; color: #1d4ed8; letter-spacing: -0.01em; }
      h1, h2, h3 { page-break-after: avoid; }
      .section { margin: 36px 0; page-break-inside: avoid; }
      .section-title {
        margin: 0 0 14px; font-size: 12px; text-transform: uppercase;
        letter-spacing: 0.24em; color: #1e3a8a; font-weight: 700; page-break-after: avoid;
      }
      .section-body {
        padding: 24px 28px; border: 1px solid #e2e8f0; border-radius: 18px; background: #ffffff;
      }
      .section-body p { margin: 12px 0; }
      ul.bullet { margin: 12px 0 0 18px; padding: 0; }
      ul.bullet li { margin: 10px 0; font-size: 15px; orphans: 2; widows: 2; }
      table.data { width: 100%; border-collapse: collapse; margin-top: 16px; }
      table.data th, table.data td {
        text-align: left; padding: 11px 14px; font-size: 15px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.35);
      }
      table.data th {
        font-size: 12px; text-transform: uppercase; letter-spacing: 0.2em;
        color: #475569; background: rgba(226, 232, 240, 0.45);
      }
      td.amount { text-align: right; font-weight: 600; color: #0f172a; }
      tr.total td { font-weight: 700; background: rgba(37, 99, 235, 0.08); }
      .note {
        margin: 28px 0; padding: 18px 22px; border-left: 4px solid #2563eb;
        background: rgba(59, 130, 246, 0.1); border-radius: 16px; font-size: 15px;
        page-break-inside: avoid;
      }
      .signature { margin-top: 48px; page-break-inside: avoid; }
      .signature strong { display: block; margin-bottom: 4px; }
      .footer {
        margin-top: 44px; border-top: 1px solid #e2e8f0; padding-top: 18px;
        font-size: 13px; color: #64748b; page-break-inside: avoid;
      }
      a { color: #2563eb; text-decoration: none; }
`;

/**
 * The letterhead.
 *
 * Typographic rather than an image — see note 2 at the top of this file. The
 * registration line only appears on instruments of employment: a company number
 * belongs on a contract and on a certificate of service, not on a payslip.
 */
function letterhead(meta: string, withRegistration = false): string {
  const registration = withRegistration
    ? '\n          <p class="brand-info">{{company_registration}}</p>'
    : "";

  return `      <div class="letterhead">
        <div class="brand">
          <p class="brand-name">{{company_name}}</p>
          <p class="brand-info">{{company_address}}</p>
          <p class="brand-info">{{company_contact}}</p>${registration}
        </div>
        <div class="meta">
${meta}
        </div>
      </div>`;
}

function letterOpen(title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>${LETTER_STYLE}    </style>
  </head>
  <body>
    <div class="wrapper">
      <div class="wrapper-inner">`;
}

const LETTER_CLOSE = `      </div>
    </div>
  </body>
</html>`;

const EMAIL_STYLE = `
      :root { color-scheme: light; }
      body {
        font-family: "Segoe UI", Helvetica, Arial, sans-serif;
        background: #f1f5f9; color: #0f172a; line-height: 1.7; margin: 0; padding: 0;
      }
      .wrapper { padding: 32px 16px; }
      .card {
        max-width: 640px; margin: 0 auto; background: #ffffff; border-radius: 20px;
        border: 1px solid rgba(148, 163, 184, 0.3); padding: 36px;
      }
      .letterhead-meta { margin-bottom: 20px; }
      .company-name {
        margin: 0; font-size: 15px; letter-spacing: 0.08em; text-transform: uppercase;
        font-weight: 700; color: #0f172a;
      }
      .company-info { margin: 2px 0 0; font-size: 12px; letter-spacing: 0.04em; color: #475569; }
      .rule { height: 1px; background: #e2e8f0; margin: 0 0 24px; }
      .badge {
        display: inline-block; padding: 6px 14px; border-radius: 999px;
        background: rgba(37, 99, 235, 0.12); color: #1d4ed8; text-transform: uppercase;
        letter-spacing: 0.22em; font-size: 11px; font-weight: 700;
      }
      h1 { color: #1d4ed8; margin: 18px 0 14px; font-size: 26px; }
      p { margin: 14px 0; font-size: 16px; }
      strong { color: #0f172a; }
      .details {
        margin: 24px 0; padding: 20px 24px; border-radius: 18px;
        background: rgba(37, 99, 235, 0.06); border: 1px solid rgba(37, 99, 235, 0.18);
      }
      .details-row { margin: 10px 0; }
      .details-label {
        display: block; text-transform: uppercase; letter-spacing: 0.2em;
        font-size: 11px; color: #1d4ed8; font-weight: 700; margin-bottom: 4px;
      }
      .details-value { font-size: 16px; font-weight: 600; }
      .cta {
        display: inline-block; margin-top: 20px; background: #1d4ed8; color: #ffffff;
        padding: 12px 26px; border-radius: 999px; text-decoration: none; font-weight: 600;
      }
      .callout {
        margin: 24px 0; padding: 16px 20px; border-left: 4px solid #2563eb;
        border-radius: 16px; background: rgba(59, 130, 246, 0.08); font-size: 15px;
      }
      ul.bullet { margin: 12px 0 0 18px; padding: 0; }
      ul.bullet li { margin: 8px 0; }
      .footer { margin-top: 28px; font-size: 15px; color: #475569; }
`;

function emailOpen(title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>${EMAIL_STYLE}    </style>
  </head>
  <body>
    <div class="wrapper">
      <div class="card">
        <div class="letterhead-meta">
          <p class="company-name">{{company_name}}</p>
          <p class="company-info">{{company_address}}</p>
          <p class="company-info">{{company_contact}}</p>
        </div>
        <div class="rule"></div>`;
}

const EMAIL_CLOSE = `      </div>
    </div>
  </body>
</html>`;

// ─── 1. Offer letter ─────────────────────────────────────────

const OFFER_LETTER = `${letterOpen("{{company_name}} · Offer of Employment")}
${letterhead(
  `          <span class="meta-label">Offer date</span>
          <span class="meta-value">{{issue_date}}</span>
          <span class="meta-label">Reference</span>
          <span class="meta-value">{{application_reference}}</span>`,
  true
)}

      <div class="candidate-block">
        <p>{{full_name}}</p>
        <p>{{candidate_email}}</p>
      </div>

      <h1>Welcome to {{company_name}}</h1>

      <p>Dear <strong>{{full_name}}</strong>,</p>
      <p>
        We are delighted to offer you the position of <strong>{{position_title}}</strong> at
        {{company_name}}. Your experience stood out throughout the selection process and we are
        confident you will make an immediate impact.
      </p>
      <p>
        Your first day is planned for <strong>{{start_date}}</strong>. You will report to
        <strong>{{manager_name}}</strong> and work <strong>{{work_mode}}</strong>, with standard
        hours of <strong>{{working_hours}}</strong>. Your probation period is
        <strong>{{probation_period}}</strong>.
      </p>

      <div class="section">
        <p class="section-title">Compensation</p>
        <div class="section-body">
          <p>
            Your total fixed compensation is <strong>{{annual_ctc}}</strong> per annum, paid
            monthly in line with our payroll calendar.
          </p>
          <table class="data">
            <thead>
              <tr><th>Component</th><th class="amount">Per annum</th></tr>
            </thead>
            <tbody>
              <tr><td>Basic salary</td><td class="amount">{{basic_salary}}</td></tr>
              <tr><td>House rent allowance</td><td class="amount">{{hra}}</td></tr>
              <tr><td>Special allowance</td><td class="amount">{{special_allowance}}</td></tr>
              <tr><td>Other allowances</td><td class="amount">{{other_allowances}}</td></tr>
              <tr class="total"><td>Gross salary</td><td class="amount">{{gross_salary}}</td></tr>
            </tbody>
          </table>
          <p>{{variable_pay_summary}}</p>
          <p>
            Provident fund, employees' state insurance where applicable, professional tax and
            income tax will be deducted in accordance with the statutes in force.
          </p>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Benefits</p>
        <div class="section-body">
          <ul class="bullet">
            <li>Benefits coverage begins on <strong>{{benefit_start_date}}</strong>.</li>
            <li>{{bonus_plan}}</li>
            <li>{{additional_benefits}}</li>
          </ul>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Policies you will acknowledge</p>
        <div class="section-body">
          <ul class="bullet">
            <li><strong>Code of conduct.</strong> Integrity, respect and professionalism in all dealings.</li>
            <li><strong>Data privacy and security.</strong> Handling of personal and company data under the controls in force.</li>
            <li><strong>Confidentiality.</strong> Execution of the non-disclosure agreement on or before joining.</li>
            <li><strong>Acceptable use.</strong> Company-approved devices and secure access practices.</li>
          </ul>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Documents to bring</p>
        <div class="section-body">
          <ul class="bullet">
            <li>Government-issued photo identification.</li>
            <li>Cancelled cheque or bank passbook copy for salary credit.</li>
            <li>Academic certificates and prior employment records.</li>
            <li>Recent passport-size photographs.</li>
          </ul>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Your contacts</p>
        <div class="section-body">
          <p><strong>Reporting manager:</strong> {{manager_name}} · {{manager_email}}</p>
          <p><strong>People operations:</strong> {{hr_contact_name}} · {{hr_contact_email}}</p>
        </div>
      </div>

      <div class="note">
        Please confirm your acceptance by <strong>{{signature_deadline}}</strong> so we can begin
        your onboarding. Do reach out if anything here needs clarifying.
      </div>

      <div class="signature">
        <p>Warm regards,</p>
        <strong>{{signatory_name}}</strong>
        <span>{{signatory_title}}</span>
        <span>{{company_name}}</span>
      </div>

      <div class="footer">
        <p>
          This offer is contingent on the completion of onboarding formalities, background
          verification and adherence to company policies.
        </p>
      </div>
${LETTER_CLOSE}`;

// ─── 2. Payslip statement ────────────────────────────────────

const PAYSLIP_STATEMENT = `${letterOpen("Payslip statement")}
${letterhead(
  `          <span class="meta-label">Pay period</span>
          <span class="meta-value">{{pay_period}}</span>
          <span class="meta-label">Generated</span>
          <span class="meta-value">{{issue_date}}</span>`
)}

      <h1>Payslip statement</h1>

      <div class="section">
        <p class="section-title">Employee</p>
        <div class="section-body">
          <p><strong>{{employee_name}}</strong> · {{employee_code}}</p>
          <p>{{designation}} · {{department}}</p>
          <p>{{work_location}}</p>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Earnings</p>
        <div class="section-body">
          <table class="data">
            <thead>
              <tr><th>Component</th><th class="amount">Amount</th></tr>
            </thead>
            <tbody>
              <tr><td>Basic pay</td><td class="amount">{{basic_pay}}</td></tr>
              <tr><td>House rent allowance</td><td class="amount">{{hra_allowance}}</td></tr>
              <tr><td>Special allowance</td><td class="amount">{{special_allowance}}</td></tr>
              <tr><td>Incentives and bonus</td><td class="amount">{{performance_incentive}}</td></tr>
              <tr class="total"><td>Gross earnings</td><td class="amount">{{gross_pay}}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Deductions</p>
        <div class="section-body">
          <table class="data">
            <thead>
              <tr><th>Component</th><th class="amount">Amount</th></tr>
            </thead>
            <tbody>
              <tr><td>Provident fund</td><td class="amount">{{pf_contribution}}</td></tr>
              <tr><td>Professional tax</td><td class="amount">{{professional_tax}}</td></tr>
              <tr><td>Income tax / TDS</td><td class="amount">{{income_tax}}</td></tr>
              <tr><td>Other deductions</td><td class="amount">{{other_deductions}}</td></tr>
              <tr class="total"><td>Total deductions</td><td class="amount">{{total_deductions}}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Net pay</p>
        <div class="section-body">
          <table class="data">
            <tbody>
              <tr class="total"><td>Net pay credited</td><td class="amount">{{net_pay}}</td></tr>
            </tbody>
          </table>
          <p>Credited on {{credit_date}} to account {{account_number_masked}} ({{bank_name}}).</p>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Attendance</p>
        <div class="section-body">
          <table class="data">
            <thead>
              <tr><th>Metric</th><th class="amount">Days</th></tr>
            </thead>
            <tbody>
              <tr><td>Working days</td><td class="amount">{{working_days}}</td></tr>
              <tr><td>Days present</td><td class="amount">{{present_days}}</td></tr>
              <tr><td>Leave taken</td><td class="amount">{{leave_days}}</td></tr>
              <tr><td>Loss of pay</td><td class="amount">{{lop_days}}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="note">
        This payslip is computer generated and needs no signature. If any figure looks wrong,
        raise it with {{payroll_contact_email}} within three working days.
      </div>

      <div class="footer">
        <p>{{payroll_contact_name}} · Payroll and compliance</p>
      </div>
${LETTER_CLOSE}`;

// ─── 3. Payslip cover note ───────────────────────────────────

const PAYSLIP_COVER = `${letterOpen("Payslip cover note")}
${letterhead(
  `          <span class="meta-label">Pay period</span>
          <span class="meta-value">{{pay_period}}</span>
          <span class="meta-label">Issued</span>
          <span class="meta-value">{{issue_date}}</span>`
)}

      <h1>Your payslip for {{pay_period}}</h1>

      <p>Dear <strong>{{full_name}}</strong>,</p>
      <p>
        Please find enclosed your salary statement for <strong>{{pay_period}}</strong>. A summary
        is set out below; the enclosed statement carries the full breakdown.
      </p>

      <div class="section">
        <p class="section-title">Summary</p>
        <div class="section-body">
          <table class="data">
            <tbody>
              <tr><td>Gross earnings</td><td class="amount">{{gross_pay}}</td></tr>
              <tr><td>Total deductions</td><td class="amount">{{total_deductions}}</td></tr>
              <tr class="total"><td>Net pay</td><td class="amount">{{net_pay}}</td></tr>
            </tbody>
          </table>
          <p>Credited on <strong>{{credit_date}}</strong>.</p>
        </div>
      </div>

      <div class="note">
        Queries about this statement should reach {{payroll_contact_email}} within three working
        days of receipt, so that any correction lands in the same financial year.
      </div>

      <div class="signature">
        <p>Regards,</p>
        <strong>{{payroll_contact_name}}</strong>
        <span>Payroll and compliance</span>
        <span>{{company_name}}</span>
      </div>
${LETTER_CLOSE}`;

// ─── 4. Call letter ──────────────────────────────────────────

const CALL_LETTER = `${letterOpen("Interview call letter")}
${letterhead(
  `          <span class="meta-label">Issued</span>
          <span class="meta-value">{{issue_date}}</span>
          <span class="meta-label">Reference</span>
          <span class="meta-value">{{application_reference}}</span>`
)}

      <h1>Invitation to interview</h1>

      <p>Dear <strong>{{full_name}}</strong>,</p>
      <p>
        Thank you for your interest in the <strong>{{position_title}}</strong> role at
        {{company_name}}. We would like to invite you to the next stage of our selection process.
      </p>

      <div class="section">
        <p class="section-title">Your session</p>
        <div class="section-body">
          <table class="data">
            <tbody>
              <tr><td>Date</td><td class="amount">{{session_date}}</td></tr>
              <tr><td>Time</td><td class="amount">{{session_time}}</td></tr>
              <tr><td>Mode</td><td class="amount">{{session_mode}}</td></tr>
            </tbody>
          </table>
          <p><strong>Panel:</strong> {{panel_names}}</p>
        </div>
      </div>

      <div class="section">
        <p class="section-title">What to bring</p>
        <div class="section-body">
          <ul class="bullet">
            <li>A photo identification document.</li>
            <li>Copies of your academic and employment records.</li>
            <li>Any portfolio or work samples relevant to the role.</li>
          </ul>
        </div>
      </div>

      <div class="note">
        If this time does not suit you, reply to {{recruiter_email}} and we will find another. A
        rescheduled interview costs nothing; a missed one is harder to recover.
      </div>

      <div class="signature">
        <p>Regards,</p>
        <strong>{{recruiter_name}}</strong>
        <span>Talent acquisition</span>
        <span>{{company_name}}</span>
      </div>
${LETTER_CLOSE}`;

// ─── 5. Experience certificate ───────────────────────────────

const EXPERIENCE_CERTIFICATE = `${letterOpen("Experience certificate")}
${letterhead(
  `          <span class="meta-label">Issued</span>
          <span class="meta-value">{{issue_date}}</span>
          <span class="meta-label">Employee code</span>
          <span class="meta-value">{{employee_code}}</span>`,
  true
)}

      <h1>To whom it may concern</h1>

      <p>
        This is to certify that <strong>{{full_name}}</strong> was employed with
        {{company_name}} as <strong>{{position_title}}</strong> from
        <strong>{{start_date}}</strong> to <strong>{{end_date}}</strong>.
      </p>

      <div class="section">
        <p class="section-title">Responsibilities</p>
        <div class="section-body">
          <p>{{key_responsibilities}}</p>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Conduct</p>
        <div class="section-body">
          <p>{{strength_highlights}}</p>
        </div>
      </div>

      <p>
        We wish {{full_name}} every success in their future endeavours. This certificate is issued
        on request and carries no obligation on the part of the company.
      </p>

      <div class="signature">
        <p>For {{company_name}},</p>
        <strong>{{signatory_name}}</strong>
        <span>{{signatory_title}}</span>
      </div>
${LETTER_CLOSE}`;

// ─── 6. Payslip notification email ───────────────────────────

const PAYSLIP_NOTIFICATION = `${emailOpen("Payslip available")}
        <span class="badge">Payroll</span>
        <h1>Hello {{first_name}},</h1>

        <p>Your payslip for <strong>{{pay_period}}</strong> is now available.</p>

        <div class="details">
          <div class="details-row">
            <span class="details-label">Net pay</span>
            <span class="details-value">{{net_pay}}</span>
          </div>
          <div class="details-row">
            <span class="details-label">Payment date</span>
            <span class="details-value">{{payment_date}}</span>
          </div>
        </div>

        <a class="cta" href="{{portal_link}}">View your payslip</a>

        <div class="callout">
          If any figure looks wrong, contact {{payroll_contact_name}} at
          {{payroll_contact_email}} by {{dispute_deadline}}. Raising it in the same pay cycle is
          far simpler than correcting it afterwards.
        </div>

        <div class="footer">
          <p>{{payroll_contact_name}}<br />{{company_name}}</p>
        </div>
${EMAIL_CLOSE}`;

// ─── 7. Offer follow-up email ────────────────────────────────

const OFFER_FOLLOWUP = `${emailOpen("Following up on your offer")}
        <span class="badge">Offer</span>
        <h1>Hi {{first_name}},</h1>

        <p>
          We hope you have had a chance to review the offer we sent on
          <strong>{{offer_sent_date}}</strong>. We are keen to have you join {{company_name}} as
          our next <strong>{{position_title}}</strong>.
        </p>

        <div class="callout">
          If you would like to talk through the compensation, the start date or how the team is
          set up, tell us a time that suits and we will arrange it.
        </div>

        <p>What happens next:</p>
        <ul class="bullet">
          <li>Review the offer and its annexures.</li>
          <li>Send us any questions — no question is too small.</li>
          <li>Confirm your decision using the link below.</li>
        </ul>

        <a class="cta" href="{{acceptance_link}}">Respond to your offer</a>

        <p>
          We would appreciate hearing from you by <strong>{{follow_up_deadline}}</strong> so we can
          prepare your onboarding.
        </p>

        <div class="footer">
          <p>{{recruiter_name}}<br />{{recruiter_title}}<br />{{company_name}}</p>
        </div>
${EMAIL_CLOSE}`;

// ─── 8. Onboarding welcome email ─────────────────────────────

const ONBOARDING_WELCOME = `${emailOpen("Welcome aboard")}
        <span class="badge">Welcome</span>
        <h1>Welcome, {{first_name}}!</h1>

        <p>
          We are glad you are joining {{company_name}} as <strong>{{position_title}}</strong>.
          Here is what your first day looks like.
        </p>

        <div class="details">
          <div class="details-row">
            <span class="details-label">Start date</span>
            <span class="details-value">{{start_date}}</span>
          </div>
          <div class="details-row">
            <span class="details-label">Reporting time</span>
            <span class="details-value">{{start_time}}</span>
          </div>
          <div class="details-row">
            <span class="details-label">Where</span>
            <span class="details-value">{{office_location}}</span>
          </div>
          <div class="details-row">
            <span class="details-label">Your buddy</span>
            <span class="details-value">{{buddy_name}}</span>
          </div>
        </div>

        <p><strong>Day one:</strong> {{day_one_schedule}}</p>
        <p><strong>Please bring:</strong> {{documents_to_bring}}</p>
        <p><strong>Dress code:</strong> {{dress_code}}</p>

        <div class="callout">
          Anything unclear before you start? Write to {{hr_contact_name}} at
          {{hr_contact_email}} — that is exactly what the first week is for.
        </div>

        <div class="footer">
          <p>{{signatory_name}}<br />{{signatory_title}}<br />{{company_name}}</p>
        </div>
${EMAIL_CLOSE}`;

// ─── The catalog ─────────────────────────────────────────────

export const TEMPLATE_CATALOG: readonly TemplateSeed[] = [
  {
    templateType: "offer_letter",
    name: "Offer Letter",
    category: "letter",
    description: "Employment offer, issued to a candidate before joining",
    body: OFFER_LETTER,
    // The one document in the set that creates a contract, so it is the one
    // that is signed. The candidate signs first: countersigning an offer the
    // candidate has not accepted is a company signature on nothing.
    requiresSignature: true,
    signatoryRoles: ["employee", "hr"],
  },
  {
    templateType: "payslip_statement",
    name: "Payslip Statement",
    category: "letter",
    description: "Detailed monthly salary statement",
    body: PAYSLIP_STATEMENT,
    // Computer generated, and it says so. A signature block on a payslip
    // implies a person checked this one, and on a run of nine hundred nobody
    // did.
    requiresSignature: false,
    signatoryRoles: [],
  },
  {
    templateType: "payslip_cover",
    name: "Payslip Cover Note",
    category: "letter",
    description: "Covering note that accompanies a monthly payslip",
    body: PAYSLIP_COVER,
    requiresSignature: false,
    signatoryRoles: [],
  },
  {
    templateType: "call_letter",
    name: "Interview Call Letter",
    category: "letter",
    description: "Invitation to an interview or assessment session",
    body: CALL_LETTER,
    requiresSignature: false,
    signatoryRoles: [],
  },
  {
    templateType: "experience_certificate",
    name: "Experience Certificate",
    category: "letter",
    description: "Proof of employment issued on request, usually at exit",
    body: EXPERIENCE_CERTIFICATE,
    // Signed by the company alone. It is a statement of fact by the employer
    // about a former employee, not an agreement between the two of them.
    requiresSignature: true,
    signatoryRoles: ["hr"],
  },
  {
    templateType: "payslip_notification",
    name: "Payslip Notification Email",
    category: "mail",
    description: "Email sent when a payslip is released",
    body: PAYSLIP_NOTIFICATION,
    requiresSignature: false,
    signatoryRoles: [],
  },
  {
    templateType: "offer_followup",
    name: "Offer Follow-up Email",
    category: "mail",
    description: "Follow-up to a candidate who has not yet responded to an offer",
    body: OFFER_FOLLOWUP,
    requiresSignature: false,
    signatoryRoles: [],
  },
  {
    templateType: "onboarding_welcome",
    name: "Onboarding Welcome Email",
    category: "mail",
    description: "Welcome email with joining details, sent before day one",
    body: ONBOARDING_WELCOME,
    requiresSignature: false,
    signatoryRoles: [],
  },
] as const;

/** Looks a template up by its stable key. */
export function templateByType(templateType: string): TemplateSeed | undefined {
  return TEMPLATE_CATALOG.find((t) => t.templateType === templateType);
}
