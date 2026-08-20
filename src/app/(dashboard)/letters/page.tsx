"use client";

// ═══════════════════════════════════════════════════════════════
// LETTERS
// ═══════════════════════════════════════════════════════════════
//
// Generate an offer, and send it to the person it is for.
//
// What this replaced looked complete and did nothing. It listed twelve
// template names typed into the file, none of which corresponded to a template
// that existed; "Generate Letter" wrote a row into the generic document store
// recording that a letter had been generated — a name, a recipient, a
// timestamp — and never rendered one. Nothing was produced, so nothing could
// be sent, and the history lived in a client store that emptied on reload.
//
// The screen now drives `/api/documents/*`: real templates, a real render, a
// real signing envelope, and an email that actually leaves the building.

import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { FileText, Plus, Send, CheckCircle2, Clock, Copy, AlertTriangle, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { DataEmptyState, DataLoadingSkeleton } from "@/components/data-empty-state";
import {
  checkDraft, describeDelivery, downloadDocumentPdf, generateOffer, listDocuments, listTemplates,
  sendDocument, type DocumentSummary, type OfferDraft, type TemplateSummary,
} from "@/lib/letters-client";
import { ENGAGEMENT_TYPES, ruleFor, type EngagementType } from "@/lib/offer-rules";

const STATUS_CONF: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400" },
  sent: { label: "Sent", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  viewed: { label: "Viewed", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  partially_signed: { label: "Partly signed", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  completed: { label: "Signed", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  declined: { label: "Declined", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  expired: { label: "Expired", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  voided: { label: "Withdrawn", className: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400" },
};

const EMPTY: OfferDraft = {
  engagementType: "full_time",
  templateId: "",
  candidateName: "",
  candidateEmail: "",
  positionTitle: "",
  startDate: "",
  compensation: "",
  hrEmail: "",
};

/** The label the compensation field takes, per engagement. */
const COMPENSATION_LABEL: Record<EngagementType, string> = {
  full_time: "Annual CTC",
  part_time: "Monthly salary",
  internship: "Monthly stipend",
  apprenticeship: "Monthly stipend",
  contract: "Professional fees",
};

export default function LettersPage() {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<OfferDraft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [links, setLinks] = useState<{ email: string; url: string }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, d] = await Promise.all([listTemplates(), listDocuments()]);
      setTemplates(t);
      setDocuments(d);
      setFailed(null);
    } catch (error) {
      // A failed load and an empty tenant look identical on screen unless the
      // difference is kept, which is how "no letters yet" hid a 404 elsewhere
      // in this product for months.
      setFailed(error instanceof Error ? error.message : "Could not load letters");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const rule = ruleFor(draft.engagementType);

  /** Templates that suit the chosen engagement, best match first. */
  const suitable = useMemo(() => {
    const preferred = rule.templateType.replace(/_/g, " ");
    return [...templates].sort((a, b) => {
      const score = (t: TemplateSummary) =>
        t.name.toLowerCase().includes(preferred.replace("offer letter ", "")) ? 0 : 1;
      return score(a) - score(b);
    });
  }, [templates, rule.templateType]);

  const problems = useMemo(() => (open ? checkDraft(draft).problems : []), [draft, open]);
  const problemFor = (field: string) => problems.find((p) => p.field === field)?.message;

  const set = <K extends keyof OfferDraft>(key: K, value: OfferDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const handleGenerate = useCallback(async () => {
    const check = checkDraft(draft);
    if (!check.valid) {
      toast.error(check.problems[0].message);
      return;
    }

    setBusy(true);
    try {
      const document = await generateOffer(draft);
      toast.success("Letter generated");

      const result = await sendDocument(document.id);
      const described = describeDelivery(result);
      if (described.tone === "success") toast.success(described.message);
      else toast.warning(described.message);

      setLinks(result.links.map((l) => ({ email: l.email, url: l.url })));
      if (described.tone === "success") setOpen(false);
      setDraft(EMPTY);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not issue the letter");
    } finally {
      setBusy(false);
    }
  }, [draft, load]);

  const resend = useCallback(async (id: string) => {
    try {
      const result = await sendDocument(id);
      const described = describeDelivery(result);
      if (described.tone === "success") toast.success(described.message);
      else toast.warning(described.message);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send");
    }
  }, [load]);

  const downloadPdf = useCallback(async (doc: DocumentSummary) => {
    try {
      await downloadDocumentPdf(doc.id, doc.title);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not download the PDF");
    }
  }, []);

  const kpis = [
    { label: "Templates", value: templates.length, icon: FileText, gradient: "from-violet-500 to-purple-600" },
    { label: "Issued", value: documents.length, icon: Send, gradient: "from-blue-500 to-cyan-500" },
    { label: "Awaiting signature", value: documents.filter((d) => ["sent", "viewed", "partially_signed"].includes(d.status)).length, icon: Clock, gradient: "from-amber-500 to-orange-500" },
    { label: "Signed", value: documents.filter((d) => d.status === "completed").length, icon: CheckCircle2, gradient: "from-emerald-500 to-green-600" },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Letters</h1>
          <p className="text-muted-foreground mt-1">Issue offers and send them for signature</p>
        </div>
        <Button
          className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2"
          onClick={() => { setDraft(EMPTY); setLinks([]); setOpen(true); }}
          disabled={templates.length === 0}
        >
          <Plus className="h-4 w-4" /> New offer
        </Button>
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

      {links.length > 0 && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" /> Signing links
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Shown once. If email did not go out, send these by hand — they cannot be recovered later.
            </p>
            {links.map((l) => (
              <div key={l.email} className="flex items-center gap-2 text-sm">
                <span className="font-medium min-w-52 truncate">{l.email}</span>
                <code className="flex-1 truncate text-xs bg-background rounded px-2 py-1">{l.url}</code>
                <Button size="sm" variant="outline" className="gap-1"
                  onClick={() => { void navigator.clipboard.writeText(l.url); toast.success("Copied"); }}>
                  <Copy className="h-3 w-3" /> Copy
                </Button>
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setLinks([])}>Dismiss</Button>
          </CardContent>
        </Card>
      )}

      <Card className="border-0 shadow-sm">
        <CardHeader><CardTitle className="text-lg">Issued letters</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <DataLoadingSkeleton />
          ) : failed ? (
            <DataEmptyState
              icon={AlertTriangle}
              title="Letters could not be loaded"
              description={failed}
              actionLabel="Try again"
              onAction={() => void load()}
            />
          ) : documents.length === 0 ? (
            <DataEmptyState
              icon={FileText}
              title="No letters issued yet"
              description="Generate an offer and it will be rendered, sent for signature and tracked here."
              actionLabel={templates.length > 0 ? "New offer" : undefined}
              onAction={templates.length > 0 ? () => setOpen(true) : undefined}
            />
          ) : (
            <div className="divide-y">
              {documents.map((doc) => {
                const conf = STATUS_CONF[doc.status] ?? { label: doc.status, className: "" };
                const signed = doc.signatures.filter((s) => s.signedAt).length;

                return (
                  <div key={doc.id} className="flex items-center gap-4 py-3">
                    <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shrink-0">
                      <FileText className="h-4 w-4 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{doc.title}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {doc.signatures.map((s) => s.email).join(", ") || "No signatories"}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {signed}/{doc.signatures.length} signed
                    </span>
                    <Badge variant="secondary" className={cn("text-xs", conf.className)}>{conf.label}</Badge>
                    {doc.status === "draft" && (
                      <Button size="sm" variant="outline" className="gap-1" onClick={() => void resend(doc.id)}>
                        <Send className="h-3 w-3" /> Send
                      </Button>
                    )}
                    {doc.blobUrl && (
                      <Button size="sm" variant="outline" className="gap-1" onClick={() => void downloadPdf(doc)}>
                        <Download className="h-3 w-3" /> PDF
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New offer</DialogTitle>
            <DialogDescription>
              The letter is rendered from a template and emailed to the candidate with a
              single-use signing link.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Engagement</Label>
                <Select
                  value={draft.engagementType}
                  onValueChange={(v) => set("engagementType", v as EngagementType)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ENGAGEMENT_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{ruleFor(t).label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Template</Label>
                <Select value={draft.templateId} onValueChange={(v) => set("templateId", v)}>
                  <SelectTrigger><SelectValue placeholder="Choose a template" /></SelectTrigger>
                  <SelectContent>
                    {suitable.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {problemFor("templateId") && <p className="text-xs text-red-600">{problemFor("templateId")}</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Candidate name" value={draft.candidateName} onChange={(v) => set("candidateName", v)} error={problemFor("candidateName")} />
              <Field label="Candidate email" type="email" value={draft.candidateEmail} onChange={(v) => set("candidateEmail", v)} error={problemFor("candidateEmail")} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Position" value={draft.positionTitle} onChange={(v) => set("positionTitle", v)} error={problemFor("positionTitle")} />
              <Field label={COMPENSATION_LABEL[draft.engagementType]} value={draft.compensation} onChange={(v) => set("compensation", v)} error={problems.find((p) => p.field.includes("ctc") || p.field.includes("stipend") || p.field.includes("fees") || p.field.includes("salary"))?.message} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Start date" type="date" value={draft.startDate} onChange={(v) => set("startDate", v)} error={problemFor("start_date")} />
              {rule.requiresEndDate && (
                <Field label="End date" type="date" value={draft.endDate ?? ""} onChange={(v) => set("endDate", v)} error={problemFor("engagement_end_date")} />
              )}
              {rule.hasProbation && (
                <Field label="Probation" value={draft.probationPeriod ?? ""} placeholder="6 months" onChange={(v) => set("probationPeriod", v)} error={problemFor("probation_period")} />
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              {draft.engagementType === "internship" && (
                <Field label="Mentor" value={draft.mentorName ?? ""} onChange={(v) => set("mentorName", v)} error={problemFor("mentor_name")} />
              )}
              {draft.engagementType === "apprenticeship" && (
                <Field label="Trade" value={draft.tradeName ?? ""} onChange={(v) => set("tradeName", v)} error={problemFor("trade_name")} />
              )}
              {draft.engagementType === "contract" && (
                <Field label="Payment schedule" value={draft.paymentSchedule ?? ""} placeholder="Monthly, within 15 days of invoice" onChange={(v) => set("paymentSchedule", v)} error={problemFor("payment_schedule")} />
              )}
              {draft.engagementType === "part_time" && (
                <Field label="Weekly hours" value={draft.weeklyHours ?? ""} placeholder="20" onChange={(v) => set("weeklyHours", v)} error={problemFor("weekly_hours")} />
              )}
              {["full_time", "part_time"].includes(draft.engagementType) && (
                <Field label="Reporting manager" value={draft.managerName ?? ""} onChange={(v) => set("managerName", v)} />
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="HR email (counter-signs)" type="email" value={draft.hrEmail} onChange={(v) => set("hrEmail", v)} error={problemFor("hrEmail")} />
              <Field label="Offer open until" type="date" value={draft.offerValidUntil ?? ""} onChange={(v) => set("offerValidUntil", v)} />
            </div>

            {/* Says what the letter will claim, before it is signed rather than
                after. The statutory position is the part candidates ask about
                and the part that is expensive to get wrong. */}
            <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">This letter will state</p>
              <p>{rule.statutory.basis}</p>
              <p>
                Provident fund: <strong>{rule.statutory.providentFund ? "applies" : "does not apply"}</strong>
                {" · "}Gratuity: <strong>{rule.statutory.gratuity ? "applies" : "does not apply"}</strong>
                {" · "}Tax deducted under section <strong>{rule.statutory.tdsSection}</strong>
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button
              className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0"
              onClick={() => void handleGenerate()}
              disabled={busy}
            >
              {busy ? "Issuing…" : "Generate and send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label, value, onChange, type = "text", placeholder, error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  error?: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
