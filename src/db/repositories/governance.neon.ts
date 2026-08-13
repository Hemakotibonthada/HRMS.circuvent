// ═══════════════════════════════════════════════════════════════
// GOVERNANCE REPOSITORY — Neon implementation (server-side only)
// ═══════════════════════════════════════════════════════════════
// Subject access, erasure, retention runs and consent. The rules live in
// src/lib/governance.ts so they test without a database.
//
// Erasure is the only operation in this codebase that destroys data on
// purpose. It is therefore split in two: `planErasureFor` produces a plan that
// a human approves, and `executeErasure` refuses to run without that approval
// recorded. A single "erase" call would be one mis-click from an irreversible
// mistake.

import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import {
  attendanceRecords,
  employees,
  leaveRequests,
  payrollRecords,
} from "@/db/schema/hrms";
import {
  consentRecords,
  dataSubjectRequests,
  erasureLog,
  legalHolds,
  retentionPolicies,
} from "@/db/schema/governance";
import {
  addMonths,
  buildSubjectAccess,
  hasConsent,
  isThirdPartySensitive,
  maskEmail,
  planErasure,
  pseudonym,
  type ErasurePlan,
  type RetentionPolicy,
  type SubjectAccessExport,
} from "@/lib/governance";
import { NeonCustomFieldsRepository } from "./custom-fields.neon";
import { NotFoundError, RepositoryError } from "./types";

/** Areas a subject-access request walks, and erasure targets. */
const AREAS = [
  "profile",
  "attendance",
  "leave",
  "payslips",
  "custom_fields",
] as const;

type Area = (typeof AREAS)[number];

/** Which entity type's retention policy governs each area. */
const AREA_ENTITY: Record<Area, string> = {
  profile: "employee",
  attendance: "attendance_record",
  leave: "leave_request",
  payslips: "payroll_record",
  custom_fields: "employee",
};

function toPolicy(row: typeof retentionPolicies.$inferSelect): RetentionPolicy {
  return {
    id: row.id,
    entityType: row.entityType,
    retainForMonths: row.retainForMonths,
    anchor: row.anchor,
    method: row.method,
    basis: row.basis,
    overridesErasure: row.overridesErasure,
    isActive: row.isActive,
  };
}

export class NeonGovernanceRepository {
  constructor(private readonly ctx: TenantContext) {}

  // ─── Policies ──────────────────────────────────────────────

  async listPolicies(): Promise<RetentionPolicy[]> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(retentionPolicies)
        .orderBy(asc(retentionPolicies.entityType));
      return rows.map(toPolicy);
    });
  }

  async savePolicy(input: {
    entityType: string;
    retainForMonths: number;
    anchor: RetentionPolicy["anchor"];
    method: RetentionPolicy["method"];
    basis: string;
    overridesErasure?: boolean;
    createdById?: string;
  }): Promise<RetentionPolicy> {
    if (input.retainForMonths < 0) {
      throw new RepositoryError("A retention period cannot be negative", 400);
    }
    if (!input.basis.trim()) {
      // A policy with no stated basis is one nobody can defend when
      // challenged, or safely change when the law does.
      throw new RepositoryError("State the statute or policy this period comes from", 400);
    }

    return withTenant(this.ctx, async (tx) => {
      const [row] = await tx
        .insert(retentionPolicies)
        .values({
          orgId: this.ctx.orgId,
          entityType: input.entityType,
          retainForMonths: input.retainForMonths,
          anchor: input.anchor,
          method: input.method,
          basis: input.basis.trim(),
          overridesErasure: input.overridesErasure ?? false,
          createdById: input.createdById,
        })
        .onConflictDoUpdate({
          target: [retentionPolicies.orgId, retentionPolicies.entityType],
          set: {
            retainForMonths: input.retainForMonths,
            anchor: input.anchor,
            method: input.method,
            basis: input.basis.trim(),
            overridesErasure: input.overridesErasure ?? false,
            updatedAt: new Date(),
          },
        })
        .returning();

      return toPolicy(row);
    });
  }

  // ─── Legal holds ───────────────────────────────────────────

  async placeHold(input: {
    reference: string;
    reason: string;
    entityType: string;
    entityId?: string;
    reviewOn?: string;
    placedById?: string;
  }): Promise<{ id: string }> {
    if (!input.reviewOn) {
      // A hold with no review date is one nobody ever lifts, and an
      // indefinite hold defeats the retention schedule entirely.
      throw new RepositoryError("A legal hold needs a review date", 400);
    }

    return withTenant(this.ctx, async (tx) => {
      const [row] = await tx
        .insert(legalHolds)
        .values({
          orgId: this.ctx.orgId,
          reference: input.reference,
          reason: input.reason,
          entityType: input.entityType,
          entityId: input.entityId,
          reviewOn: input.reviewOn,
          placedById: input.placedById,
        })
        .returning({ id: legalHolds.id });

      return row;
    });
  }

  async releaseHold(id: string, reason: string, releasedById: string): Promise<void> {
    await withTenant(this.ctx, async (tx) => {
      const [hold] = await tx
        .select()
        .from(legalHolds)
        .where(eq(legalHolds.id, id))
        .for("update")
        .limit(1);

      if (!hold) throw new NotFoundError("Legal hold", id);
      if (hold.releasedAt) throw new RepositoryError("This hold is already released", 409);

      await tx
        .update(legalHolds)
        .set({ releasedAt: new Date(), releasedById, releaseReason: reason })
        .where(eq(legalHolds.id, id));
    });
  }

  /** Live holds covering an entity, including blanket holds on its type. */
  private async holdsFor(
    tx: Parameters<Parameters<typeof withTenant>[1]>[0],
    entityType: string,
    entityId: string
  ) {
    return tx
      .select()
      .from(legalHolds)
      .where(
        and(
          eq(legalHolds.entityType, entityType),
          isNull(legalHolds.releasedAt),
          or(eq(legalHolds.entityId, entityId), isNull(legalHolds.entityId))
        )
      );
  }

  // ─── Subject access ────────────────────────────────────────

  /**
   * Assembles everything held about one person.
   *
   * Includes custom fields. They are where a passport number ends up when the
   * vendor did not ship a passport field, so a response that only walks the
   * fixed schema misses exactly the data most worth asking about.
   */
  async subjectAccess(employeeId: string): Promise<SubjectAccessExport> {
    const customFields = await new NeonCustomFieldsRepository(this.ctx).personalData(
      "employee",
      employeeId
    );

    return withTenant(this.ctx, async (tx) => {
      const [employee] = await tx
        .select()
        .from(employees)
        .where(eq(employees.id, employeeId))
        .limit(1);

      if (!employee) throw new NotFoundError("Employee", employeeId);

      const [attendance, leave, payslips] = await Promise.all([
        tx
          .select()
          .from(attendanceRecords)
          .where(eq(attendanceRecords.employeeId, employeeId))
          .orderBy(desc(attendanceRecords.workDate))
          .limit(5000),
        tx
          .select()
          .from(leaveRequests)
          .where(eq(leaveRequests.employeeId, employeeId))
          .orderBy(desc(leaveRequests.startDate)),
        tx
          .select()
          .from(payrollRecords)
          .where(eq(payrollRecords.employeeId, employeeId)),
      ]);

      // Sections are included even when empty. "We hold no disciplinary
      // record for you" is itself an answer the requester is entitled to.
      const sections = [
        { area: "profile", records: [redactInternalIds(employee)] },
        { area: "attendance", records: attendance.map(redactInternalIds) },
        { area: "leave", records: leave.map(redactInternalIds) },
        { area: "payslips", records: payslips.map(redactInternalIds) },
        { area: "custom_fields", records: [customFields] },
      ];

      const omitted = (["peer_review_comments", "investigation_witness_statements"] as const)
        .filter(isThirdPartySensitive)
        .map((area) => ({
          area,
          reason:
            "Withheld: this contains another person's personal data, which we cannot disclose without their rights being affected",
        }));

      return buildSubjectAccess(employeeId, sections, omitted);
    });
  }

  // ─── Erasure ───────────────────────────────────────────────

  /**
   * Builds an erasure plan for review. Performs nothing.
   *
   * Split from execution deliberately: erasure is irreversible, and the plan
   * is the only chance anyone gets to notice that it is about to remove
   * something it should not.
   */
  async planErasureFor(employeeId: string): Promise<ErasurePlan> {
    return withTenant(this.ctx, async (tx) => {
      const policies = (await tx.select().from(retentionPolicies)).map(toPolicy);

      const holds: { entityType: string; entityId: string; reference: string }[] = [];
      for (const entityType of new Set(Object.values(AREA_ENTITY))) {
        const found = await this.holdsFor(tx, entityType, employeeId);
        for (const hold of found) {
          holds.push({ entityType, entityId: employeeId, reference: hold.reference });
        }
      }

      const scope = [...new Set(Object.values(AREA_ENTITY))].map((entityType) => ({
        entityType,
        entityId: employeeId,
        areas: AREAS.filter((a) => AREA_ENTITY[a] === entityType),
      }));

      return planErasure(employeeId, scope, policies, holds);
    });
  }

  /**
   * Records a subject request and its plan.
   *
   * `dueOn` is set here because these are time-limited by statute. A request
   * sitting unnoticed in someone's inbox is a breach in itself, separate from
   * whatever it asked about.
   */
  async recordRequest(input: {
    requestType: "access" | "erasure" | "rectification" | "portability" | "restriction" | "objection";
    subjectEmail: string;
    subjectName?: string;
    subjectEmployeeId?: string;
    handledById?: string;
  }): Promise<{ id: string; dueOn: string }> {
    const today = new Date().toISOString().slice(0, 10);
    const dueOn = addMonths(today, 1);

    const plan = input.subjectEmployeeId
      ? await this.planErasureFor(input.subjectEmployeeId)
      : null;

    return withTenant(this.ctx, async (tx) => {
      const [row] = await tx
        .insert(dataSubjectRequests)
        .values({
          orgId: this.ctx.orgId,
          requestType: input.requestType,
          subjectEmail: input.subjectEmail.trim().toLowerCase(),
          subjectName: input.subjectName,
          subjectEmployeeId: input.subjectEmployeeId,
          dueOn,
          plan: plan?.items ?? [],
          refusedAreas: plan?.retained.map((i) => ({ area: i.area, reason: i.reason })) ?? [],
          handledById: input.handledById,
        })
        .returning({ id: dataSubjectRequests.id, dueOn: dataSubjectRequests.dueOn });

      return row;
    });
  }

  /**
   * Executes an approved erasure.
   *
   * Refuses without a recorded approval and a verified identity. Erasing on an
   * unverified request is how someone else's data gets destroyed by a person
   * who merely claimed to be them.
   */
  async executeErasure(
    requestId: string,
    performedById: string
  ): Promise<{ outcome: { area: string; method: string; rowsAffected: number }[] }> {
    return withTenant(this.ctx, async (tx) => {
      const [request] = await tx
        .select()
        .from(dataSubjectRequests)
        .where(eq(dataSubjectRequests.id, requestId))
        .for("update")
        .limit(1);

      if (!request) throw new NotFoundError("Request", requestId);
      if (request.requestType !== "erasure") {
        throw new RepositoryError("This is not an erasure request", 400);
      }
      if (!request.identityVerifiedAt) {
        throw new RepositoryError(
          "The requester's identity has not been verified",
          409
        );
      }
      if (!request.approvedAt) {
        throw new RepositoryError("This erasure has not been approved", 409);
      }
      if (request.completedAt) {
        throw new RepositoryError("This request has already been completed", 409);
      }
      if (request.approvedById === performedById) {
        // The same separation payroll uses. One person deciding and executing
        // an irreversible deletion has no check on it at all.
        throw new RepositoryError(
          "Erasure must be performed by someone other than the approver",
          403
        );
      }
      if (!request.subjectEmployeeId) {
        throw new RepositoryError("This request is not linked to an employee record", 400);
      }

      const employeeId = request.subjectEmployeeId;
      const alias = await pseudonym(employeeId, this.ctx.orgId);
      const outcome: { area: string; method: string; rowsAffected: number }[] = [];

      for (const item of request.plan) {
        if (item.method === "retain") continue;

        let rowsAffected = 0;

        if (item.area === "profile") {
          const updated = await tx
            .update(employees)
            .set({
              firstName: "Erased",
              lastName: alias,
              // The work email is a natural key elsewhere, so it is replaced
              // with something unique rather than nulled, which would collide
              // across every erased record.
              workEmail: `${alias}@erased.invalid`,
              personalEmail: null,
              phone: null,
              addressLine1: null,
              city: null,
              postalCode: null,
              dateOfBirth: null,
              panNumber: null,
              aadhaarNumber: null,
              uanNumber: null,
              bankDetails: null,
              emergencyContact: null,
              updatedAt: new Date(),
            })
            .where(eq(employees.id, employeeId))
            .returning({ id: employees.id });
          rowsAffected = updated.length;
        }

        if (item.area === "custom_fields") {
          const { erased } = await new NeonCustomFieldsRepository(
            this.ctx
          ).erasePersonalData("employee", employeeId);
          rowsAffected = erased;
        }

        if (item.area === "attendance" && item.method === "delete") {
          const deleted = await tx
            .delete(attendanceRecords)
            .where(eq(attendanceRecords.employeeId, employeeId))
            .returning({ id: attendanceRecords.id });
          rowsAffected = deleted.length;
        }

        if (item.area === "leave" && item.method === "delete") {
          const deleted = await tx
            .delete(leaveRequests)
            .where(eq(leaveRequests.employeeId, employeeId))
            .returning({ id: leaveRequests.id });
          rowsAffected = deleted.length;
        }

        outcome.push({ area: item.area, method: item.method, rowsAffected });

        await tx.insert(erasureLog).values({
          orgId: this.ctx.orgId,
          requestId,
          entityType: AREA_ENTITY[item.area as Area] ?? "employee",
          entityId: employeeId,
          area: item.area,
          method: item.method as "delete" | "anonymise" | "pseudonymise" | "retain",
          rowsAffected,
          pseudonym: item.method === "pseudonymise" ? alias : null,
          basis: item.reason,
          performedById,
        });
      }

      await tx
        .update(dataSubjectRequests)
        .set({
          status: request.refusedAreas.length > 0 ? "partially_completed" : "completed",
          completedAt: new Date(),
          outcome,
          updatedAt: new Date(),
        })
        .where(eq(dataSubjectRequests.id, requestId));

      return { outcome };
    });
  }

  /** Requests approaching or past their statutory deadline. */
  async overdueRequests(today: string): Promise<
    { id: string; requestType: string; subjectEmail: string; dueOn: string; daysLeft: number }[]
  > {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(dataSubjectRequests)
        .where(
          inArray(dataSubjectRequests.status, [
            "received",
            "identity_pending",
            "in_progress",
            "awaiting_approval",
          ])
        )
        .orderBy(asc(dataSubjectRequests.dueOn));

      return rows.map((r) => ({
        id: r.id,
        requestType: r.requestType,
        // Masked in a list view: the register of who has asked is itself
        // personal data, and it is read by more people than the request is.
        subjectEmail: maskEmail(r.subjectEmail),
        dueOn: r.dueOn,
        daysLeft: Math.round(
          (new Date(`${r.dueOn}T00:00:00Z`).getTime() -
            new Date(`${today}T00:00:00Z`).getTime()) /
            86_400_000
        ),
      }));
    });
  }

  // ─── Consent ───────────────────────────────────────────────

  async recordConsent(input: {
    subjectEmail: string;
    subjectUserId?: string;
    purpose: string;
    policyVersion: number;
    granted: boolean;
    capturedVia?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{ id: string }> {
    return withTenant(this.ctx, async (tx) => {
      // Append-only: withdrawing adds a row rather than deleting the grant,
      // because proving consent WAS held at the time of a past processing is
      // the whole point of keeping the record.
      const [row] = await tx
        .insert(consentRecords)
        .values({
          orgId: this.ctx.orgId,
          subjectEmail: input.subjectEmail.trim().toLowerCase(),
          subjectUserId: input.subjectUserId,
          purpose: input.purpose,
          policyVersion: input.policyVersion,
          grantedAt: input.granted ? new Date() : null,
          withdrawnAt: input.granted ? null : new Date(),
          capturedVia: input.capturedVia,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        })
        .returning({ id: consentRecords.id });

      return row;
    });
  }

  async consentStatus(
    subjectEmail: string,
    purpose: string,
    currentPolicyVersion: number
  ): Promise<{ granted: boolean }> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(consentRecords)
        .where(
          and(
            eq(consentRecords.subjectEmail, subjectEmail.trim().toLowerCase()),
            eq(consentRecords.purpose, purpose)
          )
        );

      return {
        granted: hasConsent(
          rows.map((r) => ({
            purpose: r.purpose,
            grantedAt: r.grantedAt?.toISOString(),
            withdrawnAt: r.withdrawnAt?.toISOString(),
            policyVersion: r.policyVersion,
          })),
          purpose,
          currentPolicyVersion
        ),
      };
    });
  }

  /**
   * Legal holds.
   *
   * A hold could be placed and released but never listed, which defeats the
   * point of having one: a hold exists so that somebody checks, before an
   * erasure or a retention sweep, whether this record is subject to it.
   * Nobody could check, because nothing could enumerate them.
   */
  async listHolds(query: { active?: boolean } = {}) {
    return withTenant(this.ctx, async (tx) => {
      const where = query.active === true ? isNull(legalHolds.releasedAt) : undefined;

      const rows = await tx
        .select()
        .from(legalHolds)
        .where(where)
        .orderBy(desc(legalHolds.placedAt));

      return rows.map((r) => ({
        id: r.id,
        reference: r.reference,
        reason: r.reason,
        entityType: r.entityType,
        entityId: r.entityId ?? undefined,
        placedAt: r.placedAt.toISOString(),
        reviewOn: r.reviewOn ?? undefined,
        releasedAt: r.releasedAt?.toISOString(),
        releaseReason: r.releaseReason ?? undefined,
        active: r.releasedAt === null,
      }));
    });
  }
}

/**
 * Strips internal identifiers from a row before it is disclosed.
 *
 * A subject-access response should be readable by the person who asked for it.
 * Internal foreign keys tell them nothing and leak the shape of the system to
 * no purpose.
 */
function redactInternalIds(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "orgId" || key === "org_id") continue;
    if (key.endsWith("ById") || key.endsWith("_by_id")) continue;
    out[key] = value instanceof Date ? value.toISOString() : value;
  }
  return out;
}

