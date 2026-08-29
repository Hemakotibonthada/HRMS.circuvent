"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarDays, Plus, Search, Sun, Star, Palmtree, Gift, Upload, Download, FileSpreadsheet } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useHolidayStore, startSync, type HolidayDoc } from "@/stores/unified-store";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { COLLECTIONS } from "@/lib/collection-service";
import { SUPPORTED_YEARS, missingFor } from "@/lib/ap-holidays";
import { parseHolidayCsv, parseHolidaySpreadsheet, type ParsedHolidayImport } from "@/lib/holiday-import";

// Dates from the API are plain YYYY-MM-DD. Read without an explicit UTC
// suffix, `new Date("2026-01-26")` is UTC midnight while `toLocaleDateString`
// renders it in the viewer's zone — which puts a holiday on the 25th for
// anyone west of Greenwich. Every read below pins UTC for that reason.
function weekdayOf(iso: string): string {
  if (!iso) return "";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", timeZone: "UTC" });
}

function isWeekend(iso: string): boolean {
  if (!iso) return false;
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function formatDate(iso: string): string {
  if (!iso) return "";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Today as YYYY-MM-DD, so "upcoming" compares two plain dates rather than a date against an instant. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const CSV_PLACEHOLDER = `Ugadi,2027-03-28
Sri Rama Navami,2027-04-15,no,Gazetted
Saturday Off,2027-01-02,no,Weekly Weekend Holiday
Sunday Off,2027-01-03,no,Weekly Weekend Holiday
Bakrid,2027-05-17
Founders Day,2027-07-15,yes,Company shutdown`;

const IMPORTABLE_YEARS = Array.from(
  { length: SUPPORTED_YEARS.last - SUPPORTED_YEARS.first + 1 },
  (_, index) => SUPPORTED_YEARS.first + index
);

export default function HolidaysPage() {
  const store = useHolidayStore();
  const { items, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("list");
  const [kindFilter, setKindFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    if (!initialized) startSync(COLLECTIONS.holidays, store);
  }, [initialized, store]);

  const today = todayIso();

  const filtered = useMemo(() => {
    let result = items;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (h) => (h.name || "").toLowerCase().includes(q) || (h.description || "").toLowerCase().includes(q)
      );
    }
    if (kindFilter === "gazetted") result = result.filter((h) => !h.isOptional);
    if (kindFilter === "optional") result = result.filter((h) => h.isOptional);
    if (kindFilter === "upcoming") result = result.filter((h) => h.holidayDate >= today);
    return [...result].sort((a, b) => (a.holidayDate || "").localeCompare(b.holidayDate || ""));
  }, [items, search, kindFilter, today]);

  const gazetted = items.filter((h) => !h.isOptional).length;
  const optional = items.filter((h) => h.isOptional).length;
  const upcoming = items.filter((h) => h.holidayDate >= today).length;
  const onWeekend = items.filter((h) => isWeekend(h.holidayDate)).length;

  const monthBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const holiday of items) {
      if (!holiday.holidayDate) continue;
      const month = new Date(`${holiday.holidayDate}T00:00:00Z`).toLocaleDateString("en-IN", {
        month: "short",
        timeZone: "UTC",
      });
      map.set(month, (map.get(month) ?? 0) + 1);
    }
    return [...map.entries()].map(([name, count]) => ({ name, count }));
  }, [items]);

  const refresh = () => startSync(COLLECTIONS.holidays, store);

  const handleDownloadTemplate = async (format: "xlsx" | "csv" = "xlsx") => {
    try {
      const response = await fetch(`/api/holidays/template?format=${format}`, {
        credentials: "include",
      });
      if (!response.ok) {
        toast.error("Failed to download template");
        return;
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `holiday-calendar-template.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success(`Downloaded holiday template (.${format})`);
    } catch {
      toast.error("Could not download the template.");
    }
  };

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") ?? "").trim();
    const body = {
      name,
      holidayDate: String(fd.get("holidayDate") ?? ""),
      isOptional: fd.get("kind") === "optional",
      description: String(fd.get("description") ?? "").trim() || undefined,
    };

    try {
      const response = await fetch("/api/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "Failed to add holiday");
      }
      toast.success(`${name} added`);
      setDialogOpen(false);
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add holiday");
    }
  };

  if (loading && !initialized)
    return (
      <div className="p-6">
        <DataLoadingSkeleton />
      </div>
    );

  return (
    <div className="p-6 space-y-6 animate-slide-up">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Holiday Calendar</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {items.length} holidays &middot; {upcoming} upcoming
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950/50 rounded-full h-9 px-4"
            onClick={() => handleDownloadTemplate("xlsx")}
          >
            <Download className="h-4 w-4 shrink-0" />
            <span>Download Template (.xlsx)</span>
          </Button>
          <Button
            variant="outline"
            onClick={() => setImportOpen(true)}
            className="gap-2 rounded-full border-border shadow-sm hover:bg-accent/80 h-9 px-4"
          >
            <Upload className="h-4 w-4 shrink-0" />
            <span>Bulk import</span>
          </Button>
          <Button
            onClick={() => setDialogOpen(true)}
            className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md gap-2 rounded-full h-9 px-4"
          >
            <Plus className="h-4 w-4 shrink-0" />
            <span>Add Holiday</span>
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
        {[
          { label: "Total Holidays", value: items.length, icon: CalendarDays, color: "from-violet-500 to-purple-600" },
          { label: "Gazetted", value: gazetted, icon: Star, color: "from-emerald-500 to-green-600" },
          { label: "Optional", value: optional, icon: Palmtree, color: "from-amber-500 to-orange-500" },
          { label: "Upcoming", value: upcoming, icon: Sun, color: "from-blue-500 to-cyan-500" },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="p-4 flex items-center gap-4">
              <div className={cn("p-3 rounded-xl bg-gradient-to-r text-white", kpi.color)}>
                <kpi.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
                <p className="text-2xl font-bold">{kpi.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {onWeekend > 0 ? (
        <p className="text-xs text-muted-foreground">
          {onWeekend} of these fall on a weekend. Indian public holidays are not moved to the following Monday, so
          they are shown on the day they land.
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search holidays..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={kindFilter} onValueChange={setKindFilter}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All holidays</SelectItem>
            <SelectItem value="gazetted">Gazetted</SelectItem>
            <SelectItem value="optional">Optional</SelectItem>
            <SelectItem value="upcoming">Upcoming</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="list">Holidays</TabsTrigger>
          <TabsTrigger value="analytics">By Month</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-3 mt-4">
          {items.length === 0 && initialized ? (
            <DataEmptyState {...EMPTY_STATES.holidays} onAction={() => setImportOpen(true)} />
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No matching holidays found.</p>
          ) : (
            filtered.map((holiday) => <HolidayRow key={holiday.id} holiday={holiday} today={today} />)
          )}
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          {items.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Holidays by Month</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {monthBreakdown.map((m) => (
                  <div key={m.name} className="flex items-center gap-3">
                    <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm flex-1">{m.name}</span>
                    <span className="font-semibold">{m.count}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : (
            <DataEmptyState {...EMPTY_STATES.holidays} compact onAction={() => setImportOpen(true)} />
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Holiday</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <Label htmlFor="holiday-name">Holiday name</Label>
              <Input id="holiday-name" name="name" required maxLength={200} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="holiday-date">Date</Label>
                <Input id="holiday-date" name="holidayDate" type="date" required />
              </div>
              <div>
                <Label htmlFor="holiday-kind">Kind</Label>
                <Select name="kind" defaultValue="gazetted">
                  <SelectTrigger id="holiday-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gazetted">Gazetted — office closed</SelectItem>
                    <SelectItem value="optional">Optional — chosen from a pool</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="holiday-description">Note</Label>
              <Input id="holiday-description" name="description" maxLength={2000} />
            </div>
            <DialogFooter>
              <Button type="submit" className="bg-gradient-to-r from-violet-500 to-purple-600 text-white">
                Add
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <BulkImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={refresh} />
    </div>
  );
}

function HolidayRow({ holiday, today }: { holiday: HolidayDoc; today: string }) {
  const weekend = isWeekend(holiday.holidayDate);
  const past = holiday.holidayDate < today;

  return (
    <Card className={cn("hover:shadow-sm transition-shadow", past && "opacity-60")}>
      <CardContent className="p-4 flex items-center gap-4">
        <div className="p-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white">
          <Gift className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm">{holiday.name}</p>
          <p className="text-xs text-muted-foreground">
            {formatDate(holiday.holidayDate)} &middot; {weekdayOf(holiday.holidayDate)}
          </p>
          {holiday.description ? (
            <p className="text-xs text-muted-foreground/80 mt-0.5 truncate">{holiday.description}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5 justify-end">
          <Badge className={cn("text-xs", holiday.isOptional ? "status-pending" : "status-active")}>
            {holiday.isOptional ? "Optional" : "Gazetted"}
          </Badge>
          {weekend ? <Badge className="text-xs status-inactive">Weekend</Badge> : null}
        </div>
      </CardContent>
    </Card>
  );
}

interface ImportOutcome {
  imported: number;
  skipped: number;
  skippedHolidays: { name: string; holidayDate: string }[];
  issues: { line: number; text: string; reason: string }[];
}

function BulkImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const [mode, setMode] = useState<"ap-calendar" | "spreadsheet" | "csv">("ap-calendar");
  const [year, setYear] = useState(String(SUPPORTED_YEARS.first));
  const [includeWeekends, setIncludeWeekends] = useState(true);
  const [csv, setCsv] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileBase64, setFileBase64] = useState<string>("");
  const [filePreview, setFilePreview] = useState<ParsedHolidayImport | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);

  const preview = useMemo(() => (mode === "csv" ? parseHolidayCsv(csv) : null), [mode, csv]);
  const stillToConfirm = useMemo(() => missingFor(Number(year) || SUPPORTED_YEARS.first), [year]);

  const handleFileChange = async (selectedFile: File | null) => {
    setFile(selectedFile);
    setFilePreview(null);
    setFileBase64("");
    if (!selectedFile) return;

    try {
      const buffer = Buffer.from(await selectedFile.arrayBuffer());
      const base64 = buffer.toString("base64");
      setFileBase64(base64);
      const parsed = parseHolidaySpreadsheet(buffer, selectedFile.name);
      setFilePreview(parsed);
    } catch {
      toast.error("Could not read the spreadsheet file.");
    }
  };

  const handleDownloadTemplate = async (format: "xlsx" | "csv" = "xlsx") => {
    try {
      const response = await fetch(`/api/holidays/template?format=${format}`, {
        credentials: "include",
      });
      if (!response.ok) {
        toast.error("Failed to download template");
        return;
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `holiday-calendar-template.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success(`Downloaded holiday template (.${format})`);
    } catch {
      toast.error("Could not download the template.");
    }
  };

  const submit = async () => {
    setBusy(true);
    setOutcome(null);
    try {
      let body: unknown;
      if (mode === "ap-calendar") {
        body = { source: "ap-calendar" as const, year: Number(year), includeWeekends };
      } else if (mode === "spreadsheet") {
        if (!fileBase64) throw new Error("Please select a file to import");
        body = { source: "file" as const, fileBase64, filename: file?.name || "holidays.xlsx" };
      } else {
        body = { source: "csv" as const, csv };
      }

      const response = await fetch("/api/holidays/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Import failed");

      setOutcome(payload as ImportOutcome);
      if (payload.imported > 0) {
        toast.success(`Imported ${payload.imported} holiday${payload.imported === 1 ? "" : "s"}`);
        onImported();
      } else {
        toast.info("Nothing new — every one of those was already on the calendar.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  const close = (next: boolean) => {
    if (!next) {
      setOutcome(null);
      setCsv("");
      setFile(null);
      setFileBase64("");
      setFilePreview(null);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bulk import holidays</DialogTitle>
          <DialogDescription>
            Import standard public holidays, weekly weekends (Saturday &amp; Sunday), or upload your custom calendar spreadsheet.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
          <TabsList className="grid grid-cols-3">
            <TabsTrigger value="ap-calendar">Standard Calendar</TabsTrigger>
            <TabsTrigger value="spreadsheet">Upload Spreadsheet</TabsTrigger>
            <TabsTrigger value="csv">Paste a list</TabsTrigger>
          </TabsList>

          {/* TAB 1: Standard & Weekend Calendar */}
          <TabsContent value="ap-calendar" className="space-y-4 mt-4">
            <div>
              <Label htmlFor="import-year">Calendar Year</Label>
              <Select value={year} onValueChange={setYear}>
                <SelectTrigger id="import-year" className="w-40 mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IMPORTABLE_YEARS.map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Saturday & Sunday Holiday Checkbox */}
            <div className="flex items-start space-x-3 rounded-lg border p-3 bg-violet-50/50 dark:bg-violet-950/20 border-violet-200 dark:border-violet-800/60">
              <Checkbox
                id="include-weekends"
                checked={includeWeekends}
                onCheckedChange={(checked) => setIncludeWeekends(!!checked)}
                className="mt-0.5"
              />
              <div className="space-y-1">
                <label htmlFor="include-weekends" className="text-sm font-semibold cursor-pointer text-foreground">
                  Make Saturday and Sunday as weekly holidays
                </label>
                <p className="text-xs text-muted-foreground">
                  Automatically marks all 52 Saturdays and 52 Sundays in {year} as company weekly weekend holidays.
                </p>
              </div>
            </div>

            {stillToConfirm.length > 0 ? (
              <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">
                  {stillToConfirm.length} festival dates require local confirmation
                </p>
                <p>
                  Telugu lunisolar and Islamic moon-sighting festival dates ({stillToConfirm.map((h) => h.name).join(", ")}) can be added under &ldquo;Upload Spreadsheet&rdquo; or &ldquo;Paste a list&rdquo; once the official gazette is notified.
                </p>
              </div>
            ) : null}
          </TabsContent>

          {/* TAB 2: Spreadsheet Upload & Template Download */}
          <TabsContent value="spreadsheet" className="space-y-4 mt-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg border bg-muted/30">
              <div>
                <p className="text-xs font-semibold">Download holiday template</p>
                <p className="text-[11px] text-muted-foreground">Pre-formatted with example rows including holidays and weekends.</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 text-xs border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300"
                  onClick={() => handleDownloadTemplate("xlsx")}
                >
                  <Download className="h-3 w-3" /> Excel (.xlsx)
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => handleDownloadTemplate("csv")}
                >
                  <Download className="h-3 w-3" /> CSV
                </Button>
              </div>
            </div>

            <div>
              <Label htmlFor="holiday-file">Upload Modified Spreadsheet (.xlsx or .csv)</Label>
              <Input
                id="holiday-file"
                type="file"
                accept=".xlsx,.csv"
                className="mt-1.5 cursor-pointer text-xs"
                onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
              />
            </div>

            {filePreview && (
              <div className="rounded-md border border-border p-3 text-xs space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">
                    {filePreview.rows.length} holiday{filePreview.rows.length === 1 ? "" : "s"} found in file
                  </span>
                  {filePreview.issues.length > 0 && (
                    <Badge variant="destructive" className="text-[10px]">
                      {filePreview.issues.length} issue(s) to check
                    </Badge>
                  )}
                </div>
                {filePreview.rows.length > 0 && (
                  <div className="max-h-36 overflow-y-auto space-y-1 divide-y divide-border/40">
                    {filePreview.rows.slice(0, 5).map((r, i) => (
                      <div key={i} className="pt-1 flex items-center justify-between text-muted-foreground">
                        <span className="font-medium text-foreground">{r.name}</span>
                        <span>{r.holidayDate} ({r.isOptional ? "Optional" : "Gazetted / Off"})</span>
                      </div>
                    ))}
                    {filePreview.rows.length > 5 && (
                      <p className="text-[10px] text-muted-foreground pt-1 italic">
                        + {filePreview.rows.length - 5} more holidays
                      </p>
                    )}
                  </div>
                )}
                {filePreview.issues.slice(0, 3).map((issue) => (
                  <p key={issue.line} className="text-destructive text-[11px]">
                    Line {issue.line}: {issue.reason}
                  </p>
                ))}
              </div>
            )}
          </TabsContent>

          {/* TAB 3: Paste a list */}
          <TabsContent value="csv" className="space-y-3 mt-4">
            <div>
              <Label htmlFor="import-csv">One holiday per line</Label>
              <Textarea
                id="import-csv"
                value={csv}
                onChange={(e) => setCsv(e.target.value)}
                rows={7}
                placeholder={CSV_PLACEHOLDER}
                className="font-mono text-xs mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1.5">
                Columns: <code>Name, Date (YYYY-MM-DD), Optional (yes/no), Description</code>
              </p>
            </div>

            {preview && (preview.rows.length > 0 || preview.issues.length > 0) ? (
              <div className="rounded-md border border-border p-3 text-xs space-y-2">
                <p className="font-medium">
                  {preview.rows.length} holiday{preview.rows.length === 1 ? "" : "s"} ready
                  {preview.issues.length > 0 ? `, ${preview.issues.length} line(s) to fix` : ""}
                </p>
                {preview.issues.slice(0, 5).map((issue) => (
                  <p key={issue.line} className="text-destructive">
                    Line {issue.line}: {issue.reason}
                  </p>
                ))}
              </div>
            ) : null}
          </TabsContent>
        </Tabs>

        {outcome ? (
          <div className="rounded-md bg-muted/50 p-3 text-xs space-y-1">
            <p className="font-medium text-foreground">
              Imported {outcome.imported}
              {outcome.skipped > 0 ? `, skipped ${outcome.skipped} already on the calendar` : ""}
            </p>
            {outcome.skippedHolidays.length > 0 ? (
              <p className="text-muted-foreground truncate">
                Already exists: {outcome.skippedHolidays.slice(0, 4).map((h) => `${h.name} (${h.holidayDate})`).join(", ")}
                {outcome.skippedHolidays.length > 4 ? ` + ${outcome.skippedHolidays.length - 4} more` : ""}
              </p>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={busy}>
            Close
          </Button>
          <Button
            onClick={submit}
            disabled={
              busy ||
              (mode === "csv" && (preview?.rows.length ?? 0) === 0) ||
              (mode === "spreadsheet" && (!filePreview || filePreview.rows.length === 0))
            }
            className="bg-gradient-to-r from-violet-500 to-purple-600 text-white"
          >
            {busy ? "Importing…" : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
