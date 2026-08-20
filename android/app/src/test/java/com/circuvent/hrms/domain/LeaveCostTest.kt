package com.circuvent.hrms.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

/**
 * The cost of a leave request, as the server will actually apply it.
 *
 * The dates below are real: 21 August 2026 is a Friday and 24 August a Monday,
 * so Friday-to-Monday spans four calendar days of which two are the weekend.
 * That is the case the whole class exists for.
 */
class LeaveCostTest {

    private val friday = LocalDate.of(2026, 8, 21)
    private val saturday = LocalDate.of(2026, 8, 22)
    private val monday = LocalDate.of(2026, 8, 24)

    @Test
    fun `charges calendar days, matching the server`() {
        // Not working days. The server deducts four here, and telling somebody
        // two would be a comforting lie about their own balance.
        val summary = LeaveCost.summarise(friday, monday, isHalfDay = false)!!
        assertEquals(4.0, summary.chargedDays, 0.0)
    }

    @Test
    fun `counts the weekend days inside the range`() {
        val summary = LeaveCost.summarise(friday, monday, isHalfDay = false)!!
        assertEquals(2, summary.weekendDays)
        assertTrue(summary.hasNonWorkingDays)
    }

    @Test
    fun `a single working day has nothing to warn about`() {
        val summary = LeaveCost.summarise(friday, friday, isHalfDay = false)!!
        assertEquals(1.0, summary.chargedDays, 0.0)
        assertEquals(0, summary.weekendDays)
        assertTrue(summary.holidayNames.isEmpty())
        assertTrue(!summary.hasNonWorkingDays)
    }

    @Test
    fun `a half day is half a day`() {
        val summary = LeaveCost.summarise(friday, friday, isHalfDay = true)!!
        assertEquals(0.5, summary.chargedDays, 0.0)
    }

    @Test
    fun `a half day spanning more than one date is refused, as the server refuses it`() {
        assertNull(LeaveCost.summarise(friday, monday, isHalfDay = true))
    }

    @Test
    fun `an end before the start is refused`() {
        assertNull(LeaveCost.summarise(monday, friday, isHalfDay = false))
    }

    @Test
    fun `names a holiday inside the range`() {
        val summary = LeaveCost.summarise(
            friday,
            monday,
            isHalfDay = false,
            holidays = mapOf(monday to "Independence Day"),
        )!!
        assertEquals(listOf("Independence Day"), summary.holidayNames)
    }

    @Test
    fun `a holiday falling on a weekend is counted once, as the holiday`() {
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
    fun `the sentence leads with what leaves the balance`() {
        val summary = LeaveCost.summarise(friday, monday, isHalfDay = false)!!
        val text = LeaveCost.describe(summary)
        assertTrue(text, text.startsWith("4 days will be deducted"))
        assertTrue(text, text.contains("2 are weekend days"))
        assertTrue(text, text.contains("separately would cost less"))
    }

    @Test
    fun `says nothing extra when there is nothing to act on`() {
        val summary = LeaveCost.summarise(friday, friday, isHalfDay = false)!!
        assertEquals("1 day will be deducted.", LeaveCost.describe(summary))
    }

    @Test
    fun `a half day reads as a half, not as zero point five days of nothing`() {
        val summary = LeaveCost.summarise(friday, friday, isHalfDay = true)!!
        assertEquals("0.5 days will be deducted.", LeaveCost.describe(summary))
    }
}
