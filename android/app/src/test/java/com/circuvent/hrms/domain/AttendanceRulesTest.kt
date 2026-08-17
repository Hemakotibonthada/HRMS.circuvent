package com.circuvent.hrms.domain

import com.circuvent.hrms.domain.AttendanceRules.Summary
import com.circuvent.hrms.domain.AttendanceRules.Tone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.YearMonth

class AttendanceRulesTest {

    private val today = LocalDate.of(2026, 3, 10)
    private val march = YearMonth.of(2026, 3)

    private fun summary(
        presentDays: Int = 20,
        absentDays: Int = 1,
        lateDays: Int = 2,
        halfDays: Int = 1,
        leaveDays: Int = 2,
        wfhDays: Int = 3,
        totalWorkedMinutes: Int = 9600,
        totalOvertimeMinutes: Int = 120,
    ) = Summary(presentDays, absentDays, lateDays, halfDays, leaveDays, wfhDays, totalWorkedMinutes, totalOvertimeMinutes)

    @Test
    fun `the month range covers the whole month`() {
        assertEquals("2026-03-01" to "2026-03-31", AttendanceRules.monthRange(march))
    }

    @Test
    fun `February ends on the right day in both kinds of year`() {
        assertEquals("2026-02-28", AttendanceRules.monthRange(YearMonth.of(2026, 2)).second)
        assertEquals("2028-02-29", AttendanceRules.monthRange(YearMonth.of(2028, 2)).second)
    }

    @Test
    fun `a single digit month is padded`() {
        // An unpadded "2026-1-01" is rejected by the API's own date regex, so
        // this is the difference between a working screen and a 400.
        assertEquals("2026-01-01" to "2026-01-31", AttendanceRules.monthRange(YearMonth.of(2026, 1)))
    }

    @Test
    fun `the forward control stops at the current month`() {
        // A future month has no records, and a summary of no records reads as a
        // month of absence.
        assertFalse(AttendanceRules.canGoForward(march, today))
        assertFalse(AttendanceRules.canGoForward(YearMonth.of(2026, 4), today))
        assertTrue(AttendanceRules.canGoForward(YearMonth.of(2026, 2), today))
    }

    @Test
    fun `months are compared across years, not by month number`() {
        // December 2025 is before March 2026 despite 12 being greater than 3.
        assertTrue(AttendanceRules.canGoForward(YearMonth.of(2025, 12), today))
    }

    @Test
    fun `a future cursor is pulled back to the present`() {
        assertEquals(march, AttendanceRules.clampToPresent(YearMonth.of(2030, 6), today))
        assertEquals(
            YearMonth.of(2025, 11),
            AttendanceRules.clampToPresent(YearMonth.of(2025, 11), today),
        )
    }

    @Test
    fun `the month label names the month it was given`() {
        val label = AttendanceRules.monthLabel(march, java.util.Locale.UK)
        assertTrue("label was: $label", label.contains("March"))
        assertTrue(label.contains("2026"))
    }

    @Test
    fun `the average is per day actually present`() {
        assertEquals(480, AttendanceRules.averageWorkedMinutes(summary(presentDays = 20, totalWorkedMinutes = 9600)))
        assertEquals(33, AttendanceRules.averageWorkedMinutes(summary(presentDays = 3, totalWorkedMinutes = 100)))
    }

    @Test
    fun `no present days gives no average, rather than infinity`() {
        // The payroll engine in this product shipped with exactly this defect:
        // a zero divisor became Infinity, then NaN, and reached a payment
        // instruction.
        assertNull(AttendanceRules.averageWorkedMinutes(summary(presentDays = 0)))
        assertNull(AttendanceRules.averageWorkedMinutes(summary(presentDays = -3)))
    }

    @Test
    fun `accounted days do not count late days twice`() {
        // The server folds late days into presentDays. Adding lateDays as well
        // reports more accounted days than the month contains.
        val value = AttendanceRules.accountedDays(
            summary(presentDays = 20, lateDays = 5, absentDays = 0, halfDays = 0, leaveDays = 0, wfhDays = 0),
        )
        assertEquals(20, value)
    }

    @Test
    fun `known statuses read as words`() {
        assertEquals("Present", AttendanceRules.statusLabel("present"))
        assertEquals("Half day", AttendanceRules.statusLabel("half_day"))
        assertEquals("On leave", AttendanceRules.statusLabel("on_leave"))
        assertEquals("Working from home", AttendanceRules.statusLabel("wfh"))
    }

    @Test
    fun `an unknown status is made readable rather than hidden`() {
        // A status this build does not know is still the truth about somebody's
        // attendance. Showing "Unknown" or nothing loses it.
        assertEquals("Sabbatical unpaid", AttendanceRules.statusLabel("sabbatical_unpaid"))
        assertEquals("Unrecorded", AttendanceRules.statusLabel(""))
        assertEquals("Unrecorded", AttendanceRules.statusLabel("   "))
    }

    @Test
    fun `colour is only claimed for statuses that are understood`() {
        assertEquals(Tone.SUCCESS, AttendanceRules.statusTone("present"))
        assertEquals(Tone.DANGER, AttendanceRules.statusTone("absent"))
        assertEquals(Tone.WARNING, AttendanceRules.statusTone("late"))
        // Guessing a colour for an unrecognised status states something about
        // somebody's record that nobody checked.
        assertEquals(Tone.NEUTRAL, AttendanceRules.statusTone("sabbatical_unpaid"))
    }
}
