package com.circuvent.hrms.feature

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.circuvent.hrms.AppContainer
import com.circuvent.hrms.core.design.Theme
import com.circuvent.hrms.core.ui.AppButton
import com.circuvent.hrms.core.ui.AppCard
import com.circuvent.hrms.core.ui.AppText
import com.circuvent.hrms.core.ui.Banner
import com.circuvent.hrms.core.ui.BannerTone
import com.circuvent.hrms.core.ui.ButtonVariant
import com.circuvent.hrms.core.ui.SkeletonRows
import com.circuvent.hrms.core.ui.TextTone
import com.circuvent.hrms.core.ui.screenPadding
import com.circuvent.hrms.data.LocationProvider
import com.circuvent.hrms.data.SessionUser
import com.circuvent.hrms.data.TodayResponse
import com.circuvent.hrms.data.queue.OfflineQueue
import com.circuvent.hrms.domain.Geofence
import com.circuvent.hrms.domain.ShiftRules
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.LocalDate

/**
 * Today.
 *
 * The clock-in button is the reason this app exists, so it is the only thing
 * above the fold and it is the largest target on the screen.
 *
 * Location is checked on the device before the request is sent — not as
 * security, since a phone is an untrusted client and the server checks again,
 * but so that somebody standing in the wrong car park is told immediately
 * rather than after a round trip that ends in a refusal.
 */
@Composable
fun TodayScreen(container: AppContainer, viewModel: AppViewModel, user: SessionUser?) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val locations = remember { LocationProvider(context) }

    var today by remember { mutableStateOf<TodayResponse?>(null) }
    var loading by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<Triple<BannerTone, String, String?>?>(null) }

    val quarantined by viewModel.quarantined.collectAsState()
    val pending by viewModel.pending.collectAsState()

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { granted ->
        if (granted.values.none { it }) {
            message = Triple(
                BannerTone.ERROR,
                "Location permission is needed",
                "Your employer checks that a clock-in happened at a work location. Grant it in Settings and try again.",
            )
        }
    }

    suspend fun load() {
        try {
            today = container.repository.today()
        } catch (e: Throwable) {
            // Offline is not an error banner. Being offline is the normal state
            // in a lift or a basement, and the queue exists precisely so that
            // it does not block the action.
            if (e is com.circuvent.hrms.data.net.OfflineException) {
                message = Triple(
                    BannerTone.INFO,
                    "You are offline",
                    "Your clock-in will be sent when you reconnect.",
                )
            }
        } finally {
            loading = false
        }
    }

    LaunchedEffect(Unit) {
        load()
        viewModel.flush()
    }

    fun punch(direction: String) {
        busy = true
        message = null

        scope.launch {
            try {
                val located = locations.current()

                when (located) {
                    is LocationProvider.Result.PermissionRequired -> {
                        permissionLauncher.launch(
                            arrayOf(
                                android.Manifest.permission.ACCESS_FINE_LOCATION,
                                android.Manifest.permission.ACCESS_COARSE_LOCATION,
                            )
                        )
                        return@launch
                    }
                    is LocationProvider.Result.Disabled -> {
                        message = Triple(
                            BannerTone.ERROR,
                            "Location is switched off",
                            "Turn location on in your device settings and try again.",
                        )
                        return@launch
                    }
                    is LocationProvider.Result.Unavailable -> {
                        message = Triple(BannerTone.ERROR, "No location fix", located.message)
                        return@launch
                    }
                    is LocationProvider.Result.Located -> {
                        val fence = today?.fence
                        val fences = if (fence == null) emptyList() else listOf(
                            Geofence.Fence(fence.id, fence.name, fence.latitude, fence.longitude, fence.radiusMetres)
                        )

                        // The same function the server runs. Checking here
                        // first means a refusal is instant and explains itself,
                        // instead of arriving as a 403 after a round trip.
                        val verdict = Geofence.evaluateClockIn(
                            position = located.position,
                            fences = fences,
                            allowAnywhere = fences.isEmpty(),
                        )

                        if (!verdict.allowed) {
                            message = Triple(BannerTone.ERROR, "You are not at work", verdict.message)
                            return@launch
                        }

                        submitPunch(container, viewModel, direction, located.position, user)?.let {
                            message = it
                        }
                        load()
                    }
                }
            } catch (e: Exception) {
                message = Triple(BannerTone.ERROR, "That did not work", e.message)
            } finally {
                busy = false
                viewModel.refreshQueueCounts()
            }
        }
    }

    val record = today?.record
    val clockedIn = record?.clockInAt != null && record.clockOutAt == null
    val finished = record?.clockOutAt != null

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(screenPadding(bottomExtra = TabBarHeight)),
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.md),
    ) {
        AppText(
            if (user != null) "Hello, ${user.firstName}" else "",
            tone = TextTone.MUTED,
        )

        AppCard {
            if (loading) {
                // A placeholder the size of the heading it replaces, so the
                // button below does not jump — and so the screen never claims
                // "Not clocked in" before it has asked.
                SkeletonRows(count = 1, rowHeight = 30.dp)
            } else {
                AppText(
                    when {
                        finished -> "Day complete"
                        clockedIn -> "You are clocked in"
                        else -> "Not clocked in"
                    },
                    size = Theme.type.title2,
                    lineHeight = Theme.type.title2Line,
                    weight = FontWeight.Bold,
                    heading = true,
                )
            }

            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(top = Theme.spacing.lg),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Field("In", record?.clockInAt?.let { ShiftRules.formatClock(it) } ?: "—")
                Field("Out", record?.clockOutAt?.let { ShiftRules.formatClock(it) } ?: "—")
                Field("Worked", record?.workedMinutes?.let { ShiftRules.formatDuration(it) } ?: "—")
            }

            if (record?.requiresLocationReview == true) {
                AppText(
                    "Your manager will check today's location. Nothing is needed from you.",
                    size = Theme.type.footnote,
                    lineHeight = Theme.type.footnoteLine,
                    tone = TextTone.WARNING,
                    modifier = Modifier.padding(top = Theme.spacing.md),
                )
            }

            if (pending > 0) {
                // Shown rather than hidden. Somebody whose punch is sitting on
                // the device needs to know it has not reached the server — that
                // is the difference between "I clocked in" and "I can prove it".
                AppText(
                    if (pending == 1) "1 action waiting to be sent" else "$pending actions waiting to be sent",
                    size = Theme.type.footnote,
                    lineHeight = Theme.type.footnoteLine,
                    tone = TextTone.MUTED,
                    modifier = Modifier.padding(top = Theme.spacing.md),
                )
            }

            if (!loading) {
                AppButton(
                    label = if (clockedIn) "Clock out" else "Clock in",
                    onClick = { punch(if (clockedIn) "out" else "in") },
                    variant = if (clockedIn) ButtonVariant.SECONDARY else ButtonVariant.PRIMARY,
                    busy = busy,
                    enabled = !finished,
                    contentDescription = if (clockedIn) {
                        "Records the end of your working day using your current location"
                    } else {
                        "Records the start of your working day using your current location"
                    },
                    modifier = Modifier.padding(top = Theme.spacing.xl),
                )
            }
        }

        message?.let { (tone, title, description) ->
            Banner(tone = tone, title = title, description = description)
        }

        if (quarantined.isNotEmpty()) {
            // Refused work has to be visible and actionable. The alternative is
            // that it sits in a database on the phone for ever while the person
            // believes they clocked in — the failure this whole queue exists to
            // avoid.
            Banner(
                tone = BannerTone.ERROR,
                title = if (quarantined.size == 1) {
                    "1 action was refused and will not be retried"
                } else {
                    "${quarantined.size} actions were refused and will not be retried"
                },
                action = {
                    Column(verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm)) {
                        quarantined.forEach { operation ->
                            QuarantinedRow(operation, viewModel)
                        }
                    }
                },
            )
        }
    }
}

@Composable
private fun QuarantinedRow(operation: OfflineQueue.Operation, viewModel: AppViewModel) {
    val name = operation.kind.replace('.', ' ').replace('_', ' ')

    Column {
        AppText(
            "$name — ${operation.lastError ?: "no reason given"}",
            size = Theme.type.caption,
            lineHeight = Theme.type.captionLine,
            tone = TextTone.DANGER,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(Theme.spacing.sm)) {
            AppButton(
                label = "Try again",
                onClick = { viewModel.retry(operation.id) },
                variant = ButtonVariant.GHOST,
                fullWidth = false,
                contentDescription = "Try $name again",
            )
            AppButton(
                label = "Discard",
                onClick = { viewModel.discard(operation.id) },
                variant = ButtonVariant.GHOST,
                fullWidth = false,
                contentDescription = "Discard $name permanently",
            )
        }
    }
}

@Composable
private fun Field(label: String, value: String) {
    Column {
        AppText(label, size = Theme.type.caption, lineHeight = Theme.type.captionLine, tone = TextTone.MUTED)
        AppText(
            value,
            size = Theme.type.callout,
            lineHeight = Theme.type.calloutLine,
            weight = FontWeight.SemiBold,
        )
    }
}

/**
 * Writes the punch to the queue, then tries to send it.
 *
 * Queue first, not send-then-queue-on-failure: the process can be killed
 * between the tap and the response — locking the phone and pocketing it does
 * exactly that — and the punch has to survive it.
 *
 * Returns a banner, in three states. "Sent", "saved on this device", and
 * "refused" are different facts, and reporting a refusal as a success is the
 * worst of the three because the person stops thinking about it.
 */
private suspend fun submitPunch(
    container: AppContainer,
    viewModel: AppViewModel,
    direction: String,
    position: Geofence.Coordinates,
    user: SessionUser?,
): Triple<BannerTone, String, String?>? {
    val payload = buildJsonObject {
        put("action", direction)
        put("method", "mobile")
        put("latitude", position.latitude)
        put("longitude", position.longitude)
        position.accuracyMetres?.let { put("accuracyMetres", it) }
        position.capturedAt?.let { put("capturedAt", java.time.Instant.ofEpochMilli(it).toString()) }
        put("isMocked", position.isMocked)
    }.toString()

    // Idempotency key: a retry or a double tap must not produce two punches.
    // Scoped to the person, the day and the direction.
    val who = user?.employeeId ?: user?.id ?: "unknown"
    val id = "clock-$direction-$who-${LocalDate.now()}"
    val kind = if (direction == "in") "attendance.clock_in" else "attendance.clock_out"

    container.queue.enqueue(id, kind, payload, streamKey = "attendance-$who")

    return try {
        container.repository.sendQueued(kind, payload, id)
        container.queue.markSent(id)
        Triple(BannerTone.SUCCESS, if (direction == "in") "Clocked in" else "Clocked out", null)
    } catch (e: com.circuvent.hrms.data.net.OfflineException) {
        container.queue.markFailed(id, null, e.message)
        Triple(
            BannerTone.INFO,
            "Saved on this device",
            "It will be sent when you have a connection.",
        )
    } catch (e: com.circuvent.hrms.data.net.ApiException) {
        container.queue.markFailed(id, e.status, e.message)
        when (container.queue.outcomeOf(id)) {
            OfflineQueue.Status.QUARANTINED -> Triple(
                BannerTone.ERROR,
                "This could not be recorded",
                "Please speak to your manager or HR.",
            )
            else -> Triple(
                BannerTone.INFO,
                "Saved on this device",
                "It will be retried automatically.",
            )
        }
    }
}

