"use client";

// ═══════════════════════════════════════════════════════════════
// WHO IS THIS PERSON? — the hire behind a new employee record
// ═══════════════════════════════════════════════════════════════
// `POST /api/employees` refuses a create that names no candidate, because an
// employee with nobody behind them is how a company mailbox gets issued to
// someone who was never hired. This is the control that satisfies it.
//
// ── Why it prefills the rest of the form ──
// The candidate's name, email and designation are already recorded, and typing
// them again is how a record ends up disagreeing with the offer it came from.
// The fields stay editable — a legal name can differ from the one on an
// application — but the default is the hire's own data.
//
// ── Why people who are not ready are shown, disabled ──
// Hiding them makes the picker look broken to the one person who knows the
// candidate accepted last week. Showing them with the blocker names what has
// to happen: usually "they have not submitted their joining form yet".

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Check, Loader2, Search, UserCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { listPendingHires, type PendingHire } from "@/lib/employee-client";

/** Matches `MIN_OVERRIDE_REASON` in `lib/hire-provenance.ts`. */
const MIN_OVERRIDE_REASON = 20;

export interface HireSelection {
  candidateId?: string;
  applicationId?: string;
  provenanceOverrideReason?: string;
}

export function HirePicker(props: {
  value: HireSelection;
  onChange: (selection: HireSelection) => void;
  /** Called with the hire's own details so the form can prefill from them. */
  onPrefill?: (hire: PendingHire) => void;
}) {
  const [hires, setHires] = useState<PendingHire[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [overriding, setOverriding] = useState(false);

  const load = useCallback(async (term: string) => {
    setLoading(true);
    setError(null);
    try {
      setHires(await listPendingHires(term));
    } catch (err) {
      // Named rather than swallowed: an empty list and a failed request look
      // identical, and only one of them means "nobody has accepted an offer".
      setError(err instanceof Error ? err.message : "Could not load recent hires.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(search), search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [search, load]);

  const selected = hires.find((h) => h.candidateId === props.value.candidateId);

  const choose = (hire: PendingHire) => {
    setOverriding(false);
    props.onChange({
      candidateId: hire.candidateId,
      applicationId: hire.applicationId ?? undefined,
    });
    props.onPrefill?.(hire);
  };

  const startOverride = () => {
    setOverriding(true);
    props.onChange({ provenanceOverrideReason: "" });
  };

  const reason = props.value.provenanceOverrideReason ?? "";

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-muted-foreground">Hired candidate *</h4>
        {selected && (
          <Badge variant="secondary" className="gap-1 text-[10px]">
            <Check className="h-3 w-3" />
            {selected.name}
          </Badge>
        )}
      </div>

      {!overriding && (
        <>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-8 pl-7 text-xs"
              placeholder="Search accepted candidates by name or email"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {loading && (
            <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading candidates who have accepted an offer…
            </p>
          )}

          {error && (
            <p className="flex items-start gap-2 text-[11px] text-destructive">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              {error}
            </p>
          )}

          {!loading && !error && hires.length === 0 && (
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Nobody is waiting to be added. An employee record is created from an
              accepted offer, so the candidate has to accept in the ATS and submit
              their joining form first.
            </p>
          )}

          <div className="max-h-44 space-y-1 overflow-y-auto">
            {hires.map((hire) => {
              const isSelected = hire.candidateId === props.value.candidateId;
              return (
                <button
                  key={hire.candidateId}
                  type="button"
                  disabled={!hire.ready}
                  onClick={() => choose(hire)}
                  className={[
                    "w-full rounded-md border px-2 py-1.5 text-left transition",
                    isSelected
                      ? "border-violet-500 bg-violet-50 dark:bg-violet-950/30"
                      : "border-transparent",
                    hire.ready ? "hover:bg-muted cursor-pointer" : "cursor-not-allowed opacity-60",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium">{hire.name || hire.email}</span>
                    <Badge
                      variant={hire.ready ? "secondary" : "outline"}
                      className="shrink-0 text-[9px]"
                    >
                      {hire.offerStatus ?? "no offer"}
                    </Badge>
                  </div>
                  <p className="truncate text-[10px] text-muted-foreground">{hire.email}</p>
                  {!hire.ready && hire.blockers.length > 0 && (
                    <p className="mt-0.5 text-[10px] leading-snug text-amber-600 dark:text-amber-500">
                      {hire.blockers[0]}
                    </p>
                  )}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={startOverride}
            className="text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            This person was not hired through the ATS
          </button>
        </>
      )}

      {overriding && (
        <div className="space-y-2">
          <Label className="text-xs">Why does this person have no hire record?</Label>
          <Textarea
            className="text-xs"
            rows={3}
            placeholder="A founder, an acquired team, or a record being corrected — this is stored against the employee and shown in the audit trail."
            value={reason}
            onChange={(e) => props.onChange({ provenanceOverrideReason: e.target.value })}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-muted-foreground">
              {reason.trim().length < MIN_OVERRIDE_REASON
                ? `${MIN_OVERRIDE_REASON - reason.trim().length} more characters needed.`
                : "Recorded against this employee."}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 text-[10px]"
              onClick={() => {
                setOverriding(false);
                props.onChange({});
              }}
            >
              <UserCheck className="h-3 w-3" />
              Pick a candidate instead
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
