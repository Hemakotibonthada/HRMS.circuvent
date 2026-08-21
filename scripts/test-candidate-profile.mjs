// Proves the candidate-profile endpoint returns what a profile needs and
// nothing that belongs in a joining form.
//
//   node scripts/test-candidate-profile.mjs <profileKey> <directoryKey>

const base = process.env.HRMS_BASE || "http://localhost:3002";
const profileKey = process.argv[2];
const dirKey = process.argv[3];

let pass = 0;
let fail = 0;
function ok(label, condition, detail = "") {
  if (condition) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

async function hit(email, key) {
  const url = base + "/api/v1/candidate-profile?email=" + encodeURIComponent(email);
  const res = await fetch(url, { headers: key ? { "X-API-Key": key } : {} });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* not json */
  }
  return { status: res.status, body };
}

const WITH_DATA = "hemakotibonthada@gmail.com";
const WITHOUT_DATA = "admin@circuvent.com";

console.log("\n— who may read career history —");

const anon = await hit(WITH_DATA, null);
ok("no key is refused", anon.status === 401, `got ${anon.status}`);

const wrongScope = await hit(WITH_DATA, dirKey);
ok(
  "a key without candidates:read is refused",
  wrongScope.status === 403,
  `got ${wrongScope.status} — employees:read must not reach this`
);

console.log("\n— a real registration —");

const found = await hit(WITH_DATA, profileKey);
ok("the request succeeds", found.status === 200, `got ${found.status}`);
ok("the candidate was found", found.body?.found === true);
ok(
  "education came back",
  (found.body?.education ?? []).length > 0,
  `${(found.body?.education ?? []).length} entries`
);
ok(
  "employment came back",
  (found.body?.employment ?? []).length > 0,
  `${(found.body?.employment ?? []).length} entries`
);

const edu = (found.body?.education ?? [])[0] ?? {};
ok("an institution is present", typeof edu.institution === "string" && edu.institution.length > 0, JSON.stringify(edu));

const emp = (found.body?.employment ?? [])[0] ?? {};
ok("an employer is present", typeof emp.employer === "string" && emp.employer.length > 0, JSON.stringify(emp));

console.log("\n— what must never come back —");

const raw = JSON.stringify(found.body ?? {}).toLowerCase();
const forbidden = [
  "ctc",
  "salary",
  "pf_number",
  "pfnumber",
  "reporting_manager",
  "reportingmanager",
  "employee_id",
  "employeeid",
  "reason_for_leaving",
  "reasonforleaving",
  "relieving",
  "score",
];
const leaked = forbidden.filter((token) => raw.includes(token));
ok("no joining-form field survived the projection", leaked.length === 0, leaked.join(", "));

// The control. Every check above is an absence, and a response of `{}` would
// satisfy all of them while the feature was completely broken.
ok(
  "the leak check is looking at a real response",
  raw.includes("institution") && raw.includes("employer"),
  raw.slice(0, 120)
);

console.log("\n— somebody who never registered through Career —");

const empty = await hit(WITHOUT_DATA, profileKey);
ok("the request still succeeds", empty.status === 200, `got ${empty.status}`);
ok(
  "it is an empty answer, not an error",
  Array.isArray(empty.body?.education) && empty.body.education.length === 0,
  JSON.stringify(empty.body ?? {}).slice(0, 140)
);

console.log("\n— a stranger —");
const nobody = await hit("nobody.at.all@example.invalid", profileKey);
ok("an unknown address is not found", nobody.status === 200 && nobody.body?.found === false);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
