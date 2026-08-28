"use client";

// ═══════════════════════════════════════════════════════════════
// MY DOCUMENTS — the letters and pay changes that belong to me
// ═══════════════════════════════════════════════════════════════
// Until now an employee could see their payslips but not the letters behind
// them: the offer they signed, the revision that changed their salary. Those
// are the documents people are actually asked for — by a bank, a landlord, a
// visa application — and getting one meant emailing HR for a copy of a letter
// about yourself.
//
// The compensation history is shown alongside, not instead. A letter is the
// artefact; the history is the answer to "what am I on, and since when",
// which is the question most people arrive with.

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Download, FileText, Loader2, TrendingUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface MyDocument {
  id: string;
  title: string;
  category: string;
  status: string;
  issuedAt: string | null;
  downloadable: boolean;
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

/**
 * Formats an amount held in minor units.
 *
 * The value arrives as a string because it is a bigint of paise, and a
 * JavaScript number stops being exact somewhere past ninety lakh rupees.
 * Converting with BigInt keeps the rupee figure right for salaries this
 * company will plausibly pay.
 */
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

/** Human wording for the template categories an employee will actually see. */
function describeCategory(category: string): string {
  const known: Record<string, string> = {
    letter: "Letter",
    offer: "Offer",
    compensation_revision: "Compensation",
    experience_certificate: "Certificate",
  };
  return known[category] ?? category.replace(/_/g, " ");
}

export default function MyDocumentsPage() {
  const [documents, setDocuments] = useState<MyDocument[]>([]);
  const [payChanges, setPayChanges] = useState<MyPayChange[]>([]);
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
      setHasEmployeeRecord(Boolean(data.employeeId));
    } catch (e) {
      // Named rather than swallowed: an empty list and a failed request look
      // identical on screen, and only one of them means "you have no letters".
      setError(e instanceof Error ? e.message : "Could not load your documents.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const download = async (doc: MyDocument) => {
    setDownloading(doc.id);
    setError("");
    try {
      const res = await fetch(`/api/documents/${doc.id}/pdf`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Could not download that document.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = `${doc.title.replace(/[^\w\s.-]/g, "").trim() || "document"}.pdf`;
      window.document.body.appendChild(link);
      link.click();
      link.remove();
      // Released on a later tick rather than immediately: revoking while the
      // click is still being handled cancels the download in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not download that document.");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">My documents</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          The letters issued to you and the pay changes they record. These are the
          documents a bank or a landlord usually asks for.
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
          Your account is not linked to an employee record, so there are no letters to
          show. If you believe that is wrong, ask HR to check your profile.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4" />
            Compensation history
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </p>
          ) : payChanges.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No salary changes have been recorded against your profile yet.
            </p>
          ) : (
            <div className="divide-y">
              {payChanges.map((change) => (
                <div key={change.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {formatMinor(change.previousAnnual, change.currency)}
                      <span className="mx-2 text-muted-foreground">→</span>
                      {formatMinor(change.newAnnual, change.currency)}
                      <span className="ml-2 text-xs text-muted-foreground">a year</span>
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4" />
            Letters issued to me
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </p>
          ) : documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No letters have been issued to you yet. Letters appear here once HR sends
              them; one still being drafted is not shown.
            </p>
          ) : (
            <div className="divide-y">
              {documents.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{doc.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {describeCategory(doc.category)} · issued {formatDate(doc.issuedAt)}
                    </p>
                  </div>
                  <div className="shrink-0">
                    {doc.downloadable ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={downloading === doc.id}
                        onClick={() => download(doc)}
                      >
                        {downloading === doc.id ? (
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="mr-1 h-3.5 w-3.5" />
                        )}
                        PDF
                      </Button>
                    ) : (
                      // Said plainly rather than shown as a button that fails.
                      // The PDF is archived by a background job that may not
                      // have run yet.
                      <span className="text-[11px] text-muted-foreground">
                        PDF not ready yet
                      </span>
                    )}
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
