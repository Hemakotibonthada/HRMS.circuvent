package com.circuvent.hrms.data

import kotlinx.serialization.Serializable

// ═══════════════════════════════════════════════════════════════
// DTOs — income tax declarations and Form 16
// ═══════════════════════════════════════════════════════════════
//
// Money arrives as a **string**, not a number.
//
// A rupee figure in paise leaves the range JSON's number type carries exactly
// once it reaches crore scale, and a silently rounded salary is worse than one
// that fails to parse. The server sends these as strings for that reason, and
// they are parsed here into Long only where they are about to be displayed.
//
// Every field is defaulted, like the rest of this file, so a response that
// omits something does not crash a build that predates it. That default is why
// the leave screen once read "5 of 0 days" for a year, so the fields here are
// deliberately few and the ones that matter are checked on screen rather than
// trusted.

/** A section an employee may claim, as the server defines it. */
@Serializable
data class TaxSectionDto(
    val code: String,
    val label: String = "",
    val note: String = "",
    /** Null where the section has no statutory ceiling. */
    val capMinor: String? = null,
    val sharedCapGroup: String? = null,
    val allowedInNewRegime: Boolean = false,
    val requiresProof: Boolean = false,
)

/** One claim the employee has made. */
@Serializable
data class TaxDeclarationItemDto(
    val id: String = "",
    val section: String = "",
    val declaredMinor: String = "0",
    val verifiedMinor: String? = null,
    val proofStatus: String = "awaiting",
)

/** The declaration itself: the year, the regime, and the HRA inputs. */
@Serializable
data class TaxDeclarationDto(
    val id: String = "",
    val financialYear: Int = 0,
    val regime: String = "new",
    val status: String = "draft",
    val selfOrFamilyIsSenior: Boolean = false,
    val parentsAreSenior: Boolean = false,
    val rentPaidMinor: String = "0",
    val metroCity: Boolean = false,
)

/** What each claim is actually worth once the rules are applied. */
@Serializable
data class TaxAllowedItemDto(
    val section: String = "",
    val declaredMinor: String = "0",
    val allowedMinor: String = "0",
    /** Why the allowed figure is below the declared one, when it is. */
    val reason: String? = null,
)

@Serializable
data class TaxSummaryDto(
    val totalAllowedMinor: String = "0",
    val standardDeductionMinor: String = "0",
    val totalReliefMinor: String = "0",
    val items: List<TaxAllowedItemDto> = emptyList(),
)

@Serializable
data class TaxDeclarationResponse(
    val declaration: TaxDeclarationDto = TaxDeclarationDto(),
    val items: List<TaxDeclarationItemDto> = emptyList(),
    val summary: TaxSummaryDto = TaxSummaryDto(),
    val sections: List<TaxSectionDto> = emptyList(),
)

/** One line of a saved declaration, on the way back to the server. */
@Serializable
data class TaxDeclarationItemInput(
    val section: String,
    val declaredMinor: String,
)

@Serializable
data class TaxDeclarationSave(
    val regime: String,
    val selfOrFamilyIsSenior: Boolean = false,
    val parentsAreSenior: Boolean = false,
    val rentPaidMinor: String = "0",
    val metroCity: Boolean = false,
    val items: List<TaxDeclarationItemInput> = emptyList(),
)

// ─── Form 16 ─────────────────────────────────────────────────

@Serializable
data class Form16ChapterVIALineDto(
    val section: String = "",
    val grossAmountMinor: String = "0",
    val deductibleAmountMinor: String = "0",
)

/**
 * Part B of the certificate.
 *
 * The field names carry their section references because that is how the form
 * is read; renaming them to something friendlier would make the screen easier
 * to write and the figures impossible to check against the paper form.
 */
@Serializable
data class Form16PartBDto(
    val assessmentYear: String = "",
    val regime: String = "new",
    val grossSalaryMinor: String = "0",
    val hraExemptUnder10_13AMinor: String = "0",
    val netSalaryMinor: String = "0",
    val standardDeductionUnder16_iaMinor: String = "0",
    val professionalTaxUnder16_iiiMinor: String = "0",
    val totalSection16DeductionsMinor: String = "0",
    val incomeChargeableUnderSalariesMinor: String = "0",
    val grossTotalIncomeMinor: String = "0",
    val aggregateDeductibleMinor: String = "0",
    val totalTaxableIncomeMinor: String = "0",
    val taxOnTotalIncomeMinor: String = "0",
    val rebateUnder87AMinor: String = "0",
    val surchargeMinor: String = "0",
    val cessMinor: String = "0",
    val taxPayableMinor: String = "0",
    val reliefUnder89Minor: String = "0",
    val netTaxPayableMinor: String = "0",
    val taxDeductedAtSourceMinor: String = "0",
    val balancePayableMinor: String = "0",
    val refundDueMinor: String = "0",
    val chapterVIA: List<Form16ChapterVIALineDto> = emptyList(),
)

@Serializable
data class Form16ReconciliationDto(
    val netTaxPayableMinor: String = "0",
    val taxDeductedMinor: String = "0",
    val differenceMinor: String = "0",
    val balanced: Boolean = true,
    val message: String = "",
)

@Serializable
data class Form24QQuarterDto(
    val quarter: Int = 0,
    val months: List<Int> = emptyList(),
    val amountPaidMinor: String = "0",
    val taxDeductedMinor: String = "0",
)

@Serializable
data class Form16PartADto(
    val available: Boolean = false,
    val note: String = "",
)

@Serializable
data class Form16Response(
    val financialYear: Int = 0,
    val assessmentYear: String = "",
    /** How many months of payroll the certificate covers. */
    val monthsCovered: Int = 0,
    val complete: Boolean = false,
    val partB: Form16PartBDto = Form16PartBDto(),
    val reconciliation: Form16ReconciliationDto = Form16ReconciliationDto(),
    val form24Q: List<Form24QQuarterDto> = emptyList(),
    val partA: Form16PartADto = Form16PartADto(),
)
