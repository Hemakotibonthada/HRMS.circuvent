"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { useHrmsPortal } from "@/components/hrms-portal-provider";
import { useAuth } from "@/hooks/use-auth";
import { HRMS_PORTALS, portalAllowsModule } from "@/lib/hrms-portals";
import { MODULES } from "@/lib/constants";
import { navigationGroups } from "@/lib/hrms-navigation";

export default function WorkspacePage() {
  const portal = useHrmsPortal();
  const { user } = useAuth();
  const [selected, setSelected] = useState("all");
  const groups = navigationGroups(portal, user?.role ?? "");
  const selectedGroup = groups.find(group => group.id === selected);
  const definition = HRMS_PORTALS[portal];
  const modules = MODULES.filter(m => m.id !== "dashboard" && portalAllowsModule(portal, m.href.slice(1), user?.role ?? ""));
  const priorities = portal === "hr" ? ["employees", "attendance", "leave", "onboarding", "payroll", "interns"]
    : portal === "manager" ? ["leave", "attendance", "employees", "performance", "reports", "expenses"]
    : portal === "intern" ? ["attendance", "leave", "training", "timesheets", "goals", "mydocuments"]
    : ["selfservice", "attendance", "leave", "payslip", "mydocuments", "benefits"];
  const quick = priorities.flatMap(id => modules.filter(m => m.id === id));
  return <div className="w-full space-y-8 p-5 md:px-8 md:py-8">
    <section className="rounded-2xl border bg-gradient-to-br from-primary/10 via-background to-background p-6 md:p-9">
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">{definition.name}</p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight">Welcome{user?.displayName ? `, ${user.displayName.split(" ")[0]}` : " to your workspace"}</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">{definition.description}</p>
      <p className="mt-6 flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4" />Your organization and access stay linked to your signed-in account.</p>
    </section>
    <section aria-labelledby="quick-actions"><h2 id="quick-actions" className="mb-4 text-lg font-semibold">Your everyday essentials</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{quick.map(m => <Link key={m.id} href={m.href} className="group rounded-xl border bg-card p-5 transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-primary">
        <div className="flex justify-between"><m.icon className="h-6 w-6 text-primary" /><ArrowUpRight className="h-4 w-4 text-muted-foreground" /></div>
        <h3 className="mt-4 font-semibold">{m.name}</h3><p className="mt-1 text-sm text-muted-foreground">{m.description}</p>
      </Link>)}</div>
    </section>
    <section aria-labelledby="all-tools"><h2 id="all-tools" className="mb-4 text-lg font-semibold">Explore your workspace</h2>
      <div aria-label="Filter workspace tools" className="mb-6 flex gap-2 overflow-x-auto pb-2">
        <button onClick={() => setSelected("all")} aria-pressed={!selectedGroup} className="shrink-0 rounded-full border px-4 py-2 text-sm aria-pressed:bg-primary aria-pressed:text-primary-foreground">All sections</button>
        {groups.map(group => <button key={group.id} onClick={() => setSelected(group.id)} aria-pressed={selectedGroup?.id === group.id} className="shrink-0 rounded-full border px-4 py-2 text-sm aria-pressed:bg-primary aria-pressed:text-primary-foreground">{group.label}</button>)}
      </div>
      {!selectedGroup ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{groups.map(group => <button key={group.id} onClick={() => setSelected(group.id)} className="rounded-2xl border bg-card p-6 text-left shadow-sm transition-colors hover:border-primary">
        <span className="text-xs font-medium text-primary">{group.items.length} tools</span>
        <h3 className="mt-3 flex items-center justify-between font-semibold">{group.label}<ArrowUpRight className="h-4 w-4" /></h3>
        <p className="mt-2 text-sm text-muted-foreground">{group.description}</p>
        <p className="mt-5 text-xs leading-relaxed text-muted-foreground">{group.items.slice(0, 3).map(item => item.name).join(" · ")}{group.items.length > 3 ? " · More" : ""}</p>
      </button>)}</div> : <div>
        <p className="mb-4 text-sm text-muted-foreground">{selectedGroup.description}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{selectedGroup.items.map(m => <Link key={m.id} href={m.href} className="flex items-center gap-3 rounded-xl border bg-card p-5 text-sm hover:bg-muted"><m.icon className="h-4 w-4 text-primary" />{m.name}<ArrowUpRight className="ml-auto h-3 w-3" /></Link>)}</div>
      </div>}
    </section>
  </div>;
}
