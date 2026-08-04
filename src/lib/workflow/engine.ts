// ═══════════════════════════════════════════════════════════════
// WORKFLOW ENGINE — configurable approval chains
// ═══════════════════════════════════════════════════════════════
// Every HR process needs approval routing, and today each one hard-codes its
// own: leave asks the reporting manager, expenses ask a manager then finance,
// travel asks someone else again. Changing "expenses over ₹50,000 also need
// the CFO" currently means a code change and a deploy.
//
// This makes routing data. A tenant defines steps — who approves, under what
// conditions, within what time — and leave, expenses, travel, loans and
// offboarding all run through the same evaluator.
//
// The logic here is deliberately pure: no database, and no clock beyond what
// is passed in. Resolving approvers to actual people is the caller's job,
// which keeps every rule in this file testable without fixtures.

// ─── Conditions ──────────────────────────────────────────────

export type ComparisonOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "not_in"
  | "contains"
  | "is_empty"
  | "is_not_empty";

export interface Condition {
  field: string;
  operator: ComparisonOperator;
  value?: unknown;
}

export interface ConditionGroup {
  /** How to combine `conditions`. Defaults to "all". */
  match?: "all" | "any";
  conditions: Condition[];
}

/** Reads `a.b.c` from a nested object without throwing on a missing branch. */
export function readPath(source: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined,
      source
    );
}

function compareNumeric(
  left: unknown,
  right: unknown,
  compare: (a: number, b: number) => boolean
): boolean {
  const a = Number(left);
  const b = Number(right);
  // A non-numeric comparison is a misconfigured rule. Returning false rather
  // than letting NaN propagate keeps a bad condition from silently matching.
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return compare(a, b);
}

function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

export function evaluateCondition(condition: Condition, entity: unknown): boolean {
  const actual = readPath(entity, condition.field);

  switch (condition.operator) {
    case "eq":
      return actual === condition.value;
    case "neq":
      return actual !== condition.value;
    case "gt":
      return compareNumeric(actual, condition.value, (a, b) => a > b);
    case "gte":
      return compareNumeric(actual, condition.value, (a, b) => a >= b);
    case "lt":
      return compareNumeric(actual, condition.value, (a, b) => a < b);
    case "lte":
      return compareNumeric(actual, condition.value, (a, b) => a <= b);
    case "in":
      return Array.isArray(condition.value) && condition.value.includes(actual);
    case "not_in":
      return Array.isArray(condition.value) && !condition.value.includes(actual);
    case "contains":
      if (Array.isArray(actual)) return actual.includes(condition.value);
      return typeof actual === "string" && actual.includes(String(condition.value));
    case "is_empty":
      return isEmpty(actual);
    case "is_not_empty":
      return !isEmpty(actual);
    default:
      // An unknown operator is a configuration error. Failing closed means a
      // typo blocks the step rather than approving everything.
      return false;
  }
}

export function evaluateGroup(group: ConditionGroup | undefined, entity: unknown): boolean {
  // No conditions means "always applies", which is the common case.
  if (!group || group.conditions.length === 0) return true;
  return group.match === "any"
    ? group.conditions.some((c) => evaluateCondition(c, entity))
    : group.conditions.every((c) => evaluateCondition(c, entity));
}

// ─── Steps ───────────────────────────────────────────────────

export type ApproverType =
  | "reporting_manager"
  /** Walks up the reporting line by `levels`. */
  | "manager_chain"
  | "department_head"
  | "role"
  | "specific_user"
  | "cost_center_owner";

export interface WorkflowStep {
  id: string;
  name: string;
  approverType: ApproverType;
  /** For `role`. */
  role?: string;
  /** For `specific_user`. */
  userId?: string;
  /** For `manager_chain`; 1 is the direct manager. */
  levels?: number;
  /** The step is skipped when this does not match. */
  condition?: ConditionGroup;
  /** All resolved approvers must act, rather than any one of them. */
  requireAll?: boolean;
  /** Hours before the step is considered breached. */
  slaHours?: number;
  /** Where to escalate on breach. */
  escalateTo?: { approverType: ApproverType; role?: string; userId?: string };
  /** Approve automatically if nobody acts within the SLA. */
  autoApproveOnTimeout?: boolean;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  entityType: string;
  steps: WorkflowStep[];
  /** Whether this definition applies to a given entity at all. */
  trigger?: ConditionGroup;
  version: number;
  isActive: boolean;
}

export type Decision = "approved" | "rejected";

export interface HistoryEntry {
  stepId: string;
  actorId: string;
  decision: Decision;
  comment?: string;
  at: string;
}

export interface WorkflowInstanceState {
  definitionId: string;
  entityType: string;
  entityId: string;
  currentStepIndex: number;
  status: "pending" | "approved" | "rejected" | "cancelled";
  history: HistoryEntry[];
  dueAt?: string;
}

/**
 * Picks the definition that applies to an entity.
 *
 * Later versions win, so publishing v2 supersedes v1 without deleting it —
 * instances already running on v1 keep their original rules, which is what
 * makes an audit of a past approval meaningful.
 */
export function selectDefinition(
  definitions: WorkflowDefinition[],
  entityType: string,
  entity: unknown
): WorkflowDefinition | null {
  const candidates = definitions
    .filter((d) => d.isActive && d.entityType === entityType)
    .filter((d) => evaluateGroup(d.trigger, entity))
    .sort((a, b) => b.version - a.version);

  return candidates[0] ?? null;
}

/** Steps whose conditions match the entity. Others are skipped entirely. */
export function applicableSteps(
  definition: WorkflowDefinition,
  entity: unknown
): WorkflowStep[] {
  return definition.steps.filter((step) => evaluateGroup(step.condition, entity));
}

function dueAtFor(step: WorkflowStep, from: Date): string | undefined {
  if (!step.slaHours) return undefined;
  return new Date(from.getTime() + step.slaHours * 3_600_000).toISOString();
}

export interface StartResult {
  state: WorkflowInstanceState;
  /** The step now awaiting a decision, or null when nothing applies. */
  currentStep: WorkflowStep | null;
}

export function startWorkflow(
  definition: WorkflowDefinition,
  entityType: string,
  entityId: string,
  entity: unknown,
  now: Date = new Date()
): StartResult {
  const steps = applicableSteps(definition, entity);

  // A definition whose steps all fail their conditions means nothing needs
  // approving — auto-approve rather than leaving the request stuck forever.
  if (steps.length === 0) {
    return {
      state: {
        definitionId: definition.id,
        entityType,
        entityId,
        currentStepIndex: 0,
        status: "approved",
        history: [],
      },
      currentStep: null,
    };
  }

  return {
    state: {
      definitionId: definition.id,
      entityType,
      entityId,
      currentStepIndex: 0,
      status: "pending",
      history: [],
      dueAt: dueAtFor(steps[0], now),
    },
    currentStep: steps[0],
  };
}

export interface AdvanceResult {
  state: WorkflowInstanceState;
  currentStep: WorkflowStep | null;
  /** True when this decision ended the workflow. */
  completed: boolean;
}

/**
 * How many approvals a `requireAll` step needs.
 *
 * Only a manager chain has an intrinsic count; role-based steps depend on the
 * caller's resolution, so this is the conservative floor.
 */
function requiredApproverCount(step: WorkflowStep): number {
  return step.approverType === "manager_chain" ? Math.max(1, step.levels ?? 1) : 1;
}

/**
 * Records a decision and moves to the next applicable step.
 *
 * A rejection ends the workflow immediately. Continuing to later approvers
 * after someone has said no would be both pointless and misleading in the
 * audit trail.
 */
export function advanceWorkflow(
  state: WorkflowInstanceState,
  definition: WorkflowDefinition,
  entity: unknown,
  decision: { actorId: string; decision: Decision; comment?: string },
  now: Date = new Date()
): AdvanceResult {
  if (state.status !== "pending") {
    throw new Error(`This workflow is already ${state.status}`);
  }

  const steps = applicableSteps(definition, entity);
  const step = steps[state.currentStepIndex];
  if (!step) throw new Error("Workflow has no step at the current index");

  // One person cannot satisfy a step twice; without this a single approver
  // could clear a requireAll step alone by clicking repeatedly.
  const alreadyActed = state.history.some(
    (h) => h.stepId === step.id && h.actorId === decision.actorId
  );
  if (alreadyActed) {
    throw new Error("You have already recorded a decision on this step");
  }

  const history: HistoryEntry[] = [
    ...state.history,
    {
      stepId: step.id,
      actorId: decision.actorId,
      decision: decision.decision,
      comment: decision.comment,
      at: now.toISOString(),
    },
  ];

  if (decision.decision === "rejected") {
    return {
      state: { ...state, status: "rejected", history, dueAt: undefined },
      currentStep: null,
      completed: true,
    };
  }

  if (step.requireAll) {
    const approvals = history.filter((h) => h.stepId === step.id && h.decision === "approved");
    if (approvals.length < requiredApproverCount(step)) {
      return { state: { ...state, history }, currentStep: step, completed: false };
    }
  }

  const nextIndex = state.currentStepIndex + 1;
  const nextStep = steps[nextIndex];

  if (!nextStep) {
    return {
      state: {
        ...state,
        status: "approved",
        currentStepIndex: nextIndex,
        history,
        dueAt: undefined,
      },
      currentStep: null,
      completed: true,
    };
  }

  return {
    state: { ...state, currentStepIndex: nextIndex, history, dueAt: dueAtFor(nextStep, now) },
    currentStep: nextStep,
    completed: false,
  };
}

// ─── SLA and escalation ──────────────────────────────────────

export interface BreachedInstance {
  entityId: string;
  stepId: string;
  overdueByHours: number;
  escalateTo?: WorkflowStep["escalateTo"];
  autoApprove: boolean;
}

export interface TrackedInstance {
  entityId: string;
  state: WorkflowInstanceState;
  definition: WorkflowDefinition;
  entity: unknown;
}

/**
 * Instances whose current step has passed its deadline.
 *
 * Run on a schedule by the worker VM. Escalation matters because the common
 * failure of an approval system is not a wrong decision but no decision: a
 * request sits in someone's queue while they are on holiday.
 */
export function findBreaches(
  instances: TrackedInstance[],
  now: Date = new Date()
): BreachedInstance[] {
  const breaches: BreachedInstance[] = [];

  for (const { entityId, state, definition, entity } of instances) {
    if (state.status !== "pending" || !state.dueAt) continue;

    const due = new Date(state.dueAt).getTime();
    if (Number.isNaN(due) || due > now.getTime()) continue;

    const step = applicableSteps(definition, entity)[state.currentStepIndex];
    if (!step) continue;

    breaches.push({
      entityId,
      stepId: step.id,
      overdueByHours: Math.floor((now.getTime() - due) / 3_600_000),
      escalateTo: step.escalateTo,
      autoApprove: step.autoApproveOnTimeout ?? false,
    });
  }

  return breaches;
}

// ─── Approver resolution ─────────────────────────────────────

export interface OrgContext {
  /** Employee id → their manager's id. */
  managerOf: (employeeId: string) => string | undefined;
  /** Department id → its head's id. */
  headOfDepartment: (departmentId: string) => string | undefined;
  /** Role name → every user holding it. */
  usersWithRole: (role: string) => string[];
  costCenterOwner?: (costCenter: string) => string | undefined;
}

export interface ResolutionSubject {
  employeeId: string;
  departmentId?: string;
  costCenter?: string;
}

function present(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Turns a step's rule into concrete user ids.
 *
 * The requester is always excluded. Self-approval is the most common way an
 * approval control is defeated in practice, and usually by accident — a
 * department head submitting an expense against their own department.
 */
export function resolveApprovers(
  step: WorkflowStep,
  subject: ResolutionSubject,
  org: OrgContext
): string[] {
  let candidates: (string | undefined)[] = [];

  switch (step.approverType) {
    case "reporting_manager":
      candidates = [org.managerOf(subject.employeeId)];
      break;

    case "manager_chain": {
      const levels = Math.max(1, step.levels ?? 1);
      const chain: string[] = [];
      let current: string | undefined = subject.employeeId;
      const seen = new Set<string>([subject.employeeId]);

      for (let i = 0; i < levels; i++) {
        current = current ? org.managerOf(current) : undefined;
        if (!current) break;
        // A cycle in the reporting line would loop forever, and a bad edit can
        // easily make A report to B report to A.
        if (seen.has(current)) break;
        seen.add(current);
        chain.push(current);
      }
      candidates = chain;
      break;
    }

    case "department_head":
      candidates = subject.departmentId
        ? [org.headOfDepartment(subject.departmentId)]
        : [];
      break;

    case "role":
      candidates = step.role ? org.usersWithRole(step.role) : [];
      break;

    case "specific_user":
      candidates = [step.userId];
      break;

    case "cost_center_owner":
      candidates =
        subject.costCenter && org.costCenterOwner
          ? [org.costCenterOwner(subject.costCenter)]
          : [];
      break;
  }

  return [...new Set(candidates.filter(present))].filter((id) => id !== subject.employeeId);
}
