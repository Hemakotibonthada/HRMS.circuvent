package com.circuvent.hrms.shared.domain

import kotlinx.datetime.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.hours
import kotlin.time.Duration.Companion.minutes

class AttendanceRulesTest {

    private val office = AttendanceRules.Geofence(
        name = "Hyderabad office",
        latitude = 17.4485,
        longitude = 78.3908,
        radiusMetres = 100.0,
    )

    private fun punchAt(lat: Double?, lon: Double?, accuracy: Double? = 10.0) =
        AttendanceRules.Punch(
            at = Instant.parse("2026-06-01T09:00:00Z"),
            latitude = lat,
            longitude = lon,
            accuracyMetres = accuracy,
        )

    // ── Distance ─────────────────────────────────────────────

    @Test
    fun `a point is zero metres from itself`() {
        assertEquals(0.0, AttendanceRules.distanceMetres(17.4485, 78.3908, 17.4485, 78.3908), 0.5)
    }

    @Test
    fun `measures a known short distance`() {
        // Roughly 111 metres per 0.001 degree of latitude.
        val metres = AttendanceRules.distanceMetres(17.4485, 78.3908, 17.4495, 78.3908)
        assertTrue(metres in 100.0..120.0, "expected about 111m, got $metres")
    }

    // ── Punching ─────────────────────────────────────────────

    @Test
    fun `allows a punch inside the fence and names the site`() {
        val decision = AttendanceRules.mayPunch(punchAt(17.4485, 78.3908), listOf(office))
        assertIs<AttendanceRules.PunchDecision.Allowed>(decision)
        assertEquals("Hyderabad office", decision.site)
    }

    @Test
    fun `refuses a punch well outside, and says how far`() {
        val decision = AttendanceRules.mayPunch(punchAt(17.5000, 78.3908), listOf(office))
        assertIs<AttendanceRules.PunchDecision.Refused>(decision)
        assertTrue(decision.reason.contains("Hyderabad office"))
    }

    // A phone indoors can be eighty metres out. A fence drawn tightly round a
    // building would otherwise reject somebody standing inside it.
    @Test
    fun `allows a poor reading whose uncertainty reaches the fence`() {
        val justOutside = punchAt(17.4496, 78.3908, accuracy = 80.0)
        val decision = AttendanceRules.mayPunch(justOutside, listOf(office))
        assertIs<AttendanceRules.PunchDecision.Allowed>(decision)
    }

    @Test
    fun `refuses a reading too imprecise to mean anything`() {
        val decision = AttendanceRules.mayPunch(punchAt(17.4485, 78.3908, accuracy = 900.0), listOf(office))
        assertIs<AttendanceRules.PunchDecision.Refused>(decision)
    }

    @Test
    fun `refuses when location is required and absent`() {
        val decision = AttendanceRules.mayPunch(punchAt(null, null), listOf(office))
        assertIs<AttendanceRules.PunchDecision.Refused>(decision)
    }

    @Test
    fun `allows a punch with no location where none is required`() {
        val decision = AttendanceRules.mayPunch(punchAt(null, null), listOf(office), requireLocation = false)
        assertIs<AttendanceRules.PunchDecision.Allowed>(decision)
    }

    @Test
    fun `allows any location when no fences are configured`() {
        val decision = AttendanceRules.mayPunch(punchAt(0.0, 0.0), emptyList())
        assertIs<AttendanceRules.PunchDecision.Allowed>(decision)
    }

    @Test
    fun `accepts any one of several sites`() {
        val other = office.copy(name = "Pune office", latitude = 18.5204, longitude = 73.8567)
        val decision = AttendanceRules.mayPunch(punchAt(18.5204, 73.8567), listOf(office, other))
        assertIs<AttendanceRules.PunchDecision.Allowed>(decision)
        assertEquals("Pune office", decision.site)
    }

    // ── Worked time ──────────────────────────────────────────

    @Test
    fun `measures a worked shift`() {
        val inAt = Instant.parse("2026-06-01T09:00:00Z")
        val outAt = Instant.parse("2026-06-01T17:30:00Z")
        assertEquals(8.hours + 30.minutes, AttendanceRules.worked(inAt, outAt))
    }

    @Test
    fun `a punch out before the punch in is zero, not negative`() {
        val inAt = Instant.parse("2026-06-01T17:00:00Z")
        val outAt = Instant.parse("2026-06-01T09:00:00Z")
        assertEquals(kotlin.time.Duration.ZERO, AttendanceRules.worked(inAt, outAt))
    }

    // ── Day credit ───────────────────────────────────────────

    @Test
    fun `credits a full day, a half day and an absence`() {
        assertEquals(1.0, AttendanceRules.dayCredit(9.hours))
        assertEquals(1.0, AttendanceRules.dayCredit(8.hours))
        assertEquals(0.5, AttendanceRules.dayCredit(5.hours))
        assertEquals(0.0, AttendanceRules.dayCredit(2.hours))
    }

    // ── Lateness ─────────────────────────────────────────────

    @Test
    fun `allows a grace period before counting somebody late`() {
        val nine = 9 * 60
        assertFalse(AttendanceRules.isLate(nine + 10, nine))
        assertFalse(AttendanceRules.isLate(nine + 15, nine))
        assertTrue(AttendanceRules.isLate(nine + 16, nine))
    }

    // ── Overnight shifts ─────────────────────────────────────
    //
    // 22:00 to 06:00 is eight hours, not minus sixteen. The naive subtraction
    // is how night staff get paid for a negative day.
    @Test
    fun `measures a shift that crosses midnight`() {
        assertEquals(8 * 60, AttendanceRules.minutesBetween(22 * 60, 6 * 60))
    }

    @Test
    fun `measures an ordinary daytime shift`() {
        assertEquals(9 * 60, AttendanceRules.minutesBetween(9 * 60, 18 * 60))
    }
}
