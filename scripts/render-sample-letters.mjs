/**
 * Renders every letter and certificate to PDF, for a real employee and a real
 * intern, so a person can read what we actually send.
 *
 * The point is review, not production. Templates are contracts -- an offer
 * letter, a relieving letter and an experience certificate are all documents
 * somebody relies on afterwards -- and reading them as rendered PDFs is the
 * only way to notice that a clause is missing, a token never got substituted,
 * or the intern wording says "employee".
 *
 * It renders from the SAME sources the application seeds from, rather than a
 * copy: `document-templates/catalog.ts` and `scripts/seed-letter-templates.mjs`.
 * A sample pack built from its own copy of the wording would drift, and would
 * then reassure somebody about text that is not the text being sent.
 *
 * `seed-letter-templates.mjs` does not export its TEMPLATES array and connects
 * to Postgres when run, so it is loaded here by stripping the database import
 * and the entry-point call and re-exporting the array. That is deliberately
 * done in a temporary copy: the original belongs to the seeding path and is not
 * modified.
 *
 * Unsubstituted tokens are reported rather than left to look like literal text.
 * "{{basic_salary}}" printed on an offer letter is the exact failure this pack
 * exists to catch, and it is invisible if nobody counts them.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { applyCompanyLogo, extractCompanyLogoUrl } from "../src/lib/document-templates/letter-kit.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
// `os.homedir()/Desktop` is the wrong answer on a OneDrive-managed machine.
// Known Folder Move redirects the shell's Desktop to
// "<home>\OneDrive - <Tenant>\Desktop" and leaves the old literal
// "<home>\Desktop" in place, empty and orphaned. Writing there succeeds, the
// script reports every file written, and the person is looking at a Desktop
// that will never contain them - a silent failure that reads as a success.
//
// Scanning the home directory for an "OneDrive*" folder is not enough either:
// the redirected folder is a reparse point, so readdirSync does not report it
// as a directory and the scan silently misses it. Ask Windows instead - the
// User Shell Folders registry value is what Explorer itself resolves.
function resolveDesktop() {
  const fallback = path.join(os.homedir(), "Desktop");
  if (process.platform !== "win32") return fallback;
  try {
    const out = execFileSync(
      "reg",
      [
        "query",
        "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders",
        "/v",
        "Desktop",
      ],
      { encoding: "utf8" },
    );
    const match = out.match(/Desktop\s+REG_(?:EXPAND_)?SZ\s+(.+)/);
    if (!match) return fallback;
    const expanded = match[1]
      .trim()
      .replace(/%([^%]+)%/g, (whole, name) => process.env[name] ?? whole);
    return fs.existsSync(expanded) ? expanded : fallback;
  } catch {
    return fallback;
  }
}

const OUT = path.join(resolveDesktop(), "Circuvent-Letters");

/**
 * The deployment-wide fallback logo URL a tenant carries when it has not
 * configured one of its own -- the identical two-environment-variable rule
 * as `defaultLogoUrl()` in `src/lib/document-templates/branding.ts`,
 * `referral-invite-email.ts` and `intern-mail.ts`. Duplicated here rather
 * than imported for the same reason `branding.ts` duplicates it from those
 * two files rather than the reverse: this script runs under plain `node`,
 * not `tsx`, so it can only import the plain-JavaScript `letter-kit.mjs`
 * (which is why `applyCompanyLogo`/`extractCompanyLogoUrl` are imported from
 * there directly, above) and reaching `branding.ts`'s TypeScript would mean
 * spawning the same `tsx` subprocess `loadCatalogTemplates()` below uses only
 * because it has no other way to read `catalog.ts` at all. A sample pack
 * that resolved a different logo than the one the running application would
 * resolve for the exact same unconfigured tenant would be reviewing the
 * wrong picture -- and the one thing this file exists to catch is precisely
 * that kind of gap between what is sent and what gets reviewed.
 */
function defaultLogoUrl() {
  const configured = process.env.MAIL_LOGO_URL?.trim();
  if (configured) return configured;
  const careers = process.env.NEXT_PUBLIC_CAREERS_URL?.trim() || "https://career.circuvent.com";
  return `${careers.replace(/\/$/, "")}/logo-mark-128.png`;
}

/**
 * Mirrors `readLogoBytes()` in `src/lib/documents/render-pdf.ts` exactly, for
 * the same reason: the unconfigured deployment default is this repository's
 * own bundled `public/logo-mark-128.png`, read straight off disk, because
 * fetching it over HTTPS would only ask this same machine to serve itself
 * the file it already has. Anything else -- a tenant's own hosted logo, or
 * an operator's `MAIL_LOGO_URL` override -- is not a file this repository
 * ships, so there is no local copy to reach for and it is fetched instead.
 */
async function readLogoBytes(logoUrl) {
  if (!process.env.MAIL_LOGO_URL?.trim() && logoUrl === defaultLogoUrl()) {
    return new Uint8Array(fs.readFileSync(path.join(REPO, "public", "logo-mark-128.png")));
  }
  const response = await fetch(logoUrl);
  if (!response.ok) throw new Error(`Logo fetch responded with HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Fields every letter shares, so the two people below only carry what differs. */
const COMMON = {
  company_name: "Circuvent Technologies Private Limited",
  company_address: "Plot 42, HITEC City, Hyderabad, Telangana 500081, India",
  company_contact: "+91 40 4000 1234  |  people@circuvent.com",
  company_registration: "CIN U72900TG2024PTC123456",
  issue_date: "20 August 2026",
  today: "20 August 2026",
  date: "20 August 2026",
  hr_name: "Vema Reddy",
  hr_designation: "Head of People",
  hr_email: "vema@circuvent.com",
  hr_contact_name: "Vema Reddy",
  hr_contact_email: "vema@circuvent.com",
  signatory_name: "Vema Reddy",
  signatory_title: "Head of People, Circuvent Technologies",
  conduct_remark:
    "Their conduct throughout the engagement was found to be professional and satisfactory.",
  documents_to_bring:
    "Photo identification, PAN card, educational certificates, previous employment relieving letter, and two passport-size photographs.",
  first_day_plan:
    "Report to reception at the time above. Induction runs until lunch, followed by IT setup and a meeting with your reporting manager.",
  policy_acknowledgements:
    "Code of Conduct, Information Security Policy, Anti-Harassment Policy, and Leave Policy.",
  work_mode: "On-site, Hyderabad",
  working_hours: "9:30 AM to 6:30 PM IST, Monday to Friday",
  weekly_hours: "20 hours per week",
  recruiter_name: "Vema Reddy",
  recruiter_title: "Head of People",
  recruiter_email: "vema@circuvent.com",
  payroll_contact_name: "Vema Reddy",
  payroll_contact_email: "payroll@circuvent.com",
  signature_deadline: "27 August 2026",
  follow_up_deadline: "27 August 2026",
  dispute_deadline: "7 days from the date of this payslip",
  offer_sent_date: "20 August 2026",
  acceptance_link: "https://hrms.circuvent.com/sign",
  portal_link: "https://paystub.circuvent.com/payslips",
  benefit_start_date: "1 September 2026",
  session_date: "26 August 2026",
  session_time: "11:00 AM IST",
  session_mode: "Video call (Google Meet)",
  panel_names: "Hema Koteswara Rao Bonthada, Vema Reddy",
  pay_period: "September 2026",
  credit_date: "30 September 2026",
  payment_date: "30 September 2026",
  working_days: "22",
  present_days: "21",
  leave_days: "1",
  lop_days: "0",
  professional_tax: "INR 200",
  // A flat meal-card benefit, not scaled by grade: INR 50 per meal, two meals
  // a working day, 22 working days a month is the actual Rule 3(7)(iii)
  // exemption arithmetic real payroll teams use, and it is the same
  // arithmetic for an intern as for a senior engineer, so it lives here once
  // rather than being invented twice at two different amounts.
  food_card_allowance: "INR 26,400",
  food_card_allowance_monthly: "INR 2,200",
  // Both sample people are above the ESI wage ceiling (the employee on
  // salary, the intern because ESI never applies to a stipend in the first
  // place), so both read "Not applicable" here — a real tenant whose payroll
  // engine reports a wage below the ceiling would see the rupee figure
  // instead, as Annexure A's own text explains.
  employer_esi_contribution: "Not applicable",
  employer_esi_contribution_monthly: "Not applicable",
  trade_name: "Software Engineering",
  training_plan: "Structured 12-month programme with a mentor and quarterly assessment.",
  scope_of_work: "Backend engineering services for the payroll platform.",
  payment_schedule: "Monthly, within 15 days of invoice.",
  start_time: "9:30 AM IST",
  office_location: "Circuvent Technologies, Plot 42, HITEC City, Hyderabad 500081",
  buddy_name: "Tejasri Veeranki",
  day_one_schedule:
    "9:30 induction and paperwork, 11:00 IT setup and accounts, 12:30 lunch with the team, 2:00 meet your reporting manager, 3:30 first walkthrough of the codebase.",
  dress_code: "Smart casual. There is no formal dress code.",
  performance_review_cycle: "every six months, in April and October",
  health_insurance_summary:
    "Family floater cover of INR 5,00,000 for the employee, spouse and up to two dependent children, with the full annual premium paid by the company.",
  maternity_leave_summary:
    "26 weeks of paid maternity leave for the primary caregiver, as required by the Maternity Benefit Act, 1961.",
  loan_policy_summary:
    "Interest-free salary advances of up to one month's basic pay are available after confirmation, recovered over six months.",
  professional_membership_summary:
    "Annual membership of one professional body relevant to your role, reimbursed on production of receipts.",
  retirement_age: "58",
  flexible_benefit_pool:
    "A flexible-benefit pool of INR 50,000 a year, which you may allocate across meal vouchers, fuel reimbursement and telephone reimbursement, subject to policy limits and applicable tax rules.",
  conversion_policy_summary:
    "Interns who complete the term with a satisfactory performance review are considered for conversion to a permanent Software Engineer role, subject to business need and a separate written offer at that time.",
};

/** A real employee and a real intern, so the difference between them is visible. */
const PEOPLE = {
  employee: {
    label: "Employee (CV-001)",
    tokens: {
      ...COMMON,
      document_reference: "CV-001/JOIN/2026-09",
      employee_name: "Hema Koteswara Rao Bonthada",
      candidate_name: "Hema Koteswara Rao Bonthada",
      full_name: "Hema Koteswara Rao Bonthada",
      candidate_email: "hemakotibonthada@gmail.com",
      employee_code: "CV-001",
      position_title: "Senior Backend Engineer",
      designation: "Senior Backend Engineer",
      department: "Engineering",
      reporting_manager: "Vema Reddy",
      join_date: "1 September 2026",
      start_date: "1 September 2026",
      end_date: "31 August 2027",
      last_working_day: "31 August 2027",
      reporting_time: "9:30 AM IST",
      work_location: "Circuvent Technologies, Hyderabad",
      employment_type: "Full-time, permanent",
      probation_period: "6 months",
      notice_period: "60 days",
      grade_level: "M3 — Senior Engineer",
      business_unit: "Engineering — Payroll Platform Group",
      candidate_address: "Flat 302, Sri Sai Residency, Kondapur, Hyderabad, Telangana 500084, India",
      annual_ctc: "INR 23,76,000",
      basic_salary: "INR 9,60,000",
      basic_salary_monthly: "INR 80,000",
      hra: "INR 4,80,000",
      hra_monthly: "INR 40,000",
      special_allowance: "INR 3,60,000",
      special_allowance_monthly: "INR 30,000",
      conveyance_allowance: "INR 19,200",
      conveyance_allowance_monthly: "INR 1,600",
      medical_allowance: "INR 15,000",
      medical_allowance_monthly: "INR 1,250",
      lta_allowance: "INR 72,000",
      lta_allowance_monthly: "INR 6,000",
      employer_pf_contribution: "INR 21,600",
      employer_pf_contribution_monthly: "INR 1,800",
      gratuity_provision: "INR 26,640",
      performance_pay_monthly: "INR 15,000",
      pf_employer: "INR 1,80,000",
      gross_monthly: "INR 2,00,000",
      net_monthly: "INR 1,74,500",
      offer_valid_until: "20 August 2026",
      company_name: "Circuvent Technologies Private Limited",
      company_address: "Hyderabad, Telangana, India",
      hr_name: "Vema Reddy",
      hr_designation: "Head of People",
      hr_email: "vema@circuvent.com",
      today: "20 August 2026",
      date: "20 August 2026",
      tenure: "1 year",
      duration: "1 year",
      pan: "ABCDE1234F",
      uan: "100123456789",
      bank_name: "HDFC Bank",
      account_number: "XXXXXX4321",
      ifsc: "HDFC0001234",
      probation_months: "6",
      probation_notice_period: "30 days",
      confirmation_date: "1 March 2027",
      benefits_on_confirmation:
        "Group medical cover for self and dependants, annual health check, and eligibility for the annual performance bonus.",
      review_summary:
        "Consistently met expectations across delivery, code quality and collaboration during the probation period.",
      engagement_end_date: "31 August 2027",
      exit_reason: "Resignation, on their own request",
      settlement_status: "Full and final settlement has been completed and paid.",
      asset_status: "All company assets issued have been returned and verified.",
      project_summary:
        "Worked on the payroll and attendance platform, delivering the statutory calculation module.",
      learning_outcomes:
        "Distributed systems design, PostgreSQL performance tuning, and Indian payroll statutory compliance.",
      course_name: "Advanced Backend Engineering",
      trainer_name: "Vema Reddy",
      course_summary: "Distributed systems, database design and production operations.",
      course_duration: "12 weeks",
      assessment_result: "Passed with distinction",
      recognition_reason:
        "Outstanding contribution to the payroll platform, delivered ahead of schedule and without a production incident.",
      recognition_period: "Financial year 2026-27",
      application_reference: "APP-2026-0184",
      first_name: "Hema",
      manager_name: "Vema Reddy",
      manager_email: "vema@circuvent.com",
      mentor_name: "Vema Reddy",
      mentor_email: "vema@circuvent.com",
      gross_salary: "INR 23,27,760 per annum",
      gross_salary_monthly: "INR 1,93,980",
      monthly_salary: "INR 2,00,000",
      other_allowances: "INR 3,95,160",
      other_allowances_monthly: "INR 32,930",
      variable_pay_summary: "Up to 15% of annual fixed pay, against company and individual targets.",
      bonus_plan: "Annual performance bonus, reviewed each April.",
      additional_benefits:
        "Group medical cover for self and dependants, annual health check, and a learning allowance.",
      professional_fees: "Not applicable",
      stipend_amount: "Not applicable",
      key_responsibilities:
        "Designing and building backend services, owning the statutory payroll calculation module, and reviewing code.",
      strength_highlights:
        "Strong systems design, careful attention to correctness, and dependable delivery.",
      basic_pay: "INR 1,00,000",
      hra_allowance: "INR 40,000",
      performance_incentive: "INR 10,000",
      gross_pay: "INR 2,00,000",
      pf_contribution: "INR 1,800",
      income_tax: "INR 23,500",
      other_deductions: "INR 0",
      total_deductions: "INR 25,500",
      net_pay: "INR 1,74,500",
      account_number_masked: "XXXXXX4321",
    },
  },
  intern: {
    label: "Intern (CVI-001)",
    tokens: {
      ...COMMON,
      document_reference: "CVI-001/INTERN/2026-09",
      employee_name: "Sowjanya Badeti",
      candidate_name: "Sowjanya Badeti",
      full_name: "Sowjanya Badeti",
      candidate_email: "sowjanyabadeti5@gmail.com",
      employee_code: "CVI-001",
      position_title: "Software Engineering Intern",
      designation: "Software Engineering Intern",
      department: "Engineering",
      reporting_manager: "Hema Koteswara Rao Bonthada",
      join_date: "1 September 2026",
      start_date: "1 September 2026",
      end_date: "28 February 2027",
      last_working_day: "28 February 2027",
      reporting_time: "10:00 AM IST",
      work_location: "Circuvent Technologies, Hyderabad",
      employment_type: "Internship, fixed term",
      probation_period: "Not applicable",
      notice_period: "15 days",
      grade_level: "T1 — Graduate Engineer",
      business_unit: "Engineering — Platform Internship Programme",
      candidate_address: "12-3-45, Nallakunta, Hyderabad, Telangana 500044, India",
      annual_ctc: "INR 3,56,400",
      basic_salary: "INR 1,44,000",
      basic_salary_monthly: "INR 12,000",
      hra: "INR 72,000",
      hra_monthly: "INR 6,000",
      special_allowance: "INR 54,000",
      special_allowance_monthly: "INR 4,500",
      conveyance_allowance: "INR 7,200",
      conveyance_allowance_monthly: "INR 600",
      medical_allowance: "INR 3,600",
      medical_allowance_monthly: "INR 300",
      lta_allowance: "INR 10,800",
      lta_allowance_monthly: "INR 900",
      employer_pf_contribution: "INR 17,280",
      employer_pf_contribution_monthly: "INR 1,440",
      gratuity_provision: "INR 3,996",
      performance_pay_monthly: "INR 2,500",
      pf_employer: "Not applicable",
      gross_monthly: "INR 30,000",
      net_monthly: "INR 30,000",
      offer_valid_until: "20 August 2026",
      company_name: "Circuvent Technologies Private Limited",
      company_address: "Hyderabad, Telangana, India",
      hr_name: "Vema Reddy",
      hr_designation: "Head of People",
      hr_email: "vema@circuvent.com",
      today: "20 August 2026",
      date: "20 August 2026",
      tenure: "6 months",
      duration: "6 months",
      stipend: "INR 30,000 per month",
      pan: "FGHIJ5678K",
      uan: "Not applicable",
      bank_name: "State Bank of India",
      account_number: "XXXXXX8765",
      ifsc: "SBIN0009876",
      probation_months: "Not applicable",
      probation_notice_period: "15 days",
      confirmation_date: "1 March 2027",
      benefits_on_confirmation:
        "On conversion to permanent employment: group medical cover, annual health check, and provident fund enrolment.",
      review_summary:
        "Completed the internship with strong technical progress and was recommended for conversion to a permanent role.",
      engagement_end_date: "28 February 2027",
      exit_reason: "Completion of the agreed internship period",
      settlement_status: "The final stipend has been paid in full.",
      asset_status: "The laptop and access card issued have been returned and verified.",
      project_summary:
        "Built the attendance device import for the HR platform, including the mapping from terminal records to attendance.",
      learning_outcomes:
        "TypeScript, PostgreSQL, automated testing, and working to a production release process.",
      course_name: "Software Engineering Internship Programme",
      trainer_name: "Hema Koteswara Rao Bonthada",
      course_summary: "Practical backend engineering on a live product.",
      course_duration: "6 months",
      assessment_result: "Passed",
      recognition_reason:
        "Delivered the attendance import ahead of schedule during the internship.",
      recognition_period: "September 2026 to February 2027",
      application_reference: "APP-2026-0207",
      first_name: "Sowjanya",
      manager_name: "Hema Koteswara Rao Bonthada",
      manager_email: "hema@circuvent.com",
      mentor_name: "Hema Koteswara Rao Bonthada",
      mentor_email: "hema@circuvent.com",
      gross_salary: "INR 3,35,124 per annum",
      gross_salary_monthly: "INR 27,927",
      monthly_salary: "INR 30,000",
      other_allowances: "INR 17,124",
      other_allowances_monthly: "INR 1,427",
      variable_pay_summary: "Not applicable to an internship.",
      bonus_plan: "Not applicable to an internship.",
      additional_benefits: "Accident cover, a mentor, and a learning allowance for course material.",
      professional_fees: "Not applicable",
      stipend_amount: "INR 30,000 per month",
      key_responsibilities:
        "Building the attendance device import, writing automated tests, and taking part in code review.",
      strength_highlights:
        "Quick to learn, careful about correctness, and asked good questions early rather than late.",
      basic_pay: "INR 18,000",
      hra_allowance: "INR 7,200",
      performance_incentive: "INR 0",
      gross_pay: "INR 30,000",
      pf_contribution: "Not applicable",
      income_tax: "INR 0",
      other_deductions: "INR 0",
      total_deductions: "INR 200",
      net_pay: "INR 29,800",
      account_number_masked: "XXXXXX8765",
      professional_tax: "INR 200",
    },
  },
};

/**
 * Loads the letter templates without running the seeder.
 *
 * The seeder imports `pg` and calls its own entry point on load. Both are
 * removed in a temporary copy so the array can be read; the original file is
 * never touched, because it is the thing that actually seeds production.
 */
async function loadLetterTemplates() {
  const source = path.join(REPO, "scripts", "seed-letter-templates.mjs");
  if (!fs.existsSync(source)) return [];

  let code = fs.readFileSync(source, "utf8");

  /*
   * The seeder is a top-level script, not a module with an entry point: it
   * connects and writes as soon as it is loaded. So it cannot be imported at
   * all, and the array is sliced out instead -- everything from the top of the
   * file down to the end of the TEMPLATES declaration, which carries the helper
   * functions the templates are built from and none of the database work.
   *
   * Slicing rather than copying the wording matters. A sample pack with its own
   * copy of the text would drift from what is actually sent, and would then
   * reassure somebody about a letter they are not looking at.
   */
  const lines = code.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s*const\s+TEMPLATES\s*=\s*\[/.test(l));
  if (start === -1) return [];
  let end = -1;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*\];\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  if (end === -1) return [];

  code = lines.slice(0, end + 1).join("\n");
  code = code.replace(/^\s*import\s+\{[^}]*\}\s+from\s+["']pg["'];?\s*$/gm, "");
  // Anything that would start the seeder. Only top-level calls are removed;
  // the declarations they refer to are left alone.
  code = code.replace(/^\s*(await\s+)?main\s*\([^)]*\)\s*;?\s*$/gm, "");
  code = code.replace(/^\s*main\s*\([^)]*\)\s*\.catch[\s\S]*?;\s*$/gm, "");
  code += "\nexport { TEMPLATES };\n";

  // Written beside the original rather than in the system temp directory: the
  // seeder resolves its stylesheet relative to its own location, so a copy
  // anywhere else cannot find it.
  const temp = path.join(REPO, "scripts", `.letters-tmp-${Date.now()}.mjs`);
  fs.writeFileSync(temp, code, "utf8");
  try {
    const mod = await import(pathToFileURL(temp).href);
    return (mod.TEMPLATES ?? []).map((t) => ({
      name: t.name,
      category: t.category ?? "letter",
      html: typeof t.build === "function" ? t.build() : String(t.body ?? ""),
    }));
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

/** Loads the built-in catalogue, which is TypeScript and needs tsx to read. */
async function loadCatalogTemplates() {
  const out = path.join(os.tmpdir(), `catalog-${Date.now()}.json`);
  /*
   * A relative import, not an absolute one. Windows ESM refuses a bare
   * `C:\...` specifier ("absolute paths must be valid file:// URLs"), and the
   * temporary file lives in `scripts/` precisely so the catalogue is one
   * directory hop away and tsconfig's path aliases still resolve.
   */
  const script = `
    import { TEMPLATE_CATALOG } from "../src/lib/document-templates/catalog.ts";
    import fs from "node:fs";
    const rows = (TEMPLATE_CATALOG as any[]).map((t) => ({
      name: t.name,
      category: t.category ?? t.type ?? "document",
      html: typeof t.build === "function" ? t.build() : String(t.body ?? t.bodyHtml ?? ""),
    }));
    fs.writeFileSync(${JSON.stringify(out.replace(/\\/g, "/"))}, JSON.stringify(rows), "utf8");
  `;
  const temp = path.join(REPO, "scripts", `.catalog-tmp-${Date.now()}.mts`);
  fs.writeFileSync(temp, script, "utf8");
  const { spawnSync } = await import("node:child_process");
  // Quoted because the repository path contains spaces ("Office Apps") and
  // `shell: true` is required for npx on Windows, which would otherwise split
  // the path at the first space and report a missing module.
  const res = spawnSync("npx", ["tsx", `"${temp}"`], { cwd: REPO, shell: true, encoding: "utf8" });
  fs.rmSync(temp, { force: true });
  if (!fs.existsSync(out)) {
    const why = [res.stderr, res.stdout].filter(Boolean).join("\n").trim();
    console.warn("  catalogue could not be read:\n" + why.split("\n").slice(0, 12).map((l) => "    " + l).join("\n"));
    return [];
  }
  const rows = JSON.parse(fs.readFileSync(out, "utf8"));
  fs.rmSync(out, { force: true });
  return rows;
}

/** Substitutes tokens and reports the ones nothing filled in. */
function substitute(html, tokens) {
  const missing = new Set();
  const filled = String(html).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, key) => {
    const value = tokens[key];
    if (value === undefined) {
      missing.add(key);
      return whole;
    }
    return String(value);
  });
  return { filled, missing: [...missing] };
}

/** HTML to lines, keeping the structure a reader needs and dropping the rest. */
function htmlToLines(html) {
  return String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|h[1-6]|li|tr)\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "  \u2022 ")
    .replace(/<\s*\/\s*td\s*>\s*<\s*td[^>]*>/gi, "  |  ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l, i, arr) => l.length > 0 || (i > 0 && arr[i - 1].length > 0));
}

const A4 = [595.28, 841.89];
const MARGIN = 56;

async function toPdf(title, subtitle, html) {
  const doc = await PDFDocument.create();
  const body = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  // Same two outcomes as the HTML this PDF is built from, and the same
  // failure handling as `render-pdf.ts`'s `loadCompanyLogo()`: a tenant that
  // carries no `<img class="company-logo">` (or whose bytes cannot be
  // fetched) gets no logo drawn, never a broken image placeholder -- this
  // review pack would otherwise misreport a rendering bug as a design choice.
  const logoUrl = extractCompanyLogoUrl(html);
  let logo = null;
  if (logoUrl) {
    try {
      logo = await doc.embedPng(await readLogoBytes(logoUrl));
    } catch (error) {
      console.warn("  (could not load the company logo for this sample; rendering without it)", error);
    }
  }

  let page = doc.addPage(A4);
  let y = A4[1] - MARGIN;
  const width = A4[0] - MARGIN * 2;

  const newPage = () => {
    page = doc.addPage(A4);
    y = A4[1] - MARGIN;
  };

  const write = (text, font, size, colour = rgb(0.1, 0.1, 0.12)) => {
    const words = String(text).split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      y -= size * 0.8;
      return;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > width && line) {
        if (y < MARGIN + size * 2) newPage();
        page.drawText(line, { x: MARGIN, y, size, font, color: colour });
        y -= size * 1.45;
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) {
      if (y < MARGIN + size * 2) newPage();
      page.drawText(line, { x: MARGIN, y, size, font, color: colour });
      y -= size * 1.45;
    }
  };

  const logoSize = 26;
  if (logo) {
    page.drawImage(logo, {
      x: A4[0] - MARGIN - logoSize,
      y: A4[1] - MARGIN - logoSize + 9,
      width: logoSize,
      height: logoSize,
    });
  }
  page.drawText("CIRCUVENT TECHNOLOGIES", {
    x: MARGIN, y, size: 9, font: bold, color: rgb(0.35, 0.35, 0.4),
  });
  y -= 26;
  write(title, bold, 17);
  y -= 4;
  if (subtitle) write(subtitle, body, 9.5, rgb(0.42, 0.42, 0.48));
  y -= 10;

  for (const line of htmlToLines(html)) {
    const heading = line.length < 70 && /^[A-Z][A-Za-z ,'&()\/-]+$/.test(line) && !line.includes("|");
    write(line, heading ? bold : body, heading ? 11.5 : 10);
  }

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawText(`${i + 1} of ${pages.length}`, {
      x: A4[0] - MARGIN - 46, y: MARGIN - 22, size: 8,
      font: body, color: rgb(0.55, 0.55, 0.6),
    });
    p.drawText("Sample rendering for review - not a issued document", {
      x: MARGIN, y: MARGIN - 22, size: 8, font: body, color: rgb(0.62, 0.62, 0.68),
    });
  });

  return doc.save();
}

const safe = (s) => String(s).replace(/[^\w -]+/g, "").replace(/\s+/g, "-").slice(0, 70);

async function main() {
  console.log("Reading the templates the application actually seeds from...\n");
  const letters = await loadLetterTemplates();
  const catalog = await loadCatalogTemplates();
  const all = [...catalog, ...letters].filter((t) => t.html && String(t.html).trim().length > 0);

  if (all.length === 0) {
    console.error("No templates could be read. Nothing written.");
    process.exit(1);
  }
  console.log(`Found ${all.length} templates (${catalog.length} catalogue, ${letters.length} letters).\n`);

  fs.mkdirSync(OUT, { recursive: true });
  const report = [];

  for (const [key, person] of Object.entries(PEOPLE)) {
    const dir = path.join(OUT, key === "employee" ? "Employee-CV-001" : "Intern-CVI-001");
    fs.mkdirSync(dir, { recursive: true });
    console.log(`${person.label}`);

    for (const template of all) {
      const { filled, missing } = substitute(template.html, person.tokens);
      // Resolved after `substitute()`, not before: `COMPANY_LOGO_SLOT` is an
      // HTML comment, not a `{{token}}`, so it is invisible to `substitute()`
      // either way, but doing it in the same order `generate()` does in
      // `documents.neon.ts` (render tokens, then splice the logo, then treat
      // the result as final) keeps this sample pack an honest rehearsal of
      // the real pipeline rather than a shortcut that happens to look right.
      const withLogo = applyCompanyLogo(filled, defaultLogoUrl());
      const bytes = await toPdf(template.name, person.label, withLogo);
      const file = path.join(dir, `${safe(template.name)}.pdf`);
      fs.writeFileSync(file, bytes);
      report.push({ person: person.label, template: template.name, missing });
      console.log(
        `  ${missing.length === 0 ? "ok  " : "TOK "} ${template.name}` +
        (missing.length ? `  <- unfilled: ${missing.join(", ")}` : "")
      );
    }
    console.log("");
  }

  const unfilled = report.filter((r) => r.missing.length > 0);
  const summary = [
    "CIRCUVENT - SAMPLE LETTERS AND CERTIFICATES",
    "",
    `Generated ${new Date().toISOString()}`,
    `${all.length} templates x 2 people = ${report.length} documents`,
    "",
    "Rendered for review from the same sources the application seeds from:",
    "  src/lib/document-templates/catalog.ts",
    "  scripts/seed-letter-templates.mjs",
    "",
    unfilled.length === 0
      ? "Every placeholder was substituted."
      : `${unfilled.length} documents contain placeholders nothing filled in. A token left`,
    unfilled.length === 0 ? "" : "unsubstituted prints literally on the page, so these are real defects:",
    "",
    ...unfilled.map((r) => `  ${r.person} - ${r.template}: ${r.missing.join(", ")}`),
  ].join("\n");

  fs.writeFileSync(path.join(OUT, "SUMMARY.txt"), summary, "utf8");

  console.log("-".repeat(60));
  console.log(`Written to: ${OUT}`);
  console.log(`${report.length} PDFs, ${unfilled.length} with unfilled placeholders.`);
}

main().catch((error) => {
  console.error("Failed:", error?.message ?? error);
  process.exit(1);
});
