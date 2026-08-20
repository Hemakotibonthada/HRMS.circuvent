"use client";

// ═══════════════════════════════════════════════════════════════
// BENEFITS CLIENT
// ═══════════════════════════════════════════════════════════════
// The benefits page could not show a single real benefit.
//
// It went through `genericService(COLLECTIONS.policies).create(...)` — not a
// missing route, like payroll, but a *working* one for the wrong feature.
// `policies` is a real, allowed document-store collection: it is what
// `src/app/(dashboard)/policies/page.tsx` uses for uploaded company-policy
// documents. So the write succeeded, returned 200, and even round-tripped
// through the page's own Zustand store — the toast said "Benefit plan
// created!" truthfully, about a row it had just added to the policy-document
// collection. Meanwhile `benefitPlans`, `enrolmentWindows`,
// `benefitEnrolments`, `dependants` and `benefitClaims` — real tables, with
// real `/api/benefits/*` routes already reading and writing them — stayed
// empty. A 404 is loud and gets noticed. This was quiet: nothing ever
// errored, so nobody had a reason to look. And the read side was worse than
// wrong — there wasn't one. `useBenefitStore` started at `items: []` and no
// `useEffect` anywhere in the page ever called `setItems`, so the founder's
// requirement ("employee benefits needs to be known to employee") had no code
// path that could ever become true, for anybody, regardless of what was in
// the database.
//
// This module is the real data path, built the same shape as
// `payroll-client.ts`: typed wrappers over the four routes that already exist
// and already work, plus the pure functions pulled out of the pages that use
// them — because the parts of this feature worth getting wrong are not the
// fetch calls, they are "who is allowed to see whose benefits" and "what does
// an enrolment-window deadline mean today", and those are the parts that can
// be tested without a server.

export interface PlanRecord {
  id: string;
  name: string;
  benefitType: string;
  provider?: string;
  description?: string;
  employerContribution: number;
  employeeContribution: number;
  coverageAmount?: number;
  currency: string;
  allowsDependants: boolean;
  eligibleRelations: string[];
  maxDependants?: number;
  isAutoEnrolled: boolean;
  /** Resolved server-side, for whichever employee the request was scoped to. */
  isEligible?: boolean;
  /** Why the plan cannot be elected right now, if it cannot. */
  unavailableReason?: string;
  /** The currently open enrolment window for this plan, if one is open. */
  enrolmentWindow?: { opensOn: string; closesOn: string };
  documentUrl?: string;
}

export interface EnrolmentRecord {
  id: string;
  planId: string;
  planName?: string;
  employeeId: string;
  status: string;
  planYear: number;
  coverageFrom?: string;
  coverageTo?: string;
  employeeCost: number;
  employerCost: number;
  dependantIds: string[];
  electedAt: string;
}

/**
 * A dependant, shaped as `/api/benefits/dependants` actually returns it — not
 * as the table stores it. The route deliberately strips the identity-document
 * reference before responding ("stored for insurer submission, not for
 * display"), so a type that mirrored the database column would promise a
 * field this client never receives.
 */
export interface Dependant {
  id: string;
  fullName: string;
  relation: string;
  dateOfBirth?: string;
  gender?: string;
  isNominee: boolean;
  nomineeSharePercent?: number;
}

export interface ClaimRecord {
  id: string;
  enrolmentId: string;
  employeeId: string;
  dependantId?: string;
  claimNumber: string;
  claimedAmount: number;
  approvedAmount?: number;
  incidentDate: string;
  description?: string;
  documents: string[];
  status: string;
  providerReference?: string;
  settledAt?: string;
  createdAt: string;
}

export interface ClaimsPage {
  items: ClaimRecord[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/** The server's message, or a fallback. Never a bare "something went wrong". */
async function messageFrom(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return body.error || fallback;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });

  if (!response.ok) {
    throw new Error(await messageFrom(response, `Request failed (${response.status})`));
  }
  return (await response.json()) as T;
}

// ─── Plans ─────────────────────────────────────────────────

/**
 * Plans visible to `employeeId`, eligibility and any open enrolment window
 * already resolved server-side.
 *
 * `employeeId` is honoured only for `owner`/`admin`/`hr` callers —
 * `src/app/api/benefits/plans/route.ts` reads `?employeeId=` but silently
 * substitutes the caller's own id for anyone else. Omit it for self-service;
 * pass it only from the admin lookup, and only after `resolveViewedEmployeeId`
 * below has already decided the caller is allowed to ask for someone else.
 */
export async function listPlans(employeeId?: string): Promise<PlanRecord[]> {
  const qs = employeeId ? `?employeeId=${encodeURIComponent(employeeId)}` : "";
  const body = await call<{ plans: PlanRecord[] }>(`/api/benefits/plans${qs}`);
  return body.plans ?? [];
}

// ─── Enrolments ────────────────────────────────────────────

export interface EnrolmentsResult {
  employeeId: string;
  enrolments: EnrolmentRecord[];
}

export async function listEnrolments(
  opts: { employeeId?: string; planYear?: number } = {}
): Promise<EnrolmentsResult> {
  const params = new URLSearchParams();
  if (opts.employeeId) params.set("employeeId", opts.employeeId);
  if (opts.planYear) params.set("planYear", String(opts.planYear));
  const qs = params.toString();
  return call<EnrolmentsResult>(`/api/benefits/enrolments${qs ? `?${qs}` : ""}`);
}

export interface ElectInput {
  planId: string;
  planYear: number;
  dependantIds?: string[];
  lifeEvent?: { type: string; occurredOn: string };
}

/**
 * Elects a plan for the signed-in employee.
 *
 * There is no `employeeId` field on this call: the route always elects for
 * `ctx.userId` and never reads one from the body, because electing cover on a
 * colleague's behalf would change their salary deduction without their say.
 */
export async function elect(input: ElectInput): Promise<EnrolmentRecord> {
  return call<EnrolmentRecord>("/api/benefits/enrolments", {
    method: "POST",
    body: JSON.stringify({ action: "elect", ...input }),
  });
}

export async function waive(input: {
  planId: string;
  planYear: number;
  reason: string;
}): Promise<{ ok: true; status: string }> {
  return call<{ ok: true; status: string }>("/api/benefits/enrolments", {
    method: "POST",
    body: JSON.stringify({ action: "waive", ...input }),
  });
}

// ─── Dependants ────────────────────────────────────────────

/**
 * The signed-in employee's own dependants — and deliberately nobody else's.
 *
 * `/api/benefits/dependants` reads `ctx.userId` unconditionally; it does not
 * look at an `employeeId` query parameter for anyone, including HR and owner.
 * That is the strictest rule in this API surface, so this function takes no
 * arguments at all rather than an optional one the server would ignore — an
 * `employeeId` parameter here would be a lie about what the call can do, and
 * the next person to read this file should not have to check the route to
 * find out it does nothing.
 */
export async function listMyDependants(): Promise<Dependant[]> {
  const body = await call<{ dependants: Dependant[] }>("/api/benefits/dependants");
  return body.dependants ?? [];
}

export interface AddDependantInput {
  fullName: string;
  relation: string;
  dateOfBirth?: string;
  gender?: string;
  identifier?: string;
  isNominee?: boolean;
  nomineeSharePercent?: number;
}

export async function addDependant(input: AddDependantInput): Promise<{ id: string }> {
  return call<{ id: string }>("/api/benefits/dependants", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// ─── Claims ────────────────────────────────────────────────

export async function listClaims(
  opts: { employeeId?: string; page?: number; pageSize?: number } = {}
): Promise<ClaimsPage> {
  const params = new URLSearchParams();
  if (opts.employeeId) params.set("employeeId", opts.employeeId);
  if (opts.page) params.set("page", String(opts.page));
  if (opts.pageSize) params.set("pageSize", String(opts.pageSize));
  const qs = params.toString();
  return call<ClaimsPage>(`/api/benefits/claims${qs ? `?${qs}` : ""}`);
}

export interface SubmitClaimInput {
  enrolmentId: string;
  dependantId?: string;
  claimedAmount: number;
  incidentDate: string;
  description?: string;
  documents?: string[];
}

export async function submitClaim(input: SubmitClaimInput): Promise<{ id: string }> {
  return call<{ id: string }>("/api/benefits/claims", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// ═══════════════════════════════════════════════════════════════
// Pure functions — the data-shaping logic, extracted so it is testable
// without a server, a browser, or a mocked fetch.
// ═══════════════════════════════════════════════════════════════

const PRIVILEGED_ROLES = ["owner", "admin", "hr"];

export interface ViewedEmployee {
  employeeId: string;
  /** False only when a privileged caller is genuinely looking at someone else. */
  isSelf: boolean;
}

/**
 * Which employee's benefits a request should show, mirroring
 * `src/app/api/benefits/{plans,enrolments,claims}/route.ts` exactly:
 * `privileged && requested ? requested : ctx.userId`.
 *
 * The server already enforces this — a non-privileged caller's `?employeeId=`
 * is silently ignored there, not rejected, so this function changes nothing
 * about what data a request can actually reach. What it buys is a page that
 * knows the difference: if a non-privileged caller typed a colleague's id
 * into a lookup field, this returns their own id back, so the page can say
 * "you can only view your own benefits" instead of quietly ignoring the input
 * and leaving someone to wonder why the lookup did nothing.
 */
export function resolveViewedEmployeeId(
  role: string,
  selfId: string,
  requestedId?: string
): ViewedEmployee {
  const privileged = PRIVILEGED_ROLES.includes(role);
  if (privileged && requestedId && requestedId !== selfId) {
    return { employeeId: requestedId, isSelf: false };
  }
  return { employeeId: selfId, isSelf: true };
}

const LABEL_OVERRIDES: Record<string, string> = {
  // Word-by-word capitalisation gets every benefit type, relation and claim
  // status right except this one — "Parent In Law" is not how anyone writes
  // it — so it is spelled out rather than derived.
  parent_in_law: "Parent-in-law",
};

/**
 * "health_insurance" -> "Health Insurance", "parent_in_law" -> "Parent-in-law".
 *
 * Benefit types (`benefitTypeEnum` in `src/db/schema/talent.ts`), dependant
 * relations and claim statuses are all snake_case in the database, because
 * that is the enum literal, not a label a person should read.
 */
export function humanize(value: string): string {
  if (LABEL_OVERRIDES[value]) return LABEL_OVERRIDES[value];
  return value
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Whole days from `todayISO` to `targetISO`, both `YYYY-MM-DD`. Negative
 * means the date has passed.
 *
 * Computed from the date strings directly instead of `new Date(x) -
 * new Date(y)`, because that route is a timezone bug: `new Date("2026-04-30")`
 * is midnight UTC, and in any timezone behind UTC that prints as the 29th. An
 * enrolment-window deadline is a calendar date, not an instant, so it is
 * compared as one — parsed as UTC-anchored y/m/d on both sides, never through
 * the local-timezone `Date` constructor.
 */
export function daysUntil(
  targetISO: string,
  todayISO: string = new Date().toISOString().slice(0, 10)
): number {
  const toEpochDay = (iso: string): number => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d) / 86_400_000;
  };
  return toEpochDay(targetISO) - toEpochDay(todayISO);
}

export interface OpenWindow {
  planId: string;
  planName: string;
  opensOn: string;
  closesOn: string;
  daysRemaining: number;
}

/**
 * The plans that currently have an open enrolment window, with the deadline
 * pre-computed.
 *
 * A window is per-plan (`enrolment_windows.plan_ids`), not global, so "is
 * enrolment open" is not one yes/no for the whole page — dental can be open
 * while health is closed. Returning a list keyed by plan is the only shape
 * that does not erase that.
 */
export function plansWithOpenWindows(plans: PlanRecord[], todayISO?: string): OpenWindow[] {
  const open: OpenWindow[] = [];
  for (const plan of plans) {
    if (!plan.enrolmentWindow) continue;
    open.push({
      planId: plan.id,
      planName: plan.name,
      opensOn: plan.enrolmentWindow.opensOn,
      closesOn: plan.enrolmentWindow.closesOn,
      daysRemaining: daysUntil(plan.enrolmentWindow.closesOn, todayISO),
    });
  }
  return open;
}

export interface EnrichedEnrolment extends EnrolmentRecord {
  /** The plan's own record, when it could still be found. */
  plan?: PlanRecord;
}

/**
 * Joins an employee's enrolments to the plan catalogue that produced them.
 *
 * `EnrolmentRecord` already carries `planName` (the route joins it
 * server-side), but not coverage amount, currency or benefit type — those
 * exist only on `PlanRecord`. The join can come up empty:
 * `NeonBenefitsRepository.availablePlans()` only returns plans where
 * `isActive` is true, so an employee enrolled in a plan HR later deactivated
 * has a real enrolment with no matching entry here. That is surfaced as
 * "plan details unavailable" — the enrolment itself is not dropped, and
 * nothing here throws, because the deduction is presumably still being taken
 * even though the catalogue lookup came up short.
 */
export function enrichEnrolments(
  enrolments: EnrolmentRecord[],
  plans: PlanRecord[]
): EnrichedEnrolment[] {
  const byId = new Map(plans.map((p) => [p.id, p]));
  return enrolments.map((e) => ({ ...e, plan: byId.get(e.planId) }));
}

/**
 * The dependants covered by one enrolment, resolved from the employee's full
 * dependant list.
 *
 * `EnrolmentRecord.dependantIds` is a list of ids, not names — the enrolments
 * route has no reason to duplicate dependant details it already serves from
 * `/api/benefits/dependants`. A dependant id with no match is dropped rather
 * than thrown on, for the same reason a plan can go missing from
 * `enrichEnrolments`: `enrolment_dependants` rows outlive edits to the
 * dependant they point at only in theory, but this join should not be where
 * that assumption gets tested.
 */
export function dependantsForEnrolment(
  enrolment: EnrolmentRecord,
  dependants: Dependant[]
): Dependant[] {
  const byId = new Map(dependants.map((d) => [d.id, d]));
  return enrolment.dependantIds.map((id) => byId.get(id)).filter((d): d is Dependant => Boolean(d));
}
