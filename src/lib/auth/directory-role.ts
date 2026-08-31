import { sql } from "drizzle-orm";

import { withTenant } from "@/db/client";

import type { AppId } from "./tokens";

/**
 * Role held in auth.circuvent.com for a suite application.
 *
 * HRMS keeps a local copy in `identity.user_roles`, but the directory is the
 * system of record — grants are edited at myaccount.circuvent.com and arrive in
 * SSO tokens. Password sign-in and refresh used to read only the local table,
 * so everybody looked like `employee` until they happened to have a local row.
 */
export async function directoryRoleFor(
  userId: string,
  orgId: string,
  app: AppId
): Promise<string | null> {
  try {
    return await withTenant({ orgId, superuser: true }, async (tx) => {
      const userRow = await tx.execute(
        sql`SELECT external_id::text AS external_id, lower(email) AS email
              FROM identity.users
             WHERE id = ${userId}
             LIMIT 1`
      );
      const row = userRow.rows[0] as { external_id?: string; email?: string } | undefined;
      if (!row) return null;

      let authUserId = row.external_id ?? null;
      if (!authUserId && row.email) {
        const byEmail = await tx.execute(
          sql`SELECT id::text AS id FROM users WHERE lower(email) = ${row.email} LIMIT 1`
        );
        authUserId = (byEmail.rows[0] as { id?: string } | undefined)?.id ?? null;
      }
      if (!authUserId) return null;

      const direct = await tx.execute(
        sql`SELECT r.role, ar.rank AS role_rank
              FROM user_app_roles r
              JOIN app_roles ar ON ar.app_id = r.app_id AND ar.role = r.role
             WHERE r.user_id = ${authUserId}::uuid
               AND r.app_id = ${app}
               AND r.revoked_at IS NULL
             LIMIT 1`
      );
      const directRow = direct.rows[0] as { role?: string; role_rank?: number } | undefined;

      const group = await tx.execute(
        sql`SELECT ar.role, ar.rank AS role_rank
              FROM group_effective_members e
              JOIN groups g ON g.id = e.group_id AND g.status = 'active'
              JOIN group_app_roles gar ON gar.group_id = g.id AND gar.app_id = ${app}
              JOIN app_roles ar ON ar.app_id = gar.app_id AND ar.role = gar.role
             WHERE e.user_id = ${authUserId}::uuid
             ORDER BY ar.rank DESC
             LIMIT 1`
      );
      const groupRow = group.rows[0] as { role?: string; role_rank?: number } | undefined;

      if (directRow?.role && groupRow?.role) {
        const dRank = directRow.role_rank ?? 0;
        const gRank = groupRow.role_rank ?? 0;
        return gRank > dRank ? groupRow.role! : directRow.role;
      }

      return directRow?.role ?? groupRow?.role ?? null;
    });
  } catch {
    // hrms_app may not be able to read the provider tables on some deployments.
    return null;
  }
}

/** Permissions for an app role from the directory catalogue. */
export async function directoryPermissionsFor(
  userId: string,
  orgId: string,
  app: AppId,
  role: string
): Promise<string[] | null> {
  try {
    return await withTenant({ orgId, superuser: true }, async (tx) => {
      const rows = await tx.execute(
        sql`SELECT ar.permissions
              FROM app_roles ar
             WHERE ar.app_id = ${app} AND ar.role = ${role}
             LIMIT 1`
      );
      const perms = (rows.rows[0] as { permissions?: string[] } | undefined)?.permissions;
      return Array.isArray(perms) ? perms : null;
    });
  } catch {
    return null;
  }
}
