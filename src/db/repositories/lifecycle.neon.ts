// ═══════════════════════════════════════════════════════════════
// EMPLOYEE LIFECYCLE REPOSITORY — Neon implementation
// ═══════════════════════════════════════════════════════════════
// Onboarding and offboarding checklists, which previously had no storage at
// all: both dashboard pages held their tick state in React `useState`, and
// offboarding showed a "Clearance updated" toast while saving nothing.
//
// Two properties matter more than the CRUD:
//
//   * **A journey and its tasks are created together, or not at all.** A
//     half-created checklist is worse than none — it shows a progress bar
//     against a list that is missing the steps nobody has noticed are absent.
//
//   * **A journey cannot complete over an outstanding mandatory task.**
//     Checked against the rows inside the transaction, under a lock, so two
//     people pressing Complete at once cannot both pass the check. An exit
//     recorded as clean while access is still live is a wrong answer to the
//     question an audit asks.

import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import { employees, lifecycleJourneys, lifecycleTasks } from "@/db/schema/hrms";
import {
  blockingTasks,
  canComplete,
  canTransitionJourney,
  dueDateFor,
  progressOf,
  validateTemplate,
  type JourneyStatus,
  type LifecycleKind,
  type LifecycleTaskState,
} from "@/lib/lifecycle-rules";
import { dateKeyInZone } from "@/lib/date-keys";
import { NotFoundError, RepositoryError, type ListQuery, type Page } from "./types";

export interface LifecycleTaskRecord extends LifecycleTaskState {
  id: string;
  dueDate: string;
  completedAt?: string;
  completedById?: string;
  notes?: string;
}

export interface LifecycleJourneyRecord {
  id: string;
  employeeId: string;
  employeeName?: string;
  kind: LifecycleKind;
  anchorDate: string;
  status: JourneyStatus;
  exitReason?: string;
  completedAt?: string;
  createdAt: string;
  progress: ReturnType<typeof progressOf>;
  blocking: { taskKey: string; title: string }[];
  tasks: LifecycleTaskRecord[];
}

export interface TaskTemplateInput {
  taskKey: string;
  title: string;
  phase: string;
  phaseOrder?: number;
  assignee?: string;
  mandatory?: boolean;
  dueOffsetDays?: number;
}

type TaskRow = typeof lifecycleTasks.$inferSelect;
type JourneyRow = typeof lifecycleJourneys.$inferSelect;

function toTaskState(row: TaskRow): LifecycleTaskState {
  return {
    taskKey: row.taskKey,
    title: row.title,
    phase: row.phase,
    phaseOrder: row.phaseOrder,
    assignee: row.assignee,
    mandatory: row.mandatory,
    dueOffsetDays: row.dueOffsetDays,
    completed: row.completed,
  };
}

function toTaskRecord(row: TaskRow, anchorDate: string): LifecycleTaskRecord {
  return {
    ...toTaskState(row),
    id: row.id,
    dueDate: dueDateFor(anchorDate, row.dueOffsetDays),
    completedAt: row.completedAt?.toISOString(),
    completedById: row.completedById ?? undefined,
    notes: row.notes ?? undefined,
  };
}

function toJourneyRecord(
  row: JourneyRow,
  taskRows: TaskRow[],
  employeeName?: string
): LifecycleJourneyRecord {
  const states = taskRows.map(toTaskState);

  return {
    id: row.id,
    employeeId: row.employeeId,
    employeeName,
    kind: row.kind,
    anchorDate: row.anchorDate,
    status: row.status as JourneyStatus,
    exitReason: row.exitReason ?? undefined,
    completedAt: row.completedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    progress: progressOf(states),
    // Sent with every journey rather than only on a failed completion: the
    // page should be able to say "waiting on IT" without asking again.
    blocking: blockingTasks(states).map((t) => ({ taskKey: t.taskKey, title: t.title })),
    tasks: taskRows.map((t) => toTaskRecord(t, row.anchorDate)),
  };
}

export class NeonLifecycleRepository {
  constructor(private readonly ctx: TenantContext) {}

  async list(kind: LifecycleKind, q: ListQuery = {}): Promise<Page<LifecycleJourneyRecord>> {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 50));

    const conditions: SQL[] = [eq(lifecycleJourneys.kind, kind)];
    const filters = q.filters ?? {};
    if (filters.status && filters.status !== "all") {
      conditions.push(eq(lifecycleJourneys.status, filters.status as string));
    }
    if (filters.employeeId) {
      conditions.push(eq(lifecycleJourneys.employeeId, filters.employeeId as string));
    }

    return withTenant(this.ctx, async (tx) => {
      const where = and(...conditions);

      const rows = await tx
        .select({
          journey: lifecycleJourneys,
          firstName: employees.firstName,
          lastName: employees.lastName,
        })
        .from(lifecycleJourneys)
        .leftJoin(employees, eq(employees.id, lifecycleJourneys.employeeId))
        .where(where)
        .orderBy(desc(lifecycleJourneys.createdAt), asc(lifecycleJourneys.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const [{ value: total }] = await tx
        .select({ value: count() })
        .from(lifecycleJourneys)
        .where(where);

      // One query for every journey's tasks rather than one per journey. The
      // per-journey version is an N+1 that only shows up once a customer has
      // more than a handful of leavers at a time.
      //
      // `inArray` rather than building the list into the SQL text: these ids
      // came from the database and are uuid-typed, so interpolating them would
      // be safe today — but "safe because of where the value happened to come
      // from" is the property that quietly stops holding.
      const journeyIds = rows.map((r) => r.journey.id);
      const allTasks =
        journeyIds.length === 0
          ? []
          : await tx
              .select()
              .from(lifecycleTasks)
              .where(inArray(lifecycleTasks.journeyId, journeyIds))
              .orderBy(asc(lifecycleTasks.phaseOrder), asc(lifecycleTasks.taskKey));

      const byJourney = new Map<string, TaskRow[]>();
      for (const task of allTasks) {
        const list = byJourney.get(task.journeyId);
        if (list) list.push(task);
        else byJourney.set(task.journeyId, [task]);
      }

      const items = rows.map((r) =>
        toJourneyRecord(
          r.journey,
          byJourney.get(r.journey.id) ?? [],
          r.firstName || r.lastName ? `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() : undefined
        )
      );

      return {
        items,
        total,
        page,
        pageSize,
        hasMore: (page - 1) * pageSize + items.length < total,
      };
    });
  }

  async getById(id: string): Promise<LifecycleJourneyRecord | null> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select({
          journey: lifecycleJourneys,
          firstName: employees.firstName,
          lastName: employees.lastName,
        })
        .from(lifecycleJourneys)
        .leftJoin(employees, eq(employees.id, lifecycleJourneys.employeeId))
        .where(eq(lifecycleJourneys.id, id))
        .limit(1);

      const row = rows[0];
      if (!row) return null;

      const tasks = await tx
        .select()
        .from(lifecycleTasks)
        .where(eq(lifecycleTasks.journeyId, id))
        .orderBy(asc(lifecycleTasks.phaseOrder), asc(lifecycleTasks.taskKey));

      return toJourneyRecord(
        row.journey,
        tasks,
        row.firstName || row.lastName
          ? `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim()
          : undefined
      );
    });
  }

  /**
   * Starts a checklist.
   *
   * The journey and every task are inserted in one transaction. A journey with
   * half its tasks would show a progress bar against a list missing the steps
   * nobody has noticed are absent.
   */
  async start(input: {
    employeeId: string;
    kind: LifecycleKind;
    anchorDate: string;
    exitReason?: string;
    tasks: TaskTemplateInput[];
  }): Promise<LifecycleJourneyRecord> {
    const states: LifecycleTaskState[] = input.tasks.map((t) => ({
      taskKey: t.taskKey,
      title: t.title,
      phase: t.phase,
      phaseOrder: t.phaseOrder ?? 0,
      assignee: t.assignee ?? "hr",
      mandatory: t.mandatory ?? false,
      dueOffsetDays: t.dueOffsetDays ?? 0,
      completed: false,
    }));

    const validation = validateTemplate(states);
    if (!validation.ok) throw new RepositoryError(validation.errors.join("; "), 400);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.anchorDate)) {
      throw new RepositoryError("Anchor date must be YYYY-MM-DD", 400);
    }

    return withTenant(this.ctx, async (tx) => {
      const employee = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(eq(employees.id, input.employeeId))
        .limit(1);

      if (!employee[0]) throw new NotFoundError("Employee", input.employeeId);

      const existing = await tx
        .select({ id: lifecycleJourneys.id })
        .from(lifecycleJourneys)
        .where(
          and(
            eq(lifecycleJourneys.employeeId, input.employeeId),
            eq(lifecycleJourneys.kind, input.kind)
          )
        )
        .limit(1);

      if (existing[0]) {
        throw new RepositoryError(
          `This employee already has an ${input.kind} checklist`,
          409
        );
      }

      const [journey] = await tx
        .insert(lifecycleJourneys)
        .values({
          orgId: this.ctx.orgId,
          employeeId: input.employeeId,
          kind: input.kind,
          anchorDate: input.anchorDate,
          exitReason: input.exitReason?.trim() || null,
          status: "in_progress",
        })
        .returning();

      const taskRows = await tx
        .insert(lifecycleTasks)
        .values(
          states.map((t) => ({
            orgId: this.ctx.orgId,
            journeyId: journey.id,
            taskKey: t.taskKey,
            title: t.title,
            phase: t.phase,
            phaseOrder: t.phaseOrder,
            assignee: t.assignee,
            mandatory: t.mandatory,
            dueOffsetDays: t.dueOffsetDays,
            completed: false,
          }))
        )
        .returning();

      return toJourneyRecord(journey, taskRows);
    });
  }

  /**
   * Ticks or unticks a task.
   *
   * `completed` and `completed_at` are written together — a CHECK constraint
   * enforces it too, because a clearance that looks done with no record of when
   * or by whom answers nothing.
   */
  async setTaskCompletion(
    taskId: string,
    completed: boolean,
    actorId: string,
    notes?: string
  ): Promise<LifecycleJourneyRecord> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(lifecycleTasks)
        .where(eq(lifecycleTasks.id, taskId))
        .limit(1);

      const task = rows[0];
      if (!task) throw new NotFoundError("Lifecycle task", taskId);

      const journeyRows = await tx
        .select()
        .from(lifecycleJourneys)
        .where(eq(lifecycleJourneys.id, task.journeyId))
        .limit(1);

      const journey = journeyRows[0];
      if (!journey) throw new NotFoundError("Lifecycle journey", task.journeyId);

      // A finished journey is a record. Ticking a box on a completed exit
      // would rewrite history after the fact.
      if (journey.status !== "in_progress") {
        throw new RepositoryError(
          `This checklist is ${journey.status} and can no longer be changed`,
          409
        );
      }

      await tx
        .update(lifecycleTasks)
        .set({
          completed,
          completedAt: completed ? new Date() : null,
          completedById: completed ? actorId : null,
          notes: notes?.trim() || task.notes,
        })
        .where(eq(lifecycleTasks.id, taskId));

      await tx
        .update(lifecycleJourneys)
        .set({ updatedAt: new Date() })
        .where(eq(lifecycleJourneys.id, journey.id));

      const updatedTasks = await tx
        .select()
        .from(lifecycleTasks)
        .where(eq(lifecycleTasks.journeyId, journey.id))
        .orderBy(asc(lifecycleTasks.phaseOrder), asc(lifecycleTasks.taskKey));

      return toJourneyRecord(journey, updatedTasks);
    });
  }

  /**
   * Toggles a task by taskKey, automatically creating the task in the journey if it did not exist yet.
   */
  async toggleTaskByKey(input: {
    employeeId: string;
    kind?: LifecycleKind;
    taskKey: string;
    title: string;
    phase: string;
    phaseOrder?: number;
    mandatory?: boolean;
    completed: boolean;
    actorId: string;
    notes?: string;
  }): Promise<LifecycleJourneyRecord> {
    return withTenant(this.ctx, async (tx) => {
      const kind = input.kind ?? "onboarding";
      const journeyRows = await tx
        .select()
        .from(lifecycleJourneys)
        .where(
          and(
            eq(lifecycleJourneys.employeeId, input.employeeId),
            eq(lifecycleJourneys.kind, kind)
          )
        )
        .limit(1);

      let journey = journeyRows[0];
      if (!journey) {
        const [created] = await tx
          .insert(lifecycleJourneys)
          .values({
            orgId: this.ctx.orgId,
            employeeId: input.employeeId,
            kind,
            anchorDate: new Date().toISOString().slice(0, 10),
            status: "in_progress",
          })
          .returning();
        journey = created;
      }

      const existingTasks = await tx
        .select()
        .from(lifecycleTasks)
        .where(
          and(
            eq(lifecycleTasks.journeyId, journey.id),
            eq(lifecycleTasks.taskKey, input.taskKey)
          )
        )
        .limit(1);

      const existingTask = existingTasks[0];

      if (existingTask) {
        await tx
          .update(lifecycleTasks)
          .set({
            completed: input.completed,
            completedAt: input.completed ? new Date() : null,
            completedById: input.completed ? input.actorId : null,
            notes: input.notes?.trim() || existingTask.notes,
          })
          .where(eq(lifecycleTasks.id, existingTask.id));
      } else {
        await tx.insert(lifecycleTasks).values({
          id: randomUUID(),
          orgId: this.ctx.orgId,
          journeyId: journey.id,
          taskKey: input.taskKey,
          title: input.title,
          phase: input.phase,
          phaseOrder: input.phaseOrder ?? 0,
          mandatory: input.mandatory ?? false,
          dueOffsetDays: 0,
          completed: input.completed,
          completedAt: input.completed ? new Date() : null,
          completedById: input.completed ? input.actorId : null,
          notes: input.notes?.trim() || null,
        });
      }

      await tx
        .update(lifecycleJourneys)
        .set({ updatedAt: new Date() })
        .where(eq(lifecycleJourneys.id, journey.id));

      const updatedTasks = await tx
        .select()
        .from(lifecycleTasks)
        .where(eq(lifecycleTasks.journeyId, journey.id))
        .orderBy(asc(lifecycleTasks.phaseOrder), asc(lifecycleTasks.taskKey));

      return toJourneyRecord(journey, updatedTasks);
    });
  }

  /**
   * Closes a journey.
   *
   * The mandatory check runs against the rows under a lock, not against
   * whatever the client last saw. Two people pressing Complete at the same
   * moment would otherwise both read an incomplete list, both pass, and both
   * write — and the second one would be closing over a task the first had not
   * finished either.
   */
  async complete(id: string): Promise<LifecycleJourneyRecord> {
    return withTenant(this.ctx, async (tx) => {
      await tx.execute(sql`SELECT id FROM hrms.lifecycle_journeys WHERE id = ${id} FOR UPDATE`);

      const rows = await tx
        .select()
        .from(lifecycleJourneys)
        .where(eq(lifecycleJourneys.id, id))
        .limit(1);

      const journey = rows[0];
      if (!journey) throw new NotFoundError("Lifecycle journey", id);

      const tasks = await tx
        .select()
        .from(lifecycleTasks)
        .where(eq(lifecycleTasks.journeyId, id))
        .orderBy(asc(lifecycleTasks.phaseOrder), asc(lifecycleTasks.taskKey));

      const states = tasks.map(toTaskState);
      const status = journey.status as JourneyStatus;

      if (!canTransitionJourney(status, "completed")) {
        throw new RepositoryError(`A ${status} checklist cannot be completed`, 409);
      }

      if (!canComplete(status, states)) {
        const blocking = blockingTasks(states).map((t) => t.title);
        throw new RepositoryError(
          `Still outstanding: ${blocking.join(", ")}`,
          409
        );
      }

      const [updated] = await tx
        .update(lifecycleJourneys)
        .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
        .where(eq(lifecycleJourneys.id, id))
        .returning();

      return toJourneyRecord(updated, tasks);
    });
  }

  async cancel(id: string, reason: string): Promise<LifecycleJourneyRecord> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(lifecycleJourneys)
        .where(eq(lifecycleJourneys.id, id))
        .limit(1);

      const journey = rows[0];
      if (!journey) throw new NotFoundError("Lifecycle journey", id);

      const status = journey.status as JourneyStatus;
      if (!canTransitionJourney(status, "cancelled")) {
        throw new RepositoryError(`A ${status} checklist cannot be cancelled`, 409);
      }

      const [updated] = await tx
        .update(lifecycleJourneys)
        .set({
          status: "cancelled",
          exitReason: reason.trim() || journey.exitReason,
          updatedAt: new Date(),
        })
        .where(eq(lifecycleJourneys.id, id))
        .returning();

      const tasks = await tx
        .select()
        .from(lifecycleTasks)
        .where(eq(lifecycleTasks.journeyId, id))
        .orderBy(asc(lifecycleTasks.phaseOrder), asc(lifecycleTasks.taskKey));

      return toJourneyRecord(updated, tasks);
    });
  }

  /** Header counts for the dashboard, computed in the database. */
  async summary(kind: LifecycleKind): Promise<{
    inProgress: number;
    completed: number;
    overdueTasks: number;
  }> {
    const today = dateKeyInZone(new Date());

    return withTenant(this.ctx, async (tx) => {
      const statusRows = await tx
        .select({ status: lifecycleJourneys.status, n: count() })
        .from(lifecycleJourneys)
        .where(eq(lifecycleJourneys.kind, kind))
        .groupBy(lifecycleJourneys.status);

      let inProgress = 0;
      let completed = 0;
      for (const row of statusRows) {
        if (row.status === "in_progress") inProgress = Number(row.n);
        if (row.status === "completed") completed = Number(row.n);
      }

      // Due date is derived, not stored, so the comparison happens in SQL
      // against the journey's anchor rather than by loading every task.
      const [{ value: overdue }] = await tx
        .select({ value: count() })
        .from(lifecycleTasks)
        .innerJoin(lifecycleJourneys, eq(lifecycleJourneys.id, lifecycleTasks.journeyId))
        .where(
          and(
            eq(lifecycleJourneys.kind, kind),
            eq(lifecycleJourneys.status, "in_progress"),
            eq(lifecycleTasks.completed, false),
            sql`${lifecycleJourneys.anchorDate} + ${lifecycleTasks.dueOffsetDays} * INTERVAL '1 day' < ${today}::date`
          )
        );

      return { inProgress, completed, overdueTasks: Number(overdue) };
    });
  }
}
