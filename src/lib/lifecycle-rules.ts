// ═══════════════════════════════════════════════════════════════
// EMPLOYEE LIFECYCLE RULES
// ═══════════════════════════════════════════════════════════════
// The decisions an onboarding or offboarding checklist needs, separated from
// storage so they test without a database.
//
// Both dashboard pages previously held their tick state in React `useState`.
// An HR admin worked through an exit checklist — "Laptop returned", "Access
// revoked", "Final settlement processed" — and lost every tick on refresh,
// while offboarding showed a "Clearance updated" toast that said otherwise.
//
// The rule that matters most here is `blockingTasks`. An exit is not finished
// because somebody pressed a button; it is finished when the mandatory
// clearances are actually done. Letting a journey close over an outstanding
// "Access revoked" produces a record saying the exit completed cleanly, which
// is worse than no record at all — it is a wrong answer to the question an
// audit asks after an incident.

export type LifecycleKind = "onboarding" | "offboarding";
export type JourneyStatus = "in_progress" | "completed" | "cancelled";

export interface LifecycleTaskState {
  taskKey: string;
  title: string;
  phase: string;
  phaseOrder: number;
  assignee: string;
  mandatory: boolean;
  dueOffsetDays: number;
  completed: boolean;
}

export interface Progress {
  total: number;
  completed: number;
  /** 0-100, rounded. 100 only when every task is done. */
  percent: number;
  mandatoryTotal: number;
  mandatoryCompleted: number;
}

/**
 * How far along a checklist is.
 *
 * `percent` is floored rather than rounded at the top end: 99 tasks of 100
 * rounds to 99, but 199 of 200 rounds to 100 and reads as finished when it is
 * not. Anything short of every task returns at most 99.
 */
export function progressOf(tasks: readonly LifecycleTaskState[]): Progress {
  const total = tasks.length;
  const completed = tasks.filter((t) => t.completed).length;
  const mandatory = tasks.filter((t) => t.mandatory);

  let percent = 0;
  if (total > 0) {
    percent = completed === total ? 100 : Math.min(99, Math.round((completed / total) * 100));
  }

  return {
    total,
    completed,
    percent,
    mandatoryTotal: mandatory.length,
    mandatoryCompleted: mandatory.filter((t) => t.completed).length,
  };
}

/**
 * The mandatory tasks still outstanding.
 *
 * Returned rather than a boolean, because "you cannot finish this" is not
 * useful without "because these three things are not done".
 */
export function blockingTasks(tasks: readonly LifecycleTaskState[]): LifecycleTaskState[] {
  return tasks.filter((t) => t.mandatory && !t.completed);
}

/** Whether a journey may be marked complete. */
export function canComplete(status: JourneyStatus, tasks: readonly LifecycleTaskState[]): boolean {
  return status === "in_progress" && blockingTasks(tasks).length === 0;
}

/** A journey moves forward once, and never reopens. */
export function canTransitionJourney(from: JourneyStatus, to: JourneyStatus): boolean {
  const allowed: Record<JourneyStatus, JourneyStatus[]> = {
    in_progress: ["completed", "cancelled"],
    // Terminal. Reopening a completed exit would let the clearance record be
    // rewritten after the fact, which is the thing that makes it evidence.
    completed: [],
    cancelled: [],
  };
  return allowed[from].includes(to);
}

/**
 * The date a task is due, from the journey's anchor.
 *
 * Onboarding anchors on the joining date and counts forward; offboarding
 * anchors on the last working day, and its pre-exit tasks are negative
 * offsets. Computed in UTC so a daylight-saving transition in the runner's
 * zone cannot move a due date by a day.
 */
export function dueDateFor(anchorDate: string, offsetDays: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) {
    throw new RangeError(`Expected a YYYY-MM-DD anchor, got "${anchorDate}"`);
  }
  if (!Number.isInteger(offsetDays)) {
    throw new RangeError("Task offsets are whole days");
  }

  const at = new Date(`${anchorDate}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) throw new RangeError(`"${anchorDate}" is not a real date`);

  at.setUTCDate(at.getUTCDate() + offsetDays);
  return at.toISOString().slice(0, 10);
}

/**
 * Tasks that are late.
 *
 * A task is overdue only while it is still outstanding — something completed
 * after its due date is done, and listing it forever as overdue trains people
 * to ignore the list.
 */
export function overdueTasks(
  tasks: readonly LifecycleTaskState[],
  anchorDate: string,
  today: string
): LifecycleTaskState[] {
  return tasks.filter((t) => !t.completed && dueDateFor(anchorDate, t.dueOffsetDays) < today);
}

/** Groups tasks into their phases, in template order. */
export function groupByPhase(
  tasks: readonly LifecycleTaskState[]
): { phase: string; phaseOrder: number; tasks: LifecycleTaskState[] }[] {
  const byPhase = new Map<string, { phase: string; phaseOrder: number; tasks: LifecycleTaskState[] }>();

  for (const task of tasks) {
    const existing = byPhase.get(task.phase);
    if (existing) {
      existing.tasks.push(task);
      // A phase takes the lowest order any of its tasks claims, so one
      // mislabelled row cannot move the whole phase down the page.
      existing.phaseOrder = Math.min(existing.phaseOrder, task.phaseOrder);
    } else {
      byPhase.set(task.phase, {
        phase: task.phase,
        phaseOrder: task.phaseOrder,
        tasks: [task],
      });
    }
  }

  return [...byPhase.values()].sort(
    (a, b) => a.phaseOrder - b.phaseOrder || a.phase.localeCompare(b.phase)
  );
}

/**
 * Validates a checklist definition before it is written.
 *
 * Duplicate keys are the important one: the unique index would reject them
 * anyway, but as a constraint violation halfway through creating a journey
 * rather than a message naming the duplicate.
 */
export function validateTemplate(tasks: readonly LifecycleTaskState[]): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (tasks.length === 0) errors.push("A checklist needs at least one task");

  const seen = new Set<string>();
  for (const task of tasks) {
    if (!task.taskKey.trim()) errors.push("Every task needs a key");
    else if (seen.has(task.taskKey)) errors.push(`Duplicate task key "${task.taskKey}"`);
    else seen.add(task.taskKey);

    if (!task.title.trim()) errors.push(`Task "${task.taskKey}" needs a title`);
    if (!Number.isInteger(task.dueOffsetDays)) {
      errors.push(`Task "${task.taskKey}" has a fractional due offset`);
    }
  }

  if (tasks.length > 0 && !tasks.some((t) => t.mandatory)) {
    // A checklist with nothing mandatory can be completed while entirely
    // untouched, which makes its completion meaningless.
    errors.push("A checklist needs at least one mandatory task");
  }

  return { ok: errors.length === 0, errors };
}
