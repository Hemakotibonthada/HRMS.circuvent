package com.circuvent.hrms.domain

import com.circuvent.hrms.domain.ShiftRules.Shift
import com.circuvent.hrms.domain.ShiftRules.State
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime

class ShiftRulesTest {

    private fun shift(
        id: String = "a",
        shiftDate: String = "2026-03-10",
        startsAt: String = "2026-03-10T09:00:00Z",
        endsAt: String = "2026-03-10T17:00:00Z",
        durationMinutes: Int = 480,
        patternName: String? = "Day shift",
    ) = Shift(id, shiftDate, startsAt, endsAt, durationMinutes, "scheduled", patternName)

    private val before = Instant.parse("2026-03-10T06:00:00Z")
    private val during = Instant.parse("2026-03-10T12:00:00Z")
    private val after = Instant.parse("2026-03-10T20:00:00Z")

    @Test
    fun `state follows the clock`() {
        assertEquals(State.UPCOMING, ShiftRules.stateOf(shift(), before))
        assertEquals(State.IN_PROGRESS, ShiftRules.stateOf(shift(), during))
        assertEquals(State.PAST, ShiftRules.stateOf(shift(), after))
    }

    @Test
    fun `the boundaries belong to the shift that is running`() {
        // Not "upcoming" one millisecond after it began, and somebody whose
        // shift ended exactly now is not still on it.
        assertEquals(State.IN_PROGRESS, ShiftRules.stateOf(shift(), Instant.parse("2026-03-10T09:00:00Z")))
        assertEquals(State.PAST, ShiftRules.stateOf(shift(), Instant.parse("2026-03-10T17:00:00Z")))
    }

    @Test
    fun `an unreadable timestamp degrades to past rather than throwing`() {
        assertEquals(State.PAST, ShiftRules.stateOf(shift(startsAt = "not a date"), during))
        assertEquals(State.PAST, ShiftRules.stateOf(shift(endsAt = ""), during))
    }

    @Test
    fun `an offset timestamp is accepted as well as a Z`() {
        // Not every server sends Z. Rejecting an offset would silently drop
        // every shift for anyone whose backend serialises with one.
        assertEquals(
            State.IN_PROGRESS,
            ShiftRules.stateOf(
                shift(startsAt = "2026-03-10T14:30:00+05:30", endsAt = "2026-03-10T22:30:00+05:30"),
                during,
            ),
        )
    }

    @Test
    fun `nothing ahead means nothing to show`() {
        assertNull(ShiftRules.next(emptyList(), during))
        assertNull(ShiftRules.next(listOf(shift()), after))
    }

    @Test
    fun `the shift being worked wins over the one that follows`() {
        val running = shift(id = "running")
        val later = shift(
            id = "later",
            shiftDate = "2026-03-11",
            startsAt = "2026-03-11T09:00:00Z",
            endsAt = "2026-03-11T17:00:00Z",
        )
        assertEquals("running", ShiftRules.next(listOf(later, running), during)?.id)
    }

    @Test
    fun `the earliest upcoming shift wins, whatever the input order`() {
        val soon = shift(id = "soon")
        val later = shift(
            id = "later",
            shiftDate = "2026-03-12",
            startsAt = "2026-03-12T09:00:00Z",
            endsAt = "2026-03-12T17:00:00Z",
        )
        assertEquals("soon", ShiftRules.next(listOf(later, soon), before)?.id)
        assertEquals("soon", ShiftRules.next(listOf(soon, later), before)?.id)
    }

    @Test
    fun `of two overlapping live shifts the most recently started is the one being worked`() {
        val early = shift(id = "early", startsAt = "2026-03-10T08:00:00Z")
        val late = shift(id = "late", startsAt = "2026-03-10T11:00:00Z")
        assertEquals("late", ShiftRules.next(listOf(early, late), during)?.id)
    }

    @Test
    fun `days are grouped on the rostered date, earliest first`() {
        val days = ShiftRules.groupByDay(
            listOf(shift(id = "b", shiftDate = "2026-03-12"), shift(id = "a", shiftDate = "2026-03-10")),
        )
        assertEquals(listOf("2026-03-10", "2026-03-12"), days.map { it.date })
    }

    @Test
    fun `a night shift stays on the day it was rostered for`() {
        // The whole reason grouping uses shiftDate. This starts at 22:00 on the
        // 10th and ends on the 11th; the person was told to come in on the
        // 10th, so that is the day it belongs to. Deriving the day from the
        // start instant puts half a night rota on one date and half on another.
        val night = shift(
            shiftDate = "2026-03-10",
            startsAt = "2026-03-10T22:00:00Z",
            endsAt = "2026-03-11T06:00:00Z",
        )
        assertEquals(listOf("2026-03-10"), ShiftRules.groupByDay(listOf(night)).map { it.date })
    }

    @Test
    fun `a day's shifts are ordered by when they start, and the input is not mutated`() {
        val evening = shift(id = "evening", startsAt = "2026-03-10T18:00:00Z")
        val morning = shift(id = "morning", startsAt = "2026-03-10T06:00:00Z")
        val input = listOf(evening, morning)

        val day = ShiftRules.groupByDay(input).first()
        assertEquals(listOf("morning", "evening"), day.shifts.map { it.id })
        assertEquals(listOf("evening", "morning"), input.map { it.id })
    }

    @Test
    fun `a day totals its minutes`() {
        val days = ShiftRules.groupByDay(
            listOf(
                shift(id = "a", durationMinutes = 240),
                shift(id = "b", startsAt = "2026-03-10T14:00:00Z", durationMinutes = 180),
            ),
        )
        assertEquals(420, days.first().totalMinutes)
    }

    @Test
    fun `overnight is decided in the zone the worker lives in`() {
        // Built from local time on purpose. A fixture written as a UTC instant
        // answers a different question and passes or fails depending on where
        // the test is run: in India, 22:00Z and 06:00Z the next day are the
        // same local date.
        val zone = ZoneId.systemDefault()
        fun local(y: Int, m: Int, d: Int, h: Int): String =
            ZonedDateTime.of(y, m, d, h, 0, 0, 0, zone).toInstant().toString()

        assertFalse(
            ShiftRules.isOvernight(shift(startsAt = local(2026, 3, 10, 9), endsAt = local(2026, 3, 10, 17)), zone),
        )
        assertTrue(
            ShiftRules.isOvernight(shift(startsAt = local(2026, 3, 10, 22), endsAt = local(2026, 3, 11, 6)), zone),
        )
        // Across a month and a year boundary, where comparing day-of-month
        // alone would call it a same-day shift.
        assertTrue(
            ShiftRules.isOvernight(shift(startsAt = local(2026, 3, 31, 22), endsAt = local(2026, 4, 1, 6)), zone),
        )
        assertTrue(
            ShiftRules.isOvernight(shift(startsAt = local(2026, 12, 31, 22), endsAt = local(2027, 1, 1, 6)), zone),
        )
    }

    @Test
    fun `an unreadable timestamp is not reported as overnight`() {
        // Claiming a shift runs overnight on the strength of a value that could
        // not be parsed would tell somebody to arrange a night off they do not
        // need.
        assertFalse(ShiftRules.isOvernight(shift(endsAt = "nonsense")))
    }

    @Test
    fun `durations read the way a person would say them`() {
        assertEquals("0m", ShiftRules.formatDuration(0))
        assertEquals("45m", ShiftRules.formatDuration(45))
        assertEquals("1h", ShiftRules.formatDuration(60))
        assertEquals("8h", ShiftRules.formatDuration(480))
        assertEquals("1h 30m", ShiftRules.formatDuration(90))
        assertEquals("8h 30m", ShiftRules.formatDuration(510))
    }

    @Test
    fun `a negative duration is shown as absent rather than as a negative`() {
        assertEquals("—", ShiftRules.formatDuration(-30))
    }

    @Test
    fun `today, tomorrow and yesterday are named`() {
        val today = LocalDate.of(2026, 3, 10)
        assertEquals("Today", ShiftRules.dayLabel("2026-03-10", today))
        assertEquals("Tomorrow", ShiftRules.dayLabel("2026-03-11", today))
        assertEquals("Yesterday", ShiftRules.dayLabel("2026-03-09", today))
    }

    @Test
    fun `any other day is written out with the right weekday`() {
        // 2026-03-14 is a Saturday. Formatting a date parsed at UTC midnight in
        // the device zone reports Friday for anyone west of Greenwich; a
        // LocalDate has no such trap, and this pins it.
        val label = ShiftRules.dayLabel("2026-03-14", LocalDate.of(2026, 3, 10), java.util.Locale.UK)
        assertTrue("label was: $label", label.contains("Sat"))
        assertTrue(label.contains("14"))
    }

    @Test
    fun `anything that is not a date passes straight through`() {
        assertEquals("soon", ShiftRules.dayLabel("soon", LocalDate.of(2026, 3, 10)))
    }

    @Test
    fun `an unreadable instant does not render as a broken time`() {
        assertEquals("—", ShiftRules.formatClock(""))
        assertEquals("—", ShiftRules.formatClock("nonsense"))
    }
}
