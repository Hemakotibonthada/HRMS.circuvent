"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useHrmsPortal } from "@/components/hrms-portal-provider";
import { useAuth } from "@/hooks/use-auth";
import { HRMS_PORTALS, portalAllowsModule } from "@/lib/hrms-portals";
import { MODULES } from "@/lib/constants";
import { navigationGroups } from "@/lib/hrms-navigation";

export default function WorkspacePage() {
  const portal = useHrmsPortal();
  const { user } = useAuth();
  const [selected, setSelected] = useState("all");
  const [query, setQuery] = useState("");

  const groups = navigationGroups(portal, user?.role ?? "");
  const selectedGroup = groups.find((group) => group.id === selected);
  const definition = HRMS_PORTALS[portal];

  const modules = MODULES.filter(
    (m) =>
      m.id !== "dashboard" &&
      portalAllowsModule(portal, m.href.slice(1), user?.role ?? ""),
  );

  const priorities =
    portal === "hr"
      ? ["employees", "attendance", "leave", "onboarding", "payroll", "interns"]
      : portal === "manager"
        ? ["leave", "attendance", "employees", "performance", "reports", "expenses"]
        : portal === "intern"
          ? ["attendance", "leave", "training", "timesheets", "goals", "mydocuments"]
          : ["selfservice", "attendance", "leave", "payslip", "mydocuments", "benefits"];

  const quick = priorities.flatMap((id) => modules.filter((m) => m.id === id));
  const firstName = user?.displayName?.trim().split(/\s+/)[0] || "there";

  const searchGroups = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return groups;
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter(
          (item) =>
            item.name.toLowerCase().includes(term) ||
            item.description?.toLowerCase().includes(term),
        ),
      }))
      .filter(
        (group) =>
          group.label.toLowerCase().includes(term) ||
          group.description.toLowerCase().includes(term) ||
          group.items.length > 0,
      );
  }, [groups, query]);

  const selectedItems = useMemo(() => {
    if (!selectedGroup) return [];
    const term = query.trim().toLowerCase();
    if (!term) return selectedGroup.items;
    return selectedGroup.items.filter(
      (item) =>
        item.name.toLowerCase().includes(term) ||
        item.description?.toLowerCase().includes(term),
    );
  }, [selectedGroup, query]);

  return (
    <div className="min-h-full bg-background text-foreground">
      <div className="mx-auto w-full max-w-[1480px] px-5 py-6 sm:px-7 lg:px-10 lg:py-8">
        {/* Compact product-style welcome */}
        <section className="relative overflow-hidden rounded-[26px] bg-primary text-primary-foreground shadow-lg">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-black/10" />
          <div className="relative grid min-h-[250px] items-center gap-8 px-7 py-8 sm:px-9 lg:grid-cols-[1fr_auto] lg:px-11 lg:py-10">
            <div className="max-w-3xl">
              <div className="mb-5 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full border border-primary-foreground/20 bg-primary-foreground/10 px-3 py-1.5 font-semibold backdrop-blur">
                  {definition.name}
                </span>
                <span className="inline-flex items-center gap-1.5 text-primary-foreground/80">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Secure employee workspace
                </span>
              </div>

              <h1 className="text-3xl font-bold tracking-[-0.035em] sm:text-[42px] sm:leading-[1.08]">
                Welcome back, {firstName}.
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-primary-foreground/85 sm:text-[15px]">
                Everything you need for your workday — attendance, leave, documents,
                payroll and employee services — in one place.
              </p>

              <div className="mt-6 flex flex-wrap gap-3">
                {quick[0] && (
                  <Link
                    href={quick[0].href}
                    className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold !text-slate-950 shadow-sm transition hover:-translate-y-0.5 hover:bg-white/90"
                  >
                    {quick[0].name}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                )}
                <a
                  href="#tools"
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-primary-foreground/20 bg-primary-foreground/10 px-4 text-sm font-semibold text-primary-foreground backdrop-blur transition hover:bg-primary-foreground/15"
                >
                  View all tools
                  <ChevronRight className="h-4 w-4" />
                </a>
              </div>
            </div>

            <div className="hidden min-w-[300px] rounded-[22px] border border-primary-foreground/15 bg-black/10 p-5 backdrop-blur-xl lg:block">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-primary-foreground/75">Account status</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-100">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                  Active
                </span>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-primary-foreground/60">
                    Role
                  </p>
                  <p className="mt-1.5 truncate text-sm font-semibold">{user?.role || "Employee"}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-primary-foreground/60">
                    Portal
                  </p>
                  <p className="mt-1.5 truncate text-sm font-semibold">{definition.name}</p>
                </div>
              </div>
              <div className="mt-5 border-t border-primary-foreground/10 pt-4 text-xs text-primary-foreground/70">
                Access automatically follows your organization and assigned role.
              </div>
            </div>
          </div>
        </section>

        {/* Action strip - intentionally not a wall of large cards */}
        <section className="mt-9" aria-labelledby="essentials">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 id="essentials" className="text-xl font-bold tracking-tight">
                Quick actions
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Jump straight into the tasks you use most.
              </p>
            </div>
            <span className="hidden text-xs font-medium text-muted-foreground sm:block">
              {quick.length} available
            </span>
          </div>

          <div className="overflow-hidden rounded-[22px] border border-border bg-card shadow-sm">
            <div className="grid sm:grid-cols-2 xl:grid-cols-3">
              {quick.map((module, index) => (
                <Link
                  key={module.id}
                  href={module.href}
                  className={[
                    "group flex min-h-[108px] items-center gap-4 p-5 transition hover:bg-muted/50",
                    index % 3 !== 2 ? "xl:border-r xl:border-border" : "",
                    index < 3 ? "xl:border-b xl:border-border" : "",
                    index % 2 === 0 ? "sm:border-r sm:border-border xl:border-r" : "",
                    index < quick.length - 2 ? "sm:border-b sm:border-border" : "",
                  ].join(" ")}
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <module.icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{module.name}</span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                      {module.description}
                    </span>
                  </span>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* Main workspace: left section navigation + right tools */}
        <section id="tools" className="mt-9" aria-labelledby="workspace-heading">
          <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="workspace-heading" className="text-xl font-bold tracking-tight">
                My workspace
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Find every HR service available to your account.
              </p>
            </div>

            <label className="relative block w-full sm:w-[330px]">
              <span className="sr-only">Search workspace</span>
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                type="search"
                placeholder="Search tools"
                className="h-11 w-full rounded-xl border border-border bg-card pl-10 pr-4 text-sm shadow-sm outline-none placeholder:text-muted-foreground focus:border-primary/50 focus:ring-4 focus:ring-primary/10"
              />
            </label>
          </div>

          <div className="overflow-hidden rounded-[24px] border border-border bg-card shadow-sm lg:grid lg:grid-cols-[250px_1fr]">
            <aside className="border-b border-border bg-muted/25 p-3 lg:border-b-0 lg:border-r">
              <nav className="flex gap-1 overflow-x-auto lg:block lg:space-y-1">
                <button
                  type="button"
                  onClick={() => setSelected("all")}
                  className={`flex shrink-0 items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-medium transition lg:w-full ${!selectedGroup
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-background hover:text-foreground"
                    }`}
                >
                  <Sparkles className="h-4 w-4" />
                  Overview
                </button>
                {groups.map((group) => (
                  <button
                    type="button"
                    key={group.id}
                    onClick={() => setSelected(group.id)}
                    className={`flex shrink-0 items-center justify-between gap-3 rounded-xl px-3.5 py-3 text-sm font-medium transition lg:w-full ${selectedGroup?.id === group.id
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-background hover:text-foreground"
                      }`}
                  >
                    <span className="truncate">{group.label}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] ${selectedGroup?.id === group.id
                          ? "bg-primary-foreground/15 text-current"
                          : "bg-background text-muted-foreground"
                        }`}
                    >
                      {group.items.length}
                    </span>
                  </button>
                ))}
              </nav>
            </aside>

            <div className="min-w-0 p-5 sm:p-6 lg:p-8">
              {!selectedGroup ? (
                <>
                  <div className="mb-6">
                    <p className="text-xs font-semibold uppercase tracking-[.14em] text-primary">
                      All sections
                    </p>
                    <h3 className="mt-1.5 text-lg font-bold">Explore your employee services</h3>
                  </div>

                  {searchGroups.length ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      {searchGroups.map((group) => (
                        <button
                          type="button"
                          key={group.id}
                          onClick={() => setSelected(group.id)}
                          className="group flex min-h-[116px] items-center gap-4 rounded-2xl border border-border bg-background p-5 text-left transition hover:border-primary/30 hover:bg-muted/30 hover:shadow-sm"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <h4 className="truncate text-sm font-semibold">{group.label}</h4>
                              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                {group.items.length}
                              </span>
                            </div>
                            <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
                              {group.description}
                            </p>
                            <p className="mt-3 truncate text-[11px] text-muted-foreground">
                              {group.items.slice(0, 3).map((item) => item.name).join(" · ")}
                            </p>
                          </div>
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition group-hover:bg-primary group-hover:text-primary-foreground">
                            <ChevronRight className="h-4 w-4" />
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <Empty query={query} />
                  )}
                </>
              ) : (
                <>
                  <div className="mb-6 flex items-end justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[.14em] text-primary">
                        Section
                      </p>
                      <h3 className="mt-1.5 text-lg font-bold">{selectedGroup.label}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {selectedGroup.description}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelected("all")}
                      className="hidden text-xs font-semibold text-primary hover:underline sm:block"
                    >
                      View overview
                    </button>
                  </div>

                  {selectedItems.length ? (
                    <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-background">
                      {selectedItems.map((module) => (
                        <Link
                          key={module.id}
                          href={module.href}
                          className="group flex min-h-[82px] items-center gap-4 px-4 py-3.5 transition hover:bg-muted/40 sm:px-5"
                        >
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                            <module.icon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold">{module.name}</span>
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                              {module.description}
                            </span>
                          </span>
                          <span className="hidden text-xs font-medium text-muted-foreground sm:block">
                            Open
                          </span>
                          <ChevronRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <Empty query={query} />
                  )}
                </>
              )}
            </div>
          </div>
        </section>

        <footer className="mt-8 flex flex-col gap-2 border-t border-border py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span className="inline-flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5" />
            Your access is managed by your organization and role.
          </span>
          <span className="inline-flex items-center gap-2">
            <Clock3 className="h-3.5 w-3.5" />
            Circuvent People
          </span>
        </footer>
      </div>
    </div>
  );
}

function Empty({ query }: { query: string }) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/20 px-6 text-center">
      <Search className="h-5 w-5 text-muted-foreground" />
      <p className="mt-3 text-sm font-semibold">No matching tools</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {query ? `Nothing matches “${query}”.` : "There are no tools in this section."}
      </p>
    </div>
  );
}
