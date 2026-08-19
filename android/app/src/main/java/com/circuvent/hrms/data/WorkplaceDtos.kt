package com.circuvent.hrms.data

import kotlinx.serialization.Serializable

// ═══════════════════════════════════════════════════════════════
// DTOs — directory, announcements, holidays, expenses
// ═══════════════════════════════════════════════════════════════
//
// Field names are taken from the live responses rather than guessed. A name
// that does not match deserialises to its default and the screen shows a
// confident, empty value — which is how the leave screen came to read
// "5 of 0 days" for a year.

// ─── Directory ───────────────────────────────────────────────

@Serializable
data class DirectoryEmployeeDto(
    val id: String,
    val employeeCode: String = "",
    val firstName: String = "",
    val lastName: String = "",
    val fullName: String = "",
    val email: String = "",
    val phone: String? = null,
    val departmentName: String? = null,
    val designation: String = "",
    val status: String = "",
    val joinDate: String? = null,
)

@Serializable
data class DirectoryResponse(
    val items: List<DirectoryEmployeeDto> = emptyList(),
    val total: Int = 0,
    val hasMore: Boolean = false,
)

// ─── Announcements ───────────────────────────────────────────

@Serializable
data class AnnouncementDto(
    val id: String,
    val title: String = "",
    val body: String = "",
    val category: String? = null,
    val priority: String? = null,
    val isPinned: Boolean = false,
    val publishedAt: String? = null,
    val expiresAt: String? = null,
)

@Serializable
data class AnnouncementsResponse(
    val items: List<AnnouncementDto> = emptyList(),
    val count: Int = 0,
)

// ─── Holidays ────────────────────────────────────────────────

@Serializable
data class HolidayDto(
    val id: String,
    val name: String = "",
    val holidayDate: String = "",
    /** Optional holidays are chosen from a pool rather than granted. */
    val isOptional: Boolean = false,
    val year: Int = 0,
    val description: String? = null,
)

@Serializable
data class HolidaysResponse(
    val items: List<HolidayDto> = emptyList(),
    val count: Int = 0,
)

// ─── Expenses ────────────────────────────────────────────────

/**
 * An expense claim.
 *
 * `amount` is a convenience in rupees and `amountMinor` is the authoritative
 * figure in paise. The server's own comment says not to sum the former, so the
 * screen displays `amount` and never adds it up.
 */
@Serializable
data class ExpenseClaimDto(
    val id: String,
    val claimNumber: String = "",
    val title: String = "",
    val category: String = "",
    val expenseDate: String = "",
    val description: String? = null,
    val status: String = "",
    val amount: Double = 0.0,
    val amountMinor: String = "0",
    val receipts: List<String> = emptyList(),
)

@Serializable
data class ExpensesResponse(
    val items: List<ExpenseClaimDto> = emptyList(),
)

@Serializable
data class ExpenseSubmission(
    val title: String,
    val category: String,
    val expenseDate: String,
    val amountMinor: String,
    val description: String? = null,
)

// ─── The team ────────────────────────────────────────────────

@Serializable
data class TeamAbsenceDto(
    val employeeId: String = "",
    val name: String = "",
    val leaveType: String = "",
    val startDate: String = "",
    val endDate: String = "",
    /** True when the absence covers today rather than starting later. */
    val today: Boolean = false,
)

/**
 * A birthday, without the year.
 *
 * The server does not send a year and this cannot ask for one. Day and month
 * are what a colleague needs; the year is somebody's age.
 */
@Serializable
data class TeamBirthdayDto(
    val employeeId: String = "",
    val name: String = "",
    val designation: String = "",
    val on: String = "",
    val isToday: Boolean = false,
)

@Serializable
data class TeamAnniversaryDto(
    val employeeId: String = "",
    val name: String = "",
    val designation: String = "",
    val on: String = "",
    val years: Int = 0,
    val isToday: Boolean = false,
)

@Serializable
data class TeamPulseResponse(
    val teamSize: Int = 0,
    val onLeave: List<TeamAbsenceDto> = emptyList(),
    val birthdays: List<TeamBirthdayDto> = emptyList(),
    val anniversaries: List<TeamAnniversaryDto> = emptyList(),
)
