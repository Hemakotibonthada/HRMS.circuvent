package com.circuvent.hrms.core.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TimeFieldTest {

    @Test
    fun `reads a 24-hour time`() {
        assertEquals(9 to 30, parseClockTime("09:30"))
        assertEquals(18 to 5, parseClockTime("18:05"))
        assertEquals(0 to 0, parseClockTime("00:00"))
        assertEquals(23 to 59, parseClockTime("23:59"))
    }

    @Test
    fun `refuses what is not a time of day`() {
        // The server rejects each of these too. Catching them here means the
        // clock opens on a sensible hour rather than throwing on the way up.
        assertNull(parseClockTime("24:00"))
        assertNull(parseClockTime("09:60"))
        assertNull(parseClockTime("9"))
        assertNull(parseClockTime("09:30:00"))
        assertNull(parseClockTime(""))
        assertNull(parseClockTime("half nine"))
    }

    @Test
    fun `shows a 24-hour clock padded`() {
        assertEquals("09:30", formatClockTime("09:30", is24Hour = true))
        assertEquals("18:05", formatClockTime("18:5", is24Hour = true))
    }

    @Test
    fun `shows a 12-hour clock with midnight and noon as twelve`() {
        assertEquals("9:30 am", formatClockTime("09:30", is24Hour = false))
        assertEquals("6:05 pm", formatClockTime("18:05", is24Hour = false))
        // The two that catch a modulo written without thinking: both would
        // otherwise read "0:00", which is not a time anybody writes.
        assertEquals("12:00 am", formatClockTime("00:00", is24Hour = false))
        assertEquals("12:30 pm", formatClockTime("12:30", is24Hour = false))
    }

    @Test
    fun `hands back anything it cannot read`() {
        // Same reasoning as the date formatter: a visibly wrong value can be
        // reported by whoever sees it, a silently blanked one cannot.
        assertEquals("later", formatClockTime("later", is24Hour = true))
        assertEquals("", formatClockTime("", is24Hour = false))
    }
}
