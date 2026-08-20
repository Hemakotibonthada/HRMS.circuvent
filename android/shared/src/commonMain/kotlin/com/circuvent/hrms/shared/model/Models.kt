package com.circuvent.hrms.shared.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The wire types, shared by both apps.
 *
 * Defined once so a field the web API renames cannot be right on Android and
 * wrong on iOS. Every property here corresponds to something the HRMS API
 * actually returns; nothing is invented for the convenience of a screen.
 *
 * Nullable almost everywhere on purpose. A mobile client talking to an API it
 * does not deploy in lockstep with will meet a response missing a field it
 * expected, and a non-null Kotlin property turns that into a crash on launch
 * rather than a gap in one row.
 */

@Serializable
data class Session(
    val id: String,
    val email: String,
    val displayName: String? = null,
    val role: String? = null,
    val orgId: String? = null,
    val orgName: String? = null,
    /**
     * The employment record, which is not the account.
     *
     * `id` above is the login. Everything in HR is keyed by the employee row,
     * and the two are different uuids joined by `employees.user_id`. Sending
     * one where the other is meant is what made clocking in answer "Employee
     * <uuid> not found" and made every self-approval check refuse nobody.
     *
     * Null when the account has no employment record — a service mailbox, or
     * somebody whose login was provisioned before HR created their row.
     */
    val employeeId: String? = null,
    /** The code a person quotes to HR or reads off a badge, e.g. CIR-0042. */
    val employeeCode: String? = null,
    /**
     * The photograph, when there is one.
     *
     * `/api/auth/me` returns it and this type did not carry it, so every client
     * on this module drew initials for people who had uploaded a picture.
     */
    val avatarUrl: String? = null,
)

@Serializable
data class Employee(
    val id: String,
    val employeeCode: String? = null,
    val firstName: String? = null,
    val lastName: String? = null,
    val fullName: String? = null,
    val email: String? = null,
    val phone: String? = null,
    val designation: String? = null,
    val departmentName: String? = null,
    val joinDate: String? = null,
    val status: String? = null,
    val avatarUrl: String? = null,
) {
    /** What to show when the API supplies parts but not the whole. */
    val displayName: String
        get() = fullName?.takeIf { it.isNotBlank() }
            ?: listOfNotNull(firstName, lastName).joinToString(" ").ifBlank { email ?: "Unknown" }

    /** Initials for an avatar placeholder, never more than two letters. */
    val initials: String
        get() = displayName
            .split(" ")
            .filter { it.isNotBlank() }
            .take(2)
            .joinToString("") { it.first().uppercase() }
}

@Serializable
data class LeaveBalance(
    val leaveType: String,
    val year: Int? = null,
    val openingDays: Double = 0.0,
    val accruedDays: Double = 0.0,
    val carryForwardDays: Double = 0.0,
    val usedDays: Double = 0.0,
    val pendingDays: Double = 0.0,
) {
    val available: Double
        get() = maxOf(0.0, openingDays + accruedDays + carryForwardDays - usedDays - pendingDays)
}

@Serializable
data class LeaveRequest(
    val id: String,
    val employeeId: String? = null,
    val employeeName: String? = null,
    val leaveType: String,
    val startDate: String,
    val endDate: String,
    val totalDays: Double? = null,
    val isHalfDay: Boolean = false,
    val reason: String? = null,
    val status: String = "pending",
    val appliedAt: String? = null,
    val rejectionReason: String? = null,
)

@Serializable
data class AttendanceRecord(
    val id: String,
    /**
     * The API calls this `workDate`, and these three were named for what a
     * screen wanted to call them rather than for what the server sends. The
     * result was a required field that never arrived: every attendance read
     * failed to deserialise, on every client using this module.
     *
     * Defaulted rather than required, on the same reasoning as the note at the
     * top of this file — a missing field should leave a gap in one row, not
     * fail the whole response.
     */
    @SerialName("workDate") val date: String = "",
    @SerialName("clockInAt") val checkInAt: String? = null,
    @SerialName("clockOutAt") val checkOutAt: String? = null,
    val status: String? = null,
    val workedMinutes: Int? = null,
    val location: String? = null,
)

@Serializable
data class Payslip(
    val id: String,
    val month: Int,
    val year: Int,
    val grossPay: Double? = null,
    val netPay: Double? = null,
    val totalDeductions: Double? = null,
    val status: String? = null,
    @SerialName("paymentMode") val paymentMode: String? = null,
) {
    val period: String
        get() {
            val names = listOf(
                "January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December",
            )
            return "${names.getOrElse(month - 1) { "Month $month" }} $year"
        }
}

@Serializable
data class Holiday(
    val id: String? = null,
    val name: String,
    /** The API calls this `holidayDate`. */
    @SerialName("holidayDate") val date: String = "",
    val type: String? = null,
    val isOptional: Boolean = false,
)

@Serializable
data class Announcement(
    val id: String,
    val title: String,
    val body: String? = null,
    val publishedAt: String? = null,
    val priority: String? = null,
)

@Serializable
data class HelpdeskTicket(
    val id: String,
    val ticketNumber: String? = null,
    val subject: String,
    val description: String? = null,
    val category: String? = null,
    val priority: String = "normal",
    val status: String = "open",
    val createdAt: String? = null,
    val updatedAt: String? = null,
)

@Serializable
data class ExpenseClaim(
    val id: String,
    val claimNumber: String? = null,
    val title: String? = null,
    val totalAmount: Double? = null,
    val currency: String = "INR",
    val status: String = "pending",
    val submittedAt: String? = null,
)

@Serializable
data class NotificationItem(
    val id: String,
    val title: String,
    val body: String? = null,
    val actionUrl: String? = null,
    val priority: String? = null,
)

@Serializable
data class DocumentSummary(
    val id: String,
    val title: String,
    val category: String? = null,
    val status: String,
    val sentAt: String? = null,
    val completedAt: String? = null,
)

/** Paged list envelope, as the API returns it. */
@Serializable
data class Page<T>(
    val items: List<T> = emptyList(),
    val total: Int = 0,
    val page: Int = 1,
    val pageSize: Int = 50,
    val hasMore: Boolean = false,
)

// ─── Team ────────────────────────────────────────────────────

/**
 * Who is away, and whose day it is.
 *
 * Birthdays carry no year. The day and month are what a colleague needs to say
 * happy birthday; the year is somebody's age, and an HR system publishing that
 * to everyone is a disclosure nobody consented to. Anniversaries do carry it,
 * because length of service is a fact about the job and "ten years today" is
 * the entire point of mentioning it.
 */
@Serializable
data class TeamPulse(
    val teamSize: Int = 0,
    val onLeave: List<AwayColleague> = emptyList(),
    val birthdays: List<Celebration> = emptyList(),
    val anniversaries: List<Celebration> = emptyList(),
)

@Serializable
data class AwayColleague(
    val employeeId: String,
    val name: String,
    val leaveType: String? = null,
    val startDate: String? = null,
    val endDate: String? = null,
    val today: Boolean = false,
)

@Serializable
data class Celebration(
    val employeeId: String,
    val name: String,
    val designation: String? = null,
    val on: String? = null,
    val isToday: Boolean = false,
    val years: Int? = null,
)

// ─── Working somewhere else, and correcting a day ────────────

/** A request to work from home or on duty. This is not leave. */
@Serializable
data class WorkArrangementRequest(
    val id: String,
    val employeeId: String? = null,
    val employeeName: String? = null,
    val kind: String = "wfh",
    val startDate: String = "",
    val endDate: String = "",
    val reason: String? = null,
    val location: String? = null,
    val status: String = "pending",
)

/** A correction to a day the reader missed. */
@Serializable
data class RegularisationRequest(
    val id: String,
    val employeeId: String? = null,
    val employeeName: String? = null,
    val workDate: String = "",
    val requestedClockIn: String? = null,
    val requestedClockOut: String? = null,
    val reason: String? = null,
    val note: String? = null,
    val status: String = "pending",
)

/**
 * Today's punch, and the boundary it is judged against.
 *
 * The fence is null for remote and field staff, whose location has no
 * coordinates. A client must read that as "clock in from anywhere" rather than
 * as an error, or home-based employees can never punch.
 */
@Serializable
data class ClockState(
    val record: AttendanceRecord? = null,
    val fence: Geofence? = null,
)

@Serializable
data class Geofence(
    val id: String? = null,
    val name: String? = null,
    val latitude: Double? = null,
    val longitude: Double? = null,
    val radiusMetres: Double? = null,
)

// ─── Who is in ───────────────────────────────────────────────

/**
 * One colleague's day.
 *
 * `presence` is decided by the server so that three clients cannot reach three
 * different conclusions about whether somebody was late. A client chooses the
 * words and the colour; it does not make the judgement.
 *
 * `clockInLocal` is the wall-clock time in the zone the working day is measured
 * in, already formatted. Clients must not slice the ISO instant themselves —
 * that is UTC, and a punch at 00:30 IST reads as 19:00 the previous evening.
 */
@Serializable
data class TeamMemberDay(
    val employeeId: String = "",
    val name: String = "",
    val designation: String = "",
    val avatarUrl: String? = null,
    /** on_leave | off | late | in | not_in | absent */
    val presence: String = "not_in",
    val clockInAt: String? = null,
    val clockOutAt: String? = null,
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
    @SerialName("not_in") val notIn: Int = 0,
    val late: Int = 0,
    @SerialName("in") val present: Int = 0,
)

@Serializable
data class TeamAttendance(
    val date: String = "",
    val isToday: Boolean = true,
    val counts: TeamAttendanceCounts = TeamAttendanceCounts(),
    val members: List<TeamMemberDay> = emptyList(),
)

// ─── People, and saying thank you ────────────────────────────

/**
 * A colleague, from the name-only lookup.
 *
 * Deliberately not [Employee]: that carries work email, phone and join date
 * from an endpoint only HR roles may call. This is what it takes to recognise
 * and address somebody, and it is available to everyone signed in.
 */
@Serializable
data class Colleague(
    val id: String = "",
    val fullName: String = "",
    val designation: String = "",
    val departmentName: String? = null,
    val avatarUrl: String? = null,
)

/**
 * One piece of recognition.
 *
 * `fromName` is resolved by the server from the session that wrote it, never
 * from anything the sender typed.
 */
@Serializable
data class Praise(
    val id: String = "",
    val createdAt: String? = null,
    val value: String = "",
    val message: String = "",
    val toName: String = "",
    val toAvatarUrl: String? = null,
    val fromName: String? = null,
)

// ─── Your own record ─────────────────────────────────────────

/**
 * The details an employee owns about themselves.
 *
 * Only the self-editable subset plus the few read-only facts a person needs to
 * check. Pay, bank details and statutory identifiers are deliberately not here:
 * the endpoint behind this does not return them, and a client type that names
 * them invites a screen that expects them.
 */
@Serializable
data class MyDetails(
    val id: String = "",
    val firstName: String = "",
    val lastName: String = "",
    val employeeCode: String = "",
    val workEmail: String = "",
    val personalEmail: String? = null,
    val phone: String? = null,
    val avatarUrl: String? = null,
    val dateOfBirth: String? = null,
    val bloodGroup: String? = null,
    val maritalStatus: String? = null,
    val addressLine1: String? = null,
    val city: String? = null,
    val state: String? = null,
    val postalCode: String? = null,
    val country: String? = null,
    val designation: String? = null,
    val joinDate: String? = null,
    /** Set once. HR corrects it afterwards, because it decides statutory age. */
    val dateOfBirthLocked: Boolean = false,
)

// ─── The wall ────────────────────────────────────────────────

@Serializable
data class WallPost(
    val id: String = "",
    val author: String = "",
    val department: String = "",
    val content: String = "",
    val tags: List<String> = emptyList(),
    val likes: Int = 0,
    val createdAt: String = "",
    val liked: Boolean = false,
    val type: String = "post",
)

@Serializable
data class WallComment(
    val id: String = "",
    val createdAt: String? = null,
    val body: String = "",
    val authorName: String? = null,
    val authorAvatarUrl: String? = null,
)

// ─── Money owed ──────────────────────────────────────────────

@Serializable
data class LoanRequest(
    val id: String = "",
    val kind: String = "",
    val principalMinor: Long = 0,
    val outstandingMinor: Long = 0,
    val months: Int = 0,
    val status: String = "pending",
    val purpose: String? = null,
    val requestedAt: String? = null,
)

/**
 * What this employee may borrow.
 *
 * Measured on recorded monthly basic pay, never estimated from CTC. An
 * indicative payslip can fall back to a percentage; a decision about how much
 * money somebody may have cannot.
 */
@Serializable
data class LoanLimit(
    val kind: String = "",
    val months: Int = 0,
    val maxMinor: Long = 0,
)

@Serializable
data class LoanOverview(
    val items: List<LoanRequest> = emptyList(),
    val limits: List<LoanLimit> = emptyList(),
    val outstandingMinor: Long = 0,
    val monthlyBasicMinor: Long? = null,
)

// ─── Performance ─────────────────────────────────────────────

@Serializable
data class ReviewCycle(
    val id: String = "",
    val name: String = "",
    val status: String = "",
    val startDate: String? = null,
    val endDate: String? = null,
)

@Serializable
data class Goal(
    val id: String = "",
    val title: String = "",
    val description: String? = null,
    val status: String = "",
    /** 0-100. Refused on a parent goal, which computes from its children. */
    val progressPercent: Int = 0,
    val weightage: Int? = null,
    val parentGoalId: String? = null,
    val dueDate: String? = null,
)

// ─── Tax ─────────────────────────────────────────────────────

@Serializable
data class TaxDeclarationItem(
    val section: String = "",
    val label: String = "",
    val declaredMinor: Long = 0,
    val provedMinor: Long = 0,
    val capMinor: Long? = null,
)

@Serializable
data class TaxDeclaration(
    val regime: String = "",
    val financialYear: String = "",
    val items: List<TaxDeclarationItem> = emptyList(),
    val annualRentMinor: Long = 0,
    val metroCity: Boolean = false,
)

// ─── Benefits, assets, learning, shifts ──────────────────────

@Serializable
data class BenefitPlan(
    val id: String = "",
    val name: String = "",
    val category: String? = null,
    val description: String? = null,
    val employeeContributionMinor: Long? = null,
)

@Serializable
data class BenefitEnrolment(
    val id: String = "",
    val planId: String = "",
    val planName: String? = null,
    val status: String = "",
    val enrolledAt: String? = null,
)

@Serializable
data class AssetItem(
    val id: String = "",
    val assetTag: String? = null,
    val name: String = "",
    val category: String? = null,
    val status: String = "",
    val assignedAt: String? = null,
)

@Serializable
data class Course(
    val id: String = "",
    val title: String = "",
    val description: String? = null,
    val category: String? = null,
    val durationMinutes: Int? = null,
    val isMandatory: Boolean = false,
)

@Serializable
data class Enrolment(
    val id: String = "",
    val courseId: String = "",
    val courseTitle: String? = null,
    val status: String = "",
    val progressPercent: Int = 0,
    val completedAt: String? = null,
)

@Serializable
data class ShiftSwap(
    val id: String = "",
    val requesterName: String? = null,
    val shiftDate: String = "",
    val status: String = "pending",
    val note: String? = null,
)
