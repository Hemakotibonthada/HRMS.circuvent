package com.circuvent.hrms.data

import kotlinx.serialization.Serializable

// ═══════════════════════════════════════════════════════════════
// DTOs — attendance regularisation
// ═══════════════════════════════════════════════════════════════
//
// Correcting a day the reader missed, or a punch somebody forgot.

/** The organisation's rules, sent with the list so the form can enforce them. */
@Serializable
data class RegularisationPolicyDto(
    val windowDays: Int = 30,
    val monthlyLimit: Int = 3,
    val requiresNote: Boolean = true,
    val reasonsNeedingProof: List<String> = emptyList(),
)

@Serializable
data class RegularisationDto(
    val id: String,
    val employeeId: String = "",
    val employeeName: String = "",
    val attendanceDate: String = "",
    val reason: String = "",
    val note: String? = null,
    val inTime: String? = null,
    val outTime: String? = null,
    val status: String = "pending",
    /** "normal", or "adjustment" where the month has already been paid. */
    val routing: String = "normal",
    val decisionReason: String? = null,
)

@Serializable
data class RegularisationListResponse(
    val requests: List<RegularisationDto> = emptyList(),
    val policy: RegularisationPolicyDto = RegularisationPolicyDto(),
)

@Serializable
data class RegularisationCreate(
    val date: String,
    val reason: String,
    val note: String? = null,
    val inTime: String? = null,
    val outTime: String? = null,
    val hasProof: Boolean = false,
)

@Serializable
data class RegularisationCreated(
    val id: String = "",
    val routing: String = "normal",
    val notes: List<String> = emptyList(),
)

/** One reason the server refused, with the field it belongs to. */
@Serializable
data class RegularisationProblem(
    val field: String = "",
    val message: String = "",
)

@Serializable
data class RegularisationRefusal(
    val error: String = "",
    val problems: List<RegularisationProblem> = emptyList(),
)
