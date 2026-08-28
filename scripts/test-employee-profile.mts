// Proves the profile projection cannot leak what the employees table holds.
//
//   npx tsx scripts/test-employee-profile.mts
//
// The projection is an allowlist, so this is the alarm rather than the
// mechanism: it feeds a record carrying every sensitive column through
// `toEmployeeProfile` and fails if any of them survives. The point is to
// notice the day somebody widens the allowlist without meaning to — the thing
// that leaks is somebody's salary, and nothing else in the request would look
// wrong.

import {
  PROFILE_FIELD_OWNERS,
  toEmployeeProfile,
  PROFILE_FIELDS,
} from "../src/lib/employee-profile.ts";

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

console.log("\n— the projection —");
ok("the allowlist is populated", PROFILE_FIELDS.length >= 10, `${PROFILE_FIELDS.length} fields`);
ok(
  "it contains the fields a profile needs",
  ["email", "fullName", "jobTitle", "department", "avatarUrl"].every((f) =>
    PROFILE_FIELDS.includes(f)
  ),
  PROFILE_FIELDS.join(", ")
);

const mustNotAppear = [
  "ctcMinor", "currency", "bankDetails", "panNumber", "aadhaarNumber",
  "uanNumber", "pfNumber", "esiNumber", "dateOfBirth", "bloodGroup",
  "maritalStatus", "addressLine1", "city", "state", "postalCode",
  "personalEmail", "phone", "emergencyContact", "customFields",
];

console.log("\n— what it must never carry —");
const inList = mustNotAppear.filter((f) => PROFILE_FIELDS.includes(f));
ok("no sensitive column is in the allowlist", inList.length === 0, inList.join(", "));

// A record shaped like the real table, carrying everything HR holds.
const record = {
  id: "emp-1",
  employeeCode: "CV-0001",
  firstName: "Vema",
  lastName: "Reddy",
  fullName: "Vema Reddy",
  email: "VEMA@circuvent.com",
  avatarUrl: "https://example.com/a.png",
  designation: "Owner",
  departmentName: "Leadership",
  employmentType: "full_time",
  status: "active",
  joinDate: "2024-01-01",
  reportingToName: "Nobody",
  // Everything below must not survive.
  ctcMinor: 250000000,
  currency: "INR",
  bankDetails: { accountNumber: "1234567890", ifsc: "HDFC0001" },
  panNumber: "ABCDE1234F",
  aadhaarNumber: "1111-2222-3333",
  uanNumber: "100200300",
  pfNumber: "PF/123",
  esiNumber: "ESI/456",
  dateOfBirth: "1990-05-05",
  bloodGroup: "O+",
  maritalStatus: "married",
  addressLine1: "12 Residency Road",
  city: "Bengaluru",
  postalCode: "560025",
  personalEmail: "vema.personal@gmail.com",
  phone: "+91 90000 00000",
  emergencyContact: { name: "Someone", phone: "+91 91111 11111" },
  customFields: { secretNote: "do not show" },
};

const projected = toEmployeeProfile(record);
const projectedJson = JSON.stringify(projected);

console.log("\n— projecting a full record —");
ok("the profile came back", !!projected && typeof projected === "object");
ok("the job title survived", projected.jobTitle === "Owner");
ok("the department survived", projected.department === "Leadership");
ok("the email is normalised to lower case", projected.email === "vema@circuvent.com");
ok("the avatar survived", projected.avatarUrl === "https://example.com/a.png");

for (const field of ["ctcMinor", "currency", "bankDetails", "panNumber", "aadhaarNumber", "dateOfBirth", "personalEmail", "phone", "emergencyContact", "customFields"]) {
  ok(`${field} did not survive`, !(field in projected), `present as ${JSON.stringify(projected[field])}`);
}

ok(
  "no sensitive value appears anywhere in the serialised profile",
  !["250000000", "ABCDE1234F", "1234567890", "1990-05-05", "vema.personal", "90000 00000", "do not show"]
    .some((needle) => projectedJson.includes(needle)),
  projectedJson.slice(0, 200)
);

// The control: a scan that finds nothing is worthless unless it can find
// something. Prove the same check fails on a deliberately leaky projection.
const leaky = { ...projected, ctcMinor: record.ctcMinor };
ok(
  "the leak check would actually catch a leak",
  JSON.stringify(leaky).includes("250000000")
);

console.log("\n— field ownership —");
ok("employment facts are marked HR-managed",
  ["jobTitle", "department", "employmentType", "joinDate", "employeeCode", "managerName"]
    .every((f) => PROFILE_FIELD_OWNERS[f] === "hr"));
ok("the avatar is the employee's own", PROFILE_FIELD_OWNERS.avatarUrl === "self");
ok("every projected field declares an owner",
  Object.keys(projected).every((f) => !!PROFILE_FIELD_OWNERS[f]),
  Object.keys(projected).filter((f) => !PROFILE_FIELD_OWNERS[f]).join(", "));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
