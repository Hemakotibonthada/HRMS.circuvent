package com.circuvent.hrms.domain

import com.circuvent.hrms.domain.LeaveRules.Field
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class LeaveRulesTest {

    private val today = LocalDate.of(2026, 3, 1)

    private fun draft(
        leaveType: String = "casual",
        startDate: String = "2026-03-10",
        endDate: String = "2026-03-12",
        isHalfDay: Boolean = false,
        reason: String = "Family wedding",
    ) = LeaveRules.Draft(leaveType, startDate, endDate, isHalfDay, reason)

    @Test
    fun `a complete request passes`() {
        assertTrue(LeaveRules.validate(draft(), today).isEmpty())
    }

    @Test
    fun `a date that does not exist is refused`() {
        // 2026 is not a leap year. The hand-rolled JavaScript version needed a
        // last-day-of-month calculation to catch this; LocalDate.parse simply
        // refuses it.
        assertFalse(LeaveRules.isRealDate("2026-02-29"))
        assertTrue(LeaveRules.isRealDate("2028-02-29"))
        assertFalse(LeaveRules.isRealDate("2026-13-01"))
        assertFalse(LeaveRules.isRealDate("2026-3-10"))
        assertFalse(LeaveRules.isRealDate("10/03/2026"))
        assertFalse(LeaveRules.isRealDate(""))
    }

    @Test
    fun `the span is inclusive of both ends`() {
        // A single day of leave is one day, not zero.
        assertEquals(1L, LeaveRules.daysBetween("2026-03-10", "2026-03-10"))
        assertEquals(3L, LeaveRules.daysBetween("2026-03-10", "2026-03-12"))
    }

    @Test
    fun `the span survives a daylight saving boundary`() {
        // The reason the JavaScript version had to compute in UTC: in local
        // time one of these days is 23 hours long and integer division loses
        // it, making the span a day short. A LocalDate has no hours.
        assertEquals(3L, LeaveRules.daysBetween("2026-03-28", "2026-03-30"))
        assertEquals(3L, LeaveRules.daysBetween("2026-10-24", "2026-10-26"))
    }

    @Test
    fun `an end before the start is refused`() {
        val errors = LeaveRules.validate(draft(startDate = "2026-03-12", endDate = "2026-03-10"), today)
        assertTrue(errors.containsKey(Field.END_DATE))
    }

    @Test
    fun `a half day must be a single day`() {
        // Otherwise "half day" is ambiguous: half of which one?
        val errors = LeaveRules.validate(
            draft(startDate = "2026-03-10", endDate = "2026-03-12", isHalfDay = true),
            today,
        )
        assertTrue(errors.containsKey(Field.END_DATE))

        val single = LeaveRules.validate(
            draft(startDate = "2026-03-10", endDate = "2026-03-10", isHalfDay = true),
            today,
        )
        assertFalse(single.containsKey(Field.END_DATE))
    }

    @Test
    fun `leave in the past is refused and points at the right process`() {
        val errors = LeaveRules.validate(draft(startDate = "2026-02-20", endDate = "2026-02-21"), today)
        assertTrue(errors[Field.START_DATE]!!.contains("regularise"))
    }

    @Test
    fun `leave starting today is allowed`() {
        // The boundary. Somebody who wakes up ill applies for today.
        val errors = LeaveRules.validate(
            draft(startDate = "2026-03-01", endDate = "2026-03-01"),
            today,
        )
        assertFalse(errors.containsKey(Field.START_DATE))
    }

    @Test
    fun `a reason is required, and is trimmed before it is measured`() {
        assertTrue(LeaveRules.validate(draft(reason = ""), today).containsKey(Field.REASON))
        assertTrue(LeaveRules.validate(draft(reason = "  x  "), today).containsKey(Field.REASON))
        assertFalse(LeaveRules.validate(draft(reason = "Flu"), today).containsKey(Field.REASON))
        assertTrue(LeaveRules.validate(draft(reason = "a".repeat(1001)), today).containsKey(Field.REASON))
    }

    @Test
    fun `a leave type is required`() {
        assertTrue(LeaveRules.validate(draft(leaveType = ""), today).containsKey(Field.TYPE))
    }

    @Test
    fun `every problem is reported at once`() {
        // Not one at a time. A form that reveals its next objection only after
        // the last is fixed gets filled in three times.
        val errors = LeaveRules.validate(
            LeaveRules.Draft("", "nonsense", "nonsense", false, ""),
            today,
        )
        assertTrue(errors.containsKey(Field.TYPE))
        assertTrue(errors.containsKey(Field.START_DATE))
        assertTrue(errors.containsKey(Field.END_DATE))
        assertTrue(errors.containsKey(Field.REASON))
    }

    @Test
    fun `the balance cost is null when it cannot be known`() {
        // Null, not zero. Zero is a measurement — "this costs you nothing" —
        // and an unparseable date is the absence of one.
        assertNull(LeaveRules.totalDays(draft(startDate = "nonsense")))
        assertNull(LeaveRules.totalDays(draft(startDate = "2026-03-12", endDate = "2026-03-10")))
        assertEquals(3.0, LeaveRules.totalDays(draft())!!, 0.0001)
        assertEquals(
            0.5,
            LeaveRules.totalDays(draft(startDate = "2026-03-10", endDate = "2026-03-10", isHalfDay = true))!!,
            0.0001,
        )
    }
}
