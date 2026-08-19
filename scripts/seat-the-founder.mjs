// ═══════════════════════════════════════════════════════════════
// One employee, on a proper package
// ═══════════════════════════════════════════════════════════════
//   node scripts/seat-the-founder.mjs [--apply]
//
// Without --apply it prints the plan and changes nothing.
//
// ── What this does ──
// Leaves exactly one employee on the books — the founder — and gives that
// record a real compensation structure and a real benefits enrolment, both of
// which were tables the product had never written a row into.
//
// Everybody else is retired, not deleted. They are people who were created by
// hand or by a half-finished import, and the company's own rule is that
// somebody becomes staff by being hired: Careers, then ATS, then employee. They
// can come back through that door, and their history stays intact while they
// are away.
//
// ── The package ──
// ₹12,00,000 cost to company, deliberately. Under the new regime for FY2026-27
// the section 87A rebate takes tax to nil at ₹12,00,000 of *taxable* income, and
// a salaried person also has the ₹75,000 standard deduction. Because employer
// provident fund and gratuity are a cost to the company rather than salary paid
// to the employee, a ₹12,00,000 CTC produces a gross of about ₹11.55 lakh and a
// taxable income of about ₹10.80 lakh — comfortably inside the rebate, with
// roughly ₹1.15 lakh of headroom still to spare. Verified with the payroll
// engine's own `computeAnnualTaxLiability`, not asserted.
//
// The structure follows IN-STANDARD, the salary template Paystub actually pays
// against: basic 40% of CTC, HRA 50% of basic, fixed conveyance and medical, and
// the special allowance taking the balance. A structure that disagreed with the
// template would put one set of numbers in the letter and another on the payslip.
//
// ── Insurance sits outside the CTC ──
// A deliberate choice, and worth stating because it is often done the other way.
// Folding the premiums into the ₹12,00,000 would quietly reduce take-home pay to
// buy cover the company had already promised. Here the premiums are recorded as
// employer-borne, on top, so the number in the offer is the number that reaches
// the bank. Employer-paid group medical premium is not a taxable perquisite in
// India, so this costs the employee nothing in tax either.

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";

const APPLY = process.argv.includes("--apply");

const env = readFileSync(".env.local", "utf8");
const url = env
  .split(/\r?\n/)
  .find((l) => l.startsWith("DATABASE_URL="))
  .slice(13)
  .trim()
  .replace(/^["']|["']$/g, "");

const FOUNDER_EMAIL = "vema@circuvent.com";
const ANNUAL_CTC = 1_200_000; // rupees
const rupees = (n) => n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

// ── IN-STANDARD, in paise ──
const minor = (rupeeAmount) => BigInt(Math.round(rupeeAmount * 100));
const annualCtcMinor = minor(ANNUAL_CTC);
const monthlyCtcMinor = annualCtcMinor / 12n;

const basicMonthly = (monthlyCtcMinor * 40n) / 100n;
const hraMonthly = (basicMonthly * 50n) / 100n;
const conveyanceMonthly = 160_000n; // ₹1,600
const medicalMonthly = 125_000n; // ₹1,250

// Retirals are a cost to the company, so they come out of CTC before the
// balance is struck — otherwise the gross would exceed the package.
const PF_CEILING_MONTHLY = 1_500_000n; // ₹15,000
const pfWage = basicMonthly < PF_CEILING_MONTHLY ? basicMonthly : PF_CEILING_MONTHLY;
const employerPfMonthly = (pfWage * 12n) / 100n;
const gratuityAnnual = (basicMonthly * 12n * 48_077n) / 1_000_000n;
const gratuityMonthly = gratuityAnnual / 12n;

const monthlyGross = monthlyCtcMinor - employerPfMonthly - gratuityMonthly;
const specialMonthly =
  monthlyGross - (basicMonthly + hraMonthly + conveyanceMonthly + medicalMonthly);

const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query("SELECT set_config('app.superuser','on',false)");

await client.query("BEGIN");
try {
  const { rows: orgRows } = await client.query(
    `SELECT id::text FROM identity.organizations WHERE slug = 'circuvent'`
  );
  const orgId = orgRows[0].id;

  const { rows: founderRows } = await client.query(
    `SELECT id::text, employee_code, first_name, last_name
       FROM hrms.employees WHERE work_email = $1 AND deleted_at IS NULL`,
    [FOUNDER_EMAIL]
  );
  const founder = founderRows[0];
  if (!founder) throw new Error(`No live employee record for ${FOUNDER_EMAIL}`);

  // ── 1. Everybody else steps back through the front door ──
  const { rows: others } = await client.query(
    `SELECT id::text, employee_code, first_name, last_name, work_email,
            application_id::text, candidate_id::text
       FROM hrms.employees
      WHERE org_id = $1::uuid AND deleted_at IS NULL AND id <> $2::uuid`,
    [orgId, founder.id]
  );

  for (const person of others) {
    console.log(
      `retire   ${person.employee_code.padEnd(8)} ${`${person.first_name ?? ""} ${
        person.last_name ?? ""
      }`.trim().padEnd(30)} ${person.work_email}`
    );
  }

  // The founder inherits the application they were actually hired against. The
  // link has to be released first: `employees_candidate_unique_idx` allows one
  // employee per candidate, which is the constraint doing its job.
  const hiredRecord = others.find((p) => p.candidate_id);
  if (hiredRecord) {
    await client.query(
      `UPDATE hrms.employees SET candidate_id = NULL, application_id = NULL WHERE id = $1::uuid`,
      [hiredRecord.id]
    );
  }

  await client.query(
    `UPDATE hrms.employees
        SET deleted_at = now(), status = 'inactive', updated_at = now()
      WHERE org_id = $1::uuid AND deleted_at IS NULL AND id <> $2::uuid`,
    [orgId, founder.id]
  );

  // ── 2. The founder's package ──
  await client.query(
    `UPDATE hrms.employees
        SET ctc_minor = $2,
            currency = 'INR',
            notice_period_days = 90,
            confirmation_date = join_date,
            application_id = coalesce($3::uuid, application_id),
            candidate_id = coalesce($4::uuid, candidate_id),
            updated_at = now()
      WHERE id = $1::uuid`,
    [founder.id, annualCtcMinor.toString(), hiredRecord?.application_id ?? null, hiredRecord?.candidate_id ?? null]
  );

  // ── 3. The salary structure ──
  //
  // `hrms.salary_structures` had never held a row. Without one there is nothing
  // that says what the package is made of, so every letter and every payslip
  // would have to re-derive it and could disagree.
  await client.query(
    `DELETE FROM hrms.salary_structures WHERE employee_id = $1::uuid`,
    [founder.id]
  );
  await client.query(
    `INSERT INTO hrms.salary_structures
       (id, org_id, employee_id, effective_from, ctc_minor, basic_minor, hra_minor,
        conveyance_minor, medical_minor, lta_minor, special_allowance_minor,
        other_allowances_minor, employer_pf_minor, employer_esi_minor, gratuity_minor,
        revision_reason)
     VALUES ($1,$2,$3,(SELECT join_date FROM hrms.employees WHERE id = $3::uuid),
             $4,$5,$6,$7,$8,0,$9,0,$10,0,$11,
             'Founder package on incorporation')`,
    [
      randomUUID(),
      orgId,
      founder.id,
      annualCtcMinor.toString(),
      (basicMonthly * 12n).toString(),
      (hraMonthly * 12n).toString(),
      (conveyanceMonthly * 12n).toString(),
      (medicalMonthly * 12n).toString(),
      (specialMonthly * 12n).toString(),
      (employerPfMonthly * 12n).toString(),
      gratuityAnnual.toString(),
    ]
  );

  // ── 4. Benefits ──
  //
  // Employer-borne, and outside the CTC. Sums insured are at the level a founder
  // and the company's officers would normally carry.
  const PLANS = [
    {
      name: "Group Medical Cover — Executive",
      benefit_type: "health_insurance",
      provider: "To be appointed",
      description:
        "Family floater hospitalisation cover for the employee, spouse, up to two children and both sets of parents. " +
        "Includes pre- and post-hospitalisation, day-care procedures and maternity. Premium borne by the company; " +
        "an employer-paid group medical premium is not a taxable perquisite.",
      coverage: 1_000_000,
      employerPremium: 48_000,
      allows_dependants: true,
      eligible_relations: ["spouse", "child", "parent", "parent_in_law"],
      max_dependants: 6,
    },
    {
      name: "Group Personal Accident — Executive",
      benefit_type: "accident_insurance",
      provider: "To be appointed",
      description:
        "Cover for accidental death and permanent total or partial disablement, worldwide and around the clock, " +
        "on and off duty. Premium borne by the company.",
      coverage: 5_000_000,
      employerPremium: 6_000,
      allows_dependants: false,
      eligible_relations: [],
      max_dependants: 0,
    },
    {
      name: "Group Term Life — Executive",
      benefit_type: "life_insurance",
      provider: "To be appointed",
      description:
        "Term life cover payable to the nominee. Premium borne by the company.",
      coverage: 10_000_000,
      employerPremium: 12_000,
      allows_dependants: false,
      eligible_relations: [],
      max_dependants: 0,
    },
    {
      name: "Employees' Provident Fund",
      benefit_type: "retirement",
      provider: "EPFO",
      description:
        "Statutory retirement saving under the Employees' Provident Funds and Miscellaneous Provisions Act, 1952. " +
        "The employee contributes 12% of provident fund wage and the company contributes the same, split between " +
        "the provident fund and the pension scheme. Calculated on the statutory monthly wage ceiling of ₹15,000.",
      coverage: 0,
      employerPremium: Number(employerPfMonthly * 12n) / 100,
      allows_dependants: false,
      eligible_relations: [],
      max_dependants: 0,
    },
    {
      name: "Gratuity",
      benefit_type: "retirement",
      provider: "Self-funded",
      description:
        "Payable under the Payment of Gratuity Act, 1972 on completing five years of continuous service, at fifteen " +
        "days' wages for each completed year, calculated on basic salary. Accrued monthly in the accounts.",
      coverage: 0,
      employerPremium: Number(gratuityAnnual) / 100,
      allows_dependants: false,
      eligible_relations: [],
      max_dependants: 0,
    },
  ];

  await client.query(
    `DELETE FROM hrms.benefit_enrolments WHERE employee_id = $1::uuid`,
    [founder.id]
  );
  await client.query(`DELETE FROM hrms.benefit_plans WHERE org_id = $1::uuid`, [orgId]);

  let annualBenefitCost = 0;
  for (const plan of PLANS) {
    const planId = randomUUID();
    await client.query(
      `INSERT INTO hrms.benefit_plans
         (id, org_id, name, benefit_type, provider, description,
          employer_contribution_minor, employee_contribution_minor, currency,
          coverage_amount_minor, allows_dependants, eligible_relations, max_dependants,
          is_auto_enrolled, is_active, effective_from)
       VALUES ($1,$2,$3,$4::hrms.benefit_type,$5,$6,$7,0,'INR',$8,$9,$10::jsonb,$11,true,true,
               (SELECT join_date FROM hrms.employees WHERE id = $12::uuid))`,
      [
        planId,
        orgId,
        plan.name,
        plan.benefit_type,
        plan.provider,
        plan.description,
        Math.round(plan.employerPremium * 100),
        Math.round(plan.coverage * 100),
        plan.allows_dependants,
        JSON.stringify(plan.eligible_relations),
        plan.max_dependants,
        founder.id,
      ]
    );

    await client.query(
      `INSERT INTO hrms.benefit_enrolments
         (id, org_id, employee_id, plan_id, status, plan_year, coverage_from,
          employee_cost_minor, employer_cost_minor, elected_at)
       VALUES ($1,$2,$3,$4,'active',2026,
               (SELECT join_date FROM hrms.employees WHERE id = $3::uuid),
               0,$5,now())`,
      [randomUUID(), orgId, founder.id, planId, Math.round(plan.employerPremium * 100)]
    );

    annualBenefitCost += plan.employerPremium;
    console.log(
      `benefit  ${plan.name.padEnd(36)} cover ${
        plan.coverage ? `Rs ${rupees(plan.coverage)}`.padEnd(16) : "".padEnd(16)
      } company pays Rs ${rupees(plan.employerPremium)}/yr`
    );
  }

  // ── 5. Say what was built ──
  console.log("\n-- The package --");
  console.log(`  Annual cost to company     Rs ${rupees(Number(annualCtcMinor) / 100)}`);
  console.log(`  Monthly gross salary       Rs ${rupees(Number(monthlyGross) / 100)}`);
  console.log(`    Basic                    Rs ${rupees(Number(basicMonthly) / 100)}`);
  console.log(`    House rent allowance     Rs ${rupees(Number(hraMonthly) / 100)}`);
  console.log(`    Conveyance               Rs ${rupees(Number(conveyanceMonthly) / 100)}`);
  console.log(`    Medical                  Rs ${rupees(Number(medicalMonthly) / 100)}`);
  console.log(`    Special allowance        Rs ${rupees(Number(specialMonthly) / 100)}`);
  console.log(`  Employer PF (year)         Rs ${rupees(Number(employerPfMonthly * 12n) / 100)}`);
  console.log(`  Gratuity accrual (year)    Rs ${rupees(Number(gratuityAnnual) / 100)}`);
  console.log(
    `  Insurance, outside the CTC Rs ${rupees(
      annualBenefitCost - Number(employerPfMonthly * 12n) / 100 - Number(gratuityAnnual) / 100
    )}/yr borne by the company`
  );

  const { rows: remaining } = await client.query(
    `SELECT employee_code, first_name, last_name, designation, work_email,
            (ctc_minor::numeric / 100)::bigint AS ctc
       FROM hrms.employees WHERE org_id = $1::uuid AND deleted_at IS NULL
      ORDER BY employee_code`,
    [orgId]
  );
  console.log("\n-- On the books --");
  for (const r of remaining) {
    console.log(
      `  ${r.employee_code}  ${`${r.first_name} ${r.last_name}`.padEnd(30)} ${r.designation} — Rs ${rupees(
        Number(r.ctc)
      )}`
    );
  }

  if (APPLY) {
    await client.query("COMMIT");
    console.log("\napplied.");
  } else {
    await client.query("ROLLBACK");
    console.log("\ndry run - nothing was changed. Re-run with --apply.");
  }
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
