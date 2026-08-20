// ═══════════════════════════════════════════════════════════════
// OFFBOARDING CHECKLIST — turning OFFBOARDING_TEMPLATE into a real journey
// ═══════════════════════════════════════════════════════════════
// `OFFBOARDING_TEMPLATE` in employee-lifecycle.ts had no callers anywhere in
// this codebase — the same "written once, read by nothing" state
// `calculateSettlement` was in before this work. The offboarding page had
// its own separate, generic six-item checklist ("IT Assets Return", "Access
// Revocation", ...) that duplicated the same idea with none of the detail
// the template already had (who does it, which step it belongs to).
//
// This file is the one place that reads OFFBOARDING_TEMPLATE and turns it
// into `TaskTemplateInput[]` — the shape `NeonLifecycleRepository.start()`
// requires (`taskKey`/`phase`/`phaseOrder`/`assignee`/`mandatory`, not the
// template's own `step`/`stepName`/nested `tasks`). The offboarding page and
// the exit orchestrator both call `offboardingTaskTemplates()` so the
// checklist a leaver sees is defined in exactly one place.

import { OFFBOARDING_TEMPLATE } from "./employee-lifecycle";

export interface OffboardingChecklistTask {
  key: string;
  title: string;
  assignee: string;
  step: number;
  stepName: string;
  mandatory: boolean;
}

/**
 * Steps whose tasks block an exit being certified complete.
 *
 * Confirming the last working day, returning IT assets and cutting access,
 * and signing off the settlement are the three things someone has to answer
 * for after the fact. Knowledge transfer slipping a week, or an exit survey
 * never being filled in, is not that — so only steps 1, 3 and 6 are
 * mandatory, matching the weight the original six-item checklist gave
 * "IT Assets Return", "Access Revocation" and "Final Settlement".
 */
const MANDATORY_STEPS = new Set([1, 3, 6]);

/**
 * When a task is due, in days offset from the agreed last working day
 * (the journey's anchor date). Steps that are resignation-formalities or
 * handover work are due well before the last day; settlement sign-off and
 * final documentation can only really happen once someone has actually left.
 */
function dueOffsetForStep(step: number): number {
  switch (step) {
    case 1: return -21; // Resignation & Acceptance
    case 2: return -14; // Knowledge Transfer
    case 3: return -1; // IT Asset & Access Revocation
    case 4: return 0; // Financial Clearance
    case 5: return 3; // Exit Interview & Documentation
    case 6: return 7; // Full & Final Settlement
    default: return 0;
  }
}

/** OFFBOARDING_TEMPLATE, flattened to one entry per task with its step context kept. */
export const OFFBOARDING_CHECKLIST_TASKS: OffboardingChecklistTask[] = OFFBOARDING_TEMPLATE.flatMap((step) =>
  step.tasks.map((task) => ({
    key: task.id,
    title: task.title,
    assignee: task.assignee,
    step: step.step,
    stepName: step.stepName,
    mandatory: MANDATORY_STEPS.has(step.step),
  }))
);

/** The six steps, each with the task keys that belong to it — for step-level rollups (e.g. "4 of 6 leavers have cleared IT"). */
export const OFFBOARDING_STEPS: Array<{ step: number; stepName: string; taskKeys: string[] }> =
  OFFBOARDING_TEMPLATE.map((step) => ({
    step: step.step,
    stepName: step.stepName,
    taskKeys: step.tasks.map((t) => t.id),
  }));

/** Ready for `NeonLifecycleRepository.start({ kind: "offboarding", tasks: ... })`. */
export function offboardingTaskTemplates(): Array<{
  taskKey: string;
  title: string;
  phase: string;
  phaseOrder: number;
  assignee: string;
  mandatory: boolean;
  dueOffsetDays: number;
}> {
  return OFFBOARDING_CHECKLIST_TASKS.map((task) => ({
    taskKey: task.key,
    title: task.title,
    phase: task.stepName,
    phaseOrder: task.step,
    assignee: task.assignee.toLowerCase(),
    mandatory: task.mandatory,
    dueOffsetDays: dueOffsetForStep(task.step),
  }));
}
