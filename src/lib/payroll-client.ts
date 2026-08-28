"use client";

// ═══════════════════════════════════════════════════════════════
// PAYROLL CLIENT
// ═══════════════════════════════════════════════════════════════
// The payroll page could not run payroll, and could not show a payslip.
//
// It went through `genericService(COLLECTIONS.payroll)`, which resolves an
// endpoint in two steps: a lookup in `ENTITY_ROUTES` for collections with a
// real table, falling back to `/api/collections/<name>` for the free-form
// document store. `payroll` was in neither. It has no entry in `ENTITY_ROUTES`,
// and `ALLOWED_COLLECTIONS` deliberately excludes it — with a comment saying
// exactly why:
//
//   "Only the free-form collections live here. Employees, leave, payroll and
//    the rest have their own tables and their own routes; routing them through
//    a schemaless store as well would give the same records two homes and let
//    them drift apart."
//
// So every read and every write returned 404 "Unknown collection payroll".
// The KPI cards showed ₹0.0L because the list failed, and Run Payroll showed
// "Failed to generate payroll" because the insert failed. Two symptoms, one
// missing routing entry.
//
// The doc-store route was right to refuse. `/api/payroll/*` and
// `payroll.neon.ts` already exist and are considerably better than what the
// page was trying to do for itself: bigint minor units rather than floats,
// statutory PF/ESI/professional-tax/TDS rather than `basic * 0.4` for HRA, and
// a maker-checker lifecycle where the person who processes a run cannot be the
// one who approves it.

import { formatPeriod } from "@/lib/money/format";

export interface PayrollRun {
  id: string;
  periodMonth: number;
  periodYear: number;
  runType: string;
  status: string;
  employeeCount: number;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  totalGrossMinor: string;
  totalDeductionsMinor: string;
  totalNetMinor: string;
  processedById?: string;
  approvedById?: string;
  paidAt?: string;
}

export interface PayrollRecord {
  id: string;
  runId: string;
  employeeId: string;
  employeeName?: string;
  workingDays: number;
  presentDays: number;
  lopDays: number;
  gross: number;
  totalDeductions: number;
  netPay: number;
  grossMinor: string;
  totalDeductionsMinor: string;
  netPayMinor: string;
  status: string;
  anomalies: string[];
}

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/**
 * Month name to the 1-12 the API expects.
 *
 * The dialog holds a name; `periodMonth` is a number, and the schema rejects
 * anything outside 1-12. Returns null rather than defaulting to January —
 * running December's payroll into January's period is not a small mistake.
 */
export function monthNumberFrom(name: string): number | null {
  const index = MONTH_NAMES.findIndex((m) => m.toLowerCase() === name.trim().toLowerCase());
  return index === -1 ? null : index + 1;
}

export function periodLabel(run: { periodMonth: number; periodYear: number }): string {
  return formatPeriod(run.periodMonth, run.periodYear);
}

/** The server's message, or a fallback. Never a bare "something went wrong". */
async function messageFrom(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return body.error || fallback;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });

  if (!response.ok) {
    throw new Error(await messageFrom(response, `Request failed (${response.status})`));
  }
  return (await response.json()) as T;
}

export async function listRuns(): Promise<PayrollRun[]> {
  const page = await call<{ items: PayrollRun[] }>("/api/payroll/runs?pageSize=100");
  return page.items ?? [];
}

export async function getRun(id: string): Promise<{ run: PayrollRun; records: PayrollRecord[] }> {
  const body = await call<{ run: PayrollRun; records: { items: PayrollRecord[] } }>(
    `/api/payroll/runs/${id}`
  );
  return { run: body.run, records: body.records.items ?? [] };
}

export async function createRun(periodMonth: number, periodYear: number): Promise<PayrollRun> {
  return call<PayrollRun>("/api/payroll/runs", {
    method: "POST",
    body: JSON.stringify({ periodMonth, periodYear, runType: "regular" }),
  });
}

export async function actOnRun(
  id: string,
  action: "process" | "approve" | "pay"
): Promise<PayrollRun> {
  return call<PayrollRun>(`/api/payroll/runs/${id}`, {
    method: "POST",
    body: JSON.stringify({ action }),
  });
}

/**
 * The signed-in employee's own payslips.
 *
 * `/api/payroll/payslips` releases only approved and paid runs — a draft or
 * processed run is still being corrected, and showing someone a figure that
 * later changes is worse than showing nothing.
 */
export interface MyPayslip extends PayrollRecord {
  periodMonth?: number;
  periodYear?: number;
}

export async function listMyPayslips(): Promise<MyPayslip[]> {
  const body = await call<{ payslips: MyPayslip[] }>("/api/payroll/payslips");
  return body.payslips ?? [];
}

/**
 * Creates the run and computes everyone's payslip.
 *
 * Two calls because they are two decisions: a draft run can exist before it is
 * costed, and processing is the step that reads attendance and applies the
 * statutory rules. Presented as one action here because "Run Payroll" is one
 * action to the person pressing it.
 */
export async function generatePayroll(
  periodMonth: number,
  periodYear: number
): Promise<PayrollRun> {
  const run = await createRun(periodMonth, periodYear);
  return actOnRun(run.id, "process");
}
