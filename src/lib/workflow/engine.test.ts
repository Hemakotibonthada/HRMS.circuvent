// @vitest-environment node
//
// The workflow engine decides who approves what. Its failure modes are not
// crashes but wrong outcomes — a step silently skipped, a requester approving
// their own request, an instance stuck forever because nobody was resolved.
// These tests pin the behaviours that make it trustworthy.

import { describe, expect, it } from "vitest";
import {
  advanceWorkflow,
  applicableSteps,
  evaluateCondition,
  evaluateGroup,
  findBreaches,
  readPath,
  resolveApprovers,
  selectDefinition,
  startWorkflow,
  type OrgContext,
  type WorkflowDefinition,
  type WorkflowStep,
} from "@/lib/workflow/engine";

const expense = {
  id: "exp-1",
  employeeId: "emp-1",
  amount: 75_000,
  category: "travel",
  currency: "INR",
  meta: { urgent: true },
  tags: ["client", "offsite"],
};

function step(overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    id: "s1",
    name: "Manager approval",
    approverType: "reporting_manager",
    ...overrides,
  };
}

function definition(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    id: "def-1",
    name: "Expense approval",
    entityType: "expense",
    steps: [step()],
    version: 1,
    isActive: true,
    ...overrides,
  };
}

describe("readPath", () => {
  it("reads nested values", () => {
    expect(readPath(expense, "meta.urgent")).toBe(true);
    expect(readPath(expense, "amount")).toBe(75_000);
  });

  it("returns undefined for a missing branch rather than throwing", () => {
    expect(readPath(expense, "a.b.c.d")).toBeUndefined();
    expect(readPath(null, "a.b")).toBeUndefined();
  });
});

describe("evaluateCondition", () => {
  it("compares numerically", () => {
    expect(evaluateCondition({ field: "amount", operator: "gt", value: 50_000 }, expense)).toBe(true);
    expect(evaluateCondition({ field: "amount", operator: "gt", value: 100_000 }, expense)).toBe(false);
    expect(evaluateCondition({ field: "amount", operator: "gte", value: 75_000 }, expense)).toBe(true);
    expect(evaluateCondition({ field: "amount", operator: "lte", value: 75_000 }, expense)).toBe(true);
  });

  it("is false when a numeric comparison hits a non-number", () => {
    // A misconfigured rule must not match by NaN accident.
    expect(evaluateCondition({ field: "category", operator: "gt", value: 10 }, expense)).toBe(false);
    expect(evaluateCondition({ field: "missing", operator: "lt", value: 10 }, expense)).toBe(false);
  });

  it("handles set membership", () => {
    expect(
      evaluateCondition({ field: "category", operator: "in", value: ["travel", "meals"] }, expense)
    ).toBe(true);
    expect(
      evaluateCondition({ field: "category", operator: "not_in", value: ["meals"] }, expense)
    ).toBe(true);
  });

  it("treats a non-array value for in/not_in as no match", () => {
    expect(evaluateCondition({ field: "category", operator: "in", value: "travel" }, expense)).toBe(
      false
    );
  });

  it("handles contains for both arrays and strings", () => {
    expect(evaluateCondition({ field: "tags", operator: "contains", value: "client" }, expense)).toBe(
      true
    );
    expect(evaluateCondition({ field: "category", operator: "contains", value: "rav" }, expense)).toBe(
      true
    );
  });

  it("distinguishes empty from present", () => {
    const entity = { a: "", b: null, c: [], d: 0, e: "x" };
    expect(evaluateCondition({ field: "a", operator: "is_empty" }, entity)).toBe(true);
    expect(evaluateCondition({ field: "b", operator: "is_empty" }, entity)).toBe(true);
    expect(evaluateCondition({ field: "c", operator: "is_empty" }, entity)).toBe(true);
    // Zero is a value, not an absence.
    expect(evaluateCondition({ field: "d", operator: "is_empty" }, entity)).toBe(false);
    expect(evaluateCondition({ field: "e", operator: "is_not_empty" }, entity)).toBe(true);
  });

  it("fails closed on an unknown operator", () => {
    expect(
      evaluateCondition(
        { field: "amount", operator: "approximately" as never, value: 1 },
        expense
      )
    ).toBe(false);
  });
});

describe("evaluateGroup", () => {
  it("treats no conditions as always applicable", () => {
    expect(evaluateGroup(undefined, expense)).toBe(true);
    expect(evaluateGroup({ conditions: [] }, expense)).toBe(true);
  });

  it("requires every condition by default", () => {
    expect(
      evaluateGroup(
        {
          conditions: [
            { field: "amount", operator: "gt", value: 50_000 },
            { field: "category", operator: "eq", value: "meals" },
          ],
        },
        expense
      )
    ).toBe(false);
  });

  it("requires only one when matching any", () => {
    expect(
      evaluateGroup(
        {
          match: "any",
          conditions: [
            { field: "amount", operator: "gt", value: 500_000 },
            { field: "category", operator: "eq", value: "travel" },
          ],
        },
        expense
      )
    ).toBe(true);
  });
});

describe("selectDefinition", () => {
  it("prefers the highest active version", () => {
    const chosen = selectDefinition(
      [definition({ id: "v1", version: 1 }), definition({ id: "v3", version: 3 }), definition({ id: "v2", version: 2 })],
      "expense",
      expense
    );
    expect(chosen?.id).toBe("v3");
  });

  it("ignores inactive definitions", () => {
    const chosen = selectDefinition(
      [definition({ id: "v2", version: 2, isActive: false }), definition({ id: "v1", version: 1 })],
      "expense",
      expense
    );
    expect(chosen?.id).toBe("v1");
  });

  it("ignores definitions for other entity types", () => {
    expect(selectDefinition([definition()], "leave", expense)).toBeNull();
  });

  it("respects the trigger condition", () => {
    const highValueOnly = definition({
      trigger: { conditions: [{ field: "amount", operator: "gt", value: 100_000 }] },
    });
    expect(selectDefinition([highValueOnly], "expense", expense)).toBeNull();
  });
});

describe("applicableSteps", () => {
  it("skips steps whose condition does not match", () => {
    const def = definition({
      steps: [
        step({ id: "manager" }),
        step({
          id: "cfo",
          condition: { conditions: [{ field: "amount", operator: "gt", value: 100_000 }] },
        }),
      ],
    });
    expect(applicableSteps(def, expense).map((s) => s.id)).toEqual(["manager"]);
    expect(applicableSteps(def, { ...expense, amount: 200_000 }).map((s) => s.id)).toEqual([
      "manager",
      "cfo",
    ]);
  });
});

describe("startWorkflow", () => {
  it("begins at the first applicable step", () => {
    const result = startWorkflow(definition(), "expense", "exp-1", expense);
    expect(result.state.status).toBe("pending");
    expect(result.currentStep?.id).toBe("s1");
  });

  it("auto-approves when no step applies", () => {
    // Otherwise the request sits pending forever with nobody to act on it.
    const def = definition({
      steps: [
        step({ condition: { conditions: [{ field: "amount", operator: "gt", value: 1_000_000 }] } }),
      ],
    });
    const result = startWorkflow(def, "expense", "exp-1", expense);
    expect(result.state.status).toBe("approved");
    expect(result.currentStep).toBeNull();
  });

  it("sets a deadline from the step SLA", () => {
    const now = new Date("2026-04-01T10:00:00Z");
    const result = startWorkflow(
      definition({ steps: [step({ slaHours: 48 })] }),
      "expense",
      "exp-1",
      expense,
      now
    );
    expect(result.state.dueAt).toBe("2026-04-03T10:00:00.000Z");
  });

  it("leaves the deadline unset when the step has no SLA", () => {
    expect(startWorkflow(definition(), "expense", "exp-1", expense).state.dueAt).toBeUndefined();
  });
});

describe("advanceWorkflow", () => {
  const twoStep = definition({
    steps: [step({ id: "manager" }), step({ id: "finance", approverType: "role", role: "hr" })],
  });

  it("moves to the next step on approval", () => {
    const { state } = startWorkflow(twoStep, "expense", "exp-1", expense);
    const result = advanceWorkflow(state, twoStep, expense, {
      actorId: "mgr-1",
      decision: "approved",
    });

    expect(result.completed).toBe(false);
    expect(result.currentStep?.id).toBe("finance");
    expect(result.state.history).toHaveLength(1);
  });

  it("completes after the final step", () => {
    let { state } = startWorkflow(twoStep, "expense", "exp-1", expense);
    state = advanceWorkflow(state, twoStep, expense, { actorId: "mgr-1", decision: "approved" }).state;
    const result = advanceWorkflow(state, twoStep, expense, {
      actorId: "hr-1",
      decision: "approved",
    });

    expect(result.completed).toBe(true);
    expect(result.state.status).toBe("approved");
    expect(result.currentStep).toBeNull();
  });

  it("ends immediately on rejection without consulting later approvers", () => {
    const { state } = startWorkflow(twoStep, "expense", "exp-1", expense);
    const result = advanceWorkflow(state, twoStep, expense, {
      actorId: "mgr-1",
      decision: "rejected",
      comment: "Not budgeted",
    });

    expect(result.completed).toBe(true);
    expect(result.state.status).toBe("rejected");
    expect(result.state.dueAt).toBeUndefined();
  });

  it("records who decided what, and when", () => {
    const now = new Date("2026-04-02T09:30:00Z");
    const { state } = startWorkflow(twoStep, "expense", "exp-1", expense);
    const result = advanceWorkflow(
      state,
      twoStep,
      expense,
      { actorId: "mgr-1", decision: "approved", comment: "Fine" },
      now
    );

    expect(result.state.history[0]).toEqual({
      stepId: "manager",
      actorId: "mgr-1",
      decision: "approved",
      comment: "Fine",
      at: "2026-04-02T09:30:00.000Z",
    });
  });

  it("refuses a second decision from the same person on one step", () => {
    // Otherwise one approver could clear a requireAll step alone.
    const def = definition({
      steps: [step({ approverType: "manager_chain", levels: 2, requireAll: true })],
    });
    let { state } = startWorkflow(def, "expense", "exp-1", expense);
    state = advanceWorkflow(state, def, expense, { actorId: "mgr-1", decision: "approved" }).state;

    expect(() =>
      advanceWorkflow(state, def, expense, { actorId: "mgr-1", decision: "approved" })
    ).toThrow(/already recorded a decision/);
  });

  it("waits for every approver on a requireAll step", () => {
    const def = definition({
      steps: [step({ approverType: "manager_chain", levels: 2, requireAll: true })],
    });
    let { state } = startWorkflow(def, "expense", "exp-1", expense);

    const first = advanceWorkflow(state, def, expense, { actorId: "mgr-1", decision: "approved" });
    expect(first.completed).toBe(false);
    expect(first.state.status).toBe("pending");

    state = first.state;
    const second = advanceWorkflow(state, def, expense, { actorId: "mgr-2", decision: "approved" });
    expect(second.completed).toBe(true);
    expect(second.state.status).toBe("approved");
  });

  it("refuses to act on a finished workflow", () => {
    const { state } = startWorkflow(twoStep, "expense", "exp-1", expense);
    const done = advanceWorkflow(state, twoStep, expense, {
      actorId: "mgr-1",
      decision: "rejected",
    }).state;

    expect(() =>
      advanceWorkflow(done, twoStep, expense, { actorId: "hr-1", decision: "approved" })
    ).toThrow(/already rejected/);
  });
});

describe("findBreaches", () => {
  const def = definition({
    steps: [step({ slaHours: 24, escalateTo: { approverType: "role", role: "admin" } })],
  });

  it("reports an instance past its deadline", () => {
    const started = startWorkflow(def, "expense", "exp-1", expense, new Date("2026-04-01T00:00:00Z"));
    const breaches = findBreaches(
      [{ entityId: "exp-1", state: started.state, definition: def, entity: expense }],
      new Date("2026-04-03T00:00:00Z")
    );

    expect(breaches).toHaveLength(1);
    expect(breaches[0].overdueByHours).toBe(24);
    expect(breaches[0].escalateTo?.role).toBe("admin");
  });

  it("ignores instances still within their deadline", () => {
    const started = startWorkflow(def, "expense", "exp-1", expense, new Date("2026-04-01T00:00:00Z"));
    expect(
      findBreaches(
        [{ entityId: "exp-1", state: started.state, definition: def, entity: expense }],
        new Date("2026-04-01T12:00:00Z")
      )
    ).toHaveLength(0);
  });

  it("ignores instances with no SLA and those already decided", () => {
    const noSla = startWorkflow(definition(), "expense", "exp-1", expense);
    const decided = {
      ...startWorkflow(def, "expense", "exp-2", expense, new Date("2026-01-01T00:00:00Z")).state,
      status: "approved" as const,
    };

    const breaches = findBreaches(
      [
        { entityId: "exp-1", state: noSla.state, definition: definition(), entity: expense },
        { entityId: "exp-2", state: decided, definition: def, entity: expense },
      ],
      new Date("2026-06-01T00:00:00Z")
    );
    expect(breaches).toHaveLength(0);
  });

  it("flags auto-approval when configured", () => {
    const autoDef = definition({ steps: [step({ slaHours: 1, autoApproveOnTimeout: true })] });
    const started = startWorkflow(autoDef, "expense", "exp-1", expense, new Date("2026-04-01T00:00:00Z"));
    const breaches = findBreaches(
      [{ entityId: "exp-1", state: started.state, definition: autoDef, entity: expense }],
      new Date("2026-04-02T00:00:00Z")
    );
    expect(breaches[0].autoApprove).toBe(true);
  });
});

describe("resolveApprovers", () => {
  const chain: Record<string, string> = {
    "emp-1": "mgr-1",
    "mgr-1": "dir-1",
    "dir-1": "vp-1",
  };

  const org: OrgContext = {
    managerOf: (id) => chain[id],
    headOfDepartment: (id) => (id === "dept-eng" ? "head-eng" : undefined),
    usersWithRole: (role) => (role === "hr" ? ["hr-1", "hr-2"] : []),
    costCenterOwner: (cc) => (cc === "CC-100" ? "owner-1" : undefined),
  };

  const subject = { employeeId: "emp-1", departmentId: "dept-eng", costCenter: "CC-100" };

  it("resolves the reporting manager", () => {
    expect(resolveApprovers(step(), subject, org)).toEqual(["mgr-1"]);
  });

  it("walks the manager chain to the requested depth", () => {
    expect(
      resolveApprovers(step({ approverType: "manager_chain", levels: 3 }), subject, org)
    ).toEqual(["mgr-1", "dir-1", "vp-1"]);
  });

  it("stops when the chain runs out", () => {
    expect(
      resolveApprovers(step({ approverType: "manager_chain", levels: 10 }), subject, org)
    ).toEqual(["mgr-1", "dir-1", "vp-1"]);
  });

  it("does not loop forever on a cyclic reporting line", () => {
    // A bad edit can easily make A report to B report to A.
    const cyclic: OrgContext = {
      ...org,
      managerOf: (id) => ({ "emp-1": "mgr-1", "mgr-1": "emp-1" })[id],
    };
    expect(
      resolveApprovers(step({ approverType: "manager_chain", levels: 5 }), subject, cyclic)
    ).toEqual(["mgr-1"]);
  });

  it("resolves department heads, roles, specific users and cost-centre owners", () => {
    expect(resolveApprovers(step({ approverType: "department_head" }), subject, org)).toEqual([
      "head-eng",
    ]);
    expect(resolveApprovers(step({ approverType: "role", role: "hr" }), subject, org)).toEqual([
      "hr-1",
      "hr-2",
    ]);
    expect(
      resolveApprovers(step({ approverType: "specific_user", userId: "ceo-1" }), subject, org)
    ).toEqual(["ceo-1"]);
    expect(resolveApprovers(step({ approverType: "cost_center_owner" }), subject, org)).toEqual([
      "owner-1",
    ]);
  });

  it("never returns the requester", () => {
    // Self-approval is the most common way this control is defeated.
    const selfHead: OrgContext = { ...org, headOfDepartment: () => "emp-1" };
    expect(resolveApprovers(step({ approverType: "department_head" }), subject, selfHead)).toEqual(
      []
    );

    const selfRole: OrgContext = { ...org, usersWithRole: () => ["emp-1", "hr-2"] };
    expect(resolveApprovers(step({ approverType: "role", role: "hr" }), subject, selfRole)).toEqual(
      ["hr-2"]
    );
  });

  it("de-duplicates approvers", () => {
    const dupes: OrgContext = { ...org, usersWithRole: () => ["hr-1", "hr-1", "hr-2"] };
    expect(resolveApprovers(step({ approverType: "role", role: "hr" }), subject, dupes)).toEqual([
      "hr-1",
      "hr-2",
    ]);
  });

  it("returns nothing when the rule cannot be satisfied", () => {
    // The caller must handle this: an unresolvable step would otherwise leave
    // the request pending with nobody able to act.
    expect(resolveApprovers(step({ approverType: "role" }), subject, org)).toEqual([]);
    expect(
      resolveApprovers(step({ approverType: "department_head" }), { employeeId: "emp-1" }, org)
    ).toEqual([]);
  });
});
