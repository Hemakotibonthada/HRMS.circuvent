"use client";

// ═══════════════════════════════════════════════════════════════
// TEMPLATE EDITOR
// ═══════════════════════════════════════════════════════════════
//
// Edits one template's body and nothing else — the name, category and
// signature requirement are set by the catalog/seed this template came
// from and stay fixed here; see the repository's `update()` for why
// widening this to metadata is a bigger, separate decision.
//
// Two safety properties this screen exists to enforce, matching the two
// ways a wrong edit reaches a real candidate:
//
//   1. Save is disabled until a *fresh* preview of this exact draft has come
//      back valid. Not merely available on request: the task this UI exists
//      for is "somebody edited an offer letter and only found out it was
//      broken when a candidate did", and a preview button that is easy to
//      skip under a Friday-afternoon deadline does not prevent that. The
//      draft is re-checked automatically, debounced, on every change, so
//      seeing a valid preview costs nobody an extra click.
//   2. Even so, Save calls the real API, which re-validates independently
//      (`update()` in document-templates.neon.ts calls `validateTemplateEdit`
//      itself) — this screen's gate is a UX convenience, not the security
//      boundary. A stale tab, a race with another editor, or a bug in this
//      component's state must not be the only thing standing between an
//      invalid draft and a saved template.
//
// Editing a built-in template never touches the shipped row — `update()`
// creates a customer override on first edit and this page has no code that
// needs to know that happened; it just re-reads whatever `getTemplate`
// returns afterward. Reverting restores an earlier version's *wording* by
// writing a new version on top (not by deleting history), so "revert" is
// itself just another recorded edit — see `planRevert`'s header comment for
// why it is not re-validated against today's token rules.

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ArrowLeft, CheckCircle2, XCircle, AlertTriangle, Loader2, RotateCcw, History, KeyRound, Save, Eye,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { DataLoadingSkeleton, DataEmptyState } from "@/components/data-empty-state";
import {
  getTemplate, listVersions, previewDraft, updateTemplate, revertTemplate,
  type TemplateDetail, type TemplateVersionRecord, type PreviewResult,
} from "@/lib/document-templates-client";
import { availableTokensFor } from "@/lib/document-templates/validation";

/** Mirrors the ORIGIN_CONF convention on the list page — kept local rather
 * than shared, the same way STATUS_CONF in letters/page.tsx is not shared
 * with documents/page.tsx: it is presentation for this one screen, not a
 * domain rule anything else needs to import. */
const ORIGIN_CONF: Record<string, { label: string; className: string }> = {
  seed: { label: "Built-in", className: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400" },
  custom: { label: "Customized", className: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400" },
};

type PreviewState = "idle" | "checking" | "ready" | "error";

export default function TemplateEditorPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [template, setTemplate] = useState<TemplateDetail | null>(null);
  const [versions, setVersions] = useState<TemplateVersionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);

  const [draftBody, setDraftBody] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [revertingVersion, setRevertingVersion] = useState<number | null>(null);

  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState>("idle");
  const [previewError, setPreviewError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [detail, versionList] = await Promise.all([getTemplate(id), listVersions(id)]);
      setTemplate(detail);
      setVersions(versionList);
      setDraftBody(detail.body);
      setChangeNote("");
      setFailed(null);
    } catch (error) {
      setFailed(error instanceof Error ? error.message : "Could not load this template");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const isDirty = template !== null && draftBody !== template.body;

  /**
   * Computed from the template's last-*saved* body, not the draft being
   * typed — the same `previousBody` `validateTemplateEdit` takes. A token
   * the draft has just introduced must not grandfather itself into "known"
   * the instant it is typed, or this panel would tell someone their brand
   * new token is fine right up until Save disagrees. This panel and the
   * save/preview checks must agree on one list, for the reason
   * `knownTokensFor`'s own header comment gives: a panel and a validator
   * that disagree teaches HR to distrust whichever one is on screen.
   */
  const availableTokens = useMemo(
    () => (template ? availableTokensFor(template.name, template.body) : []),
    [template]
  );

  // Debounced, automatic — recomputed 500ms after typing settles, and once
  // as soon as the template loads so an untouched template's own
  // preview/validation is visible with zero clicks. See the file header for
  // why this cannot be an optional button someone might skip.
  useEffect(() => {
    if (!template) return;
    let cancelled = false;
    setPreviewState("checking");
    const timer = setTimeout(() => {
      void previewDraft(id, draftBody)
        .then((result) => {
          if (cancelled) return;
          setPreviewResult(result);
          setPreviewState("ready");
          setPreviewError(null);
        })
        .catch((error) => {
          if (cancelled) return;
          setPreviewResult(null);
          setPreviewState("error");
          setPreviewError(error instanceof Error ? error.message : "Could not generate a preview");
        });
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, draftBody, template]);

  const canSave =
    isDirty && !saving && previewState === "ready" && previewResult !== null && previewResult.validation.valid;

  const handleSave = useCallback(async () => {
    if (!template || !canSave) return;
    setSaving(true);
    try {
      const updated = await updateTemplate(id, {
        body: draftBody,
        changeNote: changeNote.trim() || undefined,
      });
      toast.success(
        template.origin === "seed"
          ? "Saved. This is now a customer override — the shipped wording is kept and can be restored from Version history."
          : "Saved"
      );
      setTemplate(updated);
      setDraftBody(updated.body);
      setChangeNote("");
      setVersions(await listVersions(id));
    } catch (error) {
      // Whatever this was refused for, the server names the specific bad
      // token (see validateTemplateEdit's message construction) — shown
      // verbatim rather than replaced with a generic "save failed", because
      // "one of your tokens is wrong, somewhere" sends someone re-reading
      // the whole letter instead of the one line that needs fixing.
      toast.error(error instanceof Error ? error.message : "Could not save the template");
    } finally {
      setSaving(false);
    }
  }, [id, template, draftBody, changeNote, canSave]);

  const handleDiscard = useCallback(() => {
    if (!template) return;
    setDraftBody(template.body);
    setChangeNote("");
  }, [template]);

  const handleRevert = useCallback(
    async (version: TemplateVersionRecord) => {
      const warning = isDirty ? " Your unsaved draft below will be discarded." : "";
      if (!confirm(`Revert to version ${version.version}? This restores that version's wording as the live template.${warning}`)) {
        return;
      }
      setRevertingVersion(version.version);
      try {
        const updated = await revertTemplate(id, { toVersion: version.version });
        toast.success(`Reverted to version ${version.version}`);
        setTemplate(updated);
        setDraftBody(updated.body);
        setChangeNote("");
        setVersions(await listVersions(id));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not revert this template");
      } finally {
        setRevertingVersion(null);
      }
    },
    [id, isDirty]
  );

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <DataLoadingSkeleton rows={3} />
      </div>
    );
  }

  if (failed || !template) {
    return (
      <div className="space-y-6 p-6">
        <Link href="/templates">
          <Button variant="ghost" size="sm" className="gap-1 -ml-2">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to templates
          </Button>
        </Link>
        <DataEmptyState
          icon={AlertTriangle}
          title="This template could not be loaded"
          description={failed ?? "It may have been removed."}
          actionLabel="Try again"
          onAction={() => void load()}
        />
      </div>
    );
  }

  const origin = ORIGIN_CONF[template.origin] ?? { label: template.origin, className: "" };

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link href="/templates">
          <Button variant="ghost" size="sm" className="gap-1 -ml-2">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to templates
          </Button>
        </Link>
        <div className="flex flex-wrap items-center gap-3 mt-2">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">
            {template.name}
          </h1>
          <Badge variant="secondary" className={cn("text-xs", origin.className)}>{origin.label}</Badge>
          <Badge variant="outline" className="text-xs">v{template.version}</Badge>
          {template.requiresSignature && <Badge variant="outline" className="text-xs">Requires signature</Badge>}
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          {template.category} ·{" "}
          {template.updatedByEmail
            ? `last changed by ${template.updatedByEmail} on ${new Date(template.updatedAt).toLocaleString()}`
            : "never edited — this is the shipped default"}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Body</CardTitle>
            <CardDescription>
              HTML source with <code className="text-xs">{"{{token}}"}</code> placeholders — the exact text a
              generated document is rendered from.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              className="font-mono text-xs min-h-[420px]"
              spellCheck={false}
            />

            <div className="space-y-2">
              <Label>Change note (optional, recorded in version history)</Label>
              <Input
                value={changeNote}
                onChange={(e) => setChangeNote(e.target.value)}
                placeholder="e.g. Corrected notice period wording per updated policy"
                maxLength={500}
              />
            </div>

            <ValidationBanner state={previewState} result={previewResult} error={previewError} />

            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={handleDiscard} disabled={!isDirty || saving}>
                Discard changes
              </Button>
              <Button
                className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2"
                onClick={() => void handleSave()}
                disabled={!canSave}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
            {isDirty && !canSave && !saving && (
              <p className="text-xs text-muted-foreground text-right">
                {previewState === "checking"
                  ? "Checking this draft against sample data before Save can be enabled…"
                  : previewState === "error"
                  ? "Save is disabled until a preview can be generated."
                  : "Fix the issue above before this can be saved."}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Reference</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="tokens">
              <TabsList className="w-full">
                <TabsTrigger value="tokens" className="flex-1 gap-1">
                  <KeyRound className="h-3.5 w-3.5" /> Tokens
                </TabsTrigger>
                <TabsTrigger value="history" className="flex-1 gap-1">
                  <History className="h-3.5 w-3.5" /> History
                </TabsTrigger>
              </TabsList>

              <TabsContent value="tokens" className="space-y-2 mt-3">
                <p className="text-xs text-muted-foreground">
                  Every token this template can currently resolve. Anything else is refused on Save.
                </p>
                <div className="max-h-[420px] overflow-y-auto space-y-1 pr-1">
                  {availableTokens.map((t) => (
                    <div
                      key={t.token}
                      className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-xs"
                    >
                      <code className="text-violet-700 dark:text-violet-400 truncate">{`{{${t.token}}}`}</code>
                      <span className="text-muted-foreground truncate">{t.label}</span>
                    </div>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="history" className="space-y-2 mt-3">
                {versions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No version history yet.</p>
                ) : (
                  <div className="max-h-[420px] overflow-y-auto space-y-2 pr-1">
                    {versions.map((v) => {
                      const isCurrent = v.version === template.version;
                      return (
                        <div key={v.version} className="rounded-md border p-2.5 text-xs space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">
                              v{v.version}{" "}
                              {isCurrent && <Badge variant="secondary" className="ml-1 text-[10px]">Current</Badge>}
                            </span>
                            <span className="text-muted-foreground">
                              {new Date(v.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                          <p className="text-muted-foreground truncate">{v.changedByEmail ?? "Shipped default"}</p>
                          {v.changeNote && <p className="italic text-muted-foreground">&ldquo;{v.changeNote}&rdquo;</p>}
                          {!isCurrent && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="w-full gap-1 mt-1"
                              onClick={() => void handleRevert(v)}
                              disabled={revertingVersion !== null}
                            >
                              {revertingVersion === v.version ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <RotateCcw className="h-3 w-3" />
                              )}
                              Revert to this version
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Eye className="h-4 w-4" /> Preview with sample data
          </CardTitle>
          <CardDescription>
            Rendered exactly as a real document would be, with realistic placeholder values standing in for a
            real candidate or employee. Nobody should learn a template is broken from a real offer letter.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {previewState === "checking" && !previewResult ? (
            <DataLoadingSkeleton rows={2} />
          ) : previewResult ? (
            <div className="space-y-3">
              {previewResult.preview.genericTokens.length > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 rounded-md px-3 py-2">
                  Shown with a generic «placeholder» — not a real value — for:{" "}
                  {previewResult.preview.genericTokens.map((t) => `{{${t}}}`).join(", ")}
                </p>
              )}
              {/* A full HTML document, not a fragment — an inert (empty
                  `sandbox`) iframe is the only way to display it without either
                  breaking on the nested <html>/<head> tags a plain div would
                  choke on, or letting the template's own markup run script,
                  navigate, or reach outside the frame it is shown in. Mirrors
                  the identical choice in /sign/[id]/page.tsx for the same
                  reason — a template body is the same kind of untrusted-until-
                  reviewed HTML in both places. */}
              <iframe
                title={`${template.name} — preview`}
                sandbox=""
                srcDoc={previewResult.preview.renderedBody}
                className="h-[55vh] w-full rounded-xl border border-border bg-white"
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Preview will appear here.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * One combined pass/fail/pending line for the draft currently in the
 * textarea. Kept as its own component (rather than inlined) because it has
 * four states — checking / errored / valid / invalid — each needing quite
 * different iconography and colour, and mixing that branching into the main
 * page body made the actual save-gating logic (`canSave`, above) harder to
 * see at a glance.
 */
function ValidationBanner({
  state,
  result,
  error,
}: {
  state: PreviewState;
  result: PreviewResult | null;
  error: string | null;
}) {
  if (state === "checking") {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground rounded-md border px-3 py-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking this draft against sample data…
      </p>
    );
  }
  if (state === "error") {
    return (
      <p className="flex items-center gap-2 text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/20 rounded-md px-3 py-2">
        <XCircle className="h-3.5 w-3.5 shrink-0" /> {error ?? "Could not validate this draft."}
      </p>
    );
  }
  if (!result) return null;

  if (result.validation.valid) {
    return (
      <p className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 rounded-md px-3 py-2">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> Every token in this draft resolves — safe to save.
      </p>
    );
  }

  return (
    <p className="flex items-center gap-2 text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/20 rounded-md px-3 py-2">
      <XCircle className="h-3.5 w-3.5 shrink-0" /> {result.validation.message}
    </p>
  );
}
