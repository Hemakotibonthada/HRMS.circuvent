// ═══════════════════════════════════════════════════════════════
// WORKFLOW REPOSITORY — persistence for the approval engine
// ═══════════════════════════════════════════════════════════════
// Connects the pure evaluator in src/lib/workflow/engine.ts to the database.
// The engine decides; this loads what it needs and stores what it decided.
//
// The split matters for auditing. An approval that happened two years ago must
// be explainable against the rules that applied *then*, so an instance records
// the definition version it started on and keeps using it even after a newer
// version is published.

import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import { departments, employees, workflowDefinitions, workflowInstances } from "@/db/schema/hrms";
import { userRoles } from "@/db/schema/identity";
import { NotFoundError, RepositoryError } from "./types";
import {
  advanceWorkflow,
  findBreaches,
  resolveApprovers,
  selectDefinition,
  startWorkflow,
  type Decision,
  type OrgContext,
  type TrackedInstance,
  type WorkflowDefinition,
  type WorkflowInstanceState,
  type WorkflowStep,
} from "@/lib/workflow/engine";

export interface PendingApproval {
  instanceId: string;
  entityType: string;
  entityId: string;
  stepId: string;
  stepName: string;
  initiatedById: string | null;
  dueAt: string | null;
  isOverdue: boolean;
}

function toState(row: typeof workflowInstances.$inferSelect): WorkflowInstanceState {
  return {
    definitionId: row.definitionId,
    entityType: row.entityType,
    entityId: row.entityId,
    currentStepIndex: row.currentStepIndex,
    status: row.status,
    history: (row.history as WorkflowInstanceState["history"]) ?? [],
    dueAt: row.dueAt?.toISOString(),
  };
}

function toDefinition(row: typeof workflowDefinitions.$inferSelect): WorkflowDefinition {
  return {
    id: row.id,
    name: row.name,
    entityType: row.entityType,
    steps: (row.steps as WorkflowStep[]) ?? [],
    trigger: row.triggerConditions as WorkflowDefinition["trigger"],
    version: row.version,
    isActive: row.isActive,
  };
}

export class NeonWorkflowRepository {
  constructor(private readonly ctx: TenantContext) {}

  /**
   * Starts a workflow for an entity, if any definition applies.
   *
   * Returns null when none does — most tenants will not configure a chain for
   * every entity type, and the caller then applies its own default (leave, for
   * example, falls back to the reporting manager).
   */
  async start(
    entityType: string,
    entityId: string,
    entity: Record<string, unknown>,
    initiatedById: string
  ): Promise<{ instanceId: string; approvers: string[] } | null> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(workflowDefinitions)
        .where(
          and(
            eq(workflowDefinitions.entityType, entityType),
            eq(workflowDefinitions.isActive, true)
          )
        );

      const definition = selectDefinition(rows.map(toDefinition), entityType, entity);
      if (!definition) return null;

      const { state, currentStep } = startWorkflow(definition, entityType, entityId, entity);

      const [row] = await tx
        .insert(workflowInstances)
        .values({
          orgId: this.ctx.orgId,
          definitionId: definition.id,
          entityType,
          entityId,
          initiatedById,
          currentStepIndex: state.currentStepIndex,
          status: state.status,
          history: state.history,
          dueAt: state.dueAt ? new Date(state.dueAt) : null,
          completedAt: state.status === "approved" ? new Date() : null,
        })
        .returning({ id: workflowInstances.id });

      const approvers = currentStep
        ? await this.approversFor(tx, currentStep, initiatedById)
        : [];

      // A step nobody can satisfy leaves the request pending forever. Better to
      // fail loudly at submission than to have someone chase it for a week.
      if (currentStep && approvers.length === 0) {
        throw new RepositoryError(
          `No approver could be resolved for step "${currentStep.name}". Check the workflow configuration.`,
          409
        );
      }

      return { instanceId: row.id, approvers };
    });
  }

  /**
   * Records a decision and advances the instance.
   *
   * The instance row is locked for the whole operation: two approvers clicking
   * at once would otherwise both read step 1, both advance to step 2, and the
   * second write would silently overwrite the first's history entry.
   */
  async decide(
    instanceId: string,
    actorId: string,
    decision: Decision,
    comment?: string
  ): Promise<{ state: WorkflowInstanceState; approvers: string[]; completed: boolean }> {
    return withTenant(this.ctx, async (tx) => {
      const locked = await tx
        .select()
        .from(workflowInstances)
        .where(eq(workflowInstances.id, instanceId))
        .for("update")
        .limit(1);

      const instance = locked[0];
      if (!instance) throw new NotFoundError("Workflow instance", instanceId);

      const definitionRows = await tx
        .select()
        .from(workflowDefinitions)
        .where(eq(workflowDefinitions.id, instance.definitionId))
        .limit(1);

      if (!definitionRows[0]) {
        throw new RepositoryError("The workflow definition no longer exists", 409);
      }

      const definition = toDefinition(definitionRows[0]);
      const entity = await this.loadEntity(tx, instance.entityType, instance.entityId);

      const currentStep = definition.steps[instance.currentStepIndex];
      if (currentStep) {
        const permitted = await this.approversFor(
          tx,
          currentStep,
          instance.initiatedById ?? undefined
        );
        // Checked here rather than trusting the caller: an API route that
        // forgets this check would let anyone approve anything.
        if (!permitted.includes(actorId)) {
          throw new RepositoryError("You are not an approver for this step", 403);
        }
      }

      let result;
      try {
        result = advanceWorkflow(toState(instance), definition, entity, {
          actorId,
          decision,
          comment,
        });
      } catch (error) {
        // The engine throws on double-decisions and finished workflows; those
        // are conflicts, not server faults.
        throw new RepositoryError((error as Error).message, 409);
      }

      await tx
        .update(workflowInstances)
        .set({
          currentStepIndex: result.state.currentStepIndex,
          status: result.state.status,
          history: result.state.history,
          dueAt: result.state.dueAt ? new Date(result.state.dueAt) : null,
          completedAt: result.completed ? new Date() : null,
        })
        .where(eq(workflowInstances.id, instanceId));

      const approvers = result.currentStep
        ? await this.approversFor(tx, result.currentStep, instance.initiatedById ?? undefined)
        : [];

      return { state: result.state, approvers, completed: result.completed };
    });
  }

  /** Instances awaiting this user's decision. */
  async pendingFor(userId: string): Promise<PendingApproval[]> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select({ instance: workflowInstances, definition: workflowDefinitions })
        .from(workflowInstances)
        .innerJoin(
          workflowDefinitions,
          eq(workflowDefinitions.id, workflowInstances.definitionId)
        )
        .where(eq(workflowInstances.status, "pending"));

      const now = Date.now();
      const pending: PendingApproval[] = [];

      for (const { instance, definition } of rows) {
        const step = (definition.steps as WorkflowStep[])?.[instance.currentStepIndex];
        if (!step) continue;

        const approvers = await this.approversFor(
          tx,
          step,
          instance.initiatedById ?? undefined
        );
        if (!approvers.includes(userId)) continue;

        pending.push({
          instanceId: instance.id,
          entityType: instance.entityType,
          entityId: instance.entityId,
          stepId: step.id,
          stepName: step.name,
          initiatedById: instance.initiatedById,
          dueAt: instance.dueAt?.toISOString() ?? null,
          isOverdue: !!instance.dueAt && instance.dueAt.getTime() < now,
        });
      }

      // Overdue first, then by deadline. An approver with thirty items needs
      // the ones already breaching at the top.
      return pending.sort((a, b) => {
        if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
        return (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999");
      });
    });
  }

  /**
   * Instances past their step deadline.
   *
   * Run on a schedule by the worker VM. The common failure of an approval
   * system is not a wrong decision but no decision — a request sitting in
   * someone's queue while they are on holiday.
   */
  async findOverdue(now: Date = new Date()) {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select({ instance: workflowInstances, definition: workflowDefinitions })
        .from(workflowInstances)
        .innerJoin(
          workflowDefinitions,
          eq(workflowDefinitions.id, workflowInstances.definitionId)
        )
        .where(
          and(
            eq(workflowInstances.status, "pending"),
            lte(workflowInstances.dueAt, now),
            isNull(workflowInstances.escalatedAt)
          )
        );

      const tracked: TrackedInstance[] = [];
      for (const { instance, definition } of rows) {
        tracked.push({
          entityId: instance.id,
          state: toState(instance),
          definition: toDefinition(definition),
          entity: await this.loadEntity(tx, instance.entityType, instance.entityId),
        });
      }

      return findBreaches(tracked, now);
    });
  }

  /** Marks an instance escalated so the same breach is not reported repeatedly. */
  async markEscalated(instanceId: string): Promise<void> {
    await withTenant(this.ctx, async (tx) => {
      await tx
        .update(workflowInstances)
        .set({ escalatedAt: new Date() })
        .where(eq(workflowInstances.id, instanceId));
    });
  }

  // ─── Internals ─────────────────────────────────────────────

  /**
   * Loads the entity a workflow is about, so step conditions can be evaluated
   * against real field values.
   */
  private async loadEntity(
    tx: Parameters<Parameters<typeof withTenant>[1]>[0],
    entityType: string,
    entityId: string
  ): Promise<Record<string, unknown>> {
    // Deliberately a whitelist. The entity type reaches this from a database
    // row, but building a table name from it would be an injection vector the
    // moment anything else can write that column.
    const tables: Record<string, string> = {
      leave: "hrms.leave_requests",
      expense: "hrms.expense_claims",
    };

    const table = tables[entityType];
    if (!table) return {};

    // The table name comes from the whitelist above and is the only thing
    // interpolated; the id is bound. Interpolating the id would be an
    // injection vector the moment anything but the database can write that
    // column.
    const result = await tx.execute(
      sql`SELECT * FROM ${sql.raw(table)} WHERE id = ${entityId}::uuid LIMIT 1`
    );
    return (result.rows[0] as Record<string, unknown>) ?? {};
  }

  /** Turns a step's rule into user ids, using live org structure. */
  private async approversFor(
    tx: Parameters<Parameters<typeof withTenant>[1]>[0],
    step: WorkflowStep,
    requesterId?: string
  ): Promise<string[]> {
    // Loaded once per call rather than per lookup: a manager chain of four
    // would otherwise issue four separate queries.
    const staff = await tx
      .select({
        id: employees.id,
        userId: employees.userId,
        reportingToId: employees.reportingToId,
        departmentId: employees.departmentId,
      })
      .from(employees)
      .where(isNull(employees.deletedAt));

    const managerByEmployee = new Map(staff.map((e) => [e.id, e.reportingToId ?? undefined]));
    const departmentOf = new Map(staff.map((e) => [e.id, e.departmentId ?? undefined]));

    const heads = await tx
      .select({ id: departments.id, headId: departments.headId })
      .from(departments);
    const headByDepartment = new Map(heads.map((d) => [d.id, d.headId ?? undefined]));

    const roleRows = step.role
      ? await tx
          .select({ userId: userRoles.userId })
          .from(userRoles)
          .where(and(eq(userRoles.orgId, this.ctx.orgId), eq(userRoles.role, step.role as never)))
      : [];

    const org: OrgContext = {
      managerOf: (id) => managerByEmployee.get(id),
      headOfDepartment: (id) => headByDepartment.get(id),
      usersWithRole: () => roleRows.map((r) => r.userId),
    };

    return resolveApprovers(
      step,
      {
        employeeId: requesterId ?? "",
        departmentId: requesterId ? departmentOf.get(requesterId) : undefined,
      },
      org
    );
  }

  /** Instances for an entity, for showing an approval trail in the UI. */
  async forEntity(entityType: string, entityIds: string[]) {
    if (entityIds.length === 0) return [];
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(workflowInstances)
        .where(
          and(
            eq(workflowInstances.entityType, entityType),
            inArray(workflowInstances.entityId, entityIds)
          )
        );
      return rows.map((r) => ({ entityId: r.entityId, state: toState(r) }));
    });
  }
}
