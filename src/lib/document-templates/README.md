# Document templates

Nineteen templates in two sources, all built on one shared letterhead module.

`catalog.ts` carries twelve — the originals ported from Office.Circuvent's
`backend/assets/templates/`, plus the offer variants (internship,
apprenticeship, contract, part-time) this product added for engagement types
Office never had to think about:

| Template | Category | Signed by |
|---|---|---|
| Offer Letter | letter | employee, then HR |
| Internship Offer Letter | letter | employee, then HR |
| Apprenticeship Offer Letter | letter | employee, then HR |
| Contract Engagement Letter | letter | employee, then HR |
| Part-time Offer Letter | letter | employee, then HR |
| Payslip Statement | letter | — |
| Payslip Cover Note | letter | — |
| Interview Call Letter | letter | — |
| Experience Certificate | letter | HR |
| Payslip Notification Email | mail | — |
| Offer Follow-up Email | mail | — |
| Onboarding Welcome Email | mail | — |

`scripts/seed-letter-templates.mjs` carries seven more — the letters that
follow an offer rather than making one, which nothing above covers: Joining
Letter, Appointment Letter, Confirmation Letter, Internship Completion
Certificate, Training Completion Certificate, Relieving Letter and
Appreciation Certificate. They live in a script rather than in `catalog.ts`
because they are seeded by a separate run (`npm run db:seed:letters`) with its
own idempotency rule (see that file's own header); folding them into
`catalog.ts` would mean every one of them is also seeded by
`scripts/seed-document-templates.ts` and the org-registration route, which is
not true today and is a bigger change than this task needs. What the two
sources do share, so that a candidate cannot tell which code path produced
which letter, is covered below under "One letterhead, two seeding scripts".

The `catalog.ts` bodies live as TypeScript constants rather than as `.html`
files on disk. Office read them with `fs.readFile` at runtime, which does not
survive a move to serverless — and constants can be tested, which files loaded
at runtime cannot be, easily.

---

## Installing them

```bash
npm run db:seed:templates              # install the twelve catalog.ts templates into every org that lacks them
npm run db:seed:templates -- --dry-run # report only
npm run db:seed:templates -- --org <uuid>
npm run db:seed:letters                # install the seven scripts/seed-letter-templates.mjs letters
npm run db:seed:letters -- --force     # overwrite an org's existing copy instead of skipping it
```

**Existing templates are never overwritten.** A template is matched on
`(org_id, name)` and skipped when present — for `db:seed:letters`, unless
`--force` is passed. HR teams edit these — an offer letter is a legal
instrument and its wording gets negotiated — so a seed that reinstalled the
stock text on every deploy would silently revert that, and nobody would find
out until a candidate received the wrong terms.

To adopt a new version of a template, delete or rename the organisation's copy
and run the seed again.

New organisations do not get these automatically. Run both seeds after creating
one, or call them from whatever provisions the org.

---

## What changed on the way in, and why

The design is Office's and is kept deliberately close; the two products should
look like one company. Four things had to change, and each was a defect waiting
to happen rather than a matter of taste.

### 1. Tenant identity was hardcoded

Seven of the eight templates carried `#42, Innovation Park, Hyderabad`,
`www.circuvent.tech`, a phone number, and — on the offer letter —
`CIN: U72900TG2019PTC000123`.

Office is a single-company deployment, so that was harmless there. This product
is multi-tenant. Importing them verbatim would have put **Circuvent's registered
company number on every customer's offer letters**. A CIN identifies a legal
entity to the Registrar of Companies; the wrong one on a signed contract is not
a cosmetic error.

Every such value is now a token: `{{company_name}}`, `{{company_address}}`,
`{{company_contact}}`, and `{{company_registration}}` on the two documents where
a company number belongs.

### 2. The logo was a `cid:` reference

`cid:company_logo@circuvent` resolves against a MIME part inside an assembled
email. These documents are also rendered standalone — on the public signing
page and into PDFs — where a `cid:` URL is a broken image. And a raw
`{{company_logo_url}}` token was not the fix either: `render()` in
`document-rules.ts` has no conditionals, so any org that had not configured a
logo would ship a signed contract containing the literal text
`<img src="{{company_logo_url}}">`.

The letterhead stays typographic underneath — entity name, address and
company number, still tokens, still what actually makes a letterhead legally
meaningful — but every letter and email now also carries a logo, resolved
server-side, once, at generation time:

- `letterhead()` and `emailOpen()` in `letter-kit.mjs` emit
  `COMPANY_LOGO_SLOT`, an inert HTML comment, not a token — `render()` never
  sees it and so can never leave a broken fragment of it unresolved.
- Immediately after `render()` and before the result is hashed into
  `renderedBody`, `generate()` in `documents.neon.ts` calls
  `applyCompanyLogo(renderedText, resolveCompanyLogoUrl(identity?.logoUrl))`.
  `resolveCompanyLogoUrl` (in `branding.ts`) uses the organisation's own logo
  when it is a genuine absolute `http(s)` URL, and otherwise the deployment
  default (`MAIL_LOGO_URL`, or `https://career.circuvent.com/logo-mark-128.png`
  — the same fallback `referral-invite-email.ts` and `intern-mail.ts` already
  use for lifecycle emails, so a generated document and a lifecycle email show
  the same mark for a tenant that has not branded itself).
- `applyCompanyLogo` (in `letter-kit.mjs`, shared with `catalog.ts` and
  `scripts/seed-letter-templates.mjs`) then splices in a real
  `<img class="company-logo" src="https://...">` — or, if it is ever handed
  nothing usable, removes the slot and leaves plain typography. There is no
  third outcome: never a placeholder, never `cid:`, never a broken image.
- Because this runs before hashing, every rendering downstream — the email
  that gets sent, the public signing page, and the PDF — reads the same
  frozen HTML with the same `<img>` (or its absence) already baked in. A
  document's hash attests to the masthead it was signed under, the same as
  every other token.
- The PDF path needs one more step: `pdf-lib` cannot fetch a remote URL
  itself, so `render-pdf.ts` calls `extractCompanyLogoUrl()` on the frozen
  HTML, reads `public/logo-mark-128.png` straight off disk for the exact
  unconfigured default (no network round trip for the common case) or
  `fetch()`es anything else, and embeds the result with `embedPng`. If that
  fetch fails — a dead URL, a non-PNG upload, a network blip — the PDF still
  renders, just without the logo. A document that will not generate at all is
  worse than one with a typographic letterhead, which is exactly the
  trade-off this whole section started from.

### 3. The offer letter injected eight raw HTML fragments, and said too little besides

`{{compensation_breakdown_html}}`, `{{policies_html}}`, `{{compliance_html}}`,
`{{documents_html}}`, `{{notes_html}}`, `{{variable_components_html}}`,
`{{compensation_notes_html}}` and `{{additional_benefits_html}}` were whole
tables and lists pushed in as markup.

`render()` in `src/lib/document-rules.ts` HTML-escapes every value on purpose —
a candidate name or a termination reason must not be able to inject markup into
a document that is then signed. Those fragments would therefore have rendered as
visible angle brackets.

Widening the renderer to trust tokens ending in `_html` would have reopened
exactly the hole the escaping closes. Instead, the offer letter was rewritten
as a main letter plus six lettered annexures and an acceptance page — the
structure a genuine offer of this length is actually built from, not one long
scroll of headings — with the parts that vary as plain tokens, and the fixed
markup (the policy clauses, the retirals wording, the acceptance paragraph)
written directly into the template:

- The **main letter** carries the reference number, the candidate's postal
  address, the subject, position/grade/business unit, gross annual salary
  with a pointer to Annexure A, the acceptance deadline and what happens if
  it lapses, and the signatory block.
- **Annexure A — Compensation** is the table a candidate actually reads
  against their payslip: a `ledgerTable()` (see `letter-kit.mjs`) built in
  `catalog.ts` from individual scalar tokens — `{{basic_salary}}`, `{{hra}}`,
  `{{special_allowance}}`, `{{conveyance_allowance}}`, `{{medical_allowance}}`,
  `{{lta_allowance}}`, `{{food_card_allowance}}` and `{{other_allowances}}`
  summing to `{{gross_salary}}`, then `{{gross_salary}}` plus
  `{{employer_pf_contribution}}` plus `{{gratuity_provision}}` plus
  `{{employer_esi_contribution}}` summing to `{{annual_ctc}}` — each of which
  lines up with a field `calculateSalaryStructure` in `payroll-engine.ts`
  already produces. `annual_ctc` deliberately excludes the group insurance
  premium that `calculateSalaryStructure`'s own `ctc` field folds in: the
  premium is disclosed separately, as a benefit, in Annexure B, and including
  it again here would inflate the one number Annexure A promises is gross
  salary plus the three retirals, nothing else. `employer_esi_contribution`
  reads as a rupee figure only where the candidate's gross salary is at or
  below the ESI wage ceiling, and as "Not applicable" above it — the row is
  always present, because a document that sometimes has four retiral rows and
  sometimes three depending on the tenant would be a harder template to keep
  correct than one that always has four and sometimes says one does not
  apply. `catalog.test.ts` renders this table with real
  `calculateSalaryStructure` output at two salary levels — one above the ESI
  ceiling and one below it, so both branches of that row are actually
  exercised — and checks the totals agree with the rows feeding them, because
  a total that disagrees with its rows on a signed offer is a dispute.
- **Annexure B — Statutory benefits and deductions** grounds every row in
  Annexure A in the actual statute: the EPF Act 1952 for provident fund, the
  Payment of Gratuity Act 1972 for gratuity (and its five-year vesting), the
  ESI Act 1948 for the threshold-dependent row above, the Maternity Benefit
  Act 1961 as amended in 2017, the Payment of Bonus Act 1965, and
  professional tax and TDS under the Income Tax Act 1961.
- **Annexure C — Terms and conditions** is thirty numbered clauses —
  probation, working hours, leave, transfer, no alternative employment, IP
  assignment, confidentiality surviving termination, non-solicitation,
  background verification and the consequence of a discrepancy, notice
  period, retirement age, disciplinary process and termination for cause
  among them.
- **Annexure D — Code of conduct and workplace policy** covers anti-
  harassment under the POSH Act 2013 (naming the Internal Committee), anti-
  bribery, conflict of interest and information security.
- **Annexure E — Data protection** states what personal data is processed,
  why, for how long, and the employee's rights under the DPDP Act 2023.
- **Annexure F — Joining checklist** lists the documents to produce on day
  one and the formalities to complete before joining.
- The **acceptance page** is a signature-and-date block that names every
  annexure by letter, so a candidate's signature is on a document that
  identifies exactly what they agreed to, not a vague "the above."

An **Internship Offer Letter** follows an equivalent structure, correctly cut
down for what an internship actually is: a stipend in place of a salary, a
fixed term with an end date, no provident fund or gratuity line (gratuity
does not vest below five years and an internship is shorter than that; PF
does not apply to a bona fide stipend), and conversion-to-permanent wording
instead of a promise of continued employment — `offer-rules.ts`'s
`forbiddenTokens` for the `internship` engagement type is what keeps
`annual_ctc` and the rest of the salaried vocabulary out of it for good, not
just this file's discipline. Its own numbered "Terms of the internship"
section is honest about the statutory position: PF, ESI and gratuity do not
apply to the stipend as paid, but would apply prospectively if the
relationship were ever recharacterised as employment — a claim an internship
letter should be able to survive being read literally, not one that hopes
nobody checks.

Nothing that was legitimately part of the original letter was lost, and the
injection surface is gone.

### 4. Token syntax

Office matched `[a-zA-Z0-9_.-]`, this product matches `[a-zA-Z0-9_.]`. No
template used a hyphen so nothing needed renaming, but a new one must not
introduce one — a hyphenated token would never be substituted and would ship as
literal braces. `catalog.test.ts` checks every braced expression against the
renderer's own pattern.

---

## One letterhead, two seeding scripts

`catalog.ts` and `scripts/seed-letter-templates.mjs` used to each carry their
own CSS, their own `shell()`, and their own `row()`/`table()` helpers — visibly
so, since the two letterhead layouts had drifted apart in whitespace and class
names even though nobody had decided they should look different. Both are now
built from one shared module, `letter-kit.mjs`:

- `letterhead()`, `letterOpen()`/`emailOpen()`, `LETTER_CLOSE`/`EMAIL_CLOSE`
  and the stylesheet, so every document — a `catalog.ts` offer letter, a
  `seed-letter-templates.mjs` joining letter, an email — opens with the same
  masthead and the same `COMPANY_LOGO_SLOT`;
- `row()`/`table()` for a plain two-column detail table, and
  `ledgerRow()`/`ledgerTotalRow()`/`ledgerTable()` for a monthly/annual
  compensation break-up with totals set in bold — the vocabulary Annexure A
  is built from.

It is plain JavaScript (`.mjs`), not TypeScript, because
`scripts/seed-letter-templates.mjs` runs as a bare `node` script in the
`db:seed:letters` npm entry, with no `ts-node`/`tsx` in that path — a `.ts`
import is not something it can ever satisfy. `branding.ts` sits alongside it
as a thin TypeScript wrapper for the one piece that genuinely needs real `env`
typing: deciding *which* logo URL a document should carry (see "The logo was a
`cid:` reference" above).

The one substantive duplicate this consolidation found — both sources defined
an "Experience Certificate" — is now defined once, in `catalog.ts`. Two active
rows sharing a name is not a cosmetic problem: `intern-documents.ts`'s
`resolveTemplate()` looks up a certificate purely by name and breaks a tie with
`ORDER BY updatedAt DESC LIMIT 1`, so which wording a departing employee
actually received depended on which row had most recently been re-seeded or
edited, not on any choice anyone made. `catalog.ts`'s version was kept because
`intern-documents.ts`'s own token set was already aligned to it.

---

## Tests

`catalog.test.ts` covers:

- every template renders with **no missing tokens** and no `{{` left in the body;
- every template passes `validateTemplate` before a generation run;
- a missing token is reported **by name** and left visible in the body;
- all four defects above stay fixed — no hardcoded tenant detail, no `cid:`, no
  `_html` token, no hyphenated token;
- a value containing `<script>` is escaped;
- what is signed and by whom — every offer is signed employee-first, because
  countersigning an offer the candidate has not accepted is a company
  signature on nothing; payslips are not signed at all, because a signature
  block implies a person checked this one and on a run of nine hundred nobody
  did;
- the content that survived the port — the compensation rows, the payslip's
  earnings and deductions, the interview details, the joining details;
- every offer letter matches the engagement it is for — the right
  compensation token, none of the tokens `offer-rules.ts` forbids, an end date
  on every fixed-term engagement and none on open-ended employment;
- **Annexure A's arithmetic**, checked at two salary levels — one above the
  ESI wage ceiling and one below it, so the employer-ESI row is exercised on
  both branches, not just the branch where it says "Not applicable" — the
  eight compensation rows sum to the gross salary row, and gross salary plus
  the three retiral rows sums to the total cost-to-company row, using real
  `calculateSalaryStructure` output rather than hand-picked numbers that
  happen to add up. The annual figure is never `calculateSalaryStructure`'s
  own `ctc` field, which also folds in the group insurance premium this
  letter discloses separately in Annexure B.

`branding.test.ts` covers the logo mechanism directly: `isAbsoluteHttpUrl`
accepts `http(s)` and rejects `cid:`, `javascript:`, relative paths and
non-string input; `applyCompanyLogo` produces no `<img>` at all for a tenant
with no logo configured and a real one with the resolved URL for a tenant that
has; `extractCompanyLogoUrl` round-trips what `applyCompanyLogo` just spliced
in and refuses to trust a tampered `src`; and `resolveCompanyLogoUrl`/
`defaultLogoUrl` prefer the organisation's own logo, then `MAIL_LOGO_URL`, then
Circuvent's own known-good mark, and never return anything that is not itself
a valid absolute `http(s)` URL.

Seeding was additionally proven against a real Postgres (PGlite, the same engine
`npm run db:verify` uses): the rows install, a second run inserts nothing, and
another tenant's connection sees zero of them under RLS.

`node scripts/render-sample-letters.mjs` renders every template in both
sources to PDF, for a sample employee and a sample intern, into
`~/Desktop/Circuvent-Letters`, and reports any token left unresolved — the
fastest way to see a template change the way a candidate would, logo included.
