import "./load-env";
import { withTenant } from "../src/db/client";
import { employees } from "../src/db/schema/hrms";
import { asc } from "drizzle-orm";

async function main() {
  const rows = await withTenant({ orgId: "", superuser: true }, async (tx) =>
    tx
      .select({
        id: employees.id,
        orgId: employees.orgId,
        code: employees.employeeCode,
        email: employees.workEmail,
        status: employees.status,
        deletedAt: employees.deletedAt,
        firstName: employees.firstName,
        lastName: employees.lastName,
      })
      .from(employees)
      .orderBy(asc(employees.employeeCode))
  );
  console.log(JSON.stringify(rows, null, 2));
}

main();