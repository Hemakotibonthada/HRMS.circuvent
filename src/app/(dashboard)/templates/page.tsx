"use client";

// ═══════════════════════════════════════════════════════════════
// DOCUMENT TEMPLATES
// ═══════════════════════════════════════════════════════════════
//
// Every offer, payslip note, interview letter and experience certificate
// this company issues comes from one of the bodies in catalog.ts (or the
// Joining/Appointment/Confirmation/Relieving/Internship-Completion letters
// scripts/seed-letter-templates.mjs seeds) — and until now, changing a
// single sentence in any of them meant a developer editing that file and
// shipping a deploy, for what is fundamentally a wording decision HR or
// legal should be able to make themselves. This screen is that editing
// surface: it lists every template this system knows how to render, and
// links each one to an editor that saves safely (see the editor's own
// header comment for what "safely" means here).
//
// Deliberately not a place to create a new document type from scratch: the
// set of things this company issues is fixed by product/legal decisions
// upstream of this UI, not by whoever is looking at this list. "Customized"
// below means "edited since it shipped", never "invented here" — every row
// traces back to one of the two seeds above.

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertTriangle, FileEdit, FileText, Layers, PenLine, Search, ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DataEmptyState, DataLoadingSkeleton } from "@/components/data-empty-state";
import { listTemplates, type TemplateListItem } from "@/lib/document-templates-client";

/** Mirrors the STATUS_CONF convention in letters/page.tsx: a label plus a
 * badge className per enum value, so a new origin (there is only ever
 * "seed" or "custom" — see the `TemplateOrigin` type) fails loudly with a
 * fallback rather than silently rendering an unstyled badge. */
const ORIGIN_CONF: Record<string, { label: string; className: string }> = {
  seed: { label: "Built-in", className: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400" },
  custom: { label: "Customized", className: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400" },
};

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<TemplateListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listTemplates();
      setTemplates(list);
      setFailed(null);
    } catch (error) {
      // A failed load and "the tenant has no templates" look identical on
      // screen unless the difference is kept — the same lesson letters/page.tsx
      // learned from a 404 that used to hide behind an empty list for months.
      setFailed(error instanceof Error ? error.message : "Could not load templates");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(
      (t) => t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q)
    );
  }, [templates, search]);

  const kpis = [
    { label: "Templates", value: templates.length, icon: Layers, gradient: "from-violet-500 to-purple-600" },
    { label: "Built-in, unedited", value: templates.filter((t) => t.origin === "seed").length, icon: ShieldCheck, gradient: "from-blue-500 to-cyan-500" },
    { label: "Customized", value: templates.filter((t) => t.origin === "custom").length, icon: PenLine, gradient: "from-amber-500 to-orange-500" },
    { label: "Require signature", value: templates.filter((t) => t.requiresSignature).length, icon: FileText, gradient: "from-emerald-500 to-green-600" },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">
            Document Templates
          </h1>
          <p className="text-muted-foreground mt-1">
            Edit the wording of offer letters, payslips and other issued documents — no developer required
          </p>
        </div>
      </div>

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
        <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
          <CardTitle className="text-lg">All templates</CardTitle>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className="pl-8 h-9 w-64"
              placeholder="Search name or category..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <DataLoadingSkeleton />
          ) : failed ? (
            <DataEmptyState
              icon={AlertTriangle}
              title="Templates could not be loaded"
              description={failed}
              actionLabel="Try again"
              onAction={() => void load()}
            />
          ) : filtered.length === 0 ? (
            templates.length === 0 ? (
              <DataEmptyState
                icon={FileText}
                title="No templates found"
                description="Run the template seed scripts (npm run db:seed:templates) to populate the catalog of offer, payslip and letter templates."
              />
            ) : (
              <DataEmptyState
                icon={Search}
                title="No templates match your search"
                description="Try a different name or category."
                actionLabel="Clear search"
                onAction={() => setSearch("")}
              />
            )
          ) : (
            <div className="divide-y">
              {filtered.map((t) => {
                const origin = ORIGIN_CONF[t.origin] ?? { label: t.origin, className: "" };
                return (
                  <div key={t.id} className="flex items-center gap-4 py-3">
                    <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shrink-0">
                      <FileText className="h-4 w-4 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{t.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {t.category}
                        {t.requiresSignature ? " · Requires signature" : ""}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap hidden sm:inline">
                      {t.updatedByEmail
                        ? `Changed by ${t.updatedByEmail} · ${new Date(t.updatedAt).toLocaleDateString()}`
                        : "Never edited — shipped default"}
                    </span>
                    <Badge variant="secondary" className={cn("text-xs shrink-0", origin.className)}>
                      {origin.label}
                    </Badge>
                    <Badge variant="outline" className="text-xs shrink-0">v{t.version}</Badge>
                    <Link href={`/templates/${t.id}`}>
                      <Button size="sm" variant="outline" className="gap-1 shrink-0">
                        <FileEdit className="h-3 w-3" /> Edit
                      </Button>
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
