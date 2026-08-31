"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Briefcase,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Receipt,
  Star,
  TrendingUp,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  EMPLOYMENT_KINDS,
  kindLabel,
  type MyDocumentKind,
} from "@/lib/my-document-kinds";

interface MyDocument {
  id: string;
  title: string;
  category: string;
  kind: MyDocumentKind;
  status: string;
  issuedAt: string | null;
  downloadable: boolean;
  needsSignature: boolean;
}

interface MyPayChange {
  id: string;
  effectiveOn: string;
  previousAnnual: string | null;
  newAnnual: string;
  changePercent: string | null;
  currency: string;
  reason: string;
}

interface MyPayslip {
  id: string;
  periodMonth: number;
  periodYear: number;
  netPayMinor: string;
  currency: string;
  downloadable: boolean;
}

interface MyTaxForm {
  financialYear: number;
  assessmentYear: number;
  monthsCovered: number;
  viewPath: string;
}

interface MyUploadedDocument {
  id: string;
  name: string;
  documentType: string;
  uploadedAt: string;
  downloadable: boolean;
}

interface MyAppraisal {
  id: string;
  cycleName: string;
  periodStart: string;
  periodEnd: string;
  finalRating: string | null;
  managerRating: string | null;
  submittedAt: string | null;
  viewPath: string;
}

function formatMinor(minor: string | null, currency: string): string {
  if (minor === null) return "—";
  try {
    const units = BigInt(minor) / 100n;
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currency || "INR",
      maximumFractionDigits: 0,
    }).format(Number(units));
  } catch {
    return "—";
  }
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

function monthLabel(month: number, year: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

async function downloadBlob(res: Response, filename: string) {
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = filename;
  window.document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function LetterRow({
  doc,
  downloading,
  onDownload,
}: {
  doc: MyDocument;
  downloading: string | null;
  onDownload: (doc: MyDocument) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{doc.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {kindLabel(doc.kind)} · issued {formatDate(doc.issuedAt)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {doc.needsSignature && (
          <Badge variant="outline" className="text-[10px] font-normal">
            Signature pending — use the link in your email
          </Badge>
        )}
        {doc.downloadable ? (
          <Button
            variant="outline"
            size="sm"
            disabled={downloading === `letter-${doc.id}`}
            onClick={() => onDownload(doc)}
          >
            {downloading === `letter-${doc.id}` ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="mr-1 h-3.5 w-3.5" />
            )}
            PDF
          </Button>
        ) : (
          <span className="text-[11px] text-muted-foreground">
            {doc.needsSignature ? "PDF after signing" : "PDF not ready yet"}
          </span>
        )}
      </div>
    </div>
  );
}

export default function MyDocumentsPage() {
  const [documents, setDocuments] = useState<MyDocument[]>([]);
  const [payChanges, setPayChanges] = useState<MyPayChange[]>([]);
  const [payslips, setPayslips] = useState<MyPayslip[]>([]);
  const [taxForms, setTaxForms] = useState<MyTaxForm[]>([]);
  const [uploads, setUploads] = useState<MyUploadedDocument[]>([]);
  const [appraisals, setAppraisals] = useState<MyAppraisal[]>([]);
  const [hasEmployeeRecord, setHasEmployeeRecord] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/me/documents", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load your documents.");
      setDocuments(data.documents ?? []);
      setPayChanges(data.payChanges ?? []);
      setPayslips(data.payslips ?? []);
      setTaxForms(data.taxForms ?? []);
      setUploads(data.uploads ?? []);
      setAppraisals(data.appraisals ?? []);
      setHasEmployeeRecord(Boolean(data.employeeId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your documents.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const employmentLetters = useMemo(
    () => documents.filter((d) => EMPLOYMENT_KINDS.includes(d.kind)),
    [documents]
  );
  const compensationLetters = useMemo(
    () => documents.filter((d) => d.kind === "compensation_letter"),
    [documents]
  );
  const appraisalLetters = useMemo(
    () => documents.filter((d) => d.kind === "appraisal_letter"),
    [documents]
  );
  const otherLetters = useMemo(
    () =>
      documents.filter(
        (d) =>
          !EMPLOYMENT_KINDS.includes(d.kind) &&
          d.kind !== "compensation_letter" &&
          d.kind !== "appraisal_letter"
      ),
    [documents]
  );

  const downloadLetter = async (doc: MyDocument) => {
    setDownloading(`letter-${doc.id}`);
    setError("");
    try {
      const res = await fetch(`/api/documents/${doc.id}/pdf`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Could not download that document.");
      }
      await downloadBlob(
        res,
        `${doc.title.replace(/[^\w\s.-]/g, "").trim() || "document"}.pdf`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not download that document.");
    } finally {
      setDownloading(null);
    }
  };

  const downloadPayslip = async (slip: MyPayslip) => {
    setDownloading(`payslip-${slip.id}`);
    setError("");
    try {
      const res = await fetch(`/api/payroll/payslips/${slip.id}/pdf`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Payslip PDF is not available yet.");
      }
      await downloadBlob(
        res,
        `payslip-${slip.periodYear}-${String(slip.periodMonth).padStart(2, "0")}.pdf`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not download that payslip.");
    } finally {
      setDownloading(null);
    }
  };

  const downloadUpload = async (doc: MyUploadedDocument) => {
    setDownloading(`upload-${doc.id}`);
    setError("");
    try {
      const res = await fetch(`/api/me/documents/${doc.id}/file`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Could not download that file.");
      }
      await downloadBlob(res, doc.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not download that file.");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">My documents</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Joining and appointment letters, compensation revisions, appraisals, payslips, tax
          certificates and other HR files issued to you.
        </p>
      </div>

      {error && (
        <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      {!loading && !hasEmployeeRecord && (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Your account is not linked to an employee record, so there are no documents to show. If
          you believe that is wrong, ask HR to check your profile.
        </p>
      )}

      <Tabs defaultValue="employment" className="space-y-4">
        <TabsList className="flex h-auto flex-wrap gap-1">
          <TabsTrigger value="employment">Employment</TabsTrigger>
          <TabsTrigger value="compensation">Compensation</TabsTrigger>
          <TabsTrigger value="appraisals">Appraisals</TabsTrigger>
          <TabsTrigger value="payslips">Payslips</TabsTrigger>
          <TabsTrigger value="tax">Tax</TabsTrigger>
          <TabsTrigger value="other">Other</TabsTrigger>
        </TabsList>

        <TabsContent value="employment" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Briefcase className="h-4 w-4" />
                Joining, appointment & offer letters
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <LoadingRow />
              ) : employmentLetters.length === 0 ? (
                <EmptyRow text="No employment letters have been issued to you yet." />
              ) : (
                <div className="divide-y">
                  {employmentLetters.map((doc) => (
                    <LetterRow
                      key={doc.id}
                      doc={doc}
                      downloading={downloading}
                      onDownload={downloadLetter}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          {!loading && otherLetters.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Other letters</CardTitle>
              </CardHeader>
              <CardContent className="divide-y">
                {otherLetters.map((doc) => (
                  <LetterRow
                    key={doc.id}
                    doc={doc}
                    downloading={downloading}
                    onDownload={downloadLetter}
                  />
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="compensation" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-4 w-4" />
                Compensation revision letters
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <LoadingRow />
              ) : compensationLetters.length === 0 ? (
                <EmptyRow text="No compensation revision letters yet." />
              ) : (
                <div className="divide-y">
                  {compensationLetters.map((doc) => (
                    <LetterRow
                      key={doc.id}
                      doc={doc}
                      downloading={downloading}
                      onDownload={downloadLetter}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Salary change history</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <LoadingRow />
              ) : payChanges.length === 0 ? (
                <EmptyRow text="No salary changes recorded yet." />
              ) : (
                <div className="divide-y">
                  {payChanges.map((change) => (
                    <div key={change.id} className="flex items-center justify-between gap-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {formatMinor(change.previousAnnual, change.currency)}
                          <span className="mx-2 text-muted-foreground">→</span>
                          {formatMinor(change.newAnnual, change.currency)}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {change.reason} · effective {formatDate(change.effectiveOn)}
                        </p>
                      </div>
                      {change.changePercent && (
                        <Badge variant="secondary" className="shrink-0">
                          {Number(change.changePercent) > 0 ? "+" : ""}
                          {change.changePercent}%
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="appraisals" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Star className="h-4 w-4" />
                Performance appraisals
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <LoadingRow />
              ) : appraisals.length === 0 && appraisalLetters.length === 0 ? (
                <EmptyRow text="Appraisals appear here once a review cycle is completed and published." />
              ) : (
                <div className="divide-y">
                  {appraisals.map((row) => (
                    <div key={row.id} className="flex items-center justify-between gap-4 py-3">
                      <div>
                        <p className="text-sm font-medium">{row.cycleName}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(row.periodStart)} – {formatDate(row.periodEnd)}
                          {row.finalRating
                            ? ` · rating ${row.finalRating}`
                            : row.managerRating
                              ? ` · manager rating ${row.managerRating}`
                              : ""}
                        </p>
                      </div>
                      <Button variant="outline" size="sm" asChild>
                        <Link href={row.viewPath}>
                          <ExternalLink className="mr-1 h-3.5 w-3.5" />
                          View
                        </Link>
                      </Button>
                    </div>
                  ))}
                  {appraisalLetters.map((doc) => (
                    <LetterRow
                      key={doc.id}
                      doc={doc}
                      downloading={downloading}
                      onDownload={downloadLetter}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payslips" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Receipt className="h-4 w-4" />
                Payslips
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <LoadingRow />
              ) : payslips.length === 0 ? (
                <EmptyRow text="No approved payslips yet. They appear here after payroll is released." />
              ) : (
                <div className="divide-y">
                  {payslips.map((slip) => (
                    <div key={slip.id} className="flex items-center justify-between gap-4 py-3">
                      <div>
                        <p className="text-sm font-medium">
                          {monthLabel(slip.periodMonth, slip.periodYear)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Net pay {formatMinor(slip.netPayMinor, slip.currency)}
                        </p>
                      </div>
                      {slip.downloadable ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={downloading === `payslip-${slip.id}`}
                          onClick={() => downloadPayslip(slip)}
                        >
                          {downloading === `payslip-${slip.id}` ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Download className="mr-1 h-3.5 w-3.5" />
                          )}
                          PDF
                        </Button>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">PDF archiving pending</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tax" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                Tax documents (Form 16)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <LoadingRow />
              ) : taxForms.length === 0 ? (
                <EmptyRow text="Form 16 is built from approved payroll. Once a financial year has payroll, it appears here." />
              ) : (
                <div className="divide-y">
                  {taxForms.map((form) => (
                    <div key={form.financialYear} className="flex items-center justify-between gap-4 py-3">
                      <div>
                        <p className="text-sm font-medium">
                          FY {form.financialYear}–{String(form.financialYear + 1).slice(-2)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Assessment year {form.assessmentYear} · {form.monthsCovered} month
                          {form.monthsCovered === 1 ? "" : "s"} of payroll
                        </p>
                      </div>
                      <Button variant="outline" size="sm" asChild>
                        <Link href={form.viewPath}>
                          <ExternalLink className="mr-1 h-3.5 w-3.5" />
                          View
                        </Link>
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="other" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                HR uploads & forms
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <LoadingRow />
              ) : uploads.length === 0 ? (
                <EmptyRow text="No uploaded documents on file yet — ID proofs, contracts and similar files appear here." />
              ) : (
                <div className="divide-y">
                  {uploads.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between gap-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{doc.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {doc.documentType.replace(/_/g, " ")} · uploaded {formatDate(doc.uploadedAt)}
                        </p>
                      </div>
                      {doc.downloadable ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={downloading === `upload-${doc.id}`}
                          onClick={() => downloadUpload(doc)}
                        >
                          {downloading === `upload-${doc.id}` ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Download className="mr-1 h-3.5 w-3.5" />
                          )}
                          Download
                        </Button>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">File unavailable</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function LoadingRow() {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      Loading…
    </p>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground">{text}</p>;
}
