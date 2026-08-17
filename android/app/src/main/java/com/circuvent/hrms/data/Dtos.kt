package com.circuvent.hrms.data

import kotlinx.serialization.Serializable

// ═══════════════════════════════════════════════════════════════
// DTOs for the screens beyond the five tabs
// ═══════════════════════════════════════════════════════════════
// Every field is defaulted. A response that omits something the server has not
// sent yet must not crash a build that predates it — the alternative is an app
// that stops working the day a column is added.

@Serializable
data class AttendanceSummaryDto(
    val month: Int = 0,
    val year: Int = 0,
    val presentDays: Int = 0,
    val absentDays: Int = 0,
    val lateDays: Int = 0,
    val halfDays: Int = 0,
    val leaveDays: Int = 0,
    val wfhDays: Int = 0,
    val totalWorkedMinutes: Int = 0,
    val totalOvertimeMinutes: Int = 0,
)

@Serializable
data class AttendanceRowDto(
    val id: String,
    val workDate: String = "",
    val clockInAt: String? = null,
    val clockOutAt: String? = null,
    val status: String = "",
    val workedMinutes: Int? = null,
    val overtimeMinutes: Int = 0,
    val lateByMinutes: Int = 0,
    val requiresLocationReview: Boolean = false,
    val isRegularized: Boolean = false,
)

@Serializable
data class AttendancePageDto(
    val items: List<AttendanceRowDto> = emptyList(),
    val total: Int = 0,
)

@Serializable
data class TicketDto(
    val id: String,
    val reference: String = "",
    val subject: String = "",
    val body: String = "",
    val requesterId: String = "",
    val priority: String = "normal",
    val state: String = "new",
    val createdAt: String = "",
    val resolutionDueAt: String? = null,
    val responseBreached: Boolean = false,
    val resolutionBreached: Boolean = false,
    val requesterName: String? = null,
)

@Serializable
data class TicketSummaryDto(
    val total: Int = 0,
    val open: Int = 0,
    val waiting: Int = 0,
    val resolved: Int = 0,
    val breached: Int = 0,
)

@Serializable
data class TicketsResponse(
    val tickets: List<TicketDto> = emptyList(),
    val summary: TicketSummaryDto = TicketSummaryDto(),
)

@Serializable
data class TicketCommentDto(
    val id: String,
    val authorId: String? = null,
    val body: String = "",
    val isInternal: Boolean = false,
    val createdAt: String = "",
)

@Serializable
data class TicketDetailResponse(
    val ticket: TicketDto,
    val comments: List<TicketCommentDto> = emptyList(),
)

@Serializable
data class PendingLeaveDto(
    val id: String,
    val employeeId: String = "",
    val employeeName: String? = null,
    val leaveType: String = "",
    val startDate: String = "",
    val endDate: String = "",
    val totalDays: Double = 0.0,
    val isHalfDay: Boolean = false,
    val reason: String = "",
    val status: String = "pending",
)

@Serializable
data class PendingLeaveResponse(val items: List<PendingLeaveDto> = emptyList())

@Serializable
data class PayslipDetailDto(
    val id: String,
    val periodMonth: Int? = null,
    val periodYear: Int? = null,
    val workingDays: Double = 0.0,
    val presentDays: Double = 0.0,
    val lopDays: Double = 0.0,
    val gross: Double = 0.0,
    val totalDeductions: Double = 0.0,
    val netPay: Double = 0.0,
    /**
     * The same amounts as exact whole paise.
     *
     * Strings because JSON has no bigint, and because a Double cannot hold
     * whole paise past roughly ₹90,071,992,547,409. The Doubles above are for
     * printing one value; anything that adds or compares should parse these
     * with [java.math.BigInteger] instead.
     */
    val grossMinor: String = "0",
    val totalDeductionsMinor: String = "0",
    val netPayMinor: String = "0",
    val status: String = "",
    val anomalies: List<String> = emptyList(),
)
