package com.circuvent.hrms.shared.domain

import kotlinx.datetime.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Real dates, deliberately. 21 August 2026 is a Friday and 24 August is the
 * Monday after it — a range chosen because it is the case people actually hit
 * and the one where the calendar-day rule costs them two days they did not
 * expect to spend.
 *
 * Ported from the Android app's copy alongside the code, so iOS gets the same
 * arithmetic rather than a second implementation that drifts.
 */
class LeaveCostTest {

    private fun date(iso: String) = LocalDate.parse(iso)

    private val friday = date("2026-08-21")
    private val monday = date("2026-08-24")
    private val saturday = date("2026-08-22")

    @Test
    fun `a single working day costs one day`() {
        val summary = LeaveCost.summarise(friday, friday, isHalfDay = false)!!
        assertEquals(1.0, summary.chargedDays)
        assertEquals(0, summary.weekendDays)
        assertTrue(!summary.hasNonWorkingDays)
    }

    @Test
    fun `friday to monday costs four calendar days, two of them weekend`() {
        val summary = LeaveCost.summarise(friday, monday, isHalfDay = false)!!
        assertEquals(4.0, summary.chargedDays)
        assertEquals(2, summary.weekendDays)
        assertTrue(summary.hasNonWorkingDays)
    }

    @Test
    fun `the sentence names the cost before the warning`() {
        val summary = LeaveCost.summarise(friday, monday, isHalfDay = false)!!
        assertEquals(
            "4 days will be deducted, and 2 are weekend days. " +
                "Applying either side of them separately would cost less.",
            LeaveCost.describe(summary),
        )
    }

    @Test
    fun `a half day is half a day`() {
        val summary = LeaveCost.summarise(friday, friday, isHalfDay = true)!!
        assertEquals(0.5, summary.chargedDays)
        assertEquals("0.5 days will be deducted.", LeaveCost.describe(summary))
    }

    @Test
    fun `a half day spanning more than one date is refused, as the server refuses it`() {
        assertNull(LeaveCost.summarise(friday, monday, isHalfDay = true))
    }

    @Test
    fun `an end before the start is not a range`() {
        assertNull(LeaveCost.summarise(monday, friday, isHalfDay = false))
    }

    @Test
    fun `a holiday inside the range is named`() {
        val summary = LeaveCost.summarise(
            friday,
            monday,
            isHalfDay = false,
            holidays = mapOf(monday to "Independence Day"),
        )!!
        assertEquals(listOf("Independence Day"), summary.holidayNames)
        assertEquals(4.0, summary.chargedDays)
    }

    @Test
    fun `a holiday on a weekend is counted once, as the holiday`() {
        // Counting it twice would overstate the waste and read as a bug to
        // anybody who checked; the holiday is the more specific reason.
        val summary = LeaveCost.summarise(
            saturday,
            saturday,
            isHalfDay = false,
            holidays = mapOf(saturday to "Ganesh Chaturthi"),
        )!!
        assertEquals(0, summary.weekendDays)
        assertEquals(listOf("Ganesh Chaturthi"), summary.holidayNames)
    }

    @Test
    fun `several holidays are listed`() {
        val summary = LeaveCost.summarise(
            friday,
            monday,
            isHalfDay = false,
            holidays = mapOf(friday to "Onam", monday to "Independence Day"),
        )!!
        assertTrue(LeaveCost.describe(summary).contains("Onam, Independence Day"))
    }

    @Test
    fun `a whole working week warns about nothing`() {
        val summary = LeaveCost.summarise(date("2026-08-17"), date("2026-08-21"), isHalfDay = false)!!
        assertEquals(5.0, summary.chargedDays)
        assertEquals("5 days will be deducted.", LeaveCost.describe(summary))
    }

    @Test
    fun `one day is singular`() {
        val summary = LeaveCost.summarise(saturday, saturday, isHalfDay = false)!!
        assertEquals(
            "1 day will be deducted, and 1 is a weekend day. " +
                "Applying either side of them separately would cost less.",
            LeaveCost.describe(summary),
        )
    }
}
