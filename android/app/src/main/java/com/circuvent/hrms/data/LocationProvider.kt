package com.circuvent.hrms.data

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import androidx.core.content.ContextCompat
import com.circuvent.hrms.domain.Geofence
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * One reading, at the moment of the tap.
 *
 * `getCurrentLocation` rather than `requestLocationUpdates`: this asks for a
 * single fresh fix and stops. A subscription would keep the radio on and would
 * be, in effect, the background tracking the manifest goes out of its way to
 * make impossible.
 *
 * The last-known location is deliberately not used as a fallback. It can be
 * hours old and half a city away, and a stale fix that happens to land inside
 * the office fence would record somebody as present who is not there.
 */
class LocationProvider(private val context: Context) {

    sealed interface Result {
        data class Located(val position: Geofence.Coordinates) : Result
        /** The user has not granted permission yet. Ask, then try again. */
        data object PermissionRequired : Result
        /** Location services are switched off on the device. */
        data object Disabled : Result
        /** Permission and services are fine; no fix arrived in time. */
        data class Unavailable(val message: String) : Result
    }

    fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    private fun servicesEnabled(): Boolean {
        val manager = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
            ?: return false
        return manager.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
            manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
    }

    @SuppressLint("MissingPermission")
    suspend fun current(): Result {
        if (!hasPermission()) return Result.PermissionRequired
        if (!servicesEnabled()) return Result.Disabled

        val client = LocationServices.getFusedLocationProviderClient(context)
        val request = CurrentLocationRequest.Builder()
            .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
            // Ten seconds. Somebody is standing at a door waiting for this; a
            // longer wait is one they fill by tapping again.
            .setDurationMillis(10_000)
            .setMaxUpdateAgeMillis(0)
            .build()

        return suspendCancellableCoroutine { continuation ->
            client.getCurrentLocation(request, null)
                .addOnSuccessListener { location ->
                    if (location == null) {
                        continuation.resume(
                            Result.Unavailable("Could not get a location fix. Step outside or near a window and try again.")
                        )
                    } else {
                        continuation.resume(
                            Result.Located(
                                Geofence.Coordinates(
                                    latitude = location.latitude,
                                    longitude = location.longitude,
                                    accuracyMetres = location.accuracy.toDouble(),
                                    capturedAt = location.time,
                                    // The OS asserting this is the only signal
                                    // that is not an inference, which is why it
                                    // is the only high-severity one on its own.
                                    isMocked = location.isFromMockProvider,
                                )
                            )
                        )
                    }
                }
                .addOnFailureListener { error ->
                    continuation.resume(
                        Result.Unavailable(error.message ?: "Could not get a location fix")
                    )
                }
        }
    }
}
