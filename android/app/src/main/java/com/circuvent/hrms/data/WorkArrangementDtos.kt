package com.circuvent.hrms.data

import kotlinx.serialization.Serializable

// ═══════════════════════════════════════════════════════════════
// DTOs — working from home, and being on duty elsewhere
// ═══════════════════════════════════════════════════════════════
//
// Not leave. A day worked from home is a day worked, and the app should never
// present it as spending a balance.

@Serializable
data class WorkArrangementDto(
    val id: String,
    val employeeId: String = "",
    val employeeName: String = "",
    /** "wfh" or "on_duty". */
    val kind: String = "wfh",
    val startDate: String = "",
    val endDate: String = "",
    val reason: String? = null,
    val location: String? = null,
    val status: String = "pending",
    val decisionReason: String? = null,
)

@Serializable
data class WorkArrangementLimitsDto(
    val maxFutureDays: Int = 90,
    val maxPastDays: Int = 7,
)

@Serializable
data class WorkArrangementsResponse(
    val requests: List<WorkArrangementDto> = emptyList(),
    val limits: WorkArrangementLimitsDto = WorkArrangementLimitsDto(),
)

@Serializable
data class WorkArrangementCreate(
    val kind: String,
    val startDate: String,
    val endDate: String,
    val reason: String? = null,
    val location: String? = null,
)
