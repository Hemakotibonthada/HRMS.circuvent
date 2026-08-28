package com.circuvent.hrms.shared.domain

import kotlinx.datetime.Instant
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.time.Duration
import kotlin.time.Duration.Companion.minutes

/**
 * Attendance: punching in, punching out, and whether either is allowed.
 *
 * Shared because the answer must not depend on which phone somebody is
 * holding. An employee whose Android punch-in is accepted at the office gate
 * and whose iPhone punch-in is rejected there has a payroll dispute, not a bug
 * report.
 */
object AttendanceRules {

    data class Punch(
        val at: Instant,
        val latitude: Double? = null,
        val longitude: Double? = null,
        val accuracyMetres: Double? = null,
    )

    data class Geofence(
        val name: String,
        val latitude: Double,
        val longitude: Double,
        val radiusMetres: Double,
    )

    sealed interface PunchDecision {
        data class Allowed(val site: String?) : PunchDecision
        data class Refused(val reason: String) : PunchDecision
    }

    /** Metres between two coordinates, by the haversine formula. */
    fun distanceMetres(
        lat1: Double,
        lon1: Double,
        lat2: Double,
        lon2: Double,
    ): Double {
        val earthRadius = 6_371_000.0
        val dLat = (lat2 - lat1).toRadians()
        val dLon = (lon2 - lon1).toRadians()

        val a = sin(dLat / 2) * sin(dLat / 2) +
            cos(lat1.toRadians()) * cos(lat2.toRadians()) * sin(dLon / 2) * sin(dLon / 2)

        return earthRadius * 2 * atan2(sqrt(a), sqrt(1 - a))
    }

    private fun Double.toRadians(): Double = this * kotlin.math.PI / 180.0

    /**
     * Whether a punch may be recorded where and when it was taken.
     *
     * The accuracy allowance is the part that matters in practice. A phone
     * indoors reports a position that can be eighty metres out, and a fence
     * drawn tightly round a building would reject someone standing inside it.
     * The reading is treated as within the fence if the fence is within the
     * circle of uncertainty, which errs towards letting a real employee work.
     */
    fun mayPunch(
        punch: Punch,
        fences: List<Geofence>,
        requireLocation: Boolean = true,
    ): PunchDecision {
        if (fences.isEmpty()) return PunchDecision.Allowed(null)

        if (punch.latitude == null || punch.longitude == null) {
            return if (requireLocation) {
                PunchDecision.Refused("Location is needed to record attendance here")
            } else {
                PunchDecision.Allowed(null)
            }
        }

        // A reading this bad says nothing about where the person is, so
        // treating it as evidence either way is wrong.
        val accuracy = punch.accuracyMetres ?: 0.0
        if (accuracy > 500.0) {
            return PunchDecision.Refused("Your location is too imprecise to record attendance")
        }

        val within = fences.firstOrNull { fence ->
            val distance = distanceMetres(
                punch.latitude, punch.longitude, fence.latitude, fence.longitude
            )
            distance <= fence.radiusMetres + accuracy
        }

        return if (within != null) {
            PunchDecision.Allowed(within.name)
        } else {
            val nearest = fences.minByOrNull { fence ->
                distanceMetres(punch.latitude, punch.longitude, fence.latitude, fence.longitude)
            }
            val metres = nearest?.let {
                distanceMetres(punch.latitude, punch.longitude, it.latitude, it.longitude).toInt()
            }
            PunchDecision.Refused(
                if (nearest != null) {
                    "You are about ${metres}m from ${nearest.name}"
                } else {
                    "You are not at a registered work location"
                }
            )
        }
    }

    /** Time worked between a punch in and a punch out. */
    fun worked(punchIn: Instant, punchOut: Instant): Duration =
        if (punchOut <= punchIn) Duration.ZERO else punchOut - punchIn

    /**
     * Whether a shift counts as a full day, a half day or an absence.
     *
     * Expressed as thresholds rather than a fixed eight hours, because the
     * figure differs by employer and hardcoding it means every tenant but one
     * is wrong.
     */
    fun dayCredit(
        worked: Duration,
        fullDayAfter: Duration = 8.hoursDuration(),
        halfDayAfter: Duration = 4.hoursDuration(),
    ): Double = when {
        worked >= fullDayAfter -> 1.0
        worked >= halfDayAfter -> 0.5
        else -> 0.0
    }

    private fun Int.hoursDuration(): Duration = (this * 60).minutes

    /** Whether an arrival is late, allowing for a grace period. */
    fun isLate(
        arrivedMinutesAfterMidnight: Int,
        shiftStartMinutesAfterMidnight: Int,
        graceMinutes: Int = 15,
    ): Boolean = arrivedMinutesAfterMidnight > shiftStartMinutesAfterMidnight + graceMinutes

    /**
     * Minutes between two clock readings, allowing for a shift that runs past
     * midnight.
     *
     * A night shift starting at 22:00 and ending at 06:00 is eight hours, not
     * minus sixteen — and the naive subtraction is how overnight staff get
     * paid for a negative day.
     */
    fun minutesBetween(fromMinutes: Int, toMinutes: Int): Int {
        val raw = toMinutes - fromMinutes
        return if (raw >= 0) raw else raw + 24 * 60
    }

    /** Whether two clock readings are within a tolerance, in minutes. */
    fun withinMinutes(a: Int, b: Int, tolerance: Int): Boolean =
        abs(minutesBetween(a, b).coerceAtMost(minutesBetween(b, a))) <= tolerance
}
