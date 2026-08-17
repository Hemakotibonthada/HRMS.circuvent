# Document templates

Eight templates — five letters and three emails — carried over from
Office.Circuvent's `backend/assets/templates/`.

| Template | Category | Signed by |
|---|---|---|
| Offer Letter | letter | employee, then HR |
| Experience Certificate | letter | HR |
| Payslip Statement | letter | — |
| Payslip Cover Note | letter | — |
| Interview Call Letter | letter | — |
| Payslip Notification Email | mail | — |
| Offer Follow-up Email | mail | — |
| Onboarding Welcome Email | mail | — |

The bodies live in [`catalog.ts`](./catalog.ts) as TypeScript constants rather
than as `.html` files on disk. Office read them with `fs.readFile` at runtime,
which does not survive a move to serverless — and constants can be tested,
which files loaded at runtime cannot be, easily.

---

## Installing them

```bash
npm run db:seed:templates              # install into every org that lacks them
npm run db:seed:templates -- --dry-run # report only
npm run db:seed:templates -- --org <uuid>
```

**Existing templates are never overwritten.** A template is matched on
`(org_id, name)` and skipped when present. HR teams edit these — an offer letter
is a legal instrument and its wording gets negotiated — so a seed that
reinstalled the stock text on every deploy would silently revert that, and
nobody would find out until a candidate received the wrong terms.

To adopt a new version of a template, delete or rename the organisation's copy
and run the seed again.

New organisations do not get these automatically. Run the seed after creating
one, or call it from whatever provisions the org.

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
email. These documents are also rendered standalone — on the public signing page
and into PDFs — where a `cid:` URL is a broken image.

The letterheads are now typographic. For a legal document that is not a
downgrade: what makes a letterhead meaningful is the entity name, address and
company number. A `{{company_logo_url}}` token was considered and rejected —
`render()` has no conditionals, so any org that had not set one would ship a
signed contract containing the literal text `<img src="{{company_logo_url}}">`.

### 3. The offer letter injected eight raw HTML fragments

`{{compensation_breakdown_html}}`, `{{policies_html}}`, `{{compliance_html}}`,
`{{documents_html}}`, `{{notes_html}}`, `{{variable_components_html}}`,
`{{compensation_notes_html}}` and `{{additional_benefits_html}}` were whole
tables and lists pushed in as markup.

`render()` in `src/lib/document-rules.ts` HTML-escapes every value on purpose —
a candidate name or a termination reason must not be able to inject markup into
a document that is then signed. Those fragments would therefore have rendered as
visible angle brackets.

Widening the renderer to trust tokens ending in `_html` would have reopened
exactly the hole the escaping closes. Instead:

- markup that is genuinely fixed (the policy list, the documents list, the
  compliance undertakings) is now part of the template;
- the parts that vary are plain tokens — `{{basic_salary}}`, `{{hra}}`,
  `{{special_allowance}}`, `{{other_allowances}}`, `{{gross_salary}}`, which
  line up with what `calculateSalaryStructure` in `payroll-engine.ts` already
  produces.

Nothing was lost and the injection surface is gone.

### 4. Token syntax

Office matched `[a-zA-Z0-9_.-]`, this product matches `[a-zA-Z0-9_.]`. No
template used a hyphen so nothing needed renaming, but a new one must not
introduce one — a hyphenated token would never be substituted and would ship as
literal braces. `catalog.test.ts` checks every braced expression against the
renderer's own pattern.

---

## Tests

`catalog.test.ts` (71 assertions) covers:

- every template renders with **no missing tokens** and no `{{` left in the body;
- every template passes `validateTemplate` before a generation run;
- a missing token is reported **by name** and left visible in the body;
- all four defects above stay fixed — no hardcoded tenant detail, no `cid:`, no
  `_html` token, no hyphenated token;
- a value containing `<script>` is escaped;
- what is signed and by whom — the offer letter is signed employee-first,
  because countersigning an offer the candidate has not accepted is a company
  signature on nothing; payslips are not signed at all, because a signature
  block implies a person checked this one and on a run of nine hundred nobody
  did;
- the content that survived the port — the compensation rows, the payslip's
  earnings and deductions, the interview details, the joining details.

Seeding was additionally proven against a real Postgres (PGlite, the same engine
`npm run db:verify` uses): eight rows install, a second run inserts nothing, and
another tenant's connection sees zero of them under RLS.
