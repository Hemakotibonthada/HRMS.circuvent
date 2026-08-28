package com.circuvent.hrms.domain

import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToInt

/**
 * ATTENDANCE RULES — month navigation and the vocabulary of a punch
 *
 * Two things here are worth more than they look.
 *
 * The month cursor cannot be moved into the future. A future month has no
 * records, and a summary built from no records reports zero present days —
 * which renders as "you were absent for all of it". The absence of data and a
 * month of absence are different facts and the screen must not confuse them.
 *
 * The average is guarded against a zero divisor. The payroll engine in this
 * product shipped with exactly that defect: a month with no working days
 * produced Infinity, which multiplied to NaN and reached a bank payment
 * instruction.
 */
object AttendanceRules {

    enum class Tone { SUCCESS, WARNING, DANGER, NEUTRAL }

    data class Summary(
        val presentDays: Int,
        val absentDays: Int,
        val lateDays: Int,
        val halfDays: Int,
        val leaveDays: Int,
        val wfhDays: Int,
        val totalWorkedMinutes: Int,
        val totalOvertimeMinutes: Int,
    )

    data class Record(
        val id: String,
        val workDate: String,
        val clockInAt: String?,
        val clockOutAt: String?,
        val status: String,
        val workedMinutes: Int?,
        val overtimeMinutes: Int,
        val lateByMinutes: Int,
        val requiresLocationReview: Boolean,
        val isRegularized: Boolean,
    )

    private val labels = mapOf(
        "present" to "Present",
        "absent" to "Absent",
        "late" to "Late",
        "half_day" to "Half day",
        "on_leave" to "On leave",
        "wfh" to "Working from home",
        "holiday" to "Holiday",
        "weekend" to "Weekend",
    )

    private val tones = mapOf(
        "present" to Tone.SUCCESS,
        "wfh" to Tone.SUCCESS,
        "late" to Tone.WARNING,
        "half_day" to Tone.WARNING,
        "on_leave" to Tone.NEUTRAL,
        "holiday" to Tone.NEUTRAL,
        "weekend" to Tone.NEUTRAL,
        "absent" to Tone.DANGER,
    )

    /**
     * A status the server sent that this build does not know about.
     *
     * Rendered as its own value made readable, not as "Unknown" and not hidden.
     * A status the app cannot name is still the truth about somebody's
     * attendance, and swallowing it leaves a blank row where a fact belongs.
     */
    fun statusLabel(status: String): String {
        labels[status]?.let { return it }
        val spaced = status.replace('_', ' ').trim()
        if (spaced.isEmpty()) return "Unrecorded"
        return spaced.replaceFirstChar { it.uppercase() }
    }

    /** Unknown statuses are neutral: a colour guess on attendance is a lie. */
    fun statusTone(status: String): Tone = tones[status] ?: Tone.NEUTRAL

    fun monthRange(cursor: YearMonth): Pair<String, String> =
        cursor.atDay(1).toString() to cursor.atEndOfMonth().toString()

    /**
     * Whether the forward control should be live.
     *
     * The current month is the last one that can be reached. Beyond it there is
     * nothing to show, and an enabled control that produces an empty screen is
     * indistinguishable from a broken one.
     */
    fun canGoForward(cursor: YearMonth, today: LocalDate): Boolean =
        cursor.isBefore(YearMonth.from(today))

    fun clampToPresent(cursor: YearMonth, today: LocalDate): YearMonth {
        val present = YearMonth.from(today)
        return if (cursor.isAfter(present)) present else cursor
    }

    fun monthLabel(cursor: YearMonth, locale: Locale = Locale.getDefault()): String =
        cursor.format(DateTimeFormatter.ofPattern("LLLL yyyy", locale))

    /**
     * Average minutes worked per day the person was actually present.
     *
     * Null, not zero, when there were no present days. Zero is a measurement —
     * "you averaged no hours" — and this is the absence of one.
     */
    fun averageWorkedMinutes(summary: Summary): Int? {
        if (summary.presentDays <= 0) return null
        return (summary.totalWorkedMinutes.toDouble() / summary.presentDays).roundToInt()
    }

    /**
     * Days in the month accounted for by some record.
     *
     * Late days are deliberately not added: the server folds them into
     * `presentDays`, and counting them twice reports more accounted days than
     * the month contains.
     */
    fun accountedDays(summary: Summary): Int =
        summary.presentDays + summary.absentDays + summary.halfDays +
            summary.leaveDays + summary.wfhDays
}
