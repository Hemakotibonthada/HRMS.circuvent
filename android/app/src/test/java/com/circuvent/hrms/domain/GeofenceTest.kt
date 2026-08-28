package com.circuvent.hrms.domain

import com.circuvent.hrms.domain.Geofence.Confidence
import com.circuvent.hrms.domain.Geofence.Coordinates
import com.circuvent.hrms.domain.Geofence.Fence
import com.circuvent.hrms.domain.Geofence.Severity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GeofenceTest {

    private val office = Fence("f1", "Whitefield office", 12.9698, 77.7500, 50.0)

    private fun at(lat: Double, lon: Double, accuracy: Double? = null) =
        Coordinates(latitude = lat, longitude = lon, accuracyMetres = accuracy)

    // ─── The radius ──────────────────────────────────────────

    @Test
    fun `the Earth radius is the one the server uses`() {
        // Load-bearing. The previous generation of this product had the server
        // on 6,371,000 and the phone on 6,371,008.8, so they disagreed by about
        // a metre per kilometre — enough to put somebody on opposite sides of a
        // 50 m office fence depending on which was asked.
        assertEquals(6_371_008.8, Geofence.EARTH_RADIUS_METRES, 0.0)
    }

    @Test
    fun `one degree of latitude is the arc the radius implies`() {
        // This is the radius test with the arithmetic attached: 2*pi*R/360.
        // If somebody "rounds" the constant, this fails with the metres of
        // error rather than with a constant nobody can eyeball.
        val expected = 2 * Math.PI * Geofence.EARTH_RADIUS_METRES / 360.0
        assertEquals(expected, Geofence.distanceMetres(at(0.0, 0.0), at(1.0, 0.0)), 0.001)

        // 111,195.08 m. The neighbouring value 111,194.93 is what the *old*
        // server radius of 6,371,000 produced — the one that disagreed with
        // the phone by about a metre per kilometre. Writing both down is the
        // point: 15 cm per degree is exactly the size of error that reads as a
        // rounding difference and decides a 50 m fence.
        assertEquals(111_195.08, Geofence.distanceMetres(at(0.0, 0.0), at(1.0, 0.0)), 0.05)

        val withOldRadius = 2 * Math.PI * 6_371_000.0 / 360.0
        assertEquals(111_194.93, withOldRadius, 0.05)
    }

    @Test
    fun `a degree of longitude shrinks with latitude`() {
        val equator = Geofence.distanceMetres(at(0.0, 0.0), at(0.0, 1.0))
        val bengaluru = Geofence.distanceMetres(at(12.97, 77.0), at(12.97, 78.0))
        assertTrue(bengaluru < equator)
        // cos(12.97 degrees) is about 0.9745.
        assertEquals(equator * 0.9745, bengaluru, 50.0)
    }

    @Test
    fun `distance to itself is zero and the order does not matter`() {
        assertEquals(0.0, Geofence.distanceMetres(at(12.97, 77.75), at(12.97, 77.75)), 0.0001)
        val a = Geofence.distanceMetres(at(12.97, 77.75), at(12.98, 77.76))
        val b = Geofence.distanceMetres(at(12.98, 77.76), at(12.97, 77.75))
        assertEquals(a, b, 0.0001)
    }

    @Test
    fun `antipodal points do not produce NaN`() {
        // asin of a value that creeps just over 1 through floating point is
        // NaN, and a NaN distance compares false against every fence, which
        // silently reads as "outside".
        val d = Geofence.distanceMetres(at(0.0, 0.0), at(0.0, 180.0))
        assertFalse(d.isNaN())
        assertEquals(Math.PI * Geofence.EARTH_RADIUS_METRES, d, 1.0)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `an impossible latitude is refused rather than measured`() {
        Geofence.distanceMetres(at(91.0, 0.0), at(0.0, 0.0))
    }

    // ─── locateWithin ────────────────────────────────────────

    @Test
    fun `no fences configured is uncertain, not outside`() {
        // "Outside" would refuse the punch. Nobody has said where work is.
        val result = Geofence.locateWithin(at(12.9698, 77.75), emptyList())
        assertEquals(Confidence.UNCERTAIN, result.confidence)
        assertNull(result.fence)
    }

    @Test
    fun `standing at the office is inside`() {
        val result = Geofence.locateWithin(at(12.9698, 77.7500, accuracy = 5.0), listOf(office))
        assertEquals(Confidence.INSIDE, result.confidence)
        assertEquals(office, result.fence)
        assertTrue(result.message.contains("Whitefield"))
    }

    @Test
    fun `a fix too vague to decide a boundary is uncertain, not a refusal`() {
        // A fix accurate to 200 m cannot decide a 50 m fence. Refusing on it
        // would deny a punch on the strength of a reading that says nothing.
        val result = Geofence.locateWithin(at(12.9698, 77.7500, accuracy = 200.0), listOf(office))
        assertEquals(Confidence.UNCERTAIN, result.confidence)
        assertTrue(result.message.contains("accurate to about 200 m"))
    }

    @Test
    fun `well away from the office is outside, with the distance named`() {
        val result = Geofence.locateWithin(at(12.9350, 77.6250, accuracy = 10.0), listOf(office))
        assertEquals(Confidence.OUTSIDE, result.confidence)
        assertNull(result.fence)
        assertTrue("message was: ${result.message}", result.message.contains("km"))
    }

    @Test
    fun `the uncertainty circle must clear the fence to be certainly inside`() {
        // 30 m from the centre of a 50 m fence with a 30 m accuracy: the far
        // edge of the circle is at 60 m, outside. It leans inside and says so.
        val thirtyMetresNorth = at(12.9698 + 0.00027, 77.7500, accuracy = 30.0)
        val result = Geofence.locateWithin(thirtyMetresNorth, listOf(office))
        assertEquals(Confidence.PROBABLY_INSIDE, result.confidence)
        assertEquals(office, result.fence)
    }

    @Test
    fun `the nearest fence is chosen, whatever the order of the list`() {
        val far = Fence("f2", "Electronic City", 12.8400, 77.6800, 50.0)
        val here = at(12.9698, 77.7500, accuracy = 5.0)

        assertEquals(office, Geofence.locateWithin(here, listOf(far, office)).fence)
        assertEquals(office, Geofence.locateWithin(here, listOf(office, far)).fence)
    }

    // ─── Spoofing signals ────────────────────────────────────

    @Test
    fun `a mock provider is the only high severity signal on its own`() {
        val signals = Geofence.spoofSignals(
            Coordinates(12.97, 77.75, accuracyMetres = 8.0, capturedAt = 1_000_000L, isMocked = true),
            now = 1_000_000L,
        )
        assertEquals(1, signals.size)
        assertEquals(Severity.HIGH, signals.first().severity)
        assertEquals("mock_provider", signals.first().code)
    }

    @Test
    fun `sub-metre accuracy is implausible on consumer hardware`() {
        val signals = Geofence.spoofSignals(
            Coordinates(12.97, 77.75, accuracyMetres = 0.4, capturedAt = 1_000L),
            now = 1_000L,
        )
        assertTrue(signals.any { it.code == "implausible_accuracy" })
    }

    @Test
    fun `a timestamp of zero is still a timestamp`() {
        // The defect this pins: the previous implementation tested the
        // timestamp for truthiness, and 0 is falsy, so the staleness and
        // impossible-speed checks were skipped entirely for it. Same shape as
        // treating an empty string as an absent number.
        val signals = Geofence.spoofSignals(
            Coordinates(12.97, 77.75, accuracyMetres = 8.0, capturedAt = 0L),
            now = 60 * 60 * 1000L,
        )
        assertTrue("A fix an hour old should be stale", signals.any { it.code == "stale_fix" })
    }

    @Test
    fun `a plausible commute raises nothing`() {
        val previous = Coordinates(12.9350, 77.6250, capturedAt = 0L)
        val now = Coordinates(12.9698, 77.7500, accuracyMetres = 10.0, capturedAt = 30 * 60 * 1000L)
        val signals = Geofence.spoofSignals(now, previous, now = 30 * 60 * 1000L)
        assertTrue("Signals were: $signals", signals.none { it.code == "impossible_speed" })
    }

    @Test
    fun `crossing the country in a minute is flagged`() {
        val previous = Coordinates(12.97, 77.75, capturedAt = 0L)
        val now = Coordinates(28.61, 77.21, accuracyMetres = 10.0, capturedAt = 60_000L)
        val signals = Geofence.spoofSignals(now, previous, now = 60_000L)
        val speed = signals.firstOrNull { it.code == "impossible_speed" }
        assertTrue("Signals were: $signals", speed != null)
        // Medium, not high. A passenger on a plane produces this too, and an
        // automatic refusal on it would deny somebody a day's pay.
        assertEquals(Severity.MEDIUM, speed!!.severity)
    }

    // ─── The verdict ─────────────────────────────────────────

    @Test
    fun `outside the fence refuses the punch and does not ask for review`() {
        val verdict = Geofence.evaluateClockIn(
            at(12.9350, 77.6250, accuracy = 10.0),
            listOf(office),
        )
        assertFalse(verdict.allowed)
        assertFalse("A refusal needs no review; it never happened", verdict.requiresReview)
    }

    @Test
    fun `inside the fence with a clean fix is allowed and unreviewed`() {
        val verdict = Geofence.evaluateClockIn(
            Coordinates(12.9698, 77.7500, accuracyMetres = 5.0, capturedAt = 1_000L),
            listOf(office),
            now = 1_000L,
        )
        assertTrue(verdict.allowed)
        assertFalse(verdict.requiresReview)
    }

    @Test
    fun `a mocked position is allowed but flagged for a human`() {
        // Not refused. The punch is recorded and a person is asked to look —
        // refusing on a heuristic is how somebody loses a day's pay to a
        // developer setting they forgot was on.
        val verdict = Geofence.evaluateClockIn(
            Coordinates(12.9698, 77.7500, accuracyMetres = 5.0, capturedAt = 1_000L, isMocked = true),
            listOf(office),
            now = 1_000L,
        )
        assertTrue(verdict.allowed)
        assertTrue(verdict.requiresReview)
    }

    @Test
    fun `field staff clock in from anywhere, and are still watched`() {
        val verdict = Geofence.evaluateClockIn(
            Coordinates(0.0, 0.0, accuracyMetres = 5.0, capturedAt = 1_000L, isMocked = true),
            emptyList(),
            now = 1_000L,
            allowAnywhere = true,
        )
        assertTrue(verdict.allowed)
        assertTrue("A mock provider still deserves a look", verdict.requiresReview)
    }

    @Test
    fun `an uncertain fix is allowed but reviewed`() {
        // The punch is not lost because the GPS was poor, and the record says
        // the location could not be confirmed.
        val verdict = Geofence.evaluateClockIn(
            Coordinates(12.9698, 77.7500, accuracyMetres = 200.0, capturedAt = 1_000L),
            listOf(office),
            now = 1_000L,
        )
        assertTrue(verdict.allowed)
        assertTrue(verdict.requiresReview)
        assertEquals(Confidence.UNCERTAIN, verdict.confidence)
    }
}
