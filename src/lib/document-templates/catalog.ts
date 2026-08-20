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
//
// ─── The logo, properly ──────────────────────────────────────
//
// Point 2 above is still exactly right about why a raw `{{company_logo_url}}`
// token is the wrong tool: `render()` has no conditionals, so an org that
// never set a logo would get a literal, broken `<img>` tag baked into a
// signed contract. What was missing was not "give up on the logo" — it was a
// mechanism that resolves the URL *before* the token-substitution stage, so
// the markup that reaches `render()` either already contains a real `https`
// URL or contains no `<img>` at all. Never a placeholder, never `cid:`.
//
// That mechanism is `letterhead()`/`emailOpen()` below (both now imported
// from `letter-kit.mjs`), which embed `COMPANY_LOGO_SLOT` — an HTML
// *comment*, not a `{{token}}`, so `extractTokens()` never sees it and it can
// never itself become an unresolved placeholder. `generate()` in
// `documents.neon.ts` calls `applyCompanyLogo()` on the already-rendered
// HTML, after every `{{token}}` has been substituted: given the tenant's own
// logo (`organizations.logo_url`) or, failing that, the deployment default
// (`MAIL_LOGO_URL`, or Circuvent's own mark — see `branding.ts`), it replaces
// the slot with a real `<img>` pointing at that absolute URL; given nothing
// usable, it deletes the slot outright. The typographic letterhead — entity
// name, address, company number — stays regardless, because that is what
// point 2 correctly identifies as what makes a letterhead legally
// meaningful; the logo is decoration on top of it, never a substitute.
//
// The PDF path (`src/lib/documents/render-pdf.ts`) needs a third step,
// because `pdf-lib` does not fetch anything an `<img src>` merely points at:
// it recovers the resolved URL with `extractCompanyLogoUrl()`, fetches it (or,
// for the packaged deployment default, reads `public/logo-mark-128.png`
// straight off disk) and embeds it with `embedPng`. If that fetch fails — a
// transient network error, a tenant's logo URL having gone stale since the
// document was signed — the PDF still generates without the logo, because a
// contract that will not generate at all is a worse failure than one with
// only the typographic letterhead.
//
// ─── One letterhead, not two ──────────────────────────────────
//
// The stylesheet, the letterhead, the email shell and the row/table helpers
// below used to be defined here *and*, separately, in
// `scripts/seed-letter-templates.mjs` as its own `CSS`/`shell()`/`row()`/
// `table()` — the same "one company, several slightly different letterheads"
// failure mode point 1 above describes, just moved from hardcoded data into
// duplicated code instead of being fixed. Both files now import the shared
// versions from `letter-kit.mjs`, so a change to the masthead or the table
// styling is one edit, not a coin flip over which of two copies a given
// letter happens to use.

import {
  COMPANY_TOKENS,
  EMAIL_CLOSE,
  LETTER_CLOSE,
  emailOpen,
  ledgerRow,
  ledgerTable,
  ledgerTotalRow,
  letterOpen,
  letterhead,
  row,
  table,
} from "./letter-kit.mjs";
import { OFFER_CONFIDENTIALITY_IP, OFFER_LEAVE_AND_ATTENDANCE, OFFER_ACCEPTANCE } from "./offer-annexures";

export { COMPANY_TOKENS };

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

// ─── 1. Offer letter ─────────────────────────────────────────

// The founder's quality bar for this template is a real TCS offer letter,
// and a real one runs long: a short main letter carrying only what is
// specific to this candidate (who, what role, what salary, by when), plus
// lettered annexures carrying everything that is true of the role or the
// company regardless of who is reading it — compensation arithmetic,
// statutory grounding, the numbered terms, the conduct policy, the data
// notice, the joining checklist. Splitting it this way is not padding for a
// page count: it is what a document this size looks like once every fact a
// real Indian employer puts in an offer is present and none of it is
// repeated to hit a length. A single flat letter that tried to say all of
// this in one undifferentiated scroll would bury the one page — the
// candidate block, the salary, the deadline — that this candidate needs to
// read first and read fastest.
//
// Ten annexures, each answering one question a signed offer has to answer
// somewhere:
//   A — Compensation:        what does each rupee of the CTC become?
//   B — Statutory benefits:  which Act requires which deduction, and how much?
//   C — Terms and conditions: what is the candidate agreeing to, clause by clause?
//   D — Code of conduct:     what standard of behaviour is expected, and against what law?
//   E — Data protection:     what personal data is processed, and what rights exist over it?
//   F — Joining checklist:   what must physically arrive on day one?
//   G — Confidentiality and IP: what happens to information and inventions during and after?
//   H — Leave and attendance:  what entitlement does "the leave policy" in clause 6 actually mean?
//   I — Company assets and acceptable use: what may you do with what the company gives you to work with?
//   J — Grievance and discipline:  how is a concern raised, and how is one investigated?
// followed by a candidate acceptance page that names every annexure by
// letter, so "I accept" cannot later be read as accepting only the page it
// is printed on.
//
// Three things worth being explicit about, because they are easy to get
// wrong in the other direction:
//
// 1. Annexure A's cost-to-company total excludes the group insurance
//    premium on purpose, the same way this template's pre-existing Annexure
//    1 did. `calculateSalaryStructure()` in `src/lib/payroll-engine.ts`
//    treats insurance as a benefit disclosed in Annexure B, not a retiral
//    folded into the headline CTC figure a candidate compares across offers
//    — see `catalog.test.ts`'s reconciliation tests, which assert the
//    printed total against the payroll engine's own arithmetic rather than
//    trusting that a rewrite kept the two in agreement.
//
// 2. There is no general non-compete or restraint-of-trade clause anywhere
//    in Annexure C. Section 27 of the Indian Contract Act, 1872 voids any
//    agreement that restrains a person from exercising a lawful profession,
//    trade or business, with narrow judicially-recognised exceptions that
//    do not include an ordinary employment contract; a clause here
//    promising what Indian law will not enforce is worse than no clause —
//    the confidentiality and non-solicitation clauses that survive
//    termination are the ones actually enforceable in this jurisdiction.
//
// 3. Annexure D's anti-bribery clause is written against the company's own
//    code of conduct, not the Prevention of Corruption Act, 1988 — that Act
//    governs public servants and those who bribe them, and a private-sector
//    offer letter that cites it as the source of an employee's obligation
//    is citing the wrong statute to the one person, the candidate, who is
//    entitled to read this letter and trust that every citation in it is
//    the one that actually applies.
const OFFER_LETTER = `${letterOpen("{{company_name}} · Offer of Employment")}
${letterhead(
  `          <span class="meta-label">Offer date</span>
          <span class="meta-value">{{issue_date}}</span>
          <span class="meta-label">Reference</span>
          <span class="meta-value">{{application_reference}}</span>`,
  true
)}

      <div class="candidate-block">
        <p><strong>{{full_name}}</strong></p>
        <p>{{candidate_address}}</p>
        <p>{{candidate_email}}</p>
      </div>

      <h1>Offer of Employment</h1>

      <p><strong>Subject:</strong> Offer of employment as {{position_title}}, {{grade_level}}, {{business_unit}}</p>

      <p>Dear <strong>{{full_name}}</strong>,</p>
      <p>
        We are delighted to offer you employment as <strong>{{position_title}}</strong> at
        {{company_name}}, at the level of <strong>{{grade_level}}</strong> within our
        <strong>{{business_unit}}</strong> business unit. Your experience stood out throughout the
        selection process and we are confident you will make an immediate impact.
      </p>
      <p>
        Your work location is <strong>{{work_location}}</strong> and you will report to
        <strong>{{manager_name}}</strong>. Your first day is planned for
        <strong>{{start_date}}</strong>, working <strong>{{work_mode}}</strong> with standard hours
        of <strong>{{working_hours}}</strong>. You will be on probation for
        <strong>{{probation_period}}</strong> from your date of joining, as set out in Annexure C.
      </p>

      <div class="section">
        <p class="section-title">What this offer comprises</p>
        <div class="section-body">
          <p>
            This letter is deliberately short: everything specific to you — your role, your
            salary, your reporting line, the date by which you need to accept — is on this page.
            Everything that is true of the role or the company regardless of who is reading it is
            in the annexures below, which are as much a part of this offer as this page is.
          </p>
          <ul class="bullet">
            <li><strong>Annexure A — Compensation.</strong> Your salary broken into its components, monthly and annual, and how it becomes a cost to the company.</li>
            <li><strong>Annexure B — Statutory benefits and deductions.</strong> The Act behind every retiral and deduction on Annexure A, and the non-statutory benefits alongside them.</li>
            <li><strong>Annexure C — Terms and conditions.</strong> The numbered clauses that govern your employment.</li>
            <li><strong>Annexure D — Code of conduct and workplace policy.</strong> The standards of behaviour expected of you and of the company.</li>
            <li><strong>Annexure E — Data protection.</strong> What personal data of yours we process, why, and your rights over it.</li>
            <li><strong>Annexure F — Joining checklist.</strong> What to bring, and what to complete, on your date of joining.</li>
            <li><strong>Annexure G — Confidentiality and intellectual property.</strong> What you may not disclose, and who owns what you create.</li>
            <li><strong>Annexure H — Leave, holidays and attendance.</strong> The entitlement behind "the leave policy" referred to in Annexure C.</li>
            <li><strong>Annexure I — Company assets, information systems and acceptable use.</strong> What you may do with the equipment, systems and access the company gives you.</li>
            <li><strong>Annexure J — Grievance redressal and disciplinary procedure.</strong> How a concern is raised and heard, and how a disciplinary matter is investigated and decided.</li>
          </ul>
          <p>Please read all ten before you sign the acceptance page at the end of this offer.</p>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Compensation</p>
        <div class="section-body">
          <p>
            Your gross annual salary is <strong>{{gross_salary}}</strong>, and your total cost to
            the company — including the retirals described in Annexure B — is
            <strong>{{annual_ctc}}</strong> a year. The full break-up, monthly and annual, is at
            <strong>Annexure A</strong> to this letter.
          </p>
        </div>
      </div>

      <div class="note">
        This offer is open for your acceptance until <strong>{{offer_valid_until}}</strong>. If we
        have not received your signed acceptance copy by that date, this offer lapses
        automatically and the position will be offered to another candidate; no further notice
        will be given.
      </div>

      <div class="section">
        <p class="section-title">Performance pay</p>
        <div class="section-body">
          <p>
            <strong>Monthly performance pay:</strong> {{performance_pay_monthly}} a month, paid
            with salary and linked to your performance against agreed goals.
          </p>
          <p>{{variable_pay_summary}}</p>
          <p>
            Performance pay and any variable component are reviewed
            {{performance_review_cycle}}. Neither is part of the fixed compensation in Annexure A,
            and neither is guaranteed by this letter.
          </p>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Your contacts</p>
        <div class="section-body">
          <p><strong>Reporting manager:</strong> {{manager_name}} · {{manager_email}}</p>
          <p><strong>People operations:</strong> {{hr_contact_name}} · {{hr_contact_email}}</p>
        </div>
      </div>

      <div class="signature">
        <p>For {{company_name}},</p>
        <strong>{{signatory_name}}</strong>
        <span>{{signatory_title}}</span>
      </div>

      <div class="footer">
        <p>
          This offer is contingent on the completion of onboarding formalities, background
          verification and adherence to company policies, as set out in Annexures C and F.
        </p>
      </div>

      <h2>Annexure A — Compensation</h2>
      <div class="section">
        <p class="section-title">Compensation break-up</p>
        <div class="section-body">
          <p>
            Figures are annualised and rounded to the nearest rupee. Provident fund, professional
            tax, income tax and any other deduction required by law apply on top of the payments
            below and are described, with the statute behind each one, in Annexure B.
          </p>
          ${ledgerTable(
            ["Component", "Monthly (INR)", "Annual (INR)"],
            [
              ledgerRow("Basic salary", "{{basic_salary_monthly}}", "{{basic_salary}}"),
              ledgerRow("House rent allowance", "{{hra_monthly}}", "{{hra}}"),
              ledgerRow("Special allowance", "{{special_allowance_monthly}}", "{{special_allowance}}"),
              ledgerRow("Conveyance allowance", "{{conveyance_allowance_monthly}}", "{{conveyance_allowance}}"),
              ledgerRow("Medical allowance", "{{medical_allowance_monthly}}", "{{medical_allowance}}"),
              ledgerRow("Leave travel allowance", "{{lta_allowance_monthly}}", "{{lta_allowance}}"),
              ledgerRow("Food card allowance", "{{food_card_allowance_monthly}}", "{{food_card_allowance}}"),
              ledgerRow("Other / flexible allowances", "{{other_allowances_monthly}}", "{{other_allowances}}"),
              ledgerTotalRow("Gross salary (A)", "{{gross_salary_monthly}}", "{{gross_salary}}"),
              ledgerRow(
                "Employer's provident fund contribution (B)",
                "{{employer_pf_contribution_monthly}}",
                "{{employer_pf_contribution}}"
              ),
              ledgerRow("Gratuity provision (C)", "—", "{{gratuity_provision}}"),
              ledgerRow(
                "Employer's ESI contribution, where applicable (D)",
                "{{employer_esi_contribution_monthly}}",
                "{{employer_esi_contribution}}"
              ),
              ledgerTotalRow("Total cost to company (A + B + C + D)", "—", "{{annual_ctc}}"),
            ]
          )}
          <p>
            House rent allowance is fixed at not less than 50% of basic salary, so it stays a
            genuine housing allowance rather than a label for what is really further basic pay.
            The food card allowance is disbursed through a pre-paid meal card under the Income Tax
            Act's meal-voucher exemption and can be used only at the establishments the card's
            issuer empanels.
          </p>
          <p>
            Employees' State Insurance applies only where gross salary does not exceed the wage
            ceiling the Act sets; row (D) above reads as a rupee figure where it applies to you
            and as "Not applicable" where your salary is above that ceiling — either way, the
            total below it is exact, not an estimate.
          </p>
          <p>
            The total cost to company above is gross salary plus the three retirals in this table
            and nothing else: it does not include the health-insurance premium the company also
            pays on your behalf, which Annexure B discloses as a benefit rather than folding it
            into the one figure you would use to compare this offer against another.
          </p>
        </div>
      </div>

      <h2>Annexure B — Statutory benefits and deductions</h2>

      <div class="section">
        <p class="section-title">Provident fund</p>
        <div class="section-body">
          <p>
            The company contributes <strong>{{employer_pf_contribution}}</strong> a year — 12% of
            basic salary, as required by the Employees' Provident Funds and Miscellaneous
            Provisions Act, 1952 — to your provident fund account, matched by an equal deduction
            from your own salary. Both contributions are credited to the Universal Account Number
            you are issued on joining, which stays with you across employers for the rest of your
            working life, so nothing needs to be transferred by hand if you leave the company —
            only linked to your next employer's contributions.
          </p>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Gratuity</p>
        <div class="section-body">
          <p>
            The company provides <strong>{{gratuity_provision}}</strong> a year — 4.81% of basic
            salary — toward gratuity under the Payment of Gratuity Act, 1972, payable on
            separation once you complete five years of continuous service, or earlier on your
            death or disablement, when the five-year requirement does not apply. Gratuity is a
            provision the company carries against a future payment, not a sum added to your
            take-home pay now.
          </p>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Employees' State Insurance</p>
        <div class="section-body">
          <p>
            The Employees' State Insurance Act, 1948 applies only where your gross salary does
            not exceed the wage ceiling the Act prescribes. Where it applies, the company
            contributes 3.25% and you contribute 0.75% of gross salary toward medical and cash
            benefits administered by the Employees' State Insurance Corporation, in place of the
            group health insurance described below rather than in addition to it. Row (D) of
            Annexure A states whether this applies to you and, where it does, the exact amount.
          </p>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Maternity benefit</p>
        <div class="section-body">
          <p>{{maternity_leave_summary}}</p>
          <p>
            This follows the Maternity Benefit Act, 1961 as amended in 2017: 26 weeks of paid
            leave for your first two children, 12 weeks for a third, 12 weeks for a commissioning
            or adopting mother, a crèche benefit where the Act requires one, and the option to
            agree work-from-home once the paid leave period ends, where the nature of your role
            allows it.
          </p>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Bonus</p>
        <div class="section-body">
          <p>
            Where the Payment of Bonus Act, 1965 applies to your role, a statutory bonus of
            between 8.33% and 20% of eligible salary is paid annually, calculated the way the Act
            requires; this is separate from, and does not reduce, the performance pay described
            in the main letter above.
          </p>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Professional tax and income tax</p>
        <div class="section-body">
          <p>
            Professional tax is deducted at the rate your state of employment sets, subject to
            the ceiling of INR 2,500 a year that Article 276 of the Constitution places on it.
            Income tax is deducted at source under section 192 of the Income Tax Act, 1961, at the
            rate your total income attracts; you may choose, for each financial year, between the
            old tax regime and the new tax regime under section 115BAC, and the company will
            deduct tax on the basis you declare. A Form 16 recording the tax deducted is issued to
            you after the end of each financial year.
          </p>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Labour welfare fund</p>
        <div class="section-body">
          <p>
            Where the State in which you work operates a labour welfare fund, the employee
            contribution to it is deducted from your salary at the rate that State notifies, and
            the company pays the matching employer contribution and remits both on your behalf.
            Not every State operates such a fund; where yours does not, no deduction is made under
            this paragraph.
          </p>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Other benefits</p>
        <div class="section-body">
          <p class="subsection-title">Health insurance</p>
          <p>
            {{health_insurance_summary}} The company pays the premium for this cover in full; it is
            not a deduction from your salary and is not part of the cost-to-company figure in
            Annexure A, because it is a benefit rather than a component of pay you could otherwise
            draw as cash.
          </p>
          <p>
            Treatment at a hospital in the insurer's network is cashless, on production of the
            e-card issued to you after enrolment; treatment outside the network is settled by
            reimbursement on the claim documents the insurer's policy specifies, generally within
            the window that policy sets from the date of discharge. A condition that existed
            before you joined this cover is not excluded on that ground alone in a group policy of
            this kind, unlike an individual policy you might buy for yourself, and maternity
            cover, where the policy provides one, follows the sub-limit stated in the policy
            document issued to you on enrolment rather than the family sum insured in full.
          </p>
          <p class="subsection-title">Loans and advances</p>
          <p>
            {{loan_policy_summary}} Any loan or advance the company extends to you is recovered
            from your salary on the schedule agreed when it is sanctioned, and the outstanding
            balance becomes payable in full from your final settlement if your employment ends
            before it is repaid.
          </p>
          <p>
            Where the rate of interest, if any, this Annexure applies is below the rate the State
            Bank of India charges on a loan of the same kind and tenure, the difference is a
            perquisite in your hands under Rule 3(7)(i) of the Income Tax Rules, 1962, and is
            added to your taxable salary for the purpose of the deduction Annexure B describes;
            this changes the income tax computed on the loan, not the instalment recovered from
            your salary under the loan itself.
          </p>
          <p class="subsection-title">Professional memberships</p>
          <p>
            {{professional_membership_summary}} Membership reimbursed under this paragraph must be
            in a body relevant to your role; the company's approval before you enrol is a condition
            of reimbursement, not a formality after the fact.
          </p>
          <p class="subsection-title">Flexible benefits</p>
          <p>
            {{flexible_benefit_pool}} You may allocate this pool across the options the company's
            flexible benefit policy in force at the time offers; an allocation you do not make by
            the date that policy sets is paid as taxable salary rather than carried forward.
          </p>
          <p>
            Each option within the pool carries its own tax treatment under the Income Tax Act,
            1961 — a meal card and fuel reimbursement are exempt up to the limit Rule 3 of the
            Income Tax Rules, 1962 sets on production of bills, while a telephone reimbursement is
            exempt only to the extent it is for official use — and the company applies that
            treatment automatically based on the option you choose, rather than taxing the whole
            pool as salary and leaving you to claim it back.
          </p>
        </div>
      </div>

      <div class="note">
        The Code on Wages, 2019, the Industrial Relations Code, 2020, the Code on Social Security,
        2020 and the Occupational Safety, Health and Working Conditions Code, 2020 consolidate the
        Acts named above and elsewhere in this offer once they are brought into force; nothing in
        this Annexure is intended to promise a benefit at a level below what the Act in force at
        the relevant time actually requires.
      </div>

      <h2>Annexure C — Terms and conditions</h2>

      <div class="section">
        <p class="section-title">Definitions and interpretation</p>
        <div class="section-body">
          <p>
            The clauses that follow use several terms consistently, and this Annexure defines them
            once here rather than re-explaining each on first use:
          </p>
          <ul class="bullet">
            <li><em>"the Company"</em> means {{company_name}}, and, where the context of a clause is transfer, secondment or a group-wide policy, includes its holding company and subsidiaries.</li>
            <li><em>"you" / "your"</em> means the candidate to whom this offer is addressed and, once this offer is accepted, the employee.</li>
            <li><em>"this offer"</em> means the main letter above together with every Annexure to it; an Annexure is part of the offer, not a separate document, and carries the same force as the main letter.</li>
            <li><em>"CTC"</em> means cost to company: the gross annual figure stated in the main letter and itemised in Annexure A, inclusive of every component and retiral the company pays or provides on your account, before any deduction.</li>
            <li><em>"basic salary"</em> means the fixed component in row (A) of Annexure A that statutory contributions — provident fund and gratuity among them — are calculated against, and does not include any allowance, benefit or variable pay.</li>
            <li><em>"confidential information"</em> has the meaning given to it in Annexure G, and includes information belonging to a customer, supplier or candidate that the company holds under an obligation of confidence to that third party.</li>
            <li><em>"working day"</em> means a day that is not a weekly off or a holiday under the list the company notifies for your work location each year.</li>
            <li><em>"financial year"</em> means the year beginning 1 April and ending the following 31 March, the year the Income Tax Act, 1961 and the labour statutes named in Annexure B themselves use.</li>
            <li><em>"immediate family"</em> means your spouse, dependent children and dependent parents, the group the company's group health insurance and gratuity nomination both use unless a specific policy states a narrower or wider group.</li>
            <li><em>"in writing"</em> includes email to the address either party has notified to the other, and does not require a signed paper document unless a specific clause below says otherwise.</li>
          </ul>
          <p>
            A heading in this Annexure is for convenience of reference only and does not limit or
            expand the clause it introduces; where a clause below cites a specific statute, that
            citation identifies the law actually intended, and is not a label the company can
            change the meaning of by later pointing to a different Act.
          </p>
        </div>
      </div>

      <div class="section">
        <div class="section-body">
          <ol class="numbered">
            <li><strong>Probation.</strong> You will be on probation for {{probation_period}} from your date of joining, during which your performance, conduct and suitability for the role will be assessed.</li>
            <li><strong>Confirmation.</strong> Your employment is confirmed by a separate written communication once your probation is satisfactorily completed; the company may extend your probation once, by written notice stating the reason, where more time is genuinely needed to assess you.</li>
            <li><strong>Training.</strong> Any training required for your role, whether before or after confirmation, is treated as time worked, and satisfactory completion of it is itself a condition of confirmation.</li>
            <li><strong>Working hours and week.</strong> Your standard working hours are {{working_hours}}, exclusive of any additional hours reasonably required by your role from time to time, across the standard working week your location and function follow.</li>
            <li><strong>Attendance.</strong> You are expected to record your attendance through the company's attendance system for every working day; unrecorded or unexplained absence is treated as leave without pay and, if it continues without response, as abandonment of employment under clause 32.</li>
            <li><strong>Leave.</strong> Your leave entitlement — earned, casual, sick and other leave, and how each accrues, carries forward or is encashed — is set out in Annexure H; the letter of appointment referred to in clause 24 states anything specific to your grade or location.</li>
            <li><strong>Notice period during probation.</strong> During probation, either party may end this employment by giving {{probation_notice_period}} written notice, or pay in lieu of that notice.</li>
            <li><strong>Notice period after confirmation.</strong> After confirmation, either party may end this employment by giving {{notice_period}} written notice, or pay in lieu of that notice.</li>
            <li><strong>Mobility and transfer.</strong> The company may transfer you to another department, function, location or group company, in India or abroad, as it considers necessary, without changing the substance of this offer; where a transfer requires relocation, the company's relocation policy in force at the time applies.</li>
            <li><strong>No alternative employment or conflicting engagement.</strong> You will not, during your employment, take up any other employment, business, trade or consultancy, paid or unpaid, or any engagement that conflicts with the company's interests, without the company's prior written consent.</li>
            <li><strong>Intellectual property.</strong> Ownership of, and your assignment to the company of, intellectual property you create in the course of your employment is set out in full in Annexure G, and is a condition of this offer; that annexure, not this summary, governs if the two are ever read as differing.</li>
            <li><strong>Confidentiality.</strong> Your obligations of confidentiality, both during your employment and after it ends, are set out in full in Annexure G; you will execute the company's confidentiality undertaking, which records those obligations, on or before joining.</li>
            <li><strong>Non-solicitation.</strong> For {{notice_period}} after your employment ends, you will not solicit the company's employees to leave the company, or solicit the company's clients with whom you dealt during your employment, for a competing business.</li>
            <li><strong>Background verification.</strong> This offer is subject to satisfactory verification of the education, employment and other particulars you have provided; a discrepancy discovered before joining is grounds for withdrawing this offer, and one discovered after joining is grounds for terminating your employment without notice.</li>
            <li><strong>Pre-employment medical.</strong> This offer is subject to your being found medically fit by a physician nominated by the company.</li>
            <li><strong>Retirement.</strong> The normal age of retirement is {{retirement_age}} years, subject to the company's retirement policy in force at the relevant time.</li>
            <li><strong>Increments and promotions.</strong> Increments and promotions are at the company's discretion, based on periodic performance reviews and business requirements, and are not guaranteed by this letter.</li>
            <li><strong>Company property.</strong> Any laptop, access card, SIM, documents or other company property issued to you must be returned in good condition on the date your employment ends, or earlier if the company asks; the company may recover the value of anything not returned from your final settlement.</li>
            <li><strong>Disciplinary process.</strong> A concern about your conduct is put to you in writing, you are given a fair opportunity to respond, and any action taken follows the company's disciplinary policy in force at the time; nothing in this clause limits the company's right to terminate for cause under clause 21.</li>
            <li><strong>Grievance redressal.</strong> A concern you wish to raise about your employment is addressed through the company's grievance redressal policy, and, where it concerns harassment, through the Internal Committee described in Annexure D.</li>
            <li><strong>Termination for cause.</strong> The company may terminate your employment without notice or pay in lieu of notice for misconduct, breach of this offer, or an act that seriously damages the company's interests or reputation.</li>
            <li><strong>Resignation and handover.</strong> Where you resign, you will serve the notice period in clause 8 (or clause 7, during probation) and complete a handover of your work and any company property to the person the company nominates.</li>
            <li><strong>Documents on joining.</strong> Please bring the documents listed in Annexure F on your date of joining.</li>
            <li><strong>Letter of appointment.</strong> A detailed letter of appointment, confirming these terms and adding those specific to your role, will follow on your date of joining.</li>
            <li><strong>Company rules.</strong> Your employment is governed by the company's rules, policies and codes of conduct in force from time to time, including those in Annexure D, which the company may amend at its discretion.</li>
            <li><strong>Data privacy.</strong> The company processes your personal data as described in Annexure E, and by accepting this offer you acknowledge that processing.</li>
            <li><strong>Notices.</strong> A notice under this offer is validly given if sent in writing to the address or email either of us has most recently given the other in writing; a notice sent by post to that address is treated as received five working days after posting, and one sent by email is treated as received when sent, unless the sender receives a delivery failure notification.</li>
            <li><strong>Governing law and jurisdiction.</strong> This offer, and your employment under it, is governed by the laws of India, and the courts having jurisdiction over the company's registered office at {{company_address}} have exclusive jurisdiction over any dispute arising from it.</li>
            <li><strong>Entire agreement.</strong> This offer, its annexures and the letter of appointment that follows it together record the entire agreement between you and the company on the subject; anything said or promised during the selection process that is not written here does not bind the company.</li>
            <li><strong>Severability and amendment.</strong> If any clause in this offer is found unenforceable, the rest continues to apply, and no amendment to this offer binds either of us unless it is in writing and signed by both.</li>
            <li><strong>Deductions from salary.</strong> The company may deduct from your salary any sum you owe it, including overpaid salary, the value of an unreturned company asset, an outstanding advance, and salary in lieu of notice not served under clause 7 or clause 8; deductions are made in accordance with the Payment of Wages Act 1936, and where that Act requires your consent, the company will obtain it.</li>
            <li><strong>Unauthorised absence.</strong> Absence without approval or explanation for eight consecutive working days is treated as abandonment of employment, after the company has written to your last known address and given you seven days to respond; absence is not treated as abandonment where you are unable to make contact for reasons beyond your control.</li>
            <li><strong>Force majeure.</strong> Neither of us is liable for a failure to perform an obligation under this offer, other than an obligation to pay money already earned, where that failure is caused by an event beyond that party's reasonable control.</li>
            <li><strong>Waiver.</strong> A failure or delay by the company in enforcing any term of this offer is not a waiver of it, and does not prevent the company from enforcing that term later.</li>
            <li><strong>Assignment.</strong> You may not assign or transfer any right or obligation under this offer; the company may assign this offer to a successor that carries on its business or the part of it in which you are employed, without needing your separate consent.</li>
            <li><strong>Counterparts and electronic acceptance.</strong> This offer may be accepted by signing and returning the acceptance page in physical or electronic form, including by the electronic signature process described on the acceptance page, and that acceptance is as binding as a wet-ink signature on paper.</li>
          </ol>
        </div>
      </div>

      <h2>Annexure D — Code of conduct and workplace policy</h2>

      <div class="section">
        <p class="section-title">Prevention of sexual harassment</p>
        <div class="section-body">
          <p>
            The company has zero tolerance for sexual harassment at the workplace and maintains
            an Internal Committee under section 4 of the Sexual Harassment of Women at Workplace
            (Prevention, Prohibition and Redressal) Act, 2013, to receive and inquire into
            complaints. A complaint may be made by, or on behalf of, any employee, and the
            Committee's inquiry is conducted in confidence, as section 16 of the Act requires; the
            identity of the complainant, the respondent and any witness is not disclosed outside
            the inquiry.
          </p>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Anti-bribery and business conduct</p>
        <div class="section-body">
          <p>
            You will not offer, give, solicit or accept a bribe, kickback or improper advantage in
            connection with the company's business, whether the counterparty is in the private or
            the public sector, and you will disclose to the company any gift or hospitality beyond
            the value the company's business conduct policy permits. This obligation is a term of
            your employment under this offer, independent of, and broader than, whatever criminal
            liability a public official or the person bribing one carries under the Prevention of
            Corruption Act, 1988 — a statute that governs public servants, not the private
            employment relationship this letter creates.
          </p>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Conflict of interest</p>
        <div class="section-body">
          <p>
            You will disclose to your reporting manager any interest — financial, familial or
            otherwise — that could reasonably be seen to conflict with your duties, before it
            becomes relevant to a decision you are involved in, and you will not use your position
            to benefit yourself, your family or a business connected to either at the company's
            expense.
          </p>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Information security and acceptable use</p>
        <div class="section-body">
          <p>
            Company systems, accounts and devices are provided for company business and are to be
            used in line with the company's information security policy; you will not share your
            credentials, install unapproved software on company devices, or move company data to
            a personal account or device. A security incident you cause or discover is to be
            reported to the company's information security contact without delay.
          </p>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Public statements</p>
        <div class="section-body">
          <p>
            You will not speak to the press, post on social media, or otherwise make a public
            statement on the company's behalf, or in a way that identifies you as its employee on
            a matter concerning the company's business, without the prior approval of the
            company's communications function.
          </p>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Integrity</p>
        <div class="section-body">
          <p>
            You will act honestly in your dealings with the company, its customers, suppliers and
            regulators, and will not falsify a record, a timesheet, an expense claim or a
            qualification.
          </p>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Non-discrimination</p>
        <div class="section-body">
          <p>
            Employment decisions are made on merit. Discrimination or harassment on the grounds of
            sex, gender identity, religion, caste, disability, marital status, sexual orientation
            or place of origin is prohibited and is a disciplinary matter.
          </p>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Insider information</p>
        <div class="section-body">
          <p>
            You will not deal in the securities of any company, nor pass information to another
            person to deal, on the basis of unpublished price-sensitive information obtained
            through your employment.
          </p>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Substance misuse</p>
        <div class="section-body">
          <p>
            You will not attend work impaired by alcohol or an unlawful substance where doing so
            affects your ability to work safely or competently.
          </p>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Raising a concern</p>
        <div class="section-body">
          <p>
            You may raise a concern about suspected wrongdoing through the company's whistleblowing
            channel, including anonymously. A person who raises a concern honestly is protected
            from detriment even if the concern turns out to be mistaken.
          </p>
        </div>
      </div>

      <h2>Annexure E — Data protection</h2>

      <div class="section">
        <p class="section-title">What we process, and why</p>
        <div class="section-body">
          <p>
            To make and administer this offer and, once you join, your employment, the company
            processes your personal data — your contact and identity details, the education and
            employment history you gave us, the outcome of the background verification at clause
            14 of Annexure C, your bank account for salary, and, over the course of your
            employment, your attendance, performance and payroll records. Some of this we process
            because you have consented to it under section 6 of the Digital Personal Data
            Protection Act, 2023 by applying for this role and accepting this offer; the rest —
            payroll, statutory filings, and anything a court or regulator can compel — we process
            for the legitimate uses section 7 of that Act permits without asking for separate
            consent, principally the performance of this employment contract and compliance with
            the labour and tax law described in Annexure B.
          </p>
        </div>
      </div>

      <div class="section">
        <p class="section-title">How long we keep it</p>
        <div class="section-body">
          <p>
            We keep your personal data for as long as your employment continues and for the
            period after it ends that the applicable labour, tax and limitation law requires
            records to be kept for, and no longer than that once neither this employment nor a
            legal requirement needs it.
          </p>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Your rights</p>
        <div class="section-body">
          <ul class="bullet">
            <li><strong>Access.</strong> You may ask, under section 11 of the Act, for a summary of the personal data we hold about you and the processing we do with it.</li>
            <li><strong>Correction and erasure.</strong> You may ask, under section 12, for data that is inaccurate or no longer necessary to be corrected or erased, subject to what we are separately required by law to retain.</li>
            <li><strong>Grievance redressal.</strong> You may raise a grievance about how we process your personal data with {{hr_contact_name}} at {{hr_contact_email}} under section 13, and we will respond within the period the Act prescribes.</li>
            <li><strong>Nomination.</strong> You may nominate another individual, under section 14, to exercise these rights on your behalf in the event of your death or incapacity.</li>
            <li><strong>Escalation.</strong> If you are not satisfied with our response, you may complain to the Data Protection Board of India under section 18 of the Act.</li>
          </ul>
        </div>
      </div>

      <h2>Annexure F — Joining checklist</h2>

      <div class="section">
        <p class="section-title">Documents to bring on your date of joining</p>
        <div class="section-body">
          <p>Please bring the original and one self-attested photocopy of each of the following:</p>
          <ul class="bullet">
            <li>A government-issued photo identity proof (passport, voter ID, driving licence or Aadhaar).</li>
            <li>Your PAN card.</li>
            <li>Your Aadhaar card.</li>
            <li>Proof of your current residential address.</li>
            <li>Certificates and mark sheets for every educational qualification listed in your application.</li>
            <li>Your relieving letter and the last three months' payslips from your most recent employer, where you have one.</li>
            <li>A cancelled cheque, or a bank passbook page, for the account your salary is to be paid into.</li>
            <li>Four recent passport-size photographs.</li>
          </ul>
          <p>In addition, please bring: {{documents_to_bring}}.</p>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Before you join</p>
        <div class="section-body">
          <ul class="bullet">
            <li>Return your signed acceptance of this offer, as described on the acceptance page below.</li>
            <li>Complete the background verification consent form the company will send you separately.</li>
            <li>Complete the pre-employment medical declaration and, where the company's physician requires it, the examination at clause 15 of Annexure C.</li>
            <li>If you hold an existing provident fund account, be ready to give its Universal Account Number so your new employer's contributions are linked to it from your date of joining.</li>
          </ul>
        </div>
      </div>

      <h2>Annexure G — Confidentiality and intellectual property</h2>
${OFFER_CONFIDENTIALITY_IP}

      <h2>Annexure H — Leave, holidays and attendance</h2>
${OFFER_LEAVE_AND_ATTENDANCE}

      <h2>Annexure I — Company assets, information systems and acceptable use</h2>
      <div class="section">
        <div class="section-body">
          <p class="section-title">Equipment issued to you</p>
          <p>
            Any laptop, mobile device, SIM, access card, software licence or other equipment the
            company issues to you remains the company's property throughout your employment. You
            are responsible for its safekeeping and for using it only for purposes connected with
            your role; loss or damage caused by your negligence may be recovered from you.
          </p>
          <p class="section-title">Systems access</p>
          <p>
            Your access to the company's email, network, applications and any system holding
            company or candidate data is granted for the duration of your employment and for the
            purpose of performing your role. Access is provisioned on joining and withdrawn on the
            date your employment ends, or earlier if the company suspends you or you go on leave
            for an extended period.
          </p>
          <p class="section-title">Acceptable use</p>
          <p>
            Company systems and equipment are provided for work; incidental personal use is
            permitted where it does not interfere with your duties, breach any policy referred to
            in clause 26 of Annexure C, or expose the company to legal or security risk. You will
            not use company systems to access, store or transmit unlawful content, to run a
            personal business, or to install software the company has not approved.
          </p>
          <p class="section-title">Monitoring</p>
          <p>
            The company may monitor use of its systems and equipment, including email and
            internet access, to the extent permitted by law and by the data protection notice at
            Annexure E, for security, legal compliance and business continuity. Monitoring is not
            used to intrude on your personal life beyond what those purposes require.
          </p>
          <p class="section-title">Reporting an incident</p>
          <p>
            You must report a lost or stolen device, a suspected security breach, or unauthorised
            access to a company system to the information security team as soon as you become
            aware of it, and no later than twenty-four hours afterward; a delay in reporting that
            makes the incident worse is itself treated as a disciplinary matter under clause 19 of Annexure C.
          </p>
          <p class="section-title">Equipment for remote and hybrid working</p>
          <p>
            Where your work mode under this offer includes working away from a company location,
            equipment issued to support that arrangement is covered by this Annexure exactly as it
            would be at a company location, and the company's information security requirements
            apply to your home network and workspace to the same standard.
          </p>
          <p class="section-title">Return of company property</p>
          <p>
            You must return every item covered by this Annexure on the date your employment ends,
            or earlier if the company asks; Clause 31 of Annexure C already allows the company to deduct the value of anything you do not return from your final settlement, and this
            Annexure does not create a second, different entitlement to do so.
          </p>
        </div>
      </div>

      <h2>Annexure J — Grievance redressal and disciplinary procedure</h2>
      <div class="section">
        <div class="section-body">
          <p class="section-title">Raising a grievance</p>
          <p>
            Clause 20 of Annexure C tells you that a concern about your employment is addressed
            through this procedure. You may raise a grievance in writing with your reporting
            manager or, where the grievance concerns your reporting manager, with the human
            resources function directly; a grievance concerning harassment is raised with the
            Internal Committee described in Annexure D instead of through this general procedure.
          </p>
          <p class="section-title">How a grievance is handled</p>
          <p>
            The person you raise a grievance with acknowledges it within three working days, hears
            you before deciding anything, and responds in writing within fifteen working days
            stating what was found and what, if anything, will change. Where a grievance requires
            longer to investigate properly, you are told why and given a revised date.
          </p>
          <p class="section-title">Appeal</p>
          <p>
            If you are not satisfied with the response, you may appeal in writing within seven
            working days of receiving it to the next level of management above the person who
            decided it; that appeal is the final stage of this procedure.
          </p>
          <p class="section-title">Disciplinary process</p>
          <p>
            Clause 19 of Annexure C states the principle that a concern about your conduct is put
            to you in writing and you are given a fair opportunity to respond before any action is
            taken. This Annexure adds the mechanics: you may be accompanied by a colleague at any
            meeting called under this procedure, the outcome is confirmed to you in writing, and
            where the outcome is termination for cause under clause 21 of Annexure C, the letter
            confirming it states the specific finding that justifies it.
          </p>
          <p class="section-title">What this procedure does not cover</p>
          <p>
            This procedure does not extend your notice period, does not apply to a decision not to
            confirm you at the end of probation, and does not apply where the company withdraws
            this offer or ends your employment during probation, both of which are governed by
            Annexure C directly rather than by this procedure.
          </p>
        </div>
      </div>

      <h2>Acceptance</h2>
${OFFER_ACCEPTANCE}
${LETTER_CLOSE}`;

// ─── 2. Payslip statement ────────────────────────────────────

const PAYSLIP_STATEMENT = `${letterOpen("Payslip statement")}
${letterhead(
  `          <span class="meta-label">Pay period</span>
          <span class="meta-value">{{pay_period}}</span>
          <span class="meta-label">Generated</span>
          <span class="meta-value">{{issue_date}}</span>`,
  false
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
          <span class="meta-value">{{issue_date}}</span>`,
  false
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
          <span class="meta-value">{{application_reference}}</span>`,
  false
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
        {{company_name}} in the <strong>{{department}}</strong> department as
        <strong>{{position_title}}</strong> from <strong>{{join_date}}</strong> to
        <strong>{{last_working_day}}</strong>.
      </p>

      <div class="section">
        <p class="section-title">Conduct</p>
        <div class="section-body">
          <p>{{conduct_remark}}</p>
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

// ─── Offer letters for the other forms of engagement ─────────
//
// The catalog carried one offer letter, written for full-time employment, and
// the letters screen offered "Offer Letter" as a single choice. An internship
// issued on that template promises provident fund, a probation period and an
// annual CTC — none of which an intern has. That is not a formatting problem:
// the document is signed, and it is the company's own statement of what the
// person is entitled to.
//
// Which tokens each of these may and may not carry is decided in
// `src/lib/offer-rules.ts`, and `catalog.test.ts` checks these bodies against
// those rules rather than against a list repeated here. So a template that
// starts mentioning gratuity to an apprentice fails the build.

const INTERNSHIP_OFFER = `${letterOpen("{{company_name}} · Internship Offer")}
${letterhead(
  `          <span class="meta-label">Offer date</span>
          <span class="meta-value">{{issue_date}}</span>
          <span class="meta-label">Reference</span>
          <span class="meta-value">{{application_reference}}</span>`,
  true
)}

      <div class="candidate-block">
        <p><strong>{{full_name}}</strong></p>
        <p>{{candidate_address}}</p>
        <p>{{candidate_email}}</p>
      </div>

      <h1>Internship Offer</h1>

      <p><strong>Subject:</strong> Offer of internship as {{position_title}}, {{business_unit}}</p>

      <p>Dear <strong>{{full_name}}</strong>,</p>
      <p>
        We are pleased to offer you an internship as <strong>{{position_title}}</strong> at
        {{company_name}}, within our <strong>{{business_unit}}</strong> business unit. This is a
        training placement, and it is designed so that you finish it having done real work you
        can point to.
      </p>
      <p>
        Your internship is a fixed term running from <strong>{{start_date}}</strong> to
        <strong>{{engagement_end_date}}</strong> and does not extend beyond that date except by a
        separate letter signed by both of us. You will be mentored by
        <strong>{{mentor_name}}</strong> and work <strong>{{work_mode}}</strong> at
        <strong>{{work_location}}</strong>, with expected hours of
        <strong>{{working_hours}}</strong>.
      </p>

      <div class="section">
        <p class="section-title">Stipend and term</p>
        <div class="section-body">
          <p>
            You will receive a stipend of <strong>{{stipend_amount}}</strong> a month, paid in
            line with our normal payment cycle, for the fixed term below.
          </p>
          ${table([
            row("Monthly stipend", "{{stipend_amount}}"),
            row("Internship start", "{{start_date}}"),
            row("Internship end", "{{engagement_end_date}}"),
            row("Working hours", "{{working_hours}}"),
          ])}
          <p>
            A stipend supports you during training rather than paying you as an employee. This
            internship does not attract provident fund, employees' state insurance or gratuity,
            and no such deduction or contribution will be made — the stipend remains your income
            and you should account for it accordingly.
          </p>
        </div>
      </div>

      <div class="section">
        <p class="section-title">What you can expect</p>
        <div class="section-body">
          <ul class="bullet">
            <li>Work on <strong>{{project_summary}}</strong>, with your mentor reviewing progress.</li>
            <li>{{learning_outcomes}}</li>
            <li>
              A certificate on successful completion of the full term, recording your role, the
              dates the internship ran between, and the work you did, signed by
              {{mentor_name}} and countersigned by people operations — issued once, on the day
              your internship ends, and not before, since it certifies a term actually completed
              rather than one merely begun.
            </li>
          </ul>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Conversion to permanent employment</p>
        <div class="section-body">
          <p>{{conversion_policy_summary}}</p>
          <p>
            Any offer of permanent employment following this internship will be made in a
            separate letter of appointment, on terms agreed at that time — completing this
            internship creates no entitlement to one and no employment relationship in the
            meantime.
          </p>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Terms of the internship</p>
        <div class="section-body">
          <ol class="numbered">
            <li><strong>Term and extension.</strong> This internship runs for the fixed term stated above, from {{start_date}} to {{engagement_end_date}}, and does not extend beyond that date except by a separate letter signed by both of us; continuing to work past that date without such a letter does not itself extend the term.</li>
            <li><strong>Stipend and payment cycle.</strong> Your stipend is paid monthly, in line with the company's normal payment cycle, for the term stated above and for no period beyond it.</li>
            <li><strong>Working hours and attendance.</strong> Your expected hours are {{working_hours}}; you are expected to record your attendance for every working day, and unrecorded or unexplained absence may reduce your stipend for the period missed.</li>
            <li><strong>Leave.</strong> Leave during the internship is as set out in the company's internship policy communicated to you separately; leave taken beyond that entitlement is unpaid and, if it is extensive, may shorten the practical benefit of the remaining term without shortening the term itself.</li>
            <li><strong>Mentorship and review.</strong> {{mentor_name}} will review your progress at agreed intervals through the internship and provide the feedback the certificate at the end of this letter's "What you can expect" section records.</li>
            <li><strong>Statutory position.</strong> A stipend paid for training is not wages paid for work, so provident fund, employees' state insurance and gratuity do not apply to it and no such deduction or contribution will be made; if, despite the intention of this offer, your engagement were ever found in fact to be one of employment rather than training, the ordinary statutory contributions described in a full-time offer letter would apply from the point that finding was made, not retrospectively invented for the whole term.</li>
            <li><strong>No alternative engagement.</strong> You will not, during this internship, take up any other internship, employment or consultancy, paid or unpaid, without the company's prior written consent.</li>
            <li><strong>Confidentiality.</strong> Anything you see here stays here, during the internship and after it ends, for as long as the information remains confidential.</li>
            <li><strong>Intellectual property.</strong> Work you produce during the internship, using the company's resources or time, belongs to {{company_name}}, and you assign all rights in it to the company as they arise.</li>
            <li><strong>Conduct and workplace policy.</strong> The company's code of conduct, including its policy against workplace harassment under the Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013, applies to you exactly as it applies to every employee for the duration of your internship.</li>
            <li><strong>Background verification.</strong> This offer is subject to satisfactory verification of your student or graduate status and the other particulars you have provided; a material discrepancy is grounds for withdrawing this offer before it starts or ending the internship without notice after it has.</li>
            <li><strong>Company property and data.</strong> Any device, access card or account issued to you is for the internship's purposes only, is to be used in line with the company's information security policy, and must be returned, or its access revoked, on the date your internship ends.</li>
            <li><strong>Data privacy.</strong> The company processes your personal data — the particulars in your application, your attendance, and your mentor's review of your work — to administer this internship, under the Digital Personal Data Protection Act, 2023, and for no longer than the internship and the period after it that record-keeping law requires; by accepting this offer you acknowledge that processing.</li>
            <li><strong>Termination.</strong> Either of us may end the internship early with <strong>{{notice_period}}</strong> written notice; we would much rather talk first if something is not working. This internship does not create an employment relationship and carries no commitment to an offer of employment at the end of it — where a role is open and you are a fit, we will tell you.</li>
          </ol>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Your contacts</p>
        <div class="section-body">
          <p><strong>Mentor:</strong> {{mentor_name}} · {{mentor_email}}</p>
          <p><strong>People operations:</strong> {{hr_contact_name}} · {{hr_contact_email}}</p>
        </div>
      </div>

      <div class="note">
        This offer is open for your acceptance until <strong>{{offer_valid_until}}</strong>. If we
        have not received your signed acceptance copy by that date, this offer lapses
        automatically and we will offer the placement to another candidate.
      </div>

      <div class="signature">
        <p>For {{company_name}},</p>
        <strong>{{signatory_name}}</strong>
        <span>{{signatory_title}}</span>
      </div>

      <div class="section">
        <p class="section-title">Intern's acceptance</p>
        <div class="section-body">
          <p>I have read and understood the terms of this internship offer and I accept them.</p>
          <p>Signature: ______________________ &nbsp;&nbsp;&nbsp; Date: ______________________</p>
          <p>Name: {{full_name}}</p>
        </div>
      </div>

      <div class="footer">
        <p>
          This internship is contingent on verification of your student or graduate status and on
          the completion of onboarding formalities.
        </p>
      </div>
${LETTER_CLOSE}`;

const APPRENTICESHIP_OFFER = `${letterOpen("{{company_name}} · Apprenticeship Offer")}
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

      <h1>Your apprenticeship at {{company_name}}</h1>

      <p>Dear <strong>{{full_name}}</strong>,</p>
      <p>
        We are pleased to engage you as an apprentice in the trade of
        <strong>{{trade_name}}</strong> at {{company_name}}, in the role of
        <strong>{{position_title}}</strong>.
      </p>
      <p>
        Your apprenticeship runs from <strong>{{start_date}}</strong> to
        <strong>{{engagement_end_date}}</strong>, working <strong>{{work_mode}}</strong> with
        expected hours of <strong>{{working_hours}}</strong>.
      </p>

      <div class="section">
        <p class="section-title">Stipend</p>
        <div class="section-body">
          <p>
            You will receive a stipend of <strong>{{stipend_amount}}</strong> per month, at or
            above the rate prescribed for your trade and period of training.
          </p>
          <p>
            An apprentice is a trainee and not a worker, so the labour enactments — including
            provident fund, employees' state insurance and gratuity — do not apply to this
            engagement. Your training records will be maintained as the scheme requires.
          </p>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Your training</p>
        <div class="section-body">
          <ul class="bullet">
            <li>Structured training in <strong>{{trade_name}}</strong> under a designated supervisor.</li>
            <li>{{training_plan}}</li>
            <li>Assessment on completion, and a certificate recording what you covered.</li>
          </ul>
        </div>
      </div>

      <div class="section">
        <p class="section-title">What we ask of you</p>
        <div class="section-body">
          <ul class="bullet">
            <li>Attend and complete the training programme for its full term.</li>
            <li>Follow all safety instructions and site rules without exception.</li>
            <li>Maintain confidentiality over anything you learn here.</li>
            <li>Keep your training record up to date.</li>
          </ul>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Ending the apprenticeship</p>
        <div class="section-body">
          <p>
            Either of us may end this engagement with <strong>{{notice_period}}</strong> written
            notice. Completing the apprenticeship does not by itself create a right to employment.
          </p>
        </div>
      </div>

      <div class="note">
        This offer is open until <strong>{{offer_valid_until}}</strong>.
      </div>

      <div class="signature">
        <p>Warm regards,</p>
        <strong>{{signatory_name}}</strong>
        <span>{{signatory_title}}</span>
        <span>{{company_name}}</span>
      </div>

      <div class="footer">
        <p>
          This engagement is contingent on registration of the apprenticeship as required and on
          the completion of onboarding formalities.
        </p>
      </div>
${LETTER_CLOSE}`;

const CONTRACT_OFFER = `${letterOpen("{{company_name}} · Contract Engagement")}
${letterhead(
  `          <span class="meta-label">Issue date</span>
          <span class="meta-value">{{issue_date}}</span>
          <span class="meta-label">Reference</span>
          <span class="meta-value">{{application_reference}}</span>`,
  true
)}

      <div class="candidate-block">
        <p>{{full_name}}</p>
        <p>{{candidate_email}}</p>
      </div>

      <h1>Engagement as {{position_title}}</h1>

      <p>Dear <strong>{{full_name}}</strong>,</p>
      <p>
        We are pleased to engage you as <strong>{{position_title}}</strong> with
        {{company_name}} on a fixed-term basis. This is a contract for services: you are engaged
        as an independent contractor and not as an employee.
      </p>
      <p>
        The engagement runs from <strong>{{start_date}}</strong> to
        <strong>{{engagement_end_date}}</strong>, delivered <strong>{{work_mode}}</strong> with
        expected availability of <strong>{{working_hours}}</strong>.
      </p>

      <div class="section">
        <p class="section-title">Fees and payment</p>
        <div class="section-body">
          <p>
            Your fees are <strong>{{professional_fees}}</strong> for the engagement, payable
            <strong>{{payment_schedule}}</strong> against an invoice.
          </p>
          <p>
            Tax will be deducted at source on your professional fees under section 194J of the
            Income-tax Act. As this is a contract for services and not employment, no provident
            fund, employees' state insurance or gratuity arises, and you remain responsible for
            your own statutory registrations and filings, including goods and services tax where
            it applies to you.
          </p>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Scope</p>
        <div class="section-body">
          <ul class="bullet">
            <li>{{scope_of_work}}</li>
            <li>Deliverables and acceptance as agreed with <strong>{{manager_name}}</strong>.</li>
            <li>You control how and when the work is done, subject to the deadlines agreed.</li>
          </ul>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Confidentiality and ownership</p>
        <div class="section-body">
          <ul class="bullet">
            <li><strong>Confidentiality.</strong> Company information stays confidential, during and after the term.</li>
            <li><strong>Intellectual property.</strong> Work product created under this engagement is assigned to {{company_name}} on payment.</li>
            <li><strong>Data protection.</strong> Personal data you handle is processed only on our instructions.</li>
          </ul>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Ending the engagement</p>
        <div class="section-body">
          <p>
            Either party may terminate on <strong>{{notice_period}}</strong> written notice. Fees
            for work properly performed up to termination remain payable.
          </p>
        </div>
      </div>

      <div class="note">
        This offer is open until <strong>{{offer_valid_until}}</strong>.
      </div>

      <div class="signature">
        <p>Warm regards,</p>
        <strong>{{signatory_name}}</strong>
        <span>{{signatory_title}}</span>
        <span>{{company_name}}</span>
      </div>

      <div class="footer">
        <p>
          Nothing in this letter creates a relationship of employment, partnership or agency
          between you and {{company_name}}.
        </p>
      </div>
${LETTER_CLOSE}`;

const PART_TIME_OFFER = `${letterOpen("{{company_name}} · Offer of Part-time Employment")}
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
        We are delighted to offer you the part-time position of
        <strong>{{position_title}}</strong> at {{company_name}}.
      </p>
      <p>
        Your first day is planned for <strong>{{start_date}}</strong>. You will report to
        <strong>{{manager_name}}</strong> and work <strong>{{work_mode}}</strong> for
        <strong>{{weekly_hours}}</strong> hours a week, scheduled as
        <strong>{{working_hours}}</strong>. Your probation period is
        <strong>{{probation_period}}</strong>.
      </p>

      <div class="section">
        <p class="section-title">Salary</p>
        <div class="section-body">
          <p>
            Your salary is <strong>{{monthly_salary}}</strong> per month, paid in line with our
            payroll calendar.
          </p>
          <p>
            You are an employee, engaged for fewer hours. Provident fund, employees' state
            insurance where the wage ceilings are met, professional tax and income tax will be
            deducted in accordance with the statutes in force.
          </p>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Leave and benefits</p>
        <div class="section-body">
          <ul class="bullet">
            <li>Leave accrues in proportion to your contracted hours.</li>
            <li>{{additional_benefits}}</li>
            <li>Public holidays falling on your working days are paid.</li>
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
          </ul>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Notice</p>
        <div class="section-body">
          <p>
            Either of us may end this employment on <strong>{{notice_period}}</strong> written
            notice, after probation.
          </p>
        </div>
      </div>

      <div class="note">
        This offer is open until <strong>{{offer_valid_until}}</strong>.
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
    templateType: "offer_letter_internship",
    name: "Internship Offer Letter",
    category: "letter",
    description: "Stipendiary internship offer, fixed term, issued to a candidate",
    body: INTERNSHIP_OFFER,
    requiresSignature: true,
    signatoryRoles: ["employee", "hr"],
  },
  {
    templateType: "offer_letter_apprenticeship",
    name: "Apprenticeship Offer Letter",
    category: "letter",
    description: "Apprenticeship engagement under a trade, fixed term",
    body: APPRENTICESHIP_OFFER,
    requiresSignature: true,
    signatoryRoles: ["employee", "hr"],
  },
  {
    templateType: "offer_letter_contract",
    name: "Contract Engagement Letter",
    category: "letter",
    description: "Fixed-term contract for services, taxed under section 194J",
    body: CONTRACT_OFFER,
    requiresSignature: true,
    signatoryRoles: ["employee", "hr"],
  },
  {
    templateType: "offer_letter_part_time",
    name: "Part-time Offer Letter",
    category: "letter",
    description: "Part-time employment offer, salary stated monthly",
    body: PART_TIME_OFFER,
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
