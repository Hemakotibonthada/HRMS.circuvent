package com.circuvent.hrms.domain

import java.time.DayOfWeek
import java.time.LocalDate

/**
 * What a leave request will actually cost, and what is worth warning about.
 *
 * The server counts **calendar** days and deducts that from the balance —
 * `countLeaveDays` in leave.neon.ts, whose comment says this is deliberate
 * because weekends and holidays vary by location. Whether that is right is a
 * policy question and differs by leave type: 26 weeks of maternity leave under
 * the Maternity Benefit Act genuinely is 182 calendar days, which is what the
 * balances show, while charging somebody two days of casual leave for a
 * Saturday and Sunday is a different matter entirely.
 *
 * This does not attempt to settle that. It reports the cost the server will
 * apply, and names the days inside the range that are not working days — so
 * somebody can see that applying for Friday and Monday separately would save
 * them two days, and decide for themselves.
 *
 * Getting this wrong in the optimistic direction would be the worst outcome:
 * telling somebody a request costs two days when four will be taken.
 */
object LeaveCost {

    data class Summary(
        /** Days the server will deduct. Calendar days, matching the server. */
        val chargedDays: Double,
        /** Days in the range that are weekends. */
        val weekendDays: Int,
        /** Days in the range that are public holidays, by name. */
        val holidayNames: List<String>,
    ) {
        /** True when the request spends entitlement on days nobody works. */
        val hasNonWorkingDays: Boolean get() = weekendDays > 0 || holidayNames.isNotEmpty()
    }

    /**
     * Summarises a range.
     *
     * A half day is 0.5 and only valid on one date, matching the server, which
     * refuses a half day spanning more than a single day.
     */
    fun summarise(
        start: LocalDate,
        end: LocalDate,
        isHalfDay: Boolean,
        holidays: Map<LocalDate, String> = emptyMap(),
        weekend: Set<DayOfWeek> = setOf(DayOfWeek.SATURDAY, DayOfWeek.SUNDAY),
    ): Summary? {
        if (end.isBefore(start)) return null
        if (isHalfDay && start != end) return null

        val charged = if (isHalfDay) {
            0.5
        } else {
            (java.time.temporal.ChronoUnit.DAYS.between(start, end) + 1).toDouble()
        }

        var weekendDays = 0
        val names = mutableListOf<String>()

        var day = start
        while (!day.isAfter(end)) {
            val holiday = holidays[day]
            when {
                // A holiday that falls on a Saturday is counted once, as a
                // holiday, because that is the more specific reason and the
                // one worth naming.
                holiday != null -> names += holiday
                day.dayOfWeek in weekend -> weekendDays++
            }
            day = day.plusDays(1)
        }

        return Summary(charged, weekendDays, names)
    }

    /**
     * A sentence for somebody about to submit.
     *
     * Deliberately concrete about the cost first, because that is the number
     * that leaves their balance. The warning follows only when there is
     * something to act on.
     */
    fun describe(summary: Summary): String {
        val days = if (summary.chargedDays == 1.0) "1 day" else "${trim(summary.chargedDays)} days"
        if (!summary.hasNonWorkingDays) return "$days will be deducted."

        val parts = mutableListOf<String>()
        if (summary.weekendDays > 0) {
            parts += if (summary.weekendDays == 1) "1 is a weekend day" else "${summary.weekendDays} are weekend days"
        }
        if (summary.holidayNames.isNotEmpty()) {
            parts += if (summary.holidayNames.size == 1) {
                "1 is ${summary.holidayNames.first()}"
            } else {
                "${summary.holidayNames.size} are holidays (${summary.holidayNames.joinToString(", ")})"
            }
        }

        return "$days will be deducted, and ${parts.joinToString(" and ")}. " +
            "Applying either side of them separately would cost less."
    }

    private fun trim(value: Double): String =
        if (value % 1.0 == 0.0) value.toInt().toString() else value.toString()
}
