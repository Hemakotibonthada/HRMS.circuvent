package com.circuvent.hrms.domain

import java.time.LocalDate
import java.time.format.DateTimeParseException

/**
 * LEAVE RULES — client-side validation
 *
 * Pure and tested. The server validates all of this again — it must, because
 * the phone is not trusted — but a form that only tells you what is wrong after
 * a round trip is painful on a mobile connection, and this is a form people
 * fill in while walking.
 *
 * Dates are `java.time.LocalDate`, which is available from API 26 and is the
 * one real improvement this rewrite gets for free. The JavaScript this replaces
 * had to handle dates as strings throughout and say so in a paragraph of
 * comment, because `new Date("2026-03-01")` parses as UTC midnight and in any
 * timezone west of Greenwich reads back as the 28th of February. Leave spans
 * were shortened by a day by exactly that. A `LocalDate` has no timezone to get
 * wrong.
 */
object LeaveRules {

    enum class Field { TYPE, START_DATE, END_DATE, REASON }

    data class Draft(
        val leaveType: String,
        val startDate: String,
        val endDate: String,
        val isHalfDay: Boolean,
        val reason: String,
    )

    /** Parses an ISO date, or null. Null means "the user is still typing". */
    fun parseDate(value: String): LocalDate? =
        try {
            // Strict: LocalDate.parse rejects "2026-3-10" and "2026-02-31",
            // which is the behaviour the hand-rolled JavaScript version needed
            // twenty lines and a leap-year comment to reproduce.
            LocalDate.parse(value)
        } catch (_: DateTimeParseException) {
            null
        }

    fun isRealDate(value: String): Boolean = parseDate(value) != null

    /**
     * Whole days between two dates, inclusive.
     *
     * Inclusive because a single-day leave is one day, not zero. Returns 0 for
     * an unreadable pair rather than throwing: the caller is a form that runs
     * this on every keystroke.
     */
    fun daysBetween(startDate: String, endDate: String): Long {
        val start = parseDate(startDate) ?: return 0
        val end = parseDate(endDate) ?: return 0
        return java.time.temporal.ChronoUnit.DAYS.between(start, end) + 1
    }

    /**
     * How much balance a draft would consume, or null when it cannot be known.
     *
     * Null rather than zero. Zero is a measurement — "this costs you nothing" —
     * and an unparseable date is the absence of one.
     */
    fun totalDays(draft: Draft): Double? {
        val start = parseDate(draft.startDate) ?: return null
        val end = parseDate(draft.endDate) ?: return null
        if (end.isBefore(start)) return null
        return if (draft.isHalfDay) 0.5 else daysBetween(draft.startDate, draft.endDate).toDouble()
    }

    fun validate(draft: Draft, today: LocalDate): Map<Field, String> {
        val errors = mutableMapOf<Field, String>()

        if (draft.leaveType.isBlank()) {
            errors[Field.TYPE] = "Choose a leave type"
        }

        val start = parseDate(draft.startDate)
        val end = parseDate(draft.endDate)

        if (start == null) errors[Field.START_DATE] = "Enter a start date as YYYY-MM-DD"
        if (end == null) errors[Field.END_DATE] = "Enter an end date as YYYY-MM-DD"

        if (start != null && end != null) {
            if (end.isBefore(start)) {
                errors[Field.END_DATE] = "The end date cannot be before the start date"
            }
            // Half day means one day. Allowing a range makes "half day"
            // ambiguous: half of which one?
            if (draft.isHalfDay && end != start) {
                errors[Field.END_DATE] = "A half day must start and end on the same date"
            }
        }

        if (start != null && start.isBefore(today)) {
            // A warning rather than a refusal would be wrong here: back-dated
            // leave is a regularisation, which is a different flow with an
            // approver who is meant to see it. Silently accepting it bypasses
            // that.
            errors[Field.START_DATE] =
                "You cannot apply for leave in the past. Ask HR to regularise it."
        }

        val reason = draft.reason.trim()
        when {
            reason.length < 3 -> errors[Field.REASON] = "Give a reason, however brief"
            reason.length > 1000 -> errors[Field.REASON] = "Keep the reason under 1000 characters"
        }

        return errors
    }
}
