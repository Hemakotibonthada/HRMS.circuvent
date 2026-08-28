// ═══════════════════════════════════════════════════════════════
// BANK ADVICE — the file that actually moves the salary
// ═══════════════════════════════════════════════════════════════
//
// Payroll is not finished when the payslips are approved. It is finished when
// the bank has moved the money, and that happens by uploading a file in a
// format the bank dictates.
//
// The thing to understand about these files is that banks reject them **as a
// batch**. One malformed IFSC in row 240 and nobody is paid that day — not the
// 239 rows above it, not the ones below. So this module refuses to produce a
// file it knows to be invalid, and says which rows are wrong, rather than
// emitting something that will come back rejected in an hour with a reference
// number and no detail.
//
// ─── Rules that cause real rejections ───
//
//   * **RTGS has a floor of ₹2,00,000.** Below that the bank will not process
//     it and the row bounces. Salary files routinely contain a mix, so the
//     payment mode is chosen per row rather than set once for the batch.
//   * **An IFSC is not free-form.** Eleven characters: four letters of bank
//     code, a mandatory zero, then six for the branch. A validator that only
//     checks the length passes `HDFC1000123`, which is wrong in the one
//     position that matters.
//   * **Same-bank rows should not go out as NEFT.** They are internal
//     transfers: instant, free, and not subject to NEFT windows. Sending them
//     through the interbank rails costs money and a day for no reason.
//
// The formats differ per bank in column order and header wording, so the layout
// is data and the validation is shared. Adding a bank should not mean rewriting
// the checks.

import type { Minor } from "./statutory-india";

export type PaymentMode = "NEFT" | "RTGS" | "IMPS" | "INTERNAL";

/** RTGS will not carry less than this. */
export const RTGS_FLOOR_MINOR: Minor = 2_00_000_00n;
/** IMPS will not carry more than this at most banks. */
export const IMPS_CEILING_MINOR: Minor = 5_00_000_00n;

export interface Beneficiary {
  employeeId: string;
  employeeCode: string;
  name: string;
  accountNumber: string;
  ifsc: string;
  amountMinor: Minor;
  /** Free text the employee sees on their statement. */
  narration?: string;
}

export interface AdviceRequest {
  /** The company account the money leaves from. */
  debitAccountNumber: string;
  debitIfsc: string;
  /** Value date, as the bank expects it. */
  valueDate: string;
  beneficiaries: readonly Beneficiary[];
  /** Payroll's own total, to check the file against. */
  expectedTotalMinor: Minor;
}

export interface RowProblem {
  employeeCode: string;
  field: string;
  message: string;
}

export interface PreparedRow extends Beneficiary {
  mode: PaymentMode;
  /** True when the beneficiary banks with the same bank as the debit account. */
  sameBank: boolean;
}

/**
 * Whether an IFSC could be real.
 *
 * Four letters, then a zero, then six alphanumerics. The zero is not decorative
 * — it is reserved, and a code without it is not an IFSC however plausible it
 * looks.
 */
export function isValidIfsc(ifsc: string): boolean {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.trim().toUpperCase());
}

/**
 * Whether an account number could be real.
 *
 * Indian account numbers have no single length — they run from 9 to 18 digits
 * depending on the bank — so this checks the shape and leaves the rest to the
 * bank. Rejecting a valid 17-digit account because a validator assumed 16 is
 * worse than passing an unpayable one, which at least bounces with a reason.
 */
export function isValidAccountNumber(account: string): boolean {
  return /^\d{9,18}$/.test(account.trim());
}

/** The bank code an IFSC belongs to. */
export function bankCodeOf(ifsc: string): string {
  return ifsc.trim().toUpperCase().slice(0, 4);
}

/**
 * The cheapest rail that will carry this row.
 *
 * Same bank first, because an internal transfer is instant and free. Then RTGS
 * for anything above its floor, since it settles in real time. Then NEFT, which
 * carries anything.
 */
export function modeFor(amountMinor: Minor, sameBank: boolean): PaymentMode {
  if (sameBank) return "INTERNAL";
  if (amountMinor >= RTGS_FLOOR_MINOR) return "RTGS";
  return "NEFT";
}

export interface ValidationResult {
  rows: PreparedRow[];
  problems: RowProblem[];
  totalMinor: Minor;
  /** True when the rows add up to what payroll said they would. */
  reconciles: boolean;
  valid: boolean;
}

/**
 * Checks every row and works out how each will be sent.
 *
 * Returns everything wrong at once. A bank file is prepared by a person under
 * time pressure on payday, and handing them one error at a time turns a
 * five-minute fix into an afternoon.
 */
export function prepare(request: AdviceRequest): ValidationResult {
  const problems: RowProblem[] = [];
  const rows: PreparedRow[] = [];
  const seenAccounts = new Map<string, string>();

  const debitBank = bankCodeOf(request.debitIfsc);

  if (!isValidIfsc(request.debitIfsc)) {
    problems.push({
      employeeCode: "-",
      field: "debitIfsc",
      message: `The company's own IFSC "${request.debitIfsc}" is not valid.`,
    });
  }

  for (const b of request.beneficiaries) {
    const ifsc = b.ifsc.trim().toUpperCase();
    const account = b.accountNumber.trim();

    if (!isValidIfsc(ifsc)) {
      problems.push({
        employeeCode: b.employeeCode,
        field: "ifsc",
        message: `"${b.ifsc}" is not a valid IFSC. Expected four letters, a zero, then six characters.`,
      });
    }

    if (!isValidAccountNumber(account)) {
      problems.push({
        employeeCode: b.employeeCode,
        field: "accountNumber",
        message: `"${b.accountNumber}" is not a valid account number.`,
      });
    }

    if (b.amountMinor <= 0n) {
      problems.push({
        employeeCode: b.employeeCode,
        field: "amount",
        message: "Nothing to pay. Remove the row rather than sending a nil transfer.",
      });
    }

    if (!b.name.trim()) {
      problems.push({
        employeeCode: b.employeeCode,
        field: "name",
        message: "The beneficiary name is empty; banks match it against the account.",
      });
    }

    // Two employees on one account is legitimate — a couple sharing one — but
    // it is also what a copy-paste error looks like, and paying the wrong
    // person is not recoverable by the payer.
    const previous = seenAccounts.get(account);
    if (previous && previous !== b.employeeCode) {
      problems.push({
        employeeCode: b.employeeCode,
        field: "accountNumber",
        message: `This account is also used by ${previous}. Confirm both before sending.`,
      });
    }
    seenAccounts.set(account, b.employeeCode);

    const sameBank = bankCodeOf(ifsc) === debitBank;
    rows.push({
      ...b,
      ifsc,
      accountNumber: account,
      sameBank,
      mode: modeFor(b.amountMinor, sameBank),
    });
  }

  const totalMinor = rows.reduce((a, r) => a + r.amountMinor, 0n);
  const reconciles = totalMinor === request.expectedTotalMinor;

  if (!reconciles) {
    const difference = totalMinor - request.expectedTotalMinor;
    problems.push({
      employeeCode: "-",
      field: "total",
      message:
        `The file totals ${totalMinor / 100n} rupees but payroll approved ` +
        `${request.expectedTotalMinor / 100n}, a difference of ${
          difference < 0n ? -difference / 100n : difference / 100n
        }. Do not send a file that does not agree with the register.`,
    });
  }

  return {
    rows,
    problems,
    totalMinor,
    reconciles,
    valid: problems.length === 0,
  };
}

export interface BankFormat {
  code: string;
  label: string;
  headers: string[];
  /** Turns one prepared row into the bank's column order. */
  row: (row: PreparedRow, request: AdviceRequest) => string[];
}

const rupees = (minor: Minor): string => {
  const whole = minor / 100n;
  const paise = minor % 100n;
  return `${whole}.${paise.toString().padStart(2, "0")}`;
};

/**
 * The layouts, as data.
 *
 * These are the common shapes for bulk salary upload. Banks revise them, and a
 * format that has drifted produces a rejection rather than a wrong payment, so
 * the failure is loud. Verify against the bank's current template before a
 * first run.
 */
export const BANK_FORMATS: Record<string, BankFormat> = {
  hdfc: {
    code: "hdfc",
    label: "HDFC Bank — bulk salary upload",
    headers: ["Transaction Type", "Beneficiary Account", "Beneficiary Name", "Amount", "IFSC", "Narration", "Value Date"],
    row: (r, req) => [
      r.mode === "INTERNAL" ? "IFT" : r.mode,
      r.accountNumber,
      r.name,
      rupees(r.amountMinor),
      r.ifsc,
      r.narration ?? "Salary",
      req.valueDate,
    ],
  },
  icici: {
    code: "icici",
    label: "ICICI Bank — corporate internet banking",
    headers: ["PYMT_MODE", "BNF_ACCT_NO", "BNF_NAME", "AMOUNT", "IFSC_CODE", "REMARKS", "PYMT_DATE", "DEBIT_ACCT_NO"],
    row: (r, req) => [
      r.mode === "INTERNAL" ? "OWN" : r.mode,
      r.accountNumber,
      r.name,
      rupees(r.amountMinor),
      r.ifsc,
      r.narration ?? "Salary",
      req.valueDate,
      req.debitAccountNumber,
    ],
  },
  sbi: {
    code: "sbi",
    label: "State Bank of India — corporate salary",
    headers: ["Sl No", "Beneficiary Name", "Account Number", "IFSC", "Amount", "Mode", "Remarks"],
    row: (r) => [
      "",
      r.name,
      r.accountNumber,
      r.ifsc,
      rupees(r.amountMinor),
      r.mode === "INTERNAL" ? "TRF" : r.mode,
      r.narration ?? "Salary",
    ],
  },
  generic: {
    code: "generic",
    label: "Generic CSV",
    headers: ["Employee Code", "Beneficiary Name", "Account Number", "IFSC", "Amount", "Mode", "Narration", "Value Date"],
    row: (r, req) => [
      r.employeeCode,
      r.name,
      r.accountNumber,
      r.ifsc,
      rupees(r.amountMinor),
      r.mode,
      r.narration ?? "Salary",
      req.valueDate,
    ],
  },
};

/** A CSV field that cannot break the row it sits in. */
function csvField(value: string): string {
  const needsQuoting = /[",\r\n]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuoting ? `"${escaped}"` : escaped;
}

export class InvalidAdviceError extends Error {
  constructor(readonly problems: RowProblem[]) {
    super(`The advice file has ${problems.length} problem(s) and was not written.`);
    this.name = "InvalidAdviceError";
  }
}

/**
 * Writes the file, or refuses to.
 *
 * Refusing is the feature. A file with one bad row is rejected by the bank as a
 * whole batch, and the person who uploaded it finds out after the payment
 * window has closed. Failing here costs a minute; failing there costs a day and
 * everyone's salary.
 *
 * Row numbers are filled in after validation so that a sequence column matches
 * the rows that were actually written.
 */
export function generateAdviceFile(request: AdviceRequest, formatCode: string): string {
  const format = BANK_FORMATS[formatCode];
  if (!format) {
    throw new Error(`Unknown bank format "${formatCode}".`);
  }

  const result = prepare(request);
  if (!result.valid) throw new InvalidAdviceError(result.problems);

  const lines = [format.headers.map(csvField).join(",")];

  result.rows.forEach((row, index) => {
    const cells = format.row(row, request).map((c, i) =>
      format.headers[i]?.toLowerCase().includes("sl no") && c === "" ? String(index + 1) : c
    );
    lines.push(cells.map(csvField).join(","));
  });

  return lines.join("\r\n") + "\r\n";
}

export interface AdviceSummary {
  count: number;
  totalMinor: Minor;
  byMode: { mode: PaymentMode; count: number; totalMinor: Minor }[];
}

/** What is about to leave the account, before anyone presses send. */
export function summarise(rows: readonly PreparedRow[]): AdviceSummary {
  const grouped = new Map<PaymentMode, { count: number; totalMinor: Minor }>();
  for (const r of rows) {
    const entry = grouped.get(r.mode) ?? { count: 0, totalMinor: 0n };
    entry.count += 1;
    entry.totalMinor += r.amountMinor;
    grouped.set(r.mode, entry);
  }

  return {
    count: rows.length,
    totalMinor: rows.reduce((a, r) => a + r.amountMinor, 0n),
    byMode: [...grouped.entries()]
      .map(([mode, v]) => ({ mode, ...v }))
      .sort((a, b) => b.totalMinor - a.totalMinor > 0n ? 1 : -1),
  };
}
