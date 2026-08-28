// ═══════════════════════════════════════════════════════════════
// GET /api/notifications
// ═══════════════════════════════════════════════════════════════
// The notification bell showed eight hardcoded entries — `DEMO_NOTIFICATIONS`
// — to every user of every tenant: "Riya Gupta requested 3 days sick leave",
// "March 2026 payroll has been processed for 1,248 employees", "Amit Shah
// submitted ₹12,500 expense for approval". None of those people exist in any
// customer's organisation, and the unread badge read 3 for everybody, forever.
//
// This derives notifications from work that is genuinely outstanding, scoped
// to the caller and their permissions. There is deliberately no notifications
// table: a notification here is a *view over current state*, not a stored
// event. It therefore cannot go stale, cannot be delivered twice, and cannot
// outlive the thing it refers to being resolved by somebody else.
//
// The trade is that "mark as read" is per-session rather than persisted. A
// bell that clears when the work is done is more useful than one that clears
// when you glance at it.
//
// Counts rather than names, throughout. "6 leave requests need your decision"
// is a prompt; eight rows naming individuals is a list, and the page it links
// to is where a list belongs — with the access control that page already has.

import { NextResponse, type NextRequest } from "next/server";
import { and, count, eq, lt, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import {
  employees,
  expenseClaims,
  leaveRequests,
  lifecycleJourneys,
  lifecycleTasks,
} from "@/db/schema/hrms";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { roleHasPermission } from "@/lib/rbac";
import { dateKeyInZone } from "@/lib/date-keys";

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: "leave" | "expense" | "onboarding" | "offboarding" | "payroll";
  href: string;
  /** Higher sorts first. Approvals outrank information. */
  priority: number;
}

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const canApproveLeave = roleHasPermission(ctx.role, "leave.approve");
  const canApproveExpenses = roleHasPermission(ctx.role, "expenses.approve");
  const runsLifecycle = roleHasPermission(ctx.role, "employees.edit");

  try {
    const items = await withTenant(ctx, async (tx) => {
      const notifications: NotificationItem[] = [];
      const today = dateKeyInZone(new Date());

      if (canApproveLeave) {
        const [{ value: pendingLeave }] = await tx
          .select({ value: count() })
          .from(leaveRequests)
          .where(eq(leaveRequests.status, "pending"));

        if (pendingLeave > 0) {
          notifications.push({
            id: "leave-pending",
            title: "Leave awaiting your decision",
            message: `${pendingLeave} request${pendingLeave === 1 ? "" : "s"} pending approval.`,
            type: "leave",
            href: "/leave",
            priority: 100,
          });
        }
      }

      if (canApproveExpenses) {
        const [{ value: pendingExpenses }] = await tx
          .select({ value: count() })
          .from(expenseClaims)
          .where(eq(expenseClaims.status, "pending"));

        if (pendingExpenses > 0) {
          notifications.push({
            id: "expense-pending",
            title: "Expense claims awaiting approval",
            message: `${pendingExpenses} claim${pendingExpenses === 1 ? "" : "s"} pending.`,
            type: "expense",
            href: "/expenses",
            priority: 95,
          });
        }

        // Approved but unpaid: the gap where somebody is out of pocket and
        // nobody is being chased about it.
        const [{ value: owed }] = await tx
          .select({ value: count() })
          .from(expenseClaims)
          .where(
            and(eq(expenseClaims.status, "approved"), sql`${expenseClaims.reimbursedAt} is null`)
          );

        if (owed > 0) {
          notifications.push({
            id: "expense-unpaid",
            title: "Approved expenses not yet reimbursed",
            message: `${owed} claim${owed === 1 ? "" : "s"} approved and awaiting payment.`,
            type: "expense",
            href: "/expenses",
            priority: 70,
          });
        }
      }

      if (runsLifecycle) {
        const [{ value: overdue }] = await tx
          .select({ value: count() })
          .from(lifecycleTasks)
          .innerJoin(lifecycleJourneys, eq(lifecycleJourneys.id, lifecycleTasks.journeyId))
          .where(
            and(
              eq(lifecycleJourneys.status, "in_progress"),
              eq(lifecycleTasks.completed, false),
              sql`${lifecycleJourneys.anchorDate} + ${lifecycleTasks.dueOffsetDays} * INTERVAL '1 day' < ${today}::date`
            )
          );

        if (overdue > 0) {
          notifications.push({
            id: "lifecycle-overdue",
            title: "Overdue onboarding and exit tasks",
            message: `${overdue} task${overdue === 1 ? "" : "s"} past its due date.`,
            type: "onboarding",
            href: "/onboarding",
            priority: 90,
          });
        }

        // An exit checklist that never completes is how a leaver keeps their
        // access. Ranked above everything else for that reason.
        const [{ value: openExits }] = await tx
          .select({ value: count() })
          .from(lifecycleJourneys)
          .where(
            and(
              eq(lifecycleJourneys.kind, "offboarding"),
              eq(lifecycleJourneys.status, "in_progress"),
              lt(lifecycleJourneys.anchorDate, today)
            )
          );

        if (openExits > 0) {
          notifications.push({
            id: "exit-open",
            title: "Exit clearance still open",
            message: `${openExits} employee${
              openExits === 1 ? " has" : "s have"
            } left with clearance outstanding.`,
            type: "offboarding",
            href: "/offboarding",
            priority: 110,
          });
        }
      }

      // Everyone sees their own outstanding items, whatever their role.
      // `ctx.userId` identifies the account; leave and expense rows are keyed
      // by the employee record, so the employee id has to be resolved first.
      // Comparing the two directly matches nothing, which is why none of these
      // three notifications had ever fired.
      const mine = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(eq(employees.userId, ctx.userId))
        .limit(1);

      if (mine[0]) {
        const employeeId = mine[0].id;
        const [{ value: myPendingLeave }] = await tx
          .select({ value: count() })
          .from(leaveRequests)
          .where(
            and(eq(leaveRequests.employeeId, employeeId), eq(leaveRequests.status, "pending"))
          );

        if (myPendingLeave > 0) {
          notifications.push({
            id: "my-leave",
            title: "Your leave request is pending",
            message: `${myPendingLeave} request${
              myPendingLeave === 1 ? "" : "s"
            } awaiting a decision.`,
            type: "leave",
            href: "/leave",
            priority: 50,
          });
        }

        const [{ value: myPendingExpenses }] = await tx
          .select({ value: count() })
          .from(expenseClaims)
          .where(
            and(eq(expenseClaims.employeeId, employeeId), eq(expenseClaims.status, "pending"))
          );

        if (myPendingExpenses > 0) {
          notifications.push({
            id: "my-expenses",
            title: "Your expense claim is pending",
            message: `${myPendingExpenses} claim${
              myPendingExpenses === 1 ? "" : "s"
            } awaiting approval.`,
            type: "expense",
            href: "/expenses",
            priority: 45,
          });
        }
      }

      return notifications.sort((a, b) => b.priority - a.priority);
    });

    return NextResponse.json({ items, count: items.length });
  } catch (error) {
    console.error("Notifications lookup failed:", error);
    return NextResponse.json({ error: "Could not read notifications" }, { status: 500 });
  }
}
