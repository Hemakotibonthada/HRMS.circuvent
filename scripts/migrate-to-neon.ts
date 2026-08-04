// ═══════════════════════════════════════════════════════════════
// FIRESTORE → NEON MIGRATION
// ═══════════════════════════════════════════════════════════════
// Copies organizations, users and employees out of the hrms-circuvent
// Firestore database into the Neon identity and hrms schemas.
//
//   npm run db:migrate:data -- --dry-run     report only, write nothing
//   npm run db:migrate:data                  perform the copy
//   npm run db:migrate:data -- --verify      compare both stores, write nothing
//
// Design notes:
//
//  * Idempotent. Every write is an upsert keyed on a natural identifier
//    (organization slug, user email, employee code), so an interrupted run can
//    simply be repeated. A migration that cannot be re-run is one you cannot
//    recover from halfway.
//
//  * Firebase Auth password hashes cannot be verified outside Firebase, so
//    users arrive with must_reset_password = true and their old UID recorded
//    in legacy_firebase_uid. They set a new password on first sign-in.
//
//  * Runs as superuser. The whole point is to write across every tenant, which
//    row-level security exists to prevent.

import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { withTenant } from "../src/db/client";
import { organizations, userRoles, users } from "../src/db/schema/identity";
import { departments, employees } from "../src/db/schema/hrms";
import { adminDb } from "../src/lib/server-auth";

const HRMS_DATABASE = "hrms-circuvent";

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const VERIFY_ONLY = args.has("--verify");

interface Counts {
  organizations: number;
  users: number;
  departments: number;
  employees: number;
  skipped: number;
}

const counts: Counts = {
  organizations: 0,
  users: 0,
  departments: 0,
  employees: 0,
  skipped: 0,
};

const problems: string[] = [];

function note(message: string) {
  problems.push(message);
  console.warn(`  ! ${message}`);
}

/** Firestore stores dates as ISO strings, Timestamps, or nothing at all. */
function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object" && "toDate" in (value as object)) {
    try {
      return (value as { toDate(): Date }).toDate();
    } catch {
      return null;
    }
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDateString(value: unknown): string | null {
  const date = toDate(value);
  return date ? date.toISOString().slice(0, 10) : null;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "org"
  );
}

/**
 * Firestore employees carry `department` as free text; Neon references a
 * departments row. Names are resolved to ids here, creating the department if
 * this is the first employee to mention it.
 */
async function resolveDepartments(
  orgId: string,
  names: Set<string>
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (names.size === 0) return map;

  await withTenant({ orgId, superuser: true }, async (tx) => {
    const existing = await tx
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(eq(departments.orgId, orgId));

    for (const row of existing) map.set(row.name.toLowerCase(), row.id);

    for (const name of names) {
      if (map.has(name.toLowerCase())) continue;
      if (DRY_RUN || VERIFY_ONLY) {
        map.set(name.toLowerCase(), randomUUID());
        continue;
      }

      const code = name.slice(0, 8).toUpperCase().replace(/[^A-Z0-9]/g, "") || "DEPT";
      const [row] = await tx
        .insert(departments)
        .values({ orgId, name, code })
        .onConflictDoUpdate({
          target: [departments.orgId, departments.code],
          set: { name },
        })
        .returning({ id: departments.id });

      map.set(name.toLowerCase(), row.id);
      counts.departments++;
    }
  });

  return map;
}

async function migrateOrganizations(): Promise<Map<string, string>> {
  const db = adminDb(HRMS_DATABASE);
  const snap = await db.collection("organizations").get();
  const idMap = new Map<string, string>();

  console.log(`\norganizations: ${snap.size} found`);

  for (const doc of snap.docs) {
    const data = doc.data();
    const name = (data.name as string) ?? "Unnamed organization";
    const slug = (data.slug as string) ?? slugify(name);

    if (DRY_RUN || VERIFY_ONLY) {
      idMap.set(doc.id, randomUUID());
      counts.organizations++;
      continue;
    }

    const newId = await withTenant({ orgId: "", superuser: true }, async (tx) => {
      const [row] = await tx
        .insert(organizations)
        .values({
          name,
          slug,
          industry: data.industry as string | undefined,
          website: data.website as string | undefined,
          city: data.city as string | undefined,
          country: (data.country as string) ?? "India",
          timezone: (data.timezone as string) ?? "Asia/Kolkata",
          currency: (data.currency as string) ?? "INR",
          plan: (["starter", "professional", "enterprise"].includes(data.plan as string)
            ? data.plan
            : "starter") as "starter" | "professional" | "enterprise",
        })
        .onConflictDoUpdate({ target: organizations.slug, set: { name, updatedAt: new Date() } })
        .returning({ id: organizations.id });
      return row.id;
    });

    idMap.set(doc.id, newId);
    counts.organizations++;
  }

  return idMap;
}

async function migrateUsers(orgIdMap: Map<string, string>): Promise<Map<string, string>> {
  const db = adminDb(HRMS_DATABASE);
  const snap = await db.collection("users").get();
  const uidMap = new Map<string, string>();

  console.log(`users: ${snap.size} found`);

  for (const doc of snap.docs) {
    const data = doc.data();
    const email = (data.email as string | undefined)?.trim().toLowerCase();

    if (!email) {
      note(`user ${doc.id} has no email; skipped`);
      counts.skipped++;
      continue;
    }

    const legacyOrg = data.organizationId as string | undefined;
    const orgId = legacyOrg ? orgIdMap.get(legacyOrg) : undefined;

    if (!orgId) {
      // Importing a user with no organization would create a row that every
      // RLS policy rejects — invisible, and confusing to debug later.
      note(`user ${email} has no resolvable organization; skipped`);
      counts.skipped++;
      continue;
    }

    if (DRY_RUN || VERIFY_ONLY) {
      uidMap.set(doc.id, randomUUID());
      counts.users++;
      continue;
    }

    const role = (data.role as string) ?? "employee";
    const newId = await withTenant({ orgId, superuser: true }, async (tx) => {
      const [row] = await tx
        .insert(users)
        .values({
          orgId,
          email,
          displayName: (data.displayName as string) ?? email,
          avatarUrl: data.avatar as string | undefined,
          legacyFirebaseUid: doc.id,
          // Firebase's scrypt hashes cannot be verified here, so nobody is
          // imported with a working password.
          passwordHash: null,
          mustResetPassword: true,
          status: (data.status as string) === "inactive" ? "deactivated" : "active",
          createdAt: toDate(data.createdAt) ?? new Date(),
        })
        .onConflictDoUpdate({
          target: users.email,
          set: { legacyFirebaseUid: doc.id, updatedAt: new Date() },
        })
        .returning({ id: users.id });

      await tx
        .insert(userRoles)
        .values({
          userId: row.id,
          orgId,
          app: "hrms",
          role: (["owner", "admin", "hr", "manager", "employee", "viewer"].includes(role)
            ? role
            : "employee") as "owner" | "admin" | "hr" | "manager" | "employee" | "viewer",
        })
        .onConflictDoNothing();

      return row.id;
    });

    uidMap.set(doc.id, newId);
    counts.users++;
  }

  return uidMap;
}

async function migrateEmployees(
  orgIdMap: Map<string, string>,
  uidMap: Map<string, string>
): Promise<void> {
  const db = adminDb(HRMS_DATABASE);
  const snap = await db.collection("employees").get();

  console.log(`employees: ${snap.size} found`);

  // Group by organization so departments resolve once per tenant rather than
  // once per employee.
  const byOrg = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
  for (const doc of snap.docs) {
    const legacyOrg = doc.data().organizationId as string | undefined;
    const orgId = legacyOrg ? orgIdMap.get(legacyOrg) : undefined;
    if (!orgId) {
      note(`employee ${doc.id} has no resolvable organization; skipped`);
      counts.skipped++;
      continue;
    }
    const list = byOrg.get(orgId) ?? [];
    list.push(doc);
    byOrg.set(orgId, list);
  }

  for (const [orgId, docs] of byOrg) {
    const departmentNames = new Set(
      docs.map((d) => (d.data().department as string | undefined)?.trim()).filter(Boolean) as string[]
    );
    const departmentIds = await resolveDepartments(orgId, departmentNames);

    let sequence = 0;
    for (const doc of docs) {
      const data = doc.data();
      const email = (data.email as string | undefined)?.trim().toLowerCase();
      const joinDate = toDateString(data.joinDate ?? data.joiningDate);

      if (!email || !joinDate) {
        note(`employee ${doc.id} is missing email or join date; skipped`);
        counts.skipped++;
        continue;
      }

      sequence++;
      const employeeCode =
        (data.employeeId as string | undefined)?.trim() || `CIR-${String(sequence).padStart(4, "0")}`;

      if (DRY_RUN || VERIFY_ONLY) {
        counts.employees++;
        continue;
      }

      const salary = Number(data.salary);
      await withTenant({ orgId, superuser: true }, async (tx) => {
        await tx
          .insert(employees)
          .values({
            orgId,
            userId: uidMap.get(doc.id) ?? null,
            employeeCode,
            firstName: (data.firstName as string) ?? "",
            lastName: (data.lastName as string) ?? "",
            workEmail: email,
            phone: data.phone as string | undefined,
            departmentId: departmentIds.get(
              ((data.department as string) ?? "").toLowerCase()
            ),
            designation: (data.designation as string) ?? "Unspecified",
            employmentType: "full_time",
            status: (["active", "on_leave", "probation", "notice_period", "terminated", "inactive"].includes(
              data.status as string
            )
              ? data.status
              : "active") as "active",
            joinDate,
            exitDate: toDateString(data.exitDate),
            // Stored in minor units; Firestore held rupees as a float.
            ctcMinor: Number.isFinite(salary) ? BigInt(Math.round(salary * 100)) : null,
          })
          .onConflictDoUpdate({
            target: [employees.orgId, employees.employeeCode],
            set: { workEmail: email, updatedAt: new Date() },
          });
      });

      counts.employees++;
    }
  }
}

/** Compares row counts between the two stores after a run. */
async function verify(orgIdMap: Map<string, string>): Promise<boolean> {
  const db = adminDb(HRMS_DATABASE);
  console.log("\nreconciliation");

  let clean = true;
  for (const [legacyOrg, orgId] of orgIdMap) {
    const firestoreCount = (
      await db.collection("employees").where("organizationId", "==", legacyOrg).count().get()
    ).data().count;

    const neonCount = await withTenant({ orgId, superuser: true }, async (tx) => {
      const rows = await tx.execute(
        sql`SELECT count(*)::int AS value FROM hrms.employees WHERE org_id = ${orgId}::uuid`
      );
      return (rows.rows[0] as { value: number }).value;
    });

    const match = firestoreCount === neonCount;
    if (!match) clean = false;
    console.log(
      `  ${match ? "ok  " : "DIFF"} org ${legacyOrg}: firestore=${firestoreCount} neon=${neonCount}`
    );
  }
  return clean;
}

async function main() {
  const mode = VERIFY_ONLY ? "verify" : DRY_RUN ? "dry run" : "live";
  console.log(`Firestore → Neon migration (${mode})`);

  const orgIdMap = await migrateOrganizations();
  const uidMap = await migrateUsers(orgIdMap);
  await migrateEmployees(orgIdMap, uidMap);

  console.log("\nsummary");
  console.log(`  organizations : ${counts.organizations}`);
  console.log(`  users         : ${counts.users}`);
  console.log(`  departments   : ${counts.departments}`);
  console.log(`  employees     : ${counts.employees}`);
  console.log(`  skipped       : ${counts.skipped}`);

  if (!DRY_RUN && !VERIFY_ONLY) {
    const clean = await verify(orgIdMap);
    if (!clean) {
      console.error("\nCounts do not match. Do not switch DATA_BACKEND to neon yet.");
      process.exit(1);
    }
  }

  if (problems.length > 0) {
    console.warn(`\n${problems.length} record(s) needed attention.`);
  }

  console.log(
    DRY_RUN || VERIFY_ONLY
      ? "\nNothing was written."
      : "\nDone. Imported users must set a new password on first sign-in."
  );
}

main().catch((error) => {
  console.error("\nMigration failed:", error);
  process.exit(1);
});
