"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Shield, Users, Receipt, CalendarClock,
  AlertTriangle, Search, Info, UserCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useRBAC } from "@/hooks/use-rbac";
import {
  listPlans,
  listEnrolments,
  listMyDependants,
  listClaims,
  resolveViewedEmployeeId,
  enrichEnrolments,
  humanize,
  daysUntil,
  type PlanRecord,
  type EnrichedEnrolment,
  type Dependant,
  type ClaimRecord,
} from "@/lib/benefits-client";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

// ═══════════════════════════════════════════════════════════════
// BENEFITS (admin/HR) — real plans, enrolments, dependants and
// claims for a specific employee, read from the tables that actually
// hold them.
// ═══════════════════════════════════════════════════════════════
// This page used to build its own in-memory "benefit plan" out of a form and
// hand it to `genericService(COLLECTIONS.policies).create(...)` — a real,
// working collection, just the one `src/app/(dashboard)/policies/page.tsx`
// uses for uploaded policy documents. It never touched `benefitPlans`,
// `benefitEnrolments`, `dependants` or `benefitClaims`, and had no
// `useEffect` at all, so nothing it displayed ever came from the database no
// matter what HR had configured there. See `src/lib/benefits-client.ts`.
//
// There is no backend for the thing the old "Add Plan" dialog pretended to
// do: `NeonBenefitsRepository` has no create/update for `benefitPlans`, and
// no route exposes one. Rather than invent a fake success message for a
// write that cannot happen, this page is scoped to what the four real
// routes actually support today — looking up a specific employee's plans,
// cover and claims — and says so where the old dialog used to be.
export default function BenefitsPage() {
  const { user } = useAuth();
  const rbac = useRBAC();
  const privileged = rbac.isAdmin || rbac.isHR;
  const selfId = user?.uid ?? "";

  // The id an admin/HR caller has asked to look up. Empty means "nobody
  // asked, show my own" — `resolveViewedEmployeeId` below turns that into
  // `selfId` either way, so a non-privileged caller typing here (they can't,
  // the input is not rendered for them, but the function does not trust that)
  // still only ever gets their own id back.
  const [lookupInput, setLookupInput] = useState("");
  const [requestedId, setRequestedId] = useState("");

  const viewed = useMemo(
    () => resolveViewedEmployeeId(rbac.role, selfId, requestedId || undefined),
    [rbac.role, selfId, requestedId]
  );

  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [enrolments, setEnrolments] = useState<EnrichedEnrolment[]>([]);
  const [dependants, setDependants] = useState<Dependant[]>([]);
  const [claims, setClaims] = useState<ClaimRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [planList, enrolmentsResult, claimsPage] = await Promise.all([
        listPlans(viewed.employeeId),
        listEnrolments({ employeeId: viewed.employeeId }),
        listClaims({ employeeId: viewed.employeeId, pageSize: 50 }),
      ]);

      // `/api/benefits/dependants` reads `ctx.userId` unconditionally — it has
      // no `employeeId` override for anybody, owner included. Calling it while
      // looking up someone else would silently return the *viewer's own*
      // dependants under that other employee's name, which is worse than
      // showing nothing. It is only ever fetched for a genuinely-self view.
      const dependantList = viewed.isSelf ? await listMyDependants() : [];

      setPlans(planList);
      setEnrolments(enrichEnrolments(enrolmentsResult.enrolments, planList));
      setDependants(dependantList);
      setClaims(claimsPage.items);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Benefits could not be loaded");
    } finally {
      setLoading(false);
      setInitialized(true);
    }
  }, [viewed.employeeId, viewed.isSelf]);

  useEffect(() => {
    if (!viewed.employeeId) return; // waiting on the session to resolve `selfId`
    void reload();
  }, [viewed.employeeId, reload]);

  const openWindowCount = plans.filter((p) => p.enrolmentWindow).length;
  const activeEnrolmentCount = enrolments.filter(
    (e) => e.status === "active" || e.status === "elected"
  ).length;

  // What "empty" means here: the org has no plan catalogue *and* the looked-up
  // employee has no enrolments or claims on record. Plans existing but this
  // one employee not having enrolled in anything yet is not the same fact —
  // that is shown inline within the Enrolments card instead of blanking the
  // whole page, so HR can still see what is on offer.
  const hasAnyData =
    plans.length > 0 || enrolments.length > 0 || claims.length > 0 || (viewed.isSelf && dependants.length > 0);

  if (loading && !initialized) return <DataLoadingSkeleton />;

  if (!loading && initialized && !hasAnyData) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader
          privileged={privileged}
          lookupInput={lookupInput}
          setLookupInput={setLookupInput}
          onLookup={() => setRequestedId(lookupInput.trim())}
          onReset={() => { setLookupInput(""); setRequestedId(""); }}
          viewed={viewed}
        />
        {/* A failed request is not "no benefits configured" — see
            src/app/(dashboard)/payroll/page.tsx for the same distinction and
            the 404 it was originally guarding against. Here the failure mode
            was quieter (a 200 into the wrong collection), but a blank page
            still cannot tell an employee those are different facts. */}
        {loadError ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-destructive">Benefits could not be loaded</p>
              <p className="text-sm text-muted-foreground mt-1">{loadError}</p>
            </div>
          </div>
        ) : (
          <DataEmptyState {...EMPTY_STATES.benefits} />
        )}
      </div>
    );
  }

  const kpis = [
    { label: "Plans Available", value: plans.length, icon: Shield, gradient: "from-violet-500 to-purple-600" },
    { label: "Active Enrolments", value: activeEnrolmentCount, icon: UserCheck, gradient: "from-emerald-500 to-green-600" },
    { label: "Open Enrolment Windows", value: openWindowCount, icon: CalendarClock, gradient: "from-amber-500 to-orange-500" },
    { label: "Claims on File", value: claims.length, icon: Receipt, gradient: "from-blue-500 to-cyan-500" },
  ];

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        privileged={privileged}
        lookupInput={lookupInput}
        setLookupInput={setLookupInput}
        onLookup={() => setRequestedId(lookupInput.trim())}
        onReset={() => { setLookupInput(""); setRequestedId(""); }}
        viewed={viewed}
      />

      {loadError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-destructive">The last refresh failed</p>
            <p className="text-sm text-muted-foreground mt-1">{loadError} Showing the last data that loaded.</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label} className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{kpi.label}</p>
                  <p className="text-2xl font-bold mt-1">{kpi.value}</p>
                </div>
                <div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center", kpi.gradient)}>
                  <kpi.icon className="h-5 w-5 text-white" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2"><Shield className="h-4 w-4" /> Plan Catalogue</CardTitle>
        </CardHeader>
        <CardContent>
          {plans.length === 0 ? (
            <DataEmptyState compact {...EMPTY_STATES.benefits} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {plans.map((plan) => (
                <div key={plan.id} className="rounded-lg border p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-sm">{plan.name}</p>
                      <Badge variant="secondary" className="text-xs mt-1">{humanize(plan.benefitType)}</Badge>
                    </div>
                    {plan.enrolmentWindow && (
                      <Badge className="status-pending text-xs whitespace-nowrap">
                        {daysUntil(plan.enrolmentWindow.closesOn) >= 0
                          ? `${daysUntil(plan.enrolmentWindow.closesOn)}d left to enrol`
                          : "Window closed"}
                      </Badge>
                    )}
                  </div>
                  {plan.description && <p className="text-xs text-muted-foreground">{plan.description}</p>}
                  <Separator />
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><span className="text-muted-foreground">Coverage: </span><span className="font-medium">{plan.coverageAmount ? `₹${plan.coverageAmount.toLocaleString()}` : "—"}</span></div>
                    <div><span className="text-muted-foreground">Employer pays: </span><span className="font-medium">₹{plan.employerContribution.toLocaleString()}</span></div>
                    <div><span className="text-muted-foreground">Employee pays: </span><span className="font-medium">₹{plan.employeeContribution.toLocaleString()}</span></div>
                    <div><span className="text-muted-foreground">Eligible: </span><span className="font-medium">{plan.isEligible === false ? "No" : "Yes"}</span></div>
                  </div>
                  {plan.unavailableReason && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">{plan.unavailableReason}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><UserCheck className="h-4 w-4" /> Enrolments</CardTitle>
        </CardHeader>
        <CardContent>
          {enrolments.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              {viewed.isSelf ? "You are" : "This employee is"} not enrolled in any plan yet.
            </p>
          ) : (
            <div className="space-y-3">
              {enrolments.map((e) => (
                <div key={e.id} className="rounded-lg border p-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-sm">{e.plan?.name ?? e.planName ?? "Plan details unavailable"}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Plan year {e.planYear} · {e.coverageFrom ?? "—"} to {e.coverageTo ?? "—"} ·{" "}
                      {e.dependantIds.length > 0
                        ? `${e.dependantIds.length} dependant${e.dependantIds.length === 1 ? "" : "s"} covered`
                        : "no dependants covered"}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right text-xs">
                      <p className="text-muted-foreground">You pay ₹{e.employeeCost.toLocaleString()}</p>
                      <p className="text-muted-foreground">Employer pays ₹{e.employerCost.toLocaleString()}</p>
                    </div>
                    <Badge variant={e.status === "waived" || e.status === "terminated" ? "secondary" : "default"}>
                      {humanize(e.status)}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> Dependants</CardTitle>
        </CardHeader>
        <CardContent>
          {!viewed.isSelf ? (
            <div className="flex items-start gap-2 text-sm text-muted-foreground py-2">
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <p>
                Dependant records are only ever returned for the signed-in account —
                <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">/api/benefits/dependants</code>
                has no lookup for another employee, by design. View this employee&apos;s own account to see who they have registered.
              </p>
            </div>
          ) : dependants.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No dependants registered yet.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {dependants.map((d) => (
                <div key={d.id} className="rounded-lg border p-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{d.fullName}</p>
                    <p className="text-xs text-muted-foreground">{humanize(d.relation)}</p>
                  </div>
                  {d.isNominee && <Badge variant="secondary" className="text-xs">Nominee{d.nomineeSharePercent ? ` · ${d.nomineeSharePercent}%` : ""}</Badge>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Receipt className="h-4 w-4" /> Claims</CardTitle>
        </CardHeader>
        <CardContent>
          {claims.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No claims on file.</p>
          ) : (
            <div className="space-y-2">
              {claims.map((c) => (
                <div key={c.id} className="rounded-lg border p-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <div>
                    <p className="font-medium">{c.claimNumber}</p>
                    <p className="text-xs text-muted-foreground">Incident on {c.incidentDate}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      ₹{c.claimedAmount.toLocaleString()}{c.approvedAmount !== undefined ? ` · ₹${c.approvedAmount.toLocaleString()} approved` : ""}
                    </span>
                    <Badge variant="secondary">{humanize(c.status)}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* There is no in-app plan editor: `NeonBenefitsRepository` exposes no
          create/update for `benefitPlans`, and no route accepts one. The old
          page's "Add Plan" dialog wrote a document into `policies` that this
          page never read back — saying that plainly here beats resurrecting
          a dialog that would do the same thing again under a real table's
          name. */}
      <div className="rounded-lg border border-dashed p-4 flex items-start gap-3 text-sm text-muted-foreground">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <p>Plan creation and editing has no in-app screen yet — plans are configured directly against the <code className="rounded bg-muted px-1 py-0.5 text-xs">benefit_plans</code> table. This page reads and displays what is already configured there.</p>
      </div>
    </div>
  );
}

function PageHeader({
  privileged, lookupInput, setLookupInput, onLookup, onReset, viewed,
}: {
  privileged: boolean;
  lookupInput: string;
  setLookupInput: (v: string) => void;
  onLookup: () => void;
  onReset: () => void;
  viewed: { employeeId: string; isSelf: boolean };
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Benefits</h1>
          <p className="text-muted-foreground mt-1">Plans, enrolments, dependants and claims for a specific employee</p>
        </div>
      </div>

      {privileged && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="benefits-lookup" className="text-xs">Look up an employee by id</Label>
            <div className="relative w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="benefits-lookup"
                placeholder="Employee id (UUID)"
                value={lookupInput}
                onChange={(e) => setLookupInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") onLookup(); }}
                className="pl-9"
              />
            </div>
          </div>
          <Button variant="outline" onClick={onLookup}>View</Button>
          {!viewed.isSelf && <Button variant="ghost" onClick={onReset}>Back to my own</Button>}
        </div>
      )}

      {!viewed.isSelf && (
        <div className="rounded-lg bg-muted/50 px-4 py-2 text-sm text-muted-foreground">
          Viewing benefits for employee <code className="rounded bg-muted px-1 py-0.5 text-xs">{viewed.employeeId}</code>, not your own.
        </div>
      )}
    </div>
  );
}
