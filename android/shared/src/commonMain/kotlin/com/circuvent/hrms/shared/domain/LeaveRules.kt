package com.circuvent.hrms.shared.domain

import kotlinx.datetime.DatePeriod
import kotlinx.datetime.DayOfWeek
import kotlinx.datetime.LocalDate
import kotlinx.datetime.plus

/**
 * Leave rules, shared by both apps.
 *
 * These were `java.time` on Android and had no iOS equivalent at all, which is
 * how two native apps normally end up disagreeing: one of them re-implements
 * "does this overlap an existing request" in Swift, slightly differently, and
 * nobody notices until an employee books the same week twice from their iPad.
 *
 * Ported to `kotlinx.datetime` so there is exactly one implementation. The
 * arithmetic below is the part worth reading twice — every one of these rules
 * decides whether a real person is paid for a day.
 */
object LeaveRules {

    /** A leave request as the apps hold it, before the server has seen it. */
    data class Request(
        val id: String = "",
        val leaveType: String,
        val startDate: LocalDate,
        val endDate: LocalDate,
        val isHalfDay: Boolean = false,
        val status: String = "pending",
    )

    data class Balance(
        val leaveType: String,
        val openingDays: Double,
        val accruedDays: Double,
        val carryForwardDays: Double,
        val usedDays: Double,
        val pendingDays: Double,
    )

    sealed interface Validation {
        data object Valid : Validation
        data class Invalid(val field: String, val message: String) : Validation
    }

    /**
     * Working days between two dates, inclusive of both.
     *
     * Weekends are excluded because leave is deducted in working days: an
     * employee who takes Friday to Monday has used two days, not four, and
     * counting calendar days quietly charges them for the weekend.
     *
     * Public holidays are passed in rather than assumed — they differ by state
     * in India, and a client that hardcodes them is wrong for most of the
     * country.
     */
    fun workingDays(
        start: LocalDate,
        end: LocalDate,
        holidays: Set<LocalDate> = emptySet(),
        weekend: Set<DayOfWeek> = setOf(DayOfWeek.SATURDAY, DayOfWeek.SUNDAY),
    ): Double {
        if (end < start) return 0.0

        var day = start
        var count = 0
        while (day <= end) {
            if (day.dayOfWeek !in weekend && day !in holidays) count++
            day = day.plus(DatePeriod(days = 1))
        }
        return count.toDouble()
    }

    /** Days a request costs, taking half days into account. */
    fun requestedDays(
        request: Request,
        holidays: Set<LocalDate> = emptySet(),
    ): Double {
        // A half day is only meaningful on a single date. Marking a fortnight
        // "half day" would otherwise halve the whole request.
        if (request.isHalfDay && request.startDate == request.endDate) {
            return if (workingDays(request.startDate, request.endDate, holidays) > 0) 0.5 else 0.0
        }
        return workingDays(request.startDate, request.endDate, holidays)
    }

    /** Days still available on a balance. */
    fun available(balance: Balance): Double {
        val granted = balance.openingDays + balance.accruedDays + balance.carryForwardDays
        val gone = balance.usedDays + balance.pendingDays
        // Never negative: an approval made against a policy that later changed
        // can legitimately overdraw, and "-2 days available" reads as a bug.
        return maxOf(0.0, granted - gone)
    }

    /** Whether two requests cover any of the same days. */
    fun overlaps(a: Request, b: Request): Boolean =
        a.startDate <= b.endDate && b.startDate <= a.endDate

    /**
     * Checks a request before it is sent.
     *
     * The server validates too and must — a client check is a convenience, not
     * a control. Doing it here means the employee is told which field is wrong
     * while they are still looking at it, and on a phone, on a train, that is
     * the difference between applying and giving up.
     */
    fun validate(
        request: Request,
        today: LocalDate,
        balance: Balance?,
        existing: List<Request> = emptyList(),
        holidays: Set<LocalDate> = emptySet(),
        minNoticeDays: Int = 0,
    ): Validation {
        if (request.endDate < request.startDate) {
            return Validation.Invalid("endDate", "The end date is before the start date")
        }

        val days = requestedDays(request, holidays)
        if (days <= 0.0) {
            return Validation.Invalid(
                "startDate",
                "Those dates are all weekends or holidays"
            )
        }

        // Sick leave is applied for after the fact by definition; refusing a
        // backdated sick day is how people end up marked absent for a day they
        // were ill.
        if (request.startDate < today && request.leaveType != "sick") {
            return Validation.Invalid("startDate", "That date has already passed")
        }

        if (minNoticeDays > 0 && request.leaveType != "sick") {
            val earliest = today.plus(DatePeriod(days = minNoticeDays))
            if (request.startDate < earliest) {
                return Validation.Invalid(
                    "startDate",
                    "This leave type needs $minNoticeDays days' notice"
                )
            }
        }

        val clash = existing.firstOrNull {
            it.status != "rejected" && it.status != "cancelled" && overlaps(it, request)
        }
        if (clash != null) {
            return Validation.Invalid("startDate", "You already have leave booked on those dates")
        }

        // Unpaid leave has no balance to draw on, so a missing balance is not
        // an error for it.
        if (request.leaveType != "unpaid") {
            if (balance == null) {
                return Validation.Invalid(
                    "leaveType",
                    "You have no ${request.leaveType} balance for this year"
                )
            }
            if (days > available(balance)) {
                return Validation.Invalid(
                    "leaveType",
                    "That is $days days and you have ${available(balance)} left"
                )
            }
        }

        return Validation.Valid
    }
}
