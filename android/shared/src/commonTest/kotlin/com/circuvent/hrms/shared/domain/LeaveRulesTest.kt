package com.circuvent.hrms.shared.domain

import kotlinx.datetime.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

/**
 * These run on the JVM, on Android and on iOS from the same source.
 *
 * That is the point of the shared module: the assertions below are the
 * definition of the product's behaviour, and neither app can drift from them
 * without failing here first.
 */
class LeaveRulesTest {

    private fun date(value: String) = LocalDate.parse(value)

    private val balance = LeaveRules.Balance(
        leaveType = "casual",
        openingDays = 12.0,
        accruedDays = 0.0,
        carryForwardDays = 0.0,
        usedDays = 0.0,
        pendingDays = 0.0,
    )

    // ── Working days ─────────────────────────────────────────

    @Test
    fun `counts a plain working week`() {
        // Monday to Friday.
        assertEquals(5.0, LeaveRules.workingDays(date("2026-06-01"), date("2026-06-05")))
    }

    @Test
    fun `excludes the weekend`() {
        // Friday to Monday is two working days, not four. Counting calendar
        // days here charges the employee for the weekend.
        assertEquals(2.0, LeaveRules.workingDays(date("2026-06-05"), date("2026-06-08")))
    }

    @Test
    fun `excludes holidays that fall on working days`() {
        val holidays = setOf(date("2026-06-03"))
        assertEquals(4.0, LeaveRules.workingDays(date("2026-06-01"), date("2026-06-05"), holidays))
    }

    @Test
    fun `a holiday on a weekend costs nothing extra`() {
        val holidays = setOf(date("2026-06-06"))
        assertEquals(5.0, LeaveRules.workingDays(date("2026-06-01"), date("2026-06-05"), holidays))
    }

    @Test
    fun `a single working day is one day`() {
        assertEquals(1.0, LeaveRules.workingDays(date("2026-06-02"), date("2026-06-02")))
    }

    @Test
    fun `a backwards range is zero, not negative`() {
        assertEquals(0.0, LeaveRules.workingDays(date("2026-06-05"), date("2026-06-01")))
    }

    // ── Half days ────────────────────────────────────────────

    @Test
    fun `a half day on one date costs half a day`() {
        val request = LeaveRules.Request(
            leaveType = "casual",
            startDate = date("2026-06-02"),
            endDate = date("2026-06-02"),
            isHalfDay = true,
        )
        assertEquals(0.5, LeaveRules.requestedDays(request))
    }

    @Test
    fun `half day is ignored across a range, rather than halving it`() {
        val request = LeaveRules.Request(
            leaveType = "casual",
            startDate = date("2026-06-01"),
            endDate = date("2026-06-05"),
            isHalfDay = true,
        )
        assertEquals(5.0, LeaveRules.requestedDays(request))
    }

    // ── Balances ─────────────────────────────────────────────

    @Test
    fun `available counts granted minus taken and pending`() {
        assertEquals(9.0, LeaveRules.available(balance.copy(usedDays = 2.0, pendingDays = 1.0)))
    }

    @Test
    fun `available never goes negative`() {
        assertEquals(0.0, LeaveRules.available(balance.copy(usedDays = 99.0)))
    }

    // ── Overlap ──────────────────────────────────────────────

    @Test
    fun `detects an overlap and a touching range`() {
        val a = LeaveRules.Request(leaveType = "casual", startDate = date("2026-06-01"), endDate = date("2026-06-05"))
        val touching = a.copy(startDate = date("2026-06-05"), endDate = date("2026-06-08"))
        val separate = a.copy(startDate = date("2026-06-08"), endDate = date("2026-06-09"))

        assertTrue(LeaveRules.overlaps(a, touching))
        assertFalse(LeaveRules.overlaps(a, separate))
    }

    // ── Validation ───────────────────────────────────────────

    private fun request(
        type: String = "casual",
        start: String = "2026-06-01",
        end: String = "2026-06-02",
    ) = LeaveRules.Request(leaveType = type, startDate = date(start), endDate = date(end))

    @Test
    fun `accepts a well-formed request`() {
        val result = LeaveRules.validate(request(), date("2026-05-01"), balance)
        assertIs<LeaveRules.Validation.Valid>(result)
    }

    @Test
    fun `refuses an end date before the start`() {
        val bad = request(start = "2026-06-05", end = "2026-06-01")
        val result = LeaveRules.validate(bad, date("2026-05-01"), balance)
        assertIs<LeaveRules.Validation.Invalid>(result)
        assertEquals("endDate", result.field)
    }

    @Test
    fun `refuses a range that is entirely weekend`() {
        val weekend = request(start = "2026-06-06", end = "2026-06-07")
        val result = LeaveRules.validate(weekend, date("2026-05-01"), balance)
        assertIs<LeaveRules.Validation.Invalid>(result)
    }

    @Test
    fun `refuses a past date`() {
        val result = LeaveRules.validate(request(), date("2026-07-01"), balance)
        assertIs<LeaveRules.Validation.Invalid>(result)
    }

    // Sick leave is applied for after the fact by definition. Refusing it is
    // how somebody ends up marked absent for a day they were ill.
    @Test
    fun `allows backdated sick leave`() {
        val result = LeaveRules.validate(request(type = "sick"), date("2026-07-01"), balance.copy(leaveType = "sick"))
        assertIs<LeaveRules.Validation.Valid>(result)
    }

    @Test
    fun `enforces a notice period, except for sickness`() {
        val soon = request(start = "2026-06-01", end = "2026-06-01")

        val refused = LeaveRules.validate(soon, date("2026-05-30"), balance, minNoticeDays = 7)
        assertIs<LeaveRules.Validation.Invalid>(refused)

        val sick = LeaveRules.validate(
            soon.copy(leaveType = "sick"),
            date("2026-05-30"),
            balance.copy(leaveType = "sick"),
            minNoticeDays = 7,
        )
        assertIs<LeaveRules.Validation.Valid>(sick)
    }

    @Test
    fun `refuses a clash with leave already booked`() {
        val existing = listOf(request(start = "2026-06-02", end = "2026-06-03"))
        val result = LeaveRules.validate(request(), date("2026-05-01"), balance, existing)
        assertIs<LeaveRules.Validation.Invalid>(result)
    }

    @Test
    fun `ignores a clash with a rejected request`() {
        val existing = listOf(request(start = "2026-06-02", end = "2026-06-03").copy(status = "rejected"))
        val result = LeaveRules.validate(request(), date("2026-05-01"), balance, existing)
        assertIs<LeaveRules.Validation.Valid>(result)
    }

    @Test
    fun `refuses more days than remain`() {
        val long = request(start = "2026-06-01", end = "2026-06-30")
        val result = LeaveRules.validate(long, date("2026-05-01"), balance)
        assertIs<LeaveRules.Validation.Invalid>(result)
    }

    @Test
    fun `refuses when there is no balance at all`() {
        val result = LeaveRules.validate(request(), date("2026-05-01"), balance = null)
        assertIs<LeaveRules.Validation.Invalid>(result)
    }

    // Unpaid leave has nothing to draw on, so a missing balance is not an
    // error for it.
    @Test
    fun `allows unpaid leave with no balance`() {
        val result = LeaveRules.validate(request(type = "unpaid"), date("2026-05-01"), balance = null)
        assertIs<LeaveRules.Validation.Valid>(result)
    }
}
