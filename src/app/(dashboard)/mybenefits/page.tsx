"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { UserCheck, Users, Receipt, CalendarClock, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  listPlans,
  listEnrolments,
  listMyDependants,
  listClaims,
  enrichEnrolments,
  plansWithOpenWindows,
  dependantsForEnrolment,
  humanize,
  type EnrichedEnrolment,
  type Dependant,
  type ClaimRecord,
  type OpenWindow,
} from "@/lib/benefits-client";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

// ═══════════════════════════════════════════════════════════════
// MY BENEFITS — an employee's own plans, cover, dependants and
// open enrolment windows, in one place.
// ═══════════════════════════════════════════════════════════════
// The founder's requirement was blunt: "employee benefits needs to be known
// to employee." There was no route to that fact at all — `/benefits` was an
// HR-shaped page (search, filters, an "Add Plan" dialog) that, on top of
// writing to the wrong collection, never had a version an employee could
// read about themselves; and it had no `useEffect`, so even HR never saw
// real data there. This page is the missing read, built the same way
// `src/app/(dashboard)/payslip/page.tsx` reads an employee's own payroll:
// every call below is self-scoped by construction — `listPlans()`,
// `listEnrolments()` and `listClaims()` are called with no `employeeId`, and
// `listMyDependants()` has no parameter to pass one even by mistake. Nobody
// reading this file needs to be told "don't fetch someone else's benefits",
// because there is nowhere here to put another employee's id.
export default function MyBenefitsPage() {
  const [enrolments, setEnrolments] = useState<EnrichedEnrolment[]>([]);
  const [dependants, setDependants] = useState<Dependant[]>([]);
  const [openWindows, setOpenWindows] = useState<OpenWindow[]>([]);
  const [claims, setClaims] = useState<ClaimRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [plans, enrolmentsResult, dependantList, claimsPage] = await Promise.all([
        listPlans(),
        listEnrolments(),
        listMyDependants(),
        listClaims({ pageSize: 50 }),
      ]);
      setEnrolments(enrichEnrolments(enrolmentsResult.enrolments, plans));
      setDependants(dependantList);
      setOpenWindows(plansWithOpenWindows(plans));
      setClaims(claimsPage.items);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Your benefits could not be loaded");
    } finally {
      setLoading(false);
      setInitialized(true);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  // "Nothing to show" deliberately leaves the plan catalogue out of this
  // check: a list of plans nobody has enrolled in, with no window open to
  // act on, is not a fact about *this* employee — it is the same catalogue
  // every employee would see. What makes the page non-empty is something
  // that actually belongs to them: an enrolment, a dependant, a claim, or a
  // deadline on a window that is currently open.
  const hasAnyData = enrolments.length > 0 || dependants.length > 0 || openWindows.length > 0 || claims.length > 0;

  if (loading && !initialized) return <DataLoadingSkeleton />;

  if (!loading && initialized && !hasAnyData) {
    return (
      <div className="space-y-6 p-6">
        <Header />
        {/* Same distinction src/app/(dashboard)/payroll/page.tsx draws: a
            request that failed must not render identically to a request that
            succeeded and found nothing. An employee looking at this page has
            no other way to tell "I have no benefits" apart from "this is
            broken" — those are different facts and need different text. */}
        {loadError ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-destructive">Your benefits could not be loaded</p>
              <p className="text-sm text-muted-foreground mt-1">{loadError}</p>
            </div>
          </div>
        ) : (
          <DataEmptyState {...EMPTY_STATES.benefits} />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <Header />

      {loadError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-destructive">The last refresh failed</p>
            <p className="text-sm text-muted-foreground mt-1">{loadError} Showing the last data that loaded.</p>
          </div>
        </div>
      )}

      {openWindows.length > 0 && (
        <Card className="border-0 shadow-sm bg-amber-50 dark:bg-amber-950/20">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><CalendarClock className="h-4 w-4" /> Open Enrolment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {openWindows.map((w) => (
              <div key={w.planId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-medium">{w.planName}</span>
                <Badge className={cn(w.daysRemaining >= 0 ? "status-pending" : "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400")}>
                  {w.daysRemaining >= 0
                    ? `Closes in ${w.daysRemaining} day${w.daysRemaining === 1 ? "" : "s"} (${w.closesOn})`
                    : `Closed on ${w.closesOn}`}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><UserCheck className="h-4 w-4" /> My Plans</CardTitle>
        </CardHeader>
        <CardContent>
          {enrolments.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">You are not enrolled in any plan yet.</p>
          ) : (
            <div className="space-y-3">
              {enrolments.map((e) => {
                const covered = dependantsForEnrolment(e, dependants);
                return (
                  <div key={e.id} className="rounded-lg border p-4 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium text-sm">{e.plan?.name ?? e.planName ?? "Plan details unavailable"}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {e.plan ? humanize(e.plan.benefitType) : "—"} · Plan year {e.planYear}
                        </p>
                      </div>
                      <Badge variant={e.status === "waived" || e.status === "terminated" ? "secondary" : "default"}>
                        {humanize(e.status)}
                      </Badge>
                    </div>
                    <Separator />
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div><span className="text-muted-foreground">Coverage: </span><span className="font-medium">{e.plan?.coverageAmount ? `₹${e.plan.coverageAmount.toLocaleString()}` : "—"}</span></div>
                      <div><span className="text-muted-foreground">You pay: </span><span className="font-medium">₹{e.employeeCost.toLocaleString()}</span></div>
                      <div><span className="text-muted-foreground">Employer pays: </span><span className="font-medium">₹{e.employerCost.toLocaleString()}</span></div>
                      <div><span className="text-muted-foreground">Cover period: </span><span className="font-medium">{e.coverageFrom ?? "—"} – {e.coverageTo ?? "—"}</span></div>
                    </div>
                    {covered.length > 0 && (
                      <p className="text-xs text-muted-foreground">Covers: {covered.map((d) => d.fullName).join(", ")}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> My Dependants</CardTitle>
        </CardHeader>
        <CardContent>
          {dependants.length === 0 ? (
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
          <CardTitle className="text-base flex items-center gap-2"><Receipt className="h-4 w-4" /> My Claims</CardTitle>
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
    </div>
  );
}

function Header() {
  return (
    <div>
      <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">My Benefits</h1>
      <p className="text-muted-foreground mt-1">Your plans, cover, dependants and any open enrolment window</p>
    </div>
  );
}
