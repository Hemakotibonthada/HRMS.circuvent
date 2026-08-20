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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.circuvent.hrms.AppContainer
import com.circuvent.hrms.R
import com.circuvent.hrms.core.design.Theme
import com.circuvent.hrms.core.ui.AppButton
import com.circuvent.hrms.core.ui.AppCard
import com.circuvent.hrms.core.ui.AppText
import com.circuvent.hrms.core.ui.Banner
import com.circuvent.hrms.core.ui.BannerTone
import com.circuvent.hrms.core.ui.ButtonVariant
import com.circuvent.hrms.core.ui.HeroCard
import com.circuvent.hrms.core.ui.SkeletonRows
import com.circuvent.hrms.core.ui.TextTone
import com.circuvent.hrms.core.ui.screenPadding
import com.circuvent.hrms.data.LocationProvider
import android.content.Context
import android.content.pm.PackageManager
import android.util.Base64
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.core.content.ContextCompat
import com.circuvent.hrms.core.camera.PunchCamera
import com.circuvent.hrms.data.AttendancePolicyDto
import com.circuvent.hrms.data.PunchSelfie
import com.circuvent.hrms.data.SessionUser
import com.circuvent.hrms.data.TodayResponse
import com.circuvent.hrms.data.queue.OfflineQueue
import com.circuvent.hrms.domain.Geofence
import com.circuvent.hrms.domain.ShiftRules
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.putJsonObject
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
fun TodayScreen(
    container: AppContainer,
    viewModel: AppViewModel,
    user: SessionUser?,
    onNavigate: (String) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val locations = remember { LocationProvider(context) }

    var today by remember { mutableStateOf<TodayResponse?>(null) }
    var loading by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<Triple<BannerTone, String, String?>?>(null) }

    val quarantined by viewModel.quarantined.collectAsState()
    val pending by viewModel.pending.collectAsState()

    val lifecycleOwner = LocalLifecycleOwner.current

    // Defaults to "no photograph". A policy call that fails must not open a
    // camera — photographing somebody on the strength of a network error is
    // the one outcome worth designing against here.
    var policy by remember { mutableStateOf(AttendancePolicyDto()) }

    val cameraPermissionNeededTitle = stringResource(R.string.today_camera_permission_needed_title)
    val cameraPermissionNeededDescription = stringResource(R.string.today_camera_permission_needed_description)
    val locationPermissionNeededTitle = stringResource(R.string.today_location_permission_needed_title)
    val locationPermissionNeededDescription = stringResource(R.string.today_location_permission_needed_description)
    val offlineTitle = stringResource(R.string.today_offline_title)
    val offlineDescription = stringResource(R.string.today_offline_description)
    val locationOffTitle = stringResource(R.string.today_location_off_title)
    val locationOffDescription = stringResource(R.string.today_location_off_description)
    val noLocationFixTitle = stringResource(R.string.today_no_location_fix_title)
    val notAtWorkTitle = stringResource(R.string.today_not_at_work_title)
    val photoNotTakenTitle = stringResource(R.string.today_photo_not_taken_title)
    val photoNotTakenDescriptionTemplate = stringResource(R.string.today_photo_not_taken_description_template)
    val genericErrorTitle = stringResource(R.string.today_generic_error_title)

    fun cameraGranted(): Boolean =
        ContextCompat.checkSelfPermission(context, android.Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED

    val cameraLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (!granted) {
            message = Triple(
                BannerTone.ERROR,
                cameraPermissionNeededTitle,
                cameraPermissionNeededDescription,
            )
        }
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { granted ->
        if (granted.values.none { it }) {
            message = Triple(
                BannerTone.ERROR,
                locationPermissionNeededTitle,
                locationPermissionNeededDescription,
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
                    offlineTitle,
                    offlineDescription,
                )
            }
        } finally {
            loading = false
        }

        // Deliberately not in the same try. A failure here must leave the
        // default in place — which is "no photograph" — rather than propagate
        // and take the clock-in card down with it.
        runCatching { container.repository.attendancePolicy() }
            .onSuccess { policy = it }
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
                            locationOffTitle,
                            locationOffDescription,
                        )
                        return@launch
                    }
                    is LocationProvider.Result.Unavailable -> {
                        message = Triple(BannerTone.ERROR, noLocationFixTitle, located.message)
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
                            message = Triple(BannerTone.ERROR, notAtWorkTitle, verdict.message)
                            return@launch
                        }

                        // Only reached when the organisation has switched
                        // selfie punch on. The camera is opened after the
                        // geofence check, not before: photographing somebody
                        // and then telling them they are in the wrong car park
                        // takes their picture for nothing.
                        var selfie: PunchSelfie? = null
                        if (policy.requireSelfieOnPunch) {
                            if (!cameraGranted()) {
                                cameraLauncher.launch(android.Manifest.permission.CAMERA)
                                return@launch
                            }

                            when (val shot = PunchCamera.capture(context, lifecycleOwner)) {
                                is PunchCamera.Result.Failed -> {
                                    message = Triple(
                                        BannerTone.ERROR,
                                        photoNotTakenTitle,
                                        photoNotTakenDescriptionTemplate.format(shot.message),
                                    )
                                    return@launch
                                }

                                is PunchCamera.Result.Captured -> {
                                    selfie = PunchSelfie(
                                        base64 = Base64.encodeToString(shot.jpeg, Base64.NO_WRAP),
                                        contentType = "image/jpeg",
                                        takenAt = shot.takenAt,
                                    )
                                }
                            }
                        }

                        submitPunch(container, viewModel, direction, located.position, user, selfie, context)?.let {
                            message = it
                        }
                        load()
                    }
                }
            } catch (e: Exception) {
                message = Triple(BannerTone.ERROR, genericErrorTitle, e.message)
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
        // `/api/auth/me` reads the access token and makes no database call, by
        // design, so it returns an id, an org, a role and an email — and no
        // name. Interpolating `firstName` therefore rendered "Hello," followed
        // by nothing, which reads as a half-loaded screen rather than a
        // greeting.
        //
        // The email's local part is real information the session already
        // carries, so it is used when there is no name; and when there is
        // neither, the line is dropped rather than shown empty.
        val greetingTemplate = stringResource(R.string.today_greeting_template)
        val greeting = remember(user, greetingTemplate) {
            val name = user?.firstName?.trim().orEmpty()
            val fallback = user?.email?.substringBefore('@')?.trim().orEmpty()
            when {
                name.isNotEmpty() -> greetingTemplate.format(name)
                fallback.isNotEmpty() -> greetingTemplate.format(fallback)
                else -> ""
            }
        }

        if (greeting.isNotEmpty()) {
            AppText(greeting, tone = TextTone.MUTED)
        }

        HomeShortcuts(onNavigate = onNavigate)

        HeroCard {
            if (loading) {
                // A placeholder the size of the heading it replaces, so the
                // button below does not jump — and so the screen never claims
                // "Not clocked in" before it has asked.
                SkeletonRows(count = 1, rowHeight = 30.dp)
            } else {
                AppText(
                    when {
                        finished -> stringResource(R.string.today_day_complete_label)
                        clockedIn -> stringResource(R.string.today_clocked_in_label)
                        else -> stringResource(R.string.today_not_clocked_in_label)
                    },
                    size = Theme.type.title2,
                    lineHeight = Theme.type.title2Line,
                    weight = FontWeight.Bold,
                    tone = TextTone.ON_HERO,
                    heading = true,
                )
            }

            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(top = Theme.spacing.lg),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Field(stringResource(R.string.today_field_in_label), record?.clockInAt?.let { ShiftRules.formatClock(it) } ?: "—", onHero = true)
                Field(stringResource(R.string.today_field_out_label), record?.clockOutAt?.let { ShiftRules.formatClock(it) } ?: "—", onHero = true)
                Field(stringResource(R.string.today_worked_label), record?.workedMinutes?.let { ShiftRules.formatDuration(it) } ?: "—", onHero = true)
            }

            if (record?.requiresLocationReview == true) {
                AppText(
                    stringResource(R.string.today_location_review_notice),
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
                    pluralStringResource(R.plurals.today_pending_actions, pending, pending),
                    size = Theme.type.footnote,
                    lineHeight = Theme.type.footnoteLine,
                    tone = TextTone.MUTED,
                    modifier = Modifier.padding(top = Theme.spacing.md),
                )
            }

            if (!loading) {
                // Shown on the card, before the button, not in a dialog after
                // the fact. Somebody is entitled to know they are about to be
                // photographed while they can still decide not to press it —
                // and the wording comes from the server because it quotes this
                // organisation's own retention period.
                policy.notice?.let { notice ->
                    Banner(
                        tone = BannerTone.INFO,
                        title = stringResource(R.string.today_photo_notice_title),
                        description = notice,
                    )
                }

                // No button once the day is closed. It used to render disabled
                // and still say "Clock in", which is the most prominent control
                // on the screen inviting a tap that does nothing — and worse,
                // naming the opposite of what had just happened. The card
                // already says "Day complete" and shows both times.
                if (!finished) {
                    AppButton(
                        label = if (clockedIn) stringResource(R.string.today_clock_out_action) else stringResource(R.string.today_clock_in_action),
                        onClick = { punch(if (clockedIn) "out" else "in") },
                        variant = ButtonVariant.ON_HERO,
                        busy = busy,
                        contentDescription = if (clockedIn) {
                            stringResource(R.string.today_clock_out_content_description)
                        } else {
                            stringResource(R.string.today_clock_in_content_description)
                        },
                        modifier = Modifier.padding(top = Theme.spacing.xl),
                    )
                }
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
                title = pluralStringResource(R.plurals.today_quarantined_actions, quarantined.size, quarantined.size),
                action = {
                    Column(verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm)) {
                        quarantined.forEach { operation ->
                            QuarantinedRow(operation, viewModel)
                        }
                    }
                },
            )
        }

        // Last, and below the clock-in card, because none of it is why the app
        // was opened. It loads separately and stays silent when it fails.
        HomeFeed(container = container, onNavigate = onNavigate)
    }
}

@Composable
private fun QuarantinedRow(operation: OfflineQueue.Operation, viewModel: AppViewModel) {
    val name = operation.kind.replace('.', ' ').replace('_', ' ')

    Column {
        AppText(
            "$name — ${operation.lastError ?: stringResource(R.string.today_quarantined_no_reason_fallback)}",
            size = Theme.type.caption,
            lineHeight = Theme.type.captionLine,
            tone = TextTone.DANGER,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(Theme.spacing.sm)) {
            AppButton(
                label = stringResource(R.string.today_try_again_action),
                onClick = { viewModel.retry(operation.id) },
                variant = ButtonVariant.GHOST,
                fullWidth = false,
                contentDescription = stringResource(R.string.today_try_again_content_description, name),
            )
            AppButton(
                label = stringResource(R.string.today_discard_action),
                onClick = { viewModel.discard(operation.id) },
                variant = ButtonVariant.GHOST,
                fullWidth = false,
                contentDescription = stringResource(R.string.today_discard_content_description, name),
            )
        }
    }
}

@Composable
/**
 * One of the three numbers on the clock-in card.
 *
 * [onHero] because the card is a gradient: the muted grey these used against a
 * white surface falls to roughly 2:1 on violet, which is a label you can see is
 * there and cannot read. On the hero the label is white held back by opacity
 * instead, which keeps the hierarchy without dropping the contrast.
 */
private fun Field(label: String, value: String, onHero: Boolean = false) {
    Column {
        AppText(
            label,
            size = Theme.type.caption,
            lineHeight = Theme.type.captionLine,
            tone = if (onHero) TextTone.ON_HERO else TextTone.MUTED,
            modifier = if (onHero) Modifier.alpha(0.75f) else Modifier,
        )
        AppText(
            value,
            size = Theme.type.callout,
            lineHeight = Theme.type.calloutLine,
            weight = FontWeight.SemiBold,
            tone = if (onHero) TextTone.ON_HERO else TextTone.DEFAULT,
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
    selfie: PunchSelfie?,
    context: Context,
): Triple<BannerTone, String, String?>? {
    val payload = buildJsonObject {
        put("action", direction)
        put("method", "mobile")
        put("latitude", position.latitude)
        put("longitude", position.longitude)
        position.accuracyMetres?.let { put("accuracyMetres", it) }
        // Epoch milliseconds, not an ISO string.
        //
        // The server takes `capturedAt: z.number().int()` — the moment the
        // fix was taken, so a punch queued in a basement is recorded at the
        // time it happened rather than the time it synced. Sending
        // `Instant.toString()` produced "Expected number, received string" and
        // the queue marked the punch refused, so clocking in failed outright
        // while every other field was correct.
        position.capturedAt?.let { put("capturedAt", it) }
        put("isMocked", position.isMocked)

        // Carried inside the queued payload rather than uploaded separately,
        // so an offline punch and its photograph cannot be split: either both
        // arrive or neither does. The server refuses a punch that was supposed
        // to carry one and does not.
        selfie?.let {
            putJsonObject("selfie") {
                put("base64", it.base64)
                put("contentType", it.contentType)
                put("takenAt", it.takenAt)
            }
        }
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
        Triple(
            BannerTone.SUCCESS,
            if (direction == "in") context.getString(R.string.today_clocked_in_success) else context.getString(R.string.today_clocked_out_success),
            null,
        )
    } catch (e: com.circuvent.hrms.data.net.OfflineException) {
        container.queue.markFailed(id, null, e.message)
        Triple(
            BannerTone.INFO,
            context.getString(R.string.today_saved_on_device_title),
            context.getString(R.string.today_saved_offline_description),
        )
    } catch (e: com.circuvent.hrms.data.net.ApiException) {
        container.queue.markFailed(id, e.status, e.message)
        when (container.queue.outcomeOf(id)) {
            OfflineQueue.Status.QUARANTINED -> Triple(
                BannerTone.ERROR,
                context.getString(R.string.today_not_recorded_title),
                context.getString(R.string.today_not_recorded_description),
            )
            else -> Triple(
                BannerTone.INFO,
                context.getString(R.string.today_saved_on_device_title),
                context.getString(R.string.today_saved_retry_description),
            )
        }
    }
}

