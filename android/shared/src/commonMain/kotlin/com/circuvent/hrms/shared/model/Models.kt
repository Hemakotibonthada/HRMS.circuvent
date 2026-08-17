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
    val date: String,
    val checkInAt: String? = null,
    val checkOutAt: String? = null,
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
    val date: String,
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
