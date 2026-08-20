// ═══════════════════════════════════════════════════════════════
// SCIM REPOSITORY — Neon implementation (server-side only)
// ═══════════════════════════════════════════════════════════════
// Provisioning from an identity provider. The mapping and patch logic live in
// src/lib/scim.ts so they test without a database.
//
// The operation that matters is deactivation. When a directory says a person
// has left, this is what actually closes their access — so a failure here has
// to be loud, and every request is logged whether it succeeded or not.

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import { employees } from "@/db/schema/hrms";
import { users } from "@/db/schema/identity";
import { scimSyncLog, scimTokens } from "@/db/schema/federation";
import {
  ScimError,
  applyPatch,
  matchesFilter,
  parseFilter,
  toProvisionedUser,
  toScimUser,
  type ProvisionedUser,
  type ScimPatch,
  type ScimUser,
} from "@/lib/scim";

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface ScimAuth {
  orgId: string;
  tokenId: string;
}

/**
 * Resolves a SCIM bearer token to the organization it provisions.
 *
 * This is the only authentication a provisioning client has, and it arrives
 * without a session — so, like the signing route, it needs one narrow lookup
 * outside a tenant context before everything else runs inside one.
 *
 * The token is hashed before comparison and compared in constant time. An
 * expired or revoked token resolves to nothing rather than to a disabled
 * context, because a caller that can still reach the tables is one bug away
 * from acting.
 */
export async function authenticateScim(header: string | null): Promise<ScimAuth | null> {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const presented = await sha256Hex(match[1].trim());

  const rows = await withTenant({ orgId: "", superuser: true }, async (tx) =>
    tx
      .select({
        id: scimTokens.id,
        orgId: scimTokens.orgId,
        tokenHash: scimTokens.tokenHash,
        expiresAt: scimTokens.expiresAt,
        revokedAt: scimTokens.revokedAt,
      })
      .from(scimTokens)
      .where(and(isNull(scimTokens.revokedAt), eq(scimTokens.tokenHash, presented)))
      .limit(1)
  );

  const token = rows.find((t) => timingSafeEqualHex(t.tokenHash, presented));
  if (!token) return null;
  if (token.expiresAt && token.expiresAt <= new Date()) return null;

  return { orgId: token.orgId, tokenId: token.id };
}

export interface ScimUserRecord extends ProvisionedUser {
  id: string;
  createdAt?: string;
  updatedAt?: string;
}

export class NeonScimRepository {
  constructor(
    private readonly ctx: TenantContext,
    private readonly tokenId: string,
    private readonly baseUrl: string
  ) {}

  /** Records a provisioning operation, successful or not. */
  async log(entry: {
    operation: string;
    externalId?: string;
    userId?: string;
    payload?: unknown;
    statusCode: number;
    errorDetail?: string;
  }): Promise<void> {
    await withTenant(this.ctx, async (tx) => {
      await tx.insert(scimSyncLog).values({
        orgId: this.ctx.orgId,
        tokenId: this.tokenId,
        operation: entry.operation,
        externalId: entry.externalId,
        userId: entry.userId,
        payload: entry.payload ?? null,
        statusCode: entry.statusCode,
        errorDetail: entry.errorDetail,
      });

      await tx
        .update(scimTokens)
        .set({ lastUsedAt: new Date() })
        .where(eq(scimTokens.id, this.tokenId));
    });
  }

  async list(
    filter: string | null,
    startIndex: number,
    count: number
  ): Promise<{ resources: ScimUser[]; total: number }> {
    const parsed = parseFilter(filter);

    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select({ u: users, e: employees })
        .from(users)
        .leftJoin(employees, eq(employees.userId, users.id))
        .orderBy(asc(users.createdAt));

      const mapped = rows.map((r) => this.toRecord(r));
      const matching = mapped.filter((u) => matchesFilter(u, parsed));

      // 1-based, per RFC 7644. Treating startIndex as 0-based silently skips
      // the first user of every page.
      const from = Math.max(0, startIndex - 1);
      const page = matching.slice(from, from + count);

      return {
        resources: page.map((u) => toScimUser(u, this.baseUrl)),
        total: matching.length,
      };
    });
  }

  async get(id: string): Promise<ScimUser> {
    return withTenant(this.ctx, async (tx) => {
      const [row] = await tx
        .select({ u: users, e: employees })
        .from(users)
        .leftJoin(employees, eq(employees.userId, users.id))
        .where(eq(users.id, id))
        .limit(1);

      if (!row) throw new ScimError("User not found", 404);
      return toScimUser(this.toRecord(row), this.baseUrl);
    });
  }

  /**
   * Creates a user.
   *
   * A repeat create for someone who already exists returns 409 with
   * `scimType: "uniqueness"` rather than a second account. Providers retry,
   * and a retry that silently created a duplicate would leave two accounts
   * where the directory believes there is one — and deactivating later would
   * close only one of them.
   */
  async create(payload: ScimUser): Promise<ScimUser> {
    const incoming = toProvisionedUser(payload);

    const created = await withTenant(this.ctx, async (tx) => {
      const [existing] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, incoming.email))
        .limit(1);

      if (existing) {
        throw new ScimError("A user with this email already exists", 409, "uniqueness");
      }

      const [row] = await tx
        .insert(users)
        .values({
          orgId: this.ctx.orgId,
          email: incoming.email,
          displayName:
            incoming.displayName ??
            [incoming.firstName, incoming.lastName].filter(Boolean).join(" "),
          externalId: incoming.externalId,
          status: incoming.isActive ? "active" : "deactivated",
          // No password. The identity provider is the only way in, which is
          // the point of provisioning the account from it.
          passwordHash: null,
        })
        .returning();

      return row;
    });

    // The common ordering the other direction never covers: HR creates the
    // employee first, and the directory provisions the login only later. See
    // `linkExistingEmployee` below — same match `NeonEmployeeRepository.create()`
    // makes when the account already exists and the employee record is new.
    await this.linkExistingEmployee(created.id, incoming.email);

    return toScimUser(
      {
        ...incoming,
        id: created.id,
        createdAt: created.createdAt?.toISOString(),
        updatedAt: created.updatedAt?.toISOString(),
      },
      this.baseUrl
    );
  }

  /**
   * Links a live, currently-unlinked employee record onto a freshly
   * provisioned account.
   *
   * `employees.user_id` is set in exactly two other places: founder
   * registration, which writes both rows together, and
   * `NeonEmployeeRepository.create()`, which matches an *existing* account
   * against a work email when the employee record is the one being created.
   * SCIM is the common ordering neither of those covers — the employee record
   * exists first, HR hires someone before IT provisions their login — and
   * until now nothing linked that ordering at all, so the person stayed
   * unresolvable to `currentEmployeeId()` no matter how long they held an
   * account.
   *
   * Same match as that block, in the other direction: case-insensitive work
   * email, same organisation, only a live (`deleted_at IS NULL`) employee
   * whose `user_id` IS NULL, and only when exactly one such employee exists.
   * Zero or more than one candidate links nothing — attaching the wrong
   * person's employment record to a login is far worse than leaving it
   * unattached.
   *
   * Deliberately outside the create transaction and never throws: a directory
   * sync provisioning an account is the operation that matters here, and it
   * must not fail — nor hand the provider a retryable error that could
   * collide with the 409 "uniqueness" check above — just because this
   * secondary, best-effort link could not be made.
   */
  private async linkExistingEmployee(userId: string, email: string): Promise<void> {
    try {
      await withTenant(this.ctx, async (tx) => {
        const candidates = await tx
          .select({ id: employees.id })
          .from(employees)
          .where(
            and(
              eq(employees.orgId, this.ctx.orgId),
              sql`lower(${employees.workEmail}) = lower(${email})`,
              isNull(employees.userId),
              isNull(employees.deletedAt)
            )
          )
          .limit(2);

        if (candidates.length !== 1) return;

        await tx
          .update(employees)
          .set({ userId })
          .where(and(eq(employees.id, candidates[0].id), isNull(employees.userId)));
      });
    } catch (error) {
      console.warn(
        "[scim] Could not link an existing employee record to the newly provisioned account.",
        {
          orgId: this.ctx.orgId,
          userId,
          errorName: error instanceof Error ? error.name : "UnknownError",
        }
      );
    }
  }

  /** Replaces a user (SCIM PUT). */
  async replace(id: string, payload: ScimUser): Promise<ScimUser> {
    const incoming = toProvisionedUser(payload);

    return withTenant(this.ctx, async (tx) => {
      const [existing] = await tx
        .select()
        .from(users)
        .where(eq(users.id, id))
        .for("update")
        .limit(1);

      if (!existing) throw new ScimError("User not found", 404);

      const [updated] = await tx
        .update(users)
        .set({
          email: incoming.email,
          displayName:
            incoming.displayName ??
            [incoming.firstName, incoming.lastName].filter(Boolean).join(" "),
          externalId: incoming.externalId,
          status: incoming.isActive ? "active" : "deactivated",
          updatedAt: new Date(),
        })
        .where(eq(users.id, id))
        .returning();

      await this.syncEmployee(tx, id, incoming);

      return toScimUser(
        { ...incoming, id: updated.id, updatedAt: updated.updatedAt?.toISOString() },
        this.baseUrl
      );
    });
  }

  /**
   * Applies a SCIM PATCH.
   *
   * The read, the patch and the write happen in one transaction with the row
   * locked. Providers send bursts, and a lost update here could re-enable an
   * account that a concurrent operation had just disabled.
   */
  async patch(id: string, patch: ScimPatch): Promise<ScimUser> {
    return withTenant(this.ctx, async (tx) => {
      const [row] = await tx
        .select({ u: users, e: employees })
        .from(users)
        .leftJoin(employees, eq(employees.userId, users.id))
        .where(eq(users.id, id))
        .for("update")
        .limit(1);

      if (!row) throw new ScimError("User not found", 404);

      const current = this.toRecord(row);
      const next = applyPatch(current, patch);

      const [updated] = await tx
        .update(users)
        .set({
          email: next.email,
          displayName:
            next.displayName ?? [next.firstName, next.lastName].filter(Boolean).join(" "),
          externalId: next.externalId,
          status: next.isActive ? "active" : "deactivated",
          updatedAt: new Date(),
        })
        .where(eq(users.id, id))
        .returning();

      await this.syncEmployee(tx, id, next);

      // Deactivation must actually close access, not just flip a flag. Any
      // live session is revoked in the same transaction.
      if (current.isActive && !next.isActive) {
        await tx.execute(
          sql`update identity.sessions set revoked_at = now()
              where user_id = ${id} and revoked_at is null`
        );
      }

      return toScimUser(
        { ...next, id: updated.id, updatedAt: updated.updatedAt?.toISOString() },
        this.baseUrl
      );
    });
  }

  /**
   * Handles SCIM DELETE.
   *
   * Deactivates rather than deleting. A removed row takes the employment
   * record, the payslip history and the audit trail with it, and a directory
   * removing a user means "this person has left", not "erase every trace that
   * they worked here". Actual erasure goes through the governance module,
   * which knows about retention obligations.
   */
  async deactivate(id: string): Promise<void> {
    await withTenant(this.ctx, async (tx) => {
      const [existing] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, id))
        .for("update")
        .limit(1);

      if (!existing) throw new ScimError("User not found", 404);

      await tx
        .update(users)
        .set({ status: "deactivated", updatedAt: new Date() })
        .where(eq(users.id, id));

      await tx.execute(
        sql`update identity.sessions set revoked_at = now()
            where user_id = ${id} and revoked_at is null`
      );

      await tx
        .update(employees)
        .set({ status: "inactive", updatedAt: new Date() })
        .where(eq(employees.userId, id));
    });
  }

  // ─── Internals ─────────────────────────────────────────────

  private toRecord(row: {
    u: typeof users.$inferSelect;
    e: typeof employees.$inferSelect | null;
  }): ScimUserRecord {
    const display = row.u.displayName ?? "";
    const parts = display.split(/\s+/).filter(Boolean);

    return {
      id: row.u.id,
      externalId: row.u.externalId ?? undefined,
      userName: row.u.email,
      email: row.u.email,
      firstName: row.e?.firstName ?? parts[0] ?? row.u.email.split("@")[0],
      lastName: row.e?.lastName ?? parts.slice(1).join(" "),
      displayName: row.u.displayName ?? undefined,
      title: row.e?.designation ?? undefined,
      employeeNumber: row.e?.employeeCode ?? undefined,
      isActive: row.u.status === "active",
      createdAt: row.u.createdAt?.toISOString(),
      updatedAt: row.u.updatedAt?.toISOString(),
    };
  }

  /**
   * Mirrors a directory change onto the employment record.
   *
   * Only the fields the directory owns. Overwriting designation or department
   * from a provider that does not populate them would blank an HR-maintained
   * field on every sync.
   */
  private async syncEmployee(
    tx: Parameters<Parameters<typeof withTenant>[1]>[0],
    userId: string,
    incoming: ProvisionedUser
  ): Promise<void> {
    const changes: Record<string, unknown> = {
      firstName: incoming.firstName,
      lastName: incoming.lastName,
      updatedAt: new Date(),
    };

    if (incoming.title) changes.designation = incoming.title;
    if (!incoming.isActive) changes.status = "inactive";

    await tx.update(employees).set(changes).where(eq(employees.userId, userId));
  }
}

/** Issues a SCIM bearer token, returning the plaintext exactly once. */
export async function createScimToken(
  ctx: TenantContext,
  name: string,
  createdById: string,
  expiresInDays?: number
): Promise<{ id: string; token: string; prefix: string }> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const prefix = token.slice(0, 8);

  const id = await withTenant(ctx, async (tx) => {
    const [row] = await tx
      .insert(scimTokens)
      .values({
        orgId: ctx.orgId,
        name,
        tokenHash: await sha256Hex(token),
        tokenPrefix: prefix,
        createdById,
        expiresAt: expiresInDays
          ? new Date(Date.now() + expiresInDays * 86_400_000)
          : null,
      })
      .returning({ id: scimTokens.id });
    return row.id;
  });

  // Returned once and never retrievable again — the stored hash cannot produce
  // it, which is the whole point of storing a hash.
  return { id, token, prefix };
}

