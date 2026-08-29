"use client";

// ═══════════════════════════════════════════════════════════════
// BULK EMPLOYEE IMPORT — upload, map, preview, commit
// ═══════════════════════════════════════════════════════════════
// Only new UI page owned by this feature; not linked from the existing
// Employees page (`(dashboard)/employees/page.tsx` is outside this feature's
// file ownership) — reachable today by navigating to `/employees/import`
// directly. See the session report for why that link was not added.
//
// Deliberately re-runs `/preview` on every mapping edit rather than keeping a
// separate "draft" mapping the user edits before pressing an explicit
// "update preview" button: with only a handful of columns in a typical
// roster export, a Select's `onValueChange` is a discrete action, not a
// keystroke stream, so there is no debouncing problem to solve, and folding
// the two states into one means the mapping shown on screen is always
// provably the one a "Commit" click will use — there is no way for the
// committed mapping to be a stale edit the user forgot to re-preview.

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Download,
  Shield,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { useRBAC } from "@/hooks/use-rbac";
import type { CanonicalRow, ImportField, RejectedRow, SkippedRow } from "@/lib/employee-import";

interface FieldOption {
  value: ImportField;
  label: string;
  required: boolean;
}

interface PreviewResponse {
  headers: string[];
  mapping: (ImportField | null)[];
  fieldOptions: FieldOption[];
  missingRequired: string[];
  rowCount: number;
  plan: { toCreate: CanonicalRow[]; toSkip: SkippedRow[]; toReject: RejectedRow[] } | null;
}

interface CommitResponse {
  created: { id: string; employeeCode: string; firstName: string; lastName: string; workEmail: string }[];
  createdCount: number;
  skipped: SkippedRow[];
  rejected: RejectedRow[];
}

/** Reads `{error}` from a failed response, falling back to the status code when the body is not JSON. */
async function readApiError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return body.error || `Request failed (${response.status})`;
}

function triggerCsvDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function EmployeeImportPage() {
  const rbac = useRBAC();

  const [file, setFile] = useState<File | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [result, setResult] = useState<CommitResponse | null>(null);
  const [bucket, setBucket] = useState<"create" | "skip" | "reject">("create");

  function reset() {
    setFile(null);
    setPreview(null);
    setResult(null);
    setBucket("create");
  }

  /**
   * Re-runs the dry run against `nextMapping` (or lets the server suggest one,
   * on the very first call for a freshly chosen file).
   *
   * Always sends the file again rather than caching a server-side session for
   * it: the route is stateless by design (see `_lib.ts`), so a Neon cold
   * start, a redeploy between calls, or simply opening the page in a second
   * tab can never leave this screen pointed at a plan the server has no
   * record of.
   */
  async function runPreview(pickedFile: File, nextMapping?: (ImportField | null)[]) {
    setPreviewing(true);
    try {
      const form = new FormData();
      form.append("file", pickedFile);
      if (nextMapping) form.append("mapping", JSON.stringify(nextMapping));

      const response = await fetch("/api/employees/import/preview", {
        method: "POST",
        credentials: "include",
        body: form,
      });

      if (!response.ok) {
        toast.error(await readApiError(response));
        return;
      }

      const body = (await response.json()) as PreviewResponse;
      setPreview(body);
    } catch {
      toast.error("Could not reach the server. Check your connection and try again.");
    } finally {
      setPreviewing(false);
    }
  }

  function handleFileChosen(picked: File | null) {
    reset();
    if (!picked) return;
    setFile(picked);
    void runPreview(picked);
  }

  function handleMappingChange(columnIndex: number, field: ImportField | null) {
    if (!preview || !file) return;
    const nextMapping = [...preview.mapping];
    nextMapping[columnIndex] = field;
    void runPreview(file, nextMapping);
  }

  async function runCommit() {
    if (!file || !preview) return;
    setCommitting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("mapping", JSON.stringify(preview.mapping));

      const response = await fetch("/api/employees/import/commit", {
        method: "POST",
        credentials: "include",
        body: form,
      });

      if (!response.ok) {
        toast.error(await readApiError(response));
        return;
      }

      const body = (await response.json()) as CommitResponse;
      setResult(body);
      toast.success(
        body.createdCount > 0
          ? `Created ${body.createdCount} employee${body.createdCount === 1 ? "" : "s"}`
          : "Nothing new to create — every row already existed or needed fixing"
      );
    } catch {
      toast.error("Could not reach the server. The import was not committed.");
    } finally {
      setCommitting(false);
      setConfirmOpen(false);
    }
  }

  async function downloadTemplate(format: "xlsx" | "csv" = "xlsx") {
    try {
      const response = await fetch(`/api/employees/import/template?format=${format}`, {
        credentials: "include",
      });
      if (!response.ok) {
        toast.error(await readApiError(response));
        return;
      }
      const blob = await response.blob();
      triggerCsvDownload(blob, `employee-import-template.${format}`);
      toast.success(`Downloaded employee import template (.${format})`);
    } catch {
      toast.error("Could not download the template.");
    }
  }

  async function downloadErrors(toReject: RejectedRow[], toSkip: SkippedRow[]) {
    try {
      const response = await fetch("/api/employees/import/errors", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toReject, toSkip }),
      });
      if (!response.ok) {
        toast.error(await readApiError(response));
        return;
      }
      triggerCsvDownload(await response.blob(), "employee-import-errors.csv");
    } catch {
      toast.error("Could not build the error report.");
    }
  }

  // Enforced again server-side on every route in this feature — this only
  // spares someone without the permission a wizard they cannot finish.
  if (!rbac.roleLoading && !rbac.canAny(["employees.create"])) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <Shield className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">You don&apos;t have permission to import employees.</p>
            <p className="text-sm text-muted-foreground">
              This action is restricted to owners, admins and HR. Ask one of them to run the import,
              or to grant you access.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Import Employees</h1>
        <p className="text-sm text-muted-foreground">
          Upload a spreadsheet of your existing staff. Download the template below, modify it with your employee data, and upload it to review a preview before committing.
        </p>
      </div>

      {/* ── 1. Upload & Download Template ── */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-violet-600" /> 1. Choose a file or download template
            </CardTitle>
            <CardDescription>.xlsx or .csv, up to 2,000 rows and 8MB. Includes all onboarding &amp; employee profile fields.</CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950/50"
              onClick={() => downloadTemplate("xlsx")}
            >
              <Download className="h-3.5 w-3.5" /> Download Excel (.xlsx)
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={() => downloadTemplate("csv")}
            >
              <Download className="h-3.5 w-3.5" /> CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <input
            type="file"
            accept=".xlsx,.csv"
            className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-primary-foreground file:text-sm file:font-medium hover:file:opacity-90"
            onChange={(e) => handleFileChosen(e.target.files?.[0] ?? null)}
          />
          {file && (
            <Button variant="ghost" size="sm" onClick={reset} className="gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" /> Start over
            </Button>
          )}
        </CardContent>
      </Card>

      {previewing && !preview && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading {file?.name}…
        </div>
      )}

      {/* ── Mapping ── */}
      {preview && !result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Check the column mapping</CardTitle>
            <CardDescription>
              {preview.rowCount} data row{preview.rowCount === 1 ? "" : "s"} found. Fix anything the
              guess below got wrong before continuing — required fields are marked with *.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {preview.missingRequired.length > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>Map a column to each of: {preview.missingRequired.join(", ")}</span>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              {preview.headers.map((header, i) => (
                <div key={`${header}-${i}`} className="flex items-center justify-between gap-3 rounded-lg border p-2.5">
                  <span className="text-sm font-medium truncate" title={header}>
                    {header || <span className="italic text-muted-foreground">(blank header)</span>}
                  </span>
                  <Select
                    value={preview.mapping[i] ?? "__unmapped__"}
                    onValueChange={(v) =>
                      handleMappingChange(i, v === "__unmapped__" ? null : (v as ImportField))
                    }
                    disabled={previewing}
                  >
                    <SelectTrigger className="w-52 h-9 shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__unmapped__">Ignore this column</SelectItem>
                      {preview.fieldOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                          {opt.required ? " *" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Dry-run preview ── */}
      {preview?.plan && !result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">3. Review the dry run</CardTitle>
            <CardDescription>
              Nothing has been written yet. This is exactly what committing will do.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge className="status-active gap-1"><CheckCircle2 className="h-3 w-3" /> {preview.plan.toCreate.length} to create</Badge>
              <Badge className="status-pending gap-1"><AlertTriangle className="h-3 w-3" /> {preview.plan.toSkip.length} to skip</Badge>
              <Badge className="status-rejected gap-1"><XCircle className="h-3 w-3" /> {preview.plan.toReject.length} to reject</Badge>
            </div>

            <Tabs value={bucket} onValueChange={(v) => setBucket(v as "create" | "skip" | "reject")}>
              <TabsList>
                <TabsTrigger value="create">Will create ({preview.plan.toCreate.length})</TabsTrigger>
                <TabsTrigger value="skip">Will skip ({preview.plan.toSkip.length})</TabsTrigger>
                <TabsTrigger value="reject">Will reject ({preview.plan.toReject.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="create" className="mt-3">
                <BucketTable
                  rows={preview.plan.toCreate}
                  empty="No rows are ready to create."
                  columns={[
                    "Row",
                    "Name",
                    "Work Email",
                    "Phone",
                    "Join Date",
                    "Designation",
                    "Department",
                    "Location",
                    "Manager",
                    "Annual CTC",
                  ]}
                  render={(r) => [
                    r.rowNumber,
                    `${r.firstName} ${r.lastName}`,
                    r.workEmail,
                    r.phone || "—",
                    r.joinDate,
                    r.designation,
                    r.department || "—",
                    r.location || "—",
                    r.reportingManager || "—",
                    r.annualCtc && !isNaN(Number(r.annualCtc.replace(/[^0-9.]/g, "")))
                      ? `₹${Number(r.annualCtc.replace(/[^0-9.]/g, "")).toLocaleString("en-IN")}`
                      : "—",
                  ]}
                />
              </TabsContent>

              <TabsContent value="skip" className="mt-3">
                <BucketTable
                  rows={preview.plan.toSkip}
                  empty="No rows will be skipped."
                  columns={["Row", "Work Email", "Why"]}
                  render={(r) => [r.rowNumber, r.workEmail, r.reasons.join("; ")]}
                />
              </TabsContent>

              <TabsContent value="reject" className="mt-3">
                <BucketTable
                  rows={preview.plan.toReject}
                  empty="No rows will be rejected."
                  columns={["Row", "Work Email", "Problems"]}
                  render={(r) => [r.rowNumber, r.raw.workEmail || "—", r.reasons.join("; ")]}
                />
              </TabsContent>
            </Tabs>

            <div className="flex items-center gap-2 pt-2">
              <Button
                onClick={() => setConfirmOpen(true)}
                disabled={preview.plan.toCreate.length === 0 || committing || previewing}
              >
                Commit import
              </Button>
              {(preview.plan.toReject.length > 0 || preview.plan.toSkip.length > 0) && (
                <Button
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => downloadErrors(preview.plan!.toReject, preview.plan!.toSkip)}
                >
                  <Download className="h-3.5 w-3.5" /> Download error report
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Result ── */}
      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Import complete
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge className="status-active">{result.createdCount} created</Badge>
              <Badge className="status-pending">{result.skipped.length} skipped</Badge>
              <Badge className="status-rejected">{result.rejected.length} rejected</Badge>
            </div>

            {result.created.length > 0 && (
              <BucketTable
                rows={result.created}
                empty=""
                columns={["Code", "Name", "Work Email"]}
                render={(r) => [r.employeeCode, `${r.firstName} ${r.lastName}`, r.workEmail]}
              />
            )}

            <div className="flex items-center gap-2 pt-2">
              {(result.rejected.length > 0 || result.skipped.length > 0) && (
                <Button
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => downloadErrors(result.rejected, result.skipped)}
                >
                  <Download className="h-3.5 w-3.5" /> Download error report
                </Button>
              )}
              <Button variant="outline" className="gap-1.5" onClick={reset}>
                <Upload className="h-3.5 w-3.5" /> Import another file
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Commit this import?</DialogTitle>
            <DialogDescription>
              {preview?.plan
                ? `This will create ${preview.plan.toCreate.length} employee${
                    preview.plan.toCreate.length === 1 ? "" : "s"
                  }. ${preview.plan.toSkip.length} row${
                    preview.plan.toSkip.length === 1 ? "" : "s"
                  } already exist and will be skipped, and ${preview.plan.toReject.length} row${
                    preview.plan.toReject.length === 1 ? "" : "s"
                  } will be rejected. This cannot be undone from this screen.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={committing}>
              Cancel
            </Button>
            <Button onClick={runCommit} disabled={committing} className="gap-1.5">
              {committing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Yes, commit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** One small generic table, shared by every bucket — the three buckets differ only in which columns matter. */
function BucketTable<T>({
  rows,
  columns,
  render,
  empty,
}: {
  rows: T[];
  columns: string[];
  render: (row: T) => (string | number)[];
  empty: string;
}) {
  if (rows.length === 0) {
    return empty ? <p className="text-sm text-muted-foreground py-4">{empty}</p> : null;
  }

  // Capped in the DOM, not in what gets committed: `plan.toCreate` passed to
  // `/commit` is always the full array regardless of how many rows this table
  // renders — this limit exists only so a 2,000-row file does not paint 2,000
  // table rows into the page at once.
  const shown = rows.slice(0, 200);

  return (
    <div className="max-h-96 overflow-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c}>{c}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((row, i) => (
            <TableRow key={i}>
              {render(row).map((cell, j) => (
                <TableCell key={j} className="text-sm">
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length > shown.length && (
        <p className="text-xs text-muted-foreground px-3 py-2 border-t">
          Showing the first {shown.length} of {rows.length} rows.
        </p>
      )}
    </div>
  );
}
