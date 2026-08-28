"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Landmark, Lock, Save, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  ACCOUNT_TYPE_OPTIONS,
  getMyBankDetails,
  saveMyBankDetails,
  type BankDetailsInput,
  type BankDetailsRecord,
} from "@/lib/bank-details-client";
import { DataLoadingSkeleton } from "@/components/data-empty-state";

// ═══════════════════════════════════════════════════════════════
// BANK DETAILS — where the signed-in employee's salary is paid
// ═══════════════════════════════════════════════════════════════
//
// Until this page existed, `employees.bank_details` was a jsonb column with
// nothing that ever wrote to it, `lib/form-schemas.ts` defined a "Bank
// Details" section that no page imported, and `lib/paystub-client.ts` had
// been sending `statutoryIds: { pan, uan, pf_number, esi_number }` to Paystub
// on every sync regardless — the wire to payroll existed, but there was
// nowhere for an employee to put a value on it, so it carried nulls.
//
// The account number is the one field here that can send someone's pay to a
// stranger on a single mistyped digit, so it gets treatment nothing else on
// this form does: `/api/employees/bank-details` never returns it in full
// (see toBankDetailsView in lib/bank-details-rules.ts), and this page never
// pre-fills it from what it already has on file, only from what is retyped
// just now. Retyping is also always required to save *anything* on this
// form, even a PAN-only change — a smaller nuisance than the alternative,
// which is a server that has to guess whether a blank field means "unchanged"
// or "clear this" for the one value it can never show back to confirm.

const EMPTY_FORM: BankDetailsInput = {
  bankName: "",
  accountHolderName: "",
  accountNumber: "",
  confirmAccountNumber: "",
  ifsc: "",
  accountType: "",
  panNumber: "",
  uanNumber: "",
  pfNumber: "",
  esiNumber: "",
};

/** Loads the fields that are safe to show back as a starting point for edits. */
function formFrom(record: BankDetailsRecord): BankDetailsInput {
  return {
    ...EMPTY_FORM,
    bankName: record.bankDetails?.bankName ?? "",
    accountHolderName: record.bankDetails?.accountHolderName ?? "",
    // accountNumber / confirmAccountNumber intentionally omitted — see the
    // header comment. The masked value lives in `record`, not in the form.
    ifsc: record.bankDetails?.ifsc ?? "",
    accountType: record.bankDetails?.accountType ?? "",
    panNumber: record.statutoryIds.panNumber ?? "",
    uanNumber: record.statutoryIds.uanNumber ?? "",
    pfNumber: record.statutoryIds.pfNumber ?? "",
    esiNumber: record.statutoryIds.esiNumber ?? "",
  };
}

export default function BankDetailsPage() {
  const [record, setRecord] = useState<BankDetailsRecord | null>(null);
  const [form, setForm] = useState<BankDetailsInput>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await getMyBankDetails();
        if (cancelled) return;
        setRecord(data);
        setForm(formFrom(data));
        setLoadError(null);
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : "Bank details could not be loaded"
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setInitialized(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setField =
    (key: keyof BankDetailsInput, transform?: (raw: string) => string) =>
    (e: ChangeEvent<HTMLInputElement>) => {
      const value = transform ? transform(e.target.value) : e.target.value;
      setForm((p) => ({ ...p, [key]: value }));
    };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await saveMyBankDetails(form);
      setRecord(updated);
      // Retyped into the form once, saved, then cleared — nothing keeps
      // displaying the number the user just typed once it is safely stored.
      setForm(formFrom(updated));
      toast.success("Bank details saved");
    } catch (error) {
      // ValidationError's own message already joins every field problem the
      // server found, one per line — the same reason employee-client.ts's
      // ValidationError exists: naming which field was wrong beats a single
      // "Failed to save" that leaves the employee guessing.
      toast.error(error instanceof Error ? error.message : "Could not save bank details");
    } finally {
      setSaving(false);
    }
  };

  if (loading && !initialized) {
    return (
      <div className="p-6">
        <DataLoadingSkeleton rows={4} />
      </div>
    );
  }

  const onFile = record?.bankDetails ?? null;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">
          Bank &amp; Statutory Details
        </h1>
        <p className="text-muted-foreground mt-1">
          Where your salary is paid, and the IDs payroll reports it under.
        </p>
      </div>

      {loadError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <p className="text-sm font-medium text-destructive">Bank details could not be loaded</p>
          <p className="text-sm text-muted-foreground mt-1">{loadError}</p>
        </div>
      )}

      <div className="flex items-start gap-3 rounded-lg bg-amber-50 dark:bg-amber-900/10 p-3">
        <Lock className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
        {onFile ? (
          <p className="text-sm text-amber-800 dark:text-amber-400">
            On file: <span className="font-medium">{onFile.bankName}</span> ·{" "}
            <span className="font-mono">{onFile.accountNumber}</span> · {onFile.ifsc}. For your
            security the full account number is never displayed again — enter it below, and
            confirm it, whenever you save this form, whether you are keeping it or replacing it.
          </p>
        ) : (
          <p className="text-sm text-amber-800 dark:text-amber-400">
            No bank account is on file yet. Payroll cannot pay a salary it has nowhere to send —
            fill this in before your next pay run.
          </p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Landmark className="h-4 w-4 text-violet-500" /> Bank Account
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label>Bank name</Label>
              <Input
                value={form.bankName ?? ""}
                onChange={setField("bankName")}
                placeholder="e.g. HDFC Bank"
              />
            </div>
            <div className="space-y-2">
              <Label>Account holder name</Label>
              <Input
                value={form.accountHolderName ?? ""}
                onChange={setField("accountHolderName")}
                placeholder="As it appears on the passbook"
              />
            </div>
            <div className="space-y-2">
              <Label>Account number</Label>
              <Input
                value={form.accountNumber ?? ""}
                onChange={setField("accountNumber")}
                placeholder={onFile ? `Re-enter to keep or replace ${onFile.accountNumber}` : "9 to 18 digits"}
                inputMode="numeric"
              />
            </div>
            <div className="space-y-2">
              <Label>Confirm account number</Label>
              <Input
                value={form.confirmAccountNumber ?? ""}
                onChange={setField("confirmAccountNumber")}
                placeholder="Type it again"
                inputMode="numeric"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>IFSC</Label>
                <Input
                  value={form.ifsc ?? ""}
                  onChange={setField("ifsc", (raw) => raw.toUpperCase())}
                  placeholder="HDFC0001234"
                  maxLength={11}
                />
              </div>
              <div className="space-y-2">
                <Label>Account type</Label>
                <Select
                  value={form.accountType ?? ""}
                  onValueChange={(v) => setForm((p) => ({ ...p, accountType: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose one" />
                  </SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-blue-500" /> Statutory Details
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              These reach Paystub on the next sync. PAN is stored encrypted; UAN, PF and ESI are
              reference numbers, not secrets, and are stored as given.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label>PAN</Label>
              <Input
                value={form.panNumber ?? ""}
                onChange={setField("panNumber", (raw) => raw.toUpperCase())}
                placeholder="ABCDE1234F"
                maxLength={10}
              />
            </div>
            <div className="space-y-2">
              <Label>UAN</Label>
              <Input
                value={form.uanNumber ?? ""}
                onChange={setField("uanNumber")}
                placeholder="12-digit Universal Account Number"
                inputMode="numeric"
                maxLength={12}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>PF number</Label>
                <Input value={form.pfNumber ?? ""} onChange={setField("pfNumber")} placeholder="EPFO establishment number" />
              </div>
              <div className="space-y-2">
                <Label>ESI number</Label>
                <Input value={form.esiNumber ?? ""} onChange={setField("esiNumber")} placeholder="ESIC insured person number" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button
          className="gap-2 bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md"
          onClick={() => void handleSave()}
          disabled={saving}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Bank Details
        </Button>
      </div>
    </div>
  );
}
