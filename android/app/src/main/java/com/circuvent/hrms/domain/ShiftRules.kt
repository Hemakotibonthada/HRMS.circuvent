package com.circuvent.hrms.domain

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.format.FormatStyle
import java.util.Locale

/**
 * SHIFT RULES — grouping, ordering and labelling a published roster
 *
 * Pure and tested, because this is the logic that decides what somebody
 * believes about when they are next expected at work, and a screen is a poor
 * place to keep it.
 *
 * Two kinds of value arrive from /api/roster/my-shifts and they are not
 * interchangeable:
 *
 *   * `shiftDate` is a calendar date. It is compared as a `LocalDate`, which
 *     has no timezone to shift it.
 *   * `startsAt` and `endsAt` are instants. Those are compared as `Instant`,
 *     because "has this shift started" is a question about a moment in time and
 *     not about a calendar.
 *
 * Mixing the two is how a night shift ends up on the wrong day.
 */
object ShiftRules {

    data class Shift(
        val id: String,
        val shiftDate: String,
        val startsAt: String,
        val endsAt: String,
        val durationMinutes: Int,
        val status: String,
        val patternName: String? = null,
        val note: String? = null,
    )

    data class Day(
        val date: String,
        val shifts: List<Shift>,
        val totalMinutes: Int,
    )

    enum class State { IN_PROGRESS, UPCOMING, PAST }

    private fun instant(value: String): Instant? =
        try {
            Instant.parse(value)
        } catch (_: DateTimeParseException) {
            // Some servers send an offset rather than a Z. Try the fuller
            // parser before giving up on the value entirely.
            try {
                java.time.OffsetDateTime.parse(value).toInstant()
            } catch (_: DateTimeParseException) {
                null
            }
        }

    private fun date(value: String): LocalDate? =
        try {
            LocalDate.parse(value)
        } catch (_: DateTimeParseException) {
            null
        }

    /**
     * Where a shift sits relative to now.
     *
     * IN_PROGRESS is checked before UPCOMING deliberately. Somebody halfway
     * through a night shift asking what is next should be told about the shift
     * they are standing in, not the one after it.
     *
     * An unreadable timestamp reports PAST rather than throwing: it drops off
     * the top of the screen instead of blanking it, and the server is the
     * authority on the roster either way.
     */
    fun stateOf(shift: Shift, now: Instant): State {
        val starts = instant(shift.startsAt) ?: return State.PAST
        val ends = instant(shift.endsAt) ?: return State.PAST

        return when {
            !now.isBefore(ends) -> State.PAST
            !now.isBefore(starts) -> State.IN_PROGRESS
            else -> State.UPCOMING
        }
    }

    /**
     * The shift the person needs to know about: the one running now, or the
     * next one to start.
     *
     * Null when the roster holds nothing ahead — which the caller must render
     * as "nothing scheduled" rather than as an empty row. A blank where a time
     * should be reads as a loading failure.
     */
    fun next(shifts: List<Shift>, now: Instant): Shift? {
        var running: Shift? = null
        var runningStart: Instant? = null
        var soonest: Shift? = null
        var soonestStart: Instant? = null

        for (shift in shifts) {
            val starts = instant(shift.startsAt) ?: continue
            when (stateOf(shift, now)) {
                State.PAST -> continue
                State.IN_PROGRESS ->
                    // Overlapping assignments are possible on a badly built
                    // roster. The one that started most recently is the one
                    // being worked.
                    if (runningStart == null || starts.isAfter(runningStart)) {
                        running = shift
                        runningStart = starts
                    }
                State.UPCOMING ->
                    if (soonestStart == null || starts.isBefore(soonestStart)) {
                        soonest = shift
                        soonestStart = starts
                    }
            }
        }

        return running ?: soonest
    }

    /**
     * Groups assignments by their calendar date, earliest day first and each
     * day's shifts in start order.
     *
     * Grouped on `shiftDate` rather than on the date part of `startsAt`. A
     * shift beginning at 22:00 belongs to the day it was rostered for, which is
     * the day the person was told to come in; deriving the day from the start
     * instant puts half of a night rota on one date and half on another.
     */
    fun groupByDay(shifts: List<Shift>): List<Day> =
        shifts
            .groupBy { it.shiftDate }
            .toSortedMap()
            .map { (date, entries) ->
                val ordered = entries.sortedWith(
                    compareBy(nullsLast()) { instant(it.startsAt) }
                )
                Day(
                    date = date,
                    shifts = ordered,
                    totalMinutes = ordered.sumOf { it.durationMinutes },
                )
            }

    /**
     * True when the shift finishes on a later calendar day than it starts.
     *
     * Compared in the device's own zone, because the question being answered is
     * the one the person on the shift would ask: do I go home tomorrow.
     */
    fun isOvernight(shift: Shift, zone: ZoneId = ZoneId.systemDefault()): Boolean {
        val starts = instant(shift.startsAt) ?: return false
        val ends = instant(shift.endsAt) ?: return false
        return starts.atZone(zone).toLocalDate() != ends.atZone(zone).toLocalDate()
    }

    /**
     * Human duration for a count of minutes.
     *
     * A negative count collapses to an em dash rather than rendering "-1h 0m".
     * A duration is a fact about a shift; if it cannot be stated it should be
     * visibly absent, not wrong.
     */
    fun formatDuration(minutes: Int): String {
        if (minutes < 0) return "—"
        val hours = minutes / 60
        val rest = minutes % 60
        return when {
            hours == 0 -> "${rest}m"
            rest == 0 -> "${hours}h"
            else -> "${hours}h ${rest}m"
        }
    }

    /**
     * Day heading: "Today", "Tomorrow", "Yesterday", or a written date.
     *
     * `today` is passed in rather than read from the clock, so the caller
     * decides which zone the word "today" refers to and this stays testable
     * without freezing time.
     */
    fun dayLabel(value: String, today: LocalDate, locale: Locale = Locale.getDefault()): String {
        val day = date(value) ?: return value
        return when (day) {
            today -> "Today"
            today.plusDays(1) -> "Tomorrow"
            today.minusDays(1) -> "Yesterday"
            else -> day.format(
                DateTimeFormatter.ofPattern("EEE d MMM", locale)
            )
        }
    }

    /** Clock time for an instant, in the device's zone. */
    fun formatClock(
        value: String,
        zone: ZoneId = ZoneId.systemDefault(),
        locale: Locale = Locale.getDefault(),
    ): String {
        val at = instant(value) ?: return "—"
        return at.atZone(zone).format(
            DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale)
        )
    }
}
