package com.circuvent.hrms.data

import kotlinx.serialization.Serializable

// ═══════════════════════════════════════════════════════════════
// DTOs — employee loans
// ═══════════════════════════════════════════════════════════════
//
// Money as strings, for the same reason as the tax DTOs: a rupee figure in
// paise leaves the range JSON numbers carry exactly at crore scale.

@Serializable
data class LoanScheduleRowDto(
    val index: Int = 0,
    val month: Int = 0,
    val year: Int = 0,
    val principalMinor: String = "0",
    val interestMinor: String = "0",
    val totalMinor: String = "0",
    val closingBalanceMinor: String = "0",
)

/**
 * The taxable value of a concession, or an admission that it is not known.
 *
 * `known = false` is not the same as nothing being taxable. It means the
 * benchmark rate has not been configured, and the screen says so rather than
 * showing a zero somebody would reasonably read as "no tax to pay".
 */
@Serializable
data class LoanPerquisiteDto(
    val known: Boolean = false,
    val taxableMinor: String? = null,
    val exempt: Boolean = false,
    val note: String? = null,
)

@Serializable
data class LoanDto(
    val id: String,
    val loanType: String = "",
    val purpose: String? = null,
    val status: String = "pending",
    val principalMinor: String = "0",
    val interestRatePercent: Double = 0.0,
    val tenureMonths: Int = 0,
    val instalmentMinor: String = "0",
    val recoveredMinor: String = "0",
    val outstandingMinor: String = "0",
    val instalmentsPaid: Int = 0,
    val schedule: List<LoanScheduleRowDto> = emptyList(),
    val perquisite: LoanPerquisiteDto = LoanPerquisiteDto(),
)

@Serializable
data class LoansResponse(
    val financialYear: Int = 0,
    val loans: List<LoanDto> = emptyList(),
)

@Serializable
data class LoanRequest(
    val loanType: String,
    val principalMinor: String,
    val tenureMonths: Int,
    val purpose: String? = null,
)
