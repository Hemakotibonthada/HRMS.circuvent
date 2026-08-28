package com.circuvent.hrms.domain

import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.roundToLong
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * GEOFENCE — is this person at work?
 *
 * The single most consequential piece of arithmetic in the app: it decides
 * whether somebody's clock-in is accepted, which decides whether they are paid
 * for the day.
 *
 * The Earth radius is 6,371,008.8 m and that figure is load-bearing. The
 * previous generation of this product briefly had two haversine
 * implementations — the server used 6,371,000 and the phone used 6,371,008.8 —
 * so the two disagreed by about a metre per kilometre. Small, until it puts
 * somebody on opposite sides of a 50 m office boundary depending on which one
 * you asked, and the answer decides whether they were at work.
 *
 * The server runs the same calculation. This copy exists so a refusal is
 * instant and explains itself, rather than arriving as a 403 after a round
 * trip. It is not security: the phone is not trusted and the server checks
 * again.
 */
object Geofence {

    /** IUGG mean Earth radius. Must match the server. */
    const val EARTH_RADIUS_METRES = 6_371_008.8

    data class Coordinates(
        val latitude: Double,
        val longitude: Double,
        val accuracyMetres: Double? = null,
        /** Epoch milliseconds of the fix. */
        val capturedAt: Long? = null,
        /** The OS says this came from a mock provider. */
        val isMocked: Boolean = false,
    )

    data class Fence(
        val id: String,
        val name: String,
        val latitude: Double,
        val longitude: Double,
        val radiusMetres: Double,
    )

    enum class Confidence { INSIDE, PROBABLY_INSIDE, UNCERTAIN, OUTSIDE }

    data class FenceResult(
        val fence: Fence?,
        val distanceMetres: Int?,
        val confidence: Confidence,
        val message: String,
    )

    enum class Severity { HIGH, MEDIUM }

    data class Signal(val code: String, val severity: Severity, val detail: String)

    data class Verdict(
        val allowed: Boolean,
        val requiresReview: Boolean,
        val fence: Fence?,
        val confidence: Confidence,
        val signals: List<Signal>,
        val message: String,
    )

    /** Accuracy beyond which a fix cannot decide a 50 m boundary. */
    const val DEFAULT_MAX_ACCURACY_METRES = 100.0

    private fun requireValid(point: Coordinates) {
        require(point.latitude.isFinite() && point.longitude.isFinite()) {
            "Coordinates must be finite numbers"
        }
        require(point.latitude in -90.0..90.0) { "Latitude must be between -90 and 90" }
        require(point.longitude in -180.0..180.0) { "Longitude must be between -180 and 180" }
    }

    /**
     * Great-circle distance between two points, in metres.
     *
     * Haversine rather than the equirectangular approximation: the
     * approximation is faster and wrong by enough to matter at the edge of a
     * 50 m office fence, which is exactly where the answer is contested.
     */
    fun distanceMetres(a: Coordinates, b: Coordinates): Double {
        requireValid(a)
        requireValid(b)

        val lat1 = Math.toRadians(a.latitude)
        val lat2 = Math.toRadians(b.latitude)
        val deltaLat = Math.toRadians(b.latitude - a.latitude)
        val deltaLon = Math.toRadians(b.longitude - a.longitude)

        val h = sin(deltaLat / 2) * sin(deltaLat / 2) +
            cos(lat1) * cos(lat2) * sin(deltaLon / 2) * sin(deltaLon / 2)

        // min(1.0, …) guards the floating-point case where h creeps just over
        // 1 for antipodal points and asin returns NaN.
        return 2 * EARTH_RADIUS_METRES * asin(min(1.0, sqrt(h)))
    }

    private fun distanceTo(position: Coordinates, fence: Fence): Double =
        distanceMetres(
            position,
            Coordinates(latitude = fence.latitude, longitude = fence.longitude),
        )

    private fun formatDistance(metres: Double): String =
        if (metres >= 1000) "%.1f km".format(metres / 1000) else "${metres.roundToInt()} m"

    /**
     * Which fence, if any, this position is within — and how sure we are.
     *
     * The accuracy radius is treated as a real uncertainty rather than
     * ignored. A fix accurate to 80 m cannot decide a 50 m boundary, and
     * pretending otherwise is worse than asking the person to move.
     */
    fun locateWithin(
        position: Coordinates,
        fences: List<Fence>,
        maxAccuracyMetres: Double = DEFAULT_MAX_ACCURACY_METRES,
    ): FenceResult {
        if (fences.isEmpty()) {
            return FenceResult(null, null, Confidence.UNCERTAIN, "No work locations are configured")
        }

        val accuracy = position.accuracyMetres ?: 0.0
        if (accuracy > maxAccuracyMetres) {
            return FenceResult(
                fence = null,
                distanceMetres = null,
                confidence = Confidence.UNCERTAIN,
                message = "Your location is only accurate to about ${accuracy.roundToInt()} m. " +
                    "Step outside or near a window and try again.",
            )
        }

        // minByOrNull rather than sorting and indexing. The TypeScript version
        // needed a comment and a dead branch to explain why an index into a
        // non-empty array was still possibly undefined under its own compiler
        // settings; Kotlin's nullable return says it once.
        val nearest = fences.minByOrNull { distanceTo(position, it) }
            ?: return FenceResult(null, null, Confidence.UNCERTAIN, "No work locations are configured")

        val distance = distanceTo(position, nearest)

        // Certainly inside: even the far edge of the uncertainty circle is
        // within the fence.
        if (distance + accuracy <= nearest.radiusMetres) {
            return FenceResult(nearest, distance.roundToInt(), Confidence.INSIDE, "At ${nearest.name}")
        }

        // Certainly outside: even the near edge is beyond it.
        if (distance - accuracy > nearest.radiusMetres) {
            return FenceResult(
                fence = null,
                distanceMetres = distance.roundToInt(),
                confidence = Confidence.OUTSIDE,
                message = "You are about ${formatDistance(distance - nearest.radiusMetres)} from ${nearest.name}",
            )
        }

        // The circle straddles the boundary. The centre reading decides which
        // way to lean, but the caller is told that it is a lean.
        val leansInside = distance <= nearest.radiusMetres
        return FenceResult(
            fence = if (leansInside) nearest else null,
            distanceMetres = distance.roundToInt(),
            confidence = if (leansInside) Confidence.PROBABLY_INSIDE else Confidence.UNCERTAIN,
            message = "You seem to be at the edge of ${nearest.name}. Move a little closer if this is refused.",
        )
    }

    /**
     * Reasons to distrust a position.
     *
     * Signals, not a verdict. Every one of these has an innocent explanation —
     * a developer with mock locations left on, a passenger on a train, a fix
     * cached while the app was backgrounded. The output is for a human
     * reviewing an exception report, and treating any of it as proof would
     * deny somebody their pay on a heuristic.
     */
    fun spoofSignals(
        position: Coordinates,
        previous: Coordinates? = null,
        now: Long = System.currentTimeMillis(),
    ): List<Signal> {
        val signals = mutableListOf<Signal>()

        if (position.isMocked) {
            // The only signal the operating system asserts rather than
            // something we inferred, so it is the only high-severity one on
            // its own.
            signals += Signal(
                "mock_provider",
                Severity.HIGH,
                "The device reports this location came from a mock provider",
            )
        }

        val accuracy = position.accuracyMetres
        if (accuracy != null && accuracy in 0.0..1.0) {
            // Consumer GNSS does not do sub-metre. A reading this good is more
            // likely a fabricated one than a real fix.
            signals += Signal(
                "implausible_accuracy",
                Severity.MEDIUM,
                "An accuracy of ${"%.1f".format(accuracy)} m is better than consumer hardware achieves",
            )
        }

        val capturedAt = position.capturedAt
        // Compared against null, not falsiness. A timestamp of 0 is falsy, and
        // in the previous implementation that skipped the check entirely — the
        // same shape as treating an empty string as an absent number.
        if (capturedAt != null) {
            val age = now - capturedAt
            if (age > STALE_FIX_MS) {
                signals += Signal(
                    "stale_fix",
                    Severity.MEDIUM,
                    "The fix is ${(age / 60_000)} minutes old",
                )
            }

            if (previous?.capturedAt != null) {
                val elapsed = capturedAt - previous.capturedAt
                if (elapsed > 0) {
                    val metres = distanceMetres(previous, position)
                    val metresPerSecond = metres / (elapsed / 1000.0)
                    if (metresPerSecond > IMPOSSIBLE_SPEED_MPS && metres > 500) {
                        signals += Signal(
                            "impossible_speed",
                            Severity.MEDIUM,
                            "That is ${(metresPerSecond * 3.6).roundToLong()} km/h since the last fix",
                        )
                    }
                }
            }
        }

        return signals
    }

    /** Older than this and the fix may predate the tap that asked for it. */
    private const val STALE_FIX_MS = 5 * 60 * 1000L

    /** Faster than a commercial aircraft; 300 m/s is about 1,080 km/h. */
    private const val IMPOSSIBLE_SPEED_MPS = 300.0

    /**
     * The decision.
     *
     * `allowAnywhere` is for remote and field staff, whose employer has not
     * configured a fence for them. They still get their signals recorded, so a
     * mock provider is visible on the exception report — it simply does not
     * block the punch.
     *
     * Nothing here refuses a punch on a spoofing signal alone. A signal is a
     * reason for a human to look, and an automatic refusal on a heuristic is
     * how somebody loses a day's pay to a train journey.
     */
    fun evaluateClockIn(
        position: Coordinates,
        fences: List<Fence>,
        previous: Coordinates? = null,
        now: Long = System.currentTimeMillis(),
        maxAccuracyMetres: Double = DEFAULT_MAX_ACCURACY_METRES,
        allowAnywhere: Boolean = false,
    ): Verdict {
        val signals = spoofSignals(position, previous, now)
        val highSeverity = signals.any { it.severity == Severity.HIGH }

        if (allowAnywhere) {
            return Verdict(
                allowed = true,
                requiresReview = highSeverity,
                fence = null,
                confidence = Confidence.INSIDE,
                signals = signals,
                message = "Clocked in",
            )
        }

        val located = locateWithin(position, fences, maxAccuracyMetres)

        if (located.confidence == Confidence.OUTSIDE) {
            return Verdict(
                allowed = false,
                requiresReview = false,
                fence = null,
                confidence = Confidence.OUTSIDE,
                signals = signals,
                message = located.message,
            )
        }

        return Verdict(
            allowed = true,
            requiresReview = highSeverity || located.confidence != Confidence.INSIDE,
            fence = located.fence,
            confidence = located.confidence,
            signals = signals,
            message = located.message,
        )
    }

    /** Kept for the tests that assert the two implementations agree. */
    internal fun absDifference(a: Double, b: Double): Double = abs(a - b)
}
