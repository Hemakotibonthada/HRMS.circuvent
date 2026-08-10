// ═══════════════════════════════════════════════════════════════
// INDIAN STATUTORY COMPLIANCE
// ═══════════════════════════════════════════════════════════════
// Provident Fund, ESI, Professional Tax, Labour Welfare Fund, gratuity and
// income tax. Pure, so it tests without a database.
//
// This is the highest-consequence arithmetic in the system. Under-deducting PF
// leaves the employer liable for both halves plus interest and damages;
// over-deducting takes money from someone's salary they are entitled to. The
// figures are also filed with the government, so "close enough" is not a
// standard that exists here.
//
// Every rate below carries the rule it comes from, because rates change with
// each Finance Act and the next person needs to know what to look up. They are
// parameters with defaults, not constants: a payroll run for March 2025 must
// still compute with March 2025's rates, not today's.

export type Minor = bigint;

/** Rounds a rupee amount to whole rupees, as every statutory return requires. */
export function toWholeRupees(minor: Minor): Minor {
  const paise = minor % 100n;
  const rupees = minor - paise;
  // Half and above rounds up, matching the convention EPFO and the Income Tax
  // Department both use.
  return paise >= 50n ? rupees + 100n : rupees;
}

function percentOf(amount: Minor, percent: number): Minor {
  const scaled = BigInt(Math.round(percent * 10_000));
  const product = amount * scaled;
  const divisor = 1_000_000n;
  const quotient = product / divisor;
  const remainder = product % divisor;
  return remainder * 2n >= divisor ? quotient + 1n : quotient;
}

// ─── Provident Fund ──────────────────────────────────────────

export interface PfConfig {
  /**
   * Statutory wage ceiling for PF, in minor units.
   *
   * ₹15,000 per month since September 2014. Contributions above it are
   * voluntary unless the employer has opted to contribute on full wages.
   */
  wageCeilingMinor: Minor;
  employeeRate: number;
  employerRate: number;
  /** The employer's share diverted to the Pension Scheme (EPS). */
  pensionRate: number;
  /** EPS is capped at the ceiling even when PF is paid on full wages. */
  pensionCeilingMinor: Minor;
  adminChargeRate: number;
  edliRate: number;
  /** Contribute on actual wages rather than the capped amount. */
  contributeOnFullWages: boolean;
}

export const PF_CONFIG_2025: PfConfig = {
  wageCeilingMinor: 15_000_00n,
  employeeRate: 12,
  employerRate: 12,
  pensionRate: 8.33,
  pensionCeilingMinor: 15_000_00n,
  // EPF Administrative Charges: 0.5% of PF wages, minimum ₹500 a month.
  adminChargeRate: 0.5,
  // Employees' Deposit Linked Insurance.
  edliRate: 0.5,
  contributeOnFullWages: false,
};

export interface PfResult {
  pfWagesMinor: Minor;
  employeeContributionMinor: Minor;
  employerPfMinor: Minor;
  employerPensionMinor: Minor;
  adminChargeMinor: Minor;
  edliMinor: Minor;
  totalEmployerCostMinor: Minor;
  isExempt: boolean;
  exemptionReason?: string;
}

/**
 * PF for one month.
 *
 * PF wages are basic plus dearness allowance plus retaining allowance — not
 * gross. Computing on gross over-deducts from everyone with an HRA, which is
 * almost everyone.
 *
 * The employer's 12% splits: 8.33% of the *capped* wage goes to the pension
 * scheme and the remainder to PF. The pension cap stays at ₹15,000 even when
 * the employer contributes on full wages, which is the detail most
 * implementations get wrong.
 */
export function calculatePf(
  basicPlusDaMinor: Minor,
  config: PfConfig = PF_CONFIG_2025,
  options: { isInternationalWorker?: boolean; hasExemption?: boolean; monthlyGrossMinor?: Minor } = {}
): PfResult {
  const zero: PfResult = {
    pfWagesMinor: 0n,
    employeeContributionMinor: 0n,
    employerPfMinor: 0n,
    employerPensionMinor: 0n,
    adminChargeMinor: 0n,
    edliMinor: 0n,
    totalEmployerCostMinor: 0n,
    isExempt: true,
  };

  if (options.hasExemption) {
    return { ...zero, exemptionReason: "Covered by an exempted trust" };
  }

  // Someone joining above the ceiling who has never been a PF member may be
  // excluded. An international worker never can be, whatever they earn.
  if (
    !options.isInternationalWorker &&
    options.monthlyGrossMinor !== undefined &&
    basicPlusDaMinor > config.wageCeilingMinor &&
    !config.contributeOnFullWages
  ) {
    // Still contributes, but only on the ceiling — falls through below.
  }

  const pfWagesMinor =
    config.contributeOnFullWages || options.isInternationalWorker
      ? basicPlusDaMinor
      : basicPlusDaMinor > config.wageCeilingMinor
        ? config.wageCeilingMinor
        : basicPlusDaMinor;

  if (pfWagesMinor <= 0n) return { ...zero, exemptionReason: "No PF wages" };

  const employeeContributionMinor = toWholeRupees(percentOf(pfWagesMinor, config.employeeRate));

  // An international worker has no pension ceiling; a domestic member's
  // pension contribution is capped whatever their PF wages.
  const pensionBase = options.isInternationalWorker
    ? pfWagesMinor
    : pfWagesMinor > config.pensionCeilingMinor
      ? config.pensionCeilingMinor
      : pfWagesMinor;

  const employerPensionMinor = toWholeRupees(percentOf(pensionBase, config.pensionRate));
  const employerTotal = toWholeRupees(percentOf(pfWagesMinor, config.employerRate));
  const employerPfMinor = employerTotal - employerPensionMinor;

  // Minimum ₹500 a month, per EPFO circular. Applying the percentage alone
  // under-charges every small employer and the shortfall is recovered with
  // damages at inspection.
  const rawAdmin = toWholeRupees(percentOf(pfWagesMinor, config.adminChargeRate));
  const adminChargeMinor = rawAdmin < 500_00n ? 500_00n : rawAdmin;

  const edliMinor = toWholeRupees(percentOf(pfWagesMinor, config.edliRate));

  return {
    pfWagesMinor,
    employeeContributionMinor,
    employerPfMinor,
    employerPensionMinor,
    adminChargeMinor,
    edliMinor,
    totalEmployerCostMinor: employerTotal + adminChargeMinor + edliMinor,
    isExempt: false,
  };
}

// ─── Employees' State Insurance ──────────────────────────────

export interface EsiConfig {
  /** ₹21,000 gross a month, or ₹25,000 for a person with a disability. */
  wageCeilingMinor: Minor;
  disabilityCeilingMinor: Minor;
  employeeRate: number;
  employerRate: number;
}

export const ESI_CONFIG_2025: EsiConfig = {
  wageCeilingMinor: 21_000_00n,
  disabilityCeilingMinor: 25_000_00n,
  employeeRate: 0.75,
  employerRate: 3.25,
};

export interface EsiResult {
  isApplicable: boolean;
  esiWagesMinor: Minor;
  employeeContributionMinor: Minor;
  employerContributionMinor: Minor;
  reason?: string;
}

/**
 * ESI for one month.
 *
 * Two rules trip people up. First, ESI is on GROSS, not on basic — the
 * opposite of PF. Second, someone who crosses the ceiling mid-period keeps
 * contributing until the end of that contribution period, so cover is not lost
 * partway through a claim.
 *
 * Contribution periods are April-September and October-March.
 */
export function calculateEsi(
  monthlyGrossMinor: Minor,
  config: EsiConfig = ESI_CONFIG_2025,
  options: { hasDisability?: boolean; wasContributingAtPeriodStart?: boolean } = {}
): EsiResult {
  const ceiling = options.hasDisability
    ? config.disabilityCeilingMinor
    : config.wageCeilingMinor;

  const overCeiling = monthlyGrossMinor > ceiling;

  if (overCeiling && !options.wasContributingAtPeriodStart) {
    return {
      isApplicable: false,
      esiWagesMinor: 0n,
      employeeContributionMinor: 0n,
      employerContributionMinor: 0n,
      reason: `Gross exceeds the ESI ceiling`,
    };
  }

  if (monthlyGrossMinor <= 0n) {
    return {
      isApplicable: false,
      esiWagesMinor: 0n,
      employeeContributionMinor: 0n,
      employerContributionMinor: 0n,
      reason: "No wages",
    };
  }

  // Contributions continue on ACTUAL wages, not the capped figure, for
  // someone who crossed mid-period. Capping here would under-report to ESIC.
  return {
    isApplicable: true,
    esiWagesMinor: monthlyGrossMinor,
    employeeContributionMinor: toWholeRupees(
      percentOf(monthlyGrossMinor, config.employeeRate)
    ),
    employerContributionMinor: toWholeRupees(
      percentOf(monthlyGrossMinor, config.employerRate)
    ),
    reason: overCeiling
      ? "Continues to the end of the contribution period after crossing the ceiling"
      : undefined,
  };
}

/** The ESI contribution period a date falls in. */
export function esiContributionPeriod(date: string): {
  period: "apr_sep" | "oct_mar";
  startsOn: string;
  endsOn: string;
} {
  const [year, month] = date.split("-").map(Number);
  if (Number.isNaN(year) || Number.isNaN(month)) {
    throw new Error("Dates must be YYYY-MM-DD");
  }

  if (month >= 4 && month <= 9) {
    return { period: "apr_sep", startsOn: `${year}-04-01`, endsOn: `${year}-09-30` };
  }

  // October to March spans a year boundary.
  const startYear = month >= 10 ? year : year - 1;
  return {
    period: "oct_mar",
    startsOn: `${startYear}-10-01`,
    endsOn: `${startYear + 1}-03-31`,
  };
}

// ─── Professional Tax ────────────────────────────────────────

export interface PtSlab {
  /** Inclusive lower bound of monthly gross, in minor units. */
  fromMinor: Minor;
  /** Exclusive upper bound; null means no upper bound. */
  toMinor: Minor | null;
  amountMinor: Minor;
}

/**
 * Professional Tax is a STATE tax, and every state sets its own slabs.
 *
 * Applying one state's table nationally is wrong for everyone outside it, and
 * wrong in a way that shows up as a shortfall notice from a state commercial
 * tax department rather than as a bug report.
 */
export const PT_SLABS: Record<string, PtSlab[]> = {
  KA: [
    { fromMinor: 0n, toMinor: 25_000_00n, amountMinor: 0n },
    { fromMinor: 25_000_00n, toMinor: null, amountMinor: 200_00n },
  ],
  MH: [
    // Maharashtra's notification reads "exceeds ₹7,500 but does not exceed
    // ₹10,000", so ₹7,500 exactly is exempt. Karnataka's reads "not less than
    // ₹25,000", so ₹25,000 exactly is taxable. The boundaries genuinely
    // differ by state and cannot share one convention.
    { fromMinor: 0n, toMinor: 7_500_01n, amountMinor: 0n },
    { fromMinor: 7_500_01n, toMinor: 10_000_01n, amountMinor: 175_00n },
    { fromMinor: 10_000_01n, toMinor: null, amountMinor: 200_00n },
  ],
  TN: [
    { fromMinor: 0n, toMinor: 21_000_00n, amountMinor: 0n },
    { fromMinor: 21_000_00n, toMinor: 30_000_00n, amountMinor: 135_00n },
    { fromMinor: 30_000_00n, toMinor: 45_000_00n, amountMinor: 315_00n },
    { fromMinor: 45_000_00n, toMinor: 60_000_00n, amountMinor: 690_00n },
    { fromMinor: 60_000_00n, toMinor: 75_000_00n, amountMinor: 1_025_00n },
    { fromMinor: 75_000_00n, toMinor: null, amountMinor: 1_250_00n },
  ],
  WB: [
    { fromMinor: 0n, toMinor: 10_000_00n, amountMinor: 0n },
    { fromMinor: 10_000_00n, toMinor: 15_000_00n, amountMinor: 110_00n },
    { fromMinor: 15_000_00n, toMinor: 25_000_00n, amountMinor: 130_00n },
    { fromMinor: 25_000_00n, toMinor: 40_000_00n, amountMinor: 150_00n },
    { fromMinor: 40_000_00n, toMinor: null, amountMinor: 200_00n },
  ],
  TS: [
    { fromMinor: 0n, toMinor: 15_000_00n, amountMinor: 0n },
    { fromMinor: 15_000_00n, toMinor: 20_000_00n, amountMinor: 150_00n },
    { fromMinor: 20_000_00n, toMinor: null, amountMinor: 200_00n },
  ],
  GJ: [
    { fromMinor: 0n, toMinor: 12_000_00n, amountMinor: 0n },
    { fromMinor: 12_000_00n, toMinor: null, amountMinor: 200_00n },
  ],
  // Delhi, Haryana, UP and several others levy no professional tax at all.
  DL: [{ fromMinor: 0n, toMinor: null, amountMinor: 0n }],
  HR: [{ fromMinor: 0n, toMinor: null, amountMinor: 0n }],
  UP: [{ fromMinor: 0n, toMinor: null, amountMinor: 0n }],
};

export interface PtResult {
  amountMinor: Minor;
  stateCode: string;
  isLevied: boolean;
  note?: string;
}

/**
 * Professional tax for one month.
 *
 * An unknown state returns zero WITH a note rather than silently deducting
 * nothing. A zero that looks identical to "this state has no PT" is how a
 * missing configuration survives to the first assessment notice.
 */
export function calculateProfessionalTax(
  monthlyGrossMinor: Minor,
  stateCode: string,
  month?: number,
  slabs: Record<string, PtSlab[]> = PT_SLABS
): PtResult {
  const code = stateCode.trim().toUpperCase();
  const table = slabs[code];

  if (!table) {
    return {
      amountMinor: 0n,
      stateCode: code,
      isLevied: false,
      note: `No professional tax slabs configured for ${code}. Verify before filing.`,
    };
  }

  const slab = table.find(
    (s) => monthlyGrossMinor >= s.fromMinor && (s.toMinor === null || monthlyGrossMinor < s.toMinor)
  );

  if (!slab) {
    return { amountMinor: 0n, stateCode: code, isLevied: false, note: "Below the lowest slab" };
  }

  // Maharashtra charges ₹300 in February instead of ₹200, so the annual total
  // reaches the ₹2,500 statutory maximum. Missing it under-deducts by ₹100 a
  // year for every employee in the state.
  if (code === "MH" && month === 2 && slab.amountMinor === 200_00n) {
    return {
      amountMinor: 300_00n,
      stateCode: code,
      isLevied: true,
      note: "February rate, bringing the annual total to the ₹2,500 maximum",
    };
  }

  return { amountMinor: slab.amountMinor, stateCode: code, isLevied: slab.amountMinor > 0n };
}

// ─── Gratuity ────────────────────────────────────────────────

export interface GratuityResult {
  isEligible: boolean;
  yearsOfService: number;
  amountMinor: Minor;
  cappedAmountMinor: Minor;
  reason?: string;
}

/**
 * Gratuity under the Payment of Gratuity Act, 1972.
 *
 * Formula: last drawn basic + DA × 15 ÷ 26 × completed years. The 26 is
 * working days in a month, not calendar days — using 30 understates every
 * payment by about 13%.
 *
 * A part-year over six months counts as a full year, per the Act and settled
 * case law. Truncating instead costs a fifteen-year employee a whole year's
 * gratuity.
 */
export function calculateGratuity(
  lastDrawnBasicPlusDaMinor: Minor,
  joinDate: string,
  exitDate: string,
  options: { ceilingMinor?: Minor; isDeathOrDisablement?: boolean } = {}
): GratuityResult {
  const ceiling = options.ceilingMinor ?? 20_00_000_00n;
  const months = monthsBetween(joinDate, exitDate);

  if (months < 0) {
    throw new Error("An exit date cannot precede the join date");
  }

  const completedYears = Math.floor(months / 12);
  const remainderMonths = months % 12;
  const yearsOfService = remainderMonths >= 6 ? completedYears + 1 : completedYears;

  // The five-year qualifying period is waived where service ends through death
  // or disablement.
  if (completedYears < 5 && !options.isDeathOrDisablement) {
    return {
      isEligible: false,
      yearsOfService,
      amountMinor: 0n,
      cappedAmountMinor: 0n,
      reason: `${completedYears} completed years; the Act requires 5 unless service ends through death or disablement`,
    };
  }

  const amountMinor =
    (lastDrawnBasicPlusDaMinor * 15n * BigInt(yearsOfService)) / 26n;

  return {
    isEligible: true,
    yearsOfService,
    amountMinor,
    // Anything above the ceiling is taxable, but it is still payable — the cap
    // is on the tax exemption, not on the entitlement.
    cappedAmountMinor: amountMinor > ceiling ? ceiling : amountMinor,
  };
}

// ─── Income tax ──────────────────────────────────────────────

export interface TaxSlab {
  fromMinor: Minor;
  toMinor: Minor | null;
  rate: number;
}

/** New regime slabs, FY 2025-26 (Finance Act 2025). */
export const NEW_REGIME_SLABS_FY2526: TaxSlab[] = [
  { fromMinor: 0n, toMinor: 4_00_000_00n, rate: 0 },
  { fromMinor: 4_00_000_00n, toMinor: 8_00_000_00n, rate: 5 },
  { fromMinor: 8_00_000_00n, toMinor: 12_00_000_00n, rate: 10 },
  { fromMinor: 12_00_000_00n, toMinor: 16_00_000_00n, rate: 15 },
  { fromMinor: 16_00_000_00n, toMinor: 20_00_000_00n, rate: 20 },
  { fromMinor: 20_00_000_00n, toMinor: 24_00_000_00n, rate: 25 },
  { fromMinor: 24_00_000_00n, toMinor: null, rate: 30 },
];

/** Old regime slabs, unchanged for those under 60. */
export const OLD_REGIME_SLABS: TaxSlab[] = [
  { fromMinor: 0n, toMinor: 2_50_000_00n, rate: 0 },
  { fromMinor: 2_50_000_00n, toMinor: 5_00_000_00n, rate: 5 },
  { fromMinor: 5_00_000_00n, toMinor: 10_00_000_00n, rate: 20 },
  { fromMinor: 10_00_000_00n, toMinor: null, rate: 30 },
];

export interface SurchargeBand {
  aboveMinor: Minor;
  rate: number;
}

/** Surcharge is capped at 25% under the new regime, 37% under the old. */
export const SURCHARGE_NEW: SurchargeBand[] = [
  { aboveMinor: 50_00_000_00n, rate: 10 },
  { aboveMinor: 1_00_00_000_00n, rate: 15 },
  { aboveMinor: 2_00_00_000_00n, rate: 25 },
];

export interface TaxResult {
  taxableIncomeMinor: Minor;
  slabTaxMinor: Minor;
  rebateMinor: Minor;
  surchargeMinor: Minor;
  cessMinor: Minor;
  totalTaxMinor: Minor;
  effectiveRate: number;
}

/**
 * Income tax on an annual taxable income.
 *
 * Slabs are marginal: only the income within each band is taxed at that band's
 * rate. Applying a single rate to the whole amount — which happens more often
 * than it should — overstates tax by tens of thousands of rupees.
 */
export function calculateIncomeTax(
  taxableIncomeMinor: Minor,
  options: {
    slabs?: TaxSlab[];
    /** Section 87A: full rebate up to this income. */
    rebateThresholdMinor?: Minor;
    rebateCapMinor?: Minor;
    surchargeBands?: SurchargeBand[];
    cessRate?: number;
  } = {}
): TaxResult {
  const slabs = options.slabs ?? NEW_REGIME_SLABS_FY2526;
  const cessRate = options.cessRate ?? 4;

  if (taxableIncomeMinor <= 0n) {
    return {
      taxableIncomeMinor: 0n,
      slabTaxMinor: 0n,
      rebateMinor: 0n,
      surchargeMinor: 0n,
      cessMinor: 0n,
      totalTaxMinor: 0n,
      effectiveRate: 0,
    };
  }

  let slabTaxMinor = 0n;

  for (const slab of slabs) {
    if (taxableIncomeMinor <= slab.fromMinor) break;

    const upper =
      slab.toMinor === null || taxableIncomeMinor < slab.toMinor
        ? taxableIncomeMinor
        : slab.toMinor;

    slabTaxMinor += percentOf(upper - slab.fromMinor, slab.rate);
  }

  // Section 87A. The rebate wipes out the tax entirely below the threshold,
  // which is why someone on ₹11,90,000 pays nothing and someone on ₹12,10,000
  // pays a great deal.
  const rebateThreshold = options.rebateThresholdMinor ?? 12_00_000_00n;
  const rebateCap = options.rebateCapMinor ?? 60_000_00n;

  const rebateMinor =
    taxableIncomeMinor <= rebateThreshold
      ? slabTaxMinor > rebateCap
        ? rebateCap
        : slabTaxMinor
      : 0n;

  const afterRebate = slabTaxMinor - rebateMinor;

  const bands = options.surchargeBands ?? SURCHARGE_NEW;
  const applicable = [...bands]
    .sort((a, b) => (a.aboveMinor > b.aboveMinor ? -1 : 1))
    .find((b) => taxableIncomeMinor > b.aboveMinor);

  const surchargeMinor = applicable ? percentOf(afterRebate, applicable.rate) : 0n;
  const cessMinor = percentOf(afterRebate + surchargeMinor, cessRate);
  const totalTaxMinor = afterRebate + surchargeMinor + cessMinor;

  return {
    taxableIncomeMinor,
    slabTaxMinor,
    rebateMinor,
    surchargeMinor,
    cessMinor,
    totalTaxMinor,
    effectiveRate:
      Math.round((Number(totalTaxMinor) / Number(taxableIncomeMinor)) * 10_000) / 100,
  };
}

/**
 * Monthly TDS from the projected annual liability.
 *
 * Spread over the months remaining in the financial year, with tax already
 * deducted subtracted. Dividing the annual figure by twelve regardless leaves
 * a large catch-up in March, which is the complaint every payroll team gets
 * every year.
 */
export function monthlyTds(
  annualTaxMinor: Minor,
  taxAlreadyDeductedMinor: Minor,
  monthsRemaining: number
): Minor {
  if (monthsRemaining <= 0) return annualTaxMinor - taxAlreadyDeductedMinor;

  const outstanding = annualTaxMinor - taxAlreadyDeductedMinor;
  if (outstanding <= 0n) return 0n;

  return outstanding / BigInt(monthsRemaining);
}

// ─── Labour Welfare Fund ─────────────────────────────────────

export interface LwfRate {
  employeeMinor: Minor;
  employerMinor: Minor;
  /** Months in which it is deducted, 1-indexed. */
  months: number[];
}

/** Another state levy, with wildly different amounts and frequencies. */
export const LWF_RATES: Record<string, LwfRate> = {
  KA: { employeeMinor: 20_00n, employerMinor: 40_00n, months: [12] },
  MH: { employeeMinor: 12_00n, employerMinor: 36_00n, months: [6, 12] },
  TN: { employeeMinor: 20_00n, employerMinor: 40_00n, months: [12] },
  DL: { employeeMinor: 75n, employerMinor: 225n, months: [6, 12] },
  HR: { employeeMinor: 31_00n, employerMinor: 62_00n, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
};

export function calculateLwf(
  stateCode: string,
  month: number,
  rates: Record<string, LwfRate> = LWF_RATES
): { employeeMinor: Minor; employerMinor: Minor; isLevied: boolean } {
  const rate = rates[stateCode.trim().toUpperCase()];

  if (!rate || !rate.months.includes(month)) {
    return { employeeMinor: 0n, employerMinor: 0n, isLevied: false };
  }

  return {
    employeeMinor: rate.employeeMinor,
    employerMinor: rate.employerMinor,
    isLevied: true,
  };
}

// ─── Dates ───────────────────────────────────────────────────

export function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);

  if ([fy, fm, fd, ty, tm, td].some(Number.isNaN)) {
    throw new Error("Dates must be YYYY-MM-DD");
  }

  let months = (ty - fy) * 12 + (tm - fm);
  if (td < fd) months -= 1;
  return months;
}

/** The Indian financial year a date falls in, e.g. "2025-26". */
export function financialYear(date: string): string {
  const [year, month] = date.split("-").map(Number);
  if (Number.isNaN(year) || Number.isNaN(month)) {
    throw new Error("Dates must be YYYY-MM-DD");
  }
  // April to March, so January belongs to the year that started the previous
  // April.
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}
