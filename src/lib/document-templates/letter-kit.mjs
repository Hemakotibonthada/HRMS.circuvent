// ═══════════════════════════════════════════════════════════════
// LETTER KIT — the one letterhead, stylesheet and table vocabulary
// every Circuvent document is built from.
// ═══════════════════════════════════════════════════════════════
//
// Before this file there were two of everything. `catalog.ts` hand-assembled
// its twelve templates around its own `LETTER_STYLE`/`letterhead()`, and
// `scripts/seed-letter-templates.mjs` did the same around a byte-for-byte copy
// of the same CSS read from `letter-shell.css`, plus its own `shell()`. Two
// sources of truth for what a Circuvent letter looks like is how the original
// Office.Circuvent templates ended up with the company address written four
// slightly different ways — the exact defect note 1 in `catalog.ts`'s header
// describes. Fixing that for the twelve built-ins while leaving the seed
// script's eight letters to drift on their own would just move the seam
// rather than close it.
//
// This module is plain JavaScript, not TypeScript, for one concrete reason:
// `scripts/seed-letter-templates.mjs` is executed with a bare
// `node scripts/seed-letter-templates.mjs` (see the `db:seed:letters` script
// in package.json) — there is no ts-node or tsx in that path, so it can only
// ever `import` a `.mjs`/`.js`/`.json` file. `catalog.ts` has no such
// restriction: with `allowJs` and `moduleResolution: "bundler"` (see
// tsconfig.json) it imports this file directly and gets full type-checking
// from the JSDoc annotations below, so nothing here is a typing hole for the
// stricter side of the boundary.
//
// ─── The logo lives here too ─────────────────────────────────
//
// Reason 2 in `catalog.ts`'s header explains why the letterhead is
// typographic rather than an `<img>`: the old `cid:company_logo@circuvent`
// reference only resolves inside an assembled email, and `render()` in
// `src/lib/document-rules.ts` has no conditionals, so a bare
// `{{company_logo_url}}` token would leave a literal, broken
// `<img src="{{company_logo_url}}">` in a signed contract for any tenant that
// never configured a logo. Both of those are still true, and the typographic
// letterhead stays for exactly the reason given there.
//
// What changes is that a document may *also* carry a real logo, resolved
// server-side rather than substituted as a token. `COMPANY_LOGO_SLOT` below
// is an HTML comment, not a `{{token}}` — deliberately, so that it is inert to
// `extractTokens()`/`render()` (which only look for `{{...}}`) and can never
// itself become a required-but-unfilled token. The caller (`generate()` in
// `src/db/repositories/documents.neon.ts`) runs the ordinary token
// substitution first, exactly as before, and only then calls
// `applyCompanyLogo()` on the fully rendered HTML: either the marker becomes
// a real `<img>` pointing at an absolute `https` URL (the tenant's own logo,
// or the deployment default), or it is deleted outright. There is no third
// outcome — never a placeholder, never a `cid:` URL, never a broken image —
// because `applyCompanyLogo()` only ever emits one of those two shapes and
// nothing in between. `extractCompanyLogoUrl()` is the inverse, used by
// `render-pdf.ts` to recover the resolved URL from the frozen
// `renderedBody` it is handed, since PDF generation never re-renders from the
// template (`document-pdf-outbox.ts` feeds it `generatedDocuments.renderedBody`
// directly).

/** Tokens every template resolves, whatever else it needs. */
export const COMPANY_TOKENS = /** @type {const} */ ([
  "company_name",
  "company_address",
  "company_contact",
]);

/**
 * The marker `applyCompanyLogo()` replaces. An HTML comment, not a
 * `{{token}}` — see the header comment above for why that distinction is the
 * whole point.
 */
export const COMPANY_LOGO_SLOT = "<!--COMPANY_LOGO_SLOT-->";

/**
 * True only for a value that is an absolute `http(s)` URL. Rejects `cid:`,
 * `javascript:`, protocol-relative and bare-path values, empty strings, and
 * anything that is not a string at all — every one of those would either
 * fail to load or (for `javascript:`) is not something this codebase should
 * ever be writing into a `src` attribute of a document a browser renders.
 * `new URL()` throws on a relative path with no base, which is exactly the
 * behaviour wanted here: there is no base to resolve a relative logo path
 * against once this HTML is sitting in `renderedBody` or a PDF.
 *
 * @param {unknown} value
 * @returns {value is string}
 */
export function isAbsoluteHttpUrl(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Splices a resolved logo URL into already-rendered HTML, or removes the
 * slot entirely.
 *
 * This is the one function that decides what ends up in a signed document:
 * given a valid absolute URL it emits a real `<img>`; given anything else
 * (`null`, `undefined`, an empty string, a relative path, a stray `cid:`
 * value left over from imported data) it emits nothing at all. A tenant that
 * never configured a logo — and whose caller therefore has nothing better to
 * pass than `null` — gets a letter with no image tag whatsoever, not a
 * broken one. Explicit `width`/`height` avoid layout jank in the sandboxed
 * signing-page iframe before the CSS (or, for a browser with images off, ever)
 * loads; the actual pixel size is 128×128 (`public/logo-mark-128.png`).
 *
 * @param {string} html
 * @param {string | null | undefined} logoUrl
 * @returns {string}
 */
export function applyCompanyLogo(html, logoUrl) {
  const replacement = isAbsoluteHttpUrl(logoUrl)
    ? `<img class="company-logo" src="${logoUrl}" width="128" height="128" alt="Company logo" />`
    : "";
  return html.split(COMPANY_LOGO_SLOT).join(replacement);
}

/**
 * Recovers the logo URL `applyCompanyLogo()` baked into rendered HTML.
 *
 * `render-pdf.ts` never sees the token pipeline or the marker — it is handed
 * the frozen `renderedBody` of an already-generated document and has to embed
 * the logo as a real PDF image via `pdf-lib`'s `embedPng`, which needs the
 * URL (or a local file), not an `<img>` tag. Scanning for `class="company-logo"`
 * rather than assuming the tag is always exactly what `applyCompanyLogo()`
 * just emitted keeps this honest against hand-edited templates and any
 * future markup shuffling, and re-validating the extracted URL means a
 * corrupted or tampered `src` cannot smuggle a non-http(s) value into the PDF
 * embedding path.
 *
 * @param {string | null | undefined} html
 * @returns {string | null}
 */
export function extractCompanyLogoUrl(html) {
  if (!html) return null;
  const tags = String(html).match(/<img\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const classMatch = tag.match(/\bclass\s*=\s*"([^"]*)"/i);
    const classes = classMatch?.[1]?.split(/\s+/) ?? [];
    if (!classes.includes("company-logo")) continue;
    const srcMatch = tag.match(/\bsrc\s*=\s*"([^"]*)"/i);
    const src = srcMatch?.[1];
    if (isAbsoluteHttpUrl(src)) return src;
  }
  return null;
}

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
      .company-logo { display: block; max-height: 40px; width: auto; margin-bottom: 10px; }
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
      ol.numbered { margin: 12px 0 0 22px; padding: 0; }
      ol.numbered li { margin: 10px 0; font-size: 15px; orphans: 2; widows: 2; }
      table.data { width: 100%; border-collapse: collapse; margin-top: 16px; }
      table.data th, table.data td {
        text-align: left; padding: 11px 14px; font-size: 15px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.35);
      }
      table.data th {
        font-size: 12px; text-transform: uppercase; letter-spacing: 0.2em;
        color: #475569; background: rgba(226, 232, 240, 0.45);
      }
      td.amount, th.amount { text-align: right; font-weight: 600; color: #0f172a; }
      th.amount { font-weight: 700; }
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
 * Typographic rather than an image by default — see the header comment
 * above. `withRegistration` has no default on purpose: every call site has
 * to make an explicit choice about whether a company number appears, rather
 * than silently getting the more common answer. That matters here more than
 * it would elsewhere, because the wrong default is invisible in a diff and
 * only shows up as a missing CIN on a certificate, or a stray one on a
 * payslip, months later.
 *
 * @param {string} meta
 * @param {boolean} withRegistration
 * @returns {string}
 */
export function letterhead(meta, withRegistration) {
  const registration = withRegistration
    ? '\n          <p class="brand-info">{{company_registration}}</p>'
    : "";

  return `      <div class="letterhead">
        <div class="brand">
          ${COMPANY_LOGO_SLOT}
          <p class="brand-name">{{company_name}}</p>
          <p class="brand-info">{{company_address}}</p>
          <p class="brand-info">{{company_contact}}</p>${registration}
        </div>
        <div class="meta">
${meta}
        </div>
      </div>`;
}

/**
 * @param {string} title
 * @returns {string}
 */
export function letterOpen(title) {
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

export const LETTER_CLOSE = `      </div>
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
      .company-logo { display: block; max-height: 36px; width: auto; margin-bottom: 10px; }
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

/**
 * @param {string} title
 * @returns {string}
 */
export function emailOpen(title) {
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
          ${COMPANY_LOGO_SLOT}
          <p class="company-name">{{company_name}}</p>
          <p class="company-info">{{company_address}}</p>
          <p class="company-info">{{company_contact}}</p>
        </div>
        <div class="rule"></div>`;
}

export const EMAIL_CLOSE = `      </div>
    </div>
  </body>
</html>`;

/**
 * One row of a two-column label/value table.
 *
 * @param {string} label
 * @param {string} value
 * @returns {string}
 */
export function row(label, value) {
  return `<tr><th>${label}</th><td>${value}</td></tr>`;
}

/**
 * @param {string[]} rows
 * @returns {string}
 */
export function table(rows) {
  return `<table class="data"><tbody>${rows.join("")}</tbody></table>`;
}

/**
 * One row of a ledger table: a label plus one right-aligned amount cell per
 * value column. Used for Annexure 1's compensation break-up, which needs a
 * monthly *and* an annual figure per component — one column too many for the
 * plain `row()`/`table()` pair above.
 *
 * @param {string} label
 * @param {...string} amounts
 * @returns {string}
 */
export function ledgerRow(label, ...amounts) {
  const cells = amounts.map((amount) => `<td class="amount">${amount}</td>`).join("");
  return `<tr><td>${label}</td>${cells}</tr>`;
}

/**
 * Same shape as `ledgerRow`, styled as the row that reconciles the ones
 * above it (a gross salary, a cost-to-company total). A total that disagrees
 * with its own rows is exactly the defect this styling exists to make
 * visually distinct, on a document a candidate is about to sign.
 *
 * @param {string} label
 * @param {...string} amounts
 * @returns {string}
 */
export function ledgerTotalRow(label, ...amounts) {
  const cells = amounts.map((amount) => `<td class="amount">${amount}</td>`).join("");
  return `<tr class="total"><td>${label}</td>${cells}</tr>`;
}

/**
 * A multi-column ledger table. `headers[0]` labels the row-name column; every
 * other header labels a right-aligned amount column.
 *
 * @param {string[]} headers
 * @param {string[]} rows
 * @returns {string}
 */
export function ledgerTable(headers, rows) {
  const head = headers
    .map((h, i) => (i === 0 ? `<th>${h}</th>` : `<th class="amount">${h}</th>`))
    .join("");
  return `<table class="data"><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
}
