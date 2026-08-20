/**
 * Refuses the mistake that disarmed half this API: treating the account id as
 * an employee id.
 *
 *   identity.users.id   the login          — `ctx.userId`
 *   hrms.employees.id   the employment record
 *
 * They are joined by `employees.user_id` and are equal only for accounts the
 * owner-backfill script created, because that script forces `id` to the user's
 * id. Everywhere else they differ, and code that compares or assigns one to the
 * other does not fail loudly — it matches nothing. That is how clocking in
 * answered "Employee <uuid> not found", how leave and payslips returned empty
 * lists belonging to nobody, and how the self-approval check on leave stopped
 * refusing anything: `existing.employeeId === ctx.userId` is simply false for
 * everyone, so a manager could approve their own request.
 *
 * Resolve it with `currentEmployeeId` / `requireCurrentEmployeeId` from
 * `src/lib/current-employee.ts`.
 *
 * If a use is genuinely about the account — who approved, who created, a rate
 * limit key — put `// account-id: <reason>` on the line or the line above.
 *
 *   npx tsx scripts/audit-employee-identity.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SEARCH = [join("src", "app", "api"), join("src", "db", "repositories"), join("src", "lib")];

/** Patterns that mean "an employee id was wanted and an account id was given". */
const RULES: { name: string; re: RegExp }[] = [
  {
    name: "employee id assigned from the account id",
    re: /\bemployeeId\s*:\s*ctx\.userId\b/,
  },
  {
    name: "employee-keyed column compared to the account id",
    re: /\beq\(\s*[A-Za-z_$][\w$]*\.employeeId\s*,\s*ctx\.userId\s*\)/,
  },
  {
    name: "employees.id compared to the account id",
    re: /\beq\(\s*employees\.id\s*,\s*ctx\.userId\s*\)/,
  },
  {
    name: "reporting line compared to the account id",
    re: /\beq\(\s*employees\.reportingToId\s*,\s*ctx\.userId\s*\)/,
  },
  {
    name: "ownership decided by comparing an employee id to the account id",
    re: /\.employeeId\s*[!=]==\s*ctx\.userId|ctx\.userId\s*[!=]==\s*[A-Za-z_$][\w$]*\.employeeId/,
  },
  {
    name: "employee id defaulted to the account id",
    re: /\bconst\s+employeeId\s*=\s*[^;]*\bctx\.userId\b/,
  },
];

const ALLOW = /\/\/\s*account-id:/;

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.ts$/.test(entry) && !/\.test\.ts$/.test(entry)) out.push(full);
  }
  return out;
}

const findings: { file: string; line: number; rule: string; text: string }[] = [];

for (const base of SEARCH) {
  for (const file of walk(join(ROOT, base))) {
    // The resolver itself necessarily mentions both, and is the thing that
    // makes the distinction.
    if (file.endsWith(join("lib", "current-employee.ts"))) continue;

    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      if (ALLOW.test(line) || (i > 0 && ALLOW.test(lines[i - 1]))) return;
      for (const rule of RULES) {
        if (rule.re.test(line)) {
          findings.push({
            file: relative(ROOT, file).split(sep).join("/"),
            line: i + 1,
            rule: rule.name,
            text: line.trim(),
          });
          break;
        }
      }
    });
  }
}

if (findings.length === 0) {
  console.log("No account id is being used as an employee id.");
  process.exit(0);
}

console.error(
  `\n${findings.length} place${findings.length === 1 ? "" : "s"} treat the account id as an employee id:\n`
);
let current = "";
for (const f of findings) {
  if (f.file !== current) {
    current = f.file;
    console.error(`  ${f.file}`);
  }
  console.error(`    ${String(f.line).padStart(4)}  ${f.rule}`);
  console.error(`          ${f.text}`);
}
console.error(
  "\nResolve the employee with currentEmployeeId()/requireCurrentEmployeeId()" +
    "\nfrom src/lib/current-employee.ts, or mark a genuine account-id use with" +
    "\n  // account-id: <why>\n"
);
process.exit(1);
