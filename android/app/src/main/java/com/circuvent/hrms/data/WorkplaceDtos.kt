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

/**
 * One colleague's day.
 *
 * `presence` is decided on the server so that the phone, the web and iOS cannot
 * reach three different conclusions about whether somebody was late. The phone
 * chooses the words and the colour; it does not make the judgement.
 */
@Serializable
data class TeamMemberDayDto(
    val employeeId: String = "",
    val name: String = "",
    val designation: String = "",
    val avatarUrl: String? = null,
    /** on_leave | off | late | in | not_in | absent */
    val presence: String = "not_in",
    val clockInAt: String? = null,
    val clockOutAt: String? = null,
    /** Wall-clock `HH:mm` in the zone the working day is measured in. */
    val clockInLocal: String? = null,
    val clockOutLocal: String? = null,
    /** Zero unless `presence` is `late`, so it is never a guess. */
    val lateByMinutes: Int = 0,
    val leaveType: String? = null,
    val workingFromHome: Boolean = false,
)

@Serializable
data class TeamAttendanceCounts(
    val all: Int = 0,
    val not_in: Int = 0,
    val late: Int = 0,
    val `in`: Int = 0,
)

@Serializable
data class TeamAttendanceResponse(
    val date: String = "",
    val isToday: Boolean = true,
    val counts: TeamAttendanceCounts = TeamAttendanceCounts(),
    val members: List<TeamMemberDayDto> = emptyList(),
)

// ─── Praise ──────────────────────────────────────────────────

/**
 * One piece of recognition.
 *
 * `fromName` is resolved by the server from the session that wrote it, not from
 * anything the sender typed. The web's older recognition let anyone type any
 * name into a "from" box and then ranked those strings.
 */
@Serializable
data class PraiseDto(
    val id: String = "",
    val createdAt: String? = null,
    val value: String = "",
    val message: String = "",
    val toName: String = "",
    val toAvatarUrl: String? = null,
    val fromName: String? = null,
)

@Serializable
data class PraiseResponse(val items: List<PraiseDto> = emptyList())

@Serializable
data class PraiseCreate(
    val toEmployeeId: String,
    val value: String,
    val message: String,
)

/**
 * A colleague, as the name-only lookup returns them.
 *
 * Deliberately not [DirectoryEmployeeDto]: that carries email, phone and join
 * date from an endpoint only HR roles may call. This is what it takes to
 * recognise somebody, available to everybody.
 */
@Serializable
data class ColleagueDto(
    val id: String = "",
    val fullName: String = "",
    val designation: String = "",
    val departmentName: String? = null,
    val avatarUrl: String? = null,
    val workEmail: String? = null,
)

@Serializable
data class ColleagueResponse(val items: List<ColleagueDto> = emptyList())

// ─── Wall comments ───────────────────────────────────────────

@Serializable
data class WallCommentDto(
    val id: String = "",
    val createdAt: String? = null,
    val body: String = "",
    val authorName: String? = null,
    val authorAvatarUrl: String? = null,
)

@Serializable
data class WallCommentResponse(val items: List<WallCommentDto> = emptyList())

@Serializable
data class WallCommentCreate(val postId: String, val body: String)
