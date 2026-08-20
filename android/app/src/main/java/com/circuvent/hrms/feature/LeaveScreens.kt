package com.circuvent.hrms.feature

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.circuvent.hrms.AppContainer
import com.circuvent.hrms.core.design.MinTouchTarget
import com.circuvent.hrms.core.design.Theme
import com.circuvent.hrms.core.ui.AppButton
import com.circuvent.hrms.core.ui.AppCard
import com.circuvent.hrms.core.ui.AppText
import com.circuvent.hrms.core.ui.Banner
import com.circuvent.hrms.core.ui.BannerTone
import com.circuvent.hrms.core.ui.ClosedDay
import com.circuvent.hrms.core.ui.LeaveCalendar
import com.circuvent.hrms.core.ui.ButtonVariant
import com.circuvent.hrms.core.ui.EmptyState
import com.circuvent.hrms.core.ui.PillTone
import com.circuvent.hrms.core.ui.SkeletonRows
import com.circuvent.hrms.core.ui.StatusPill
import com.circuvent.hrms.core.ui.TextTone
import com.circuvent.hrms.core.ui.screenPadding
import com.circuvent.hrms.data.LeaveRequestDto
import com.circuvent.hrms.data.queue.OfflineQueue
import com.circuvent.hrms.domain.LeaveCost
import com.circuvent.hrms.domain.LeaveRules
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.LocalDate

private val LEAVE_TYPES = listOf(
    "casual", "sick", "earned", "maternity", "paternity", "bereavement", "unpaid",
)

/**
 * Apply for leave.
 *
 * Validated with the same rules the tests cover, before anything is sent. The
 * server validates all of it again — it must, because the phone is not trusted
 * — but a form that only reports what is wrong after a round trip is painful on
 * a mobile connection, and this is one people fill in while walking.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun LeaveApplyScreen(container: AppContainer, viewModel: AppViewModel, onDone: () -> Unit) {
    val today = remember { LocalDate.now() }
    var leaveType by remember { mutableStateOf("casual") }
    var startDate by remember { mutableStateOf(today.toString()) }
    var endDate by remember { mutableStateOf(today.toString()) }
    var isHalfDay by remember { mutableStateOf(false) }
    // True between the two taps of a range. The form opens with today at both
    // ends, so without this there is no way to tell a fresh pick from one
    // already made.
    var awaitingEnd by remember { mutableStateOf(false) }
    var reason by remember { mutableStateOf("") }
    var errors by remember { mutableStateOf<Map<LeaveRules.Field, String>>(emptyMap()) }
    var banner by remember { mutableStateOf<Triple<BannerTone, String, String?>?>(null) }
    var busy by remember { mutableStateOf(false) }

    val scope = rememberCoroutineScope()

    // The form is longer than the screen and Submit sits at the bottom, so a
    // banner at the top is off-screen at the exact moment it is written. An
    // error nobody scrolls back up to find is the same as no error at all, so
    // the form returns to it.
    val formScroll = rememberScrollState()
    LaunchedEffect(banner, errors) {
        if (banner != null || errors.isNotEmpty()) formScroll.animateScrollTo(0)
    }

    // Loaded so the calendar can mark the days the office is already closed.
    // A failure leaves the map empty, which downgrades the calendar to weekends
    // only rather than blocking the form — somebody still has to be able to
    // apply for leave when the holiday endpoint is having a bad day.
    var closedDays by remember { mutableStateOf<List<ClosedDay>>(emptyList()) }
    LaunchedEffect(Unit) {
        runCatching { container.repository.holidays() }
            .onSuccess { response ->
                closedDays = response.items.mapNotNull { holiday ->
                    runCatching { LocalDate.parse(holiday.holidayDate.take(10)) }
                        .getOrNull()
                        ?.let { ClosedDay(it, holiday.name, holiday.isOptional) }
                }
            }
    }

    val draft = LeaveRules.Draft(leaveType, startDate, endDate, isHalfDay, reason)
    val cost = LeaveRules.totalDays(draft)

    val summary = remember(startDate, endDate, isHalfDay, closedDays) {
        val start = runCatching { LocalDate.parse(startDate) }.getOrNull()
        val end = runCatching { LocalDate.parse(endDate) }.getOrNull()
        if (start == null || end == null) {
            null
        } else {
            LeaveCost.summarise(
                start = start,
                end = end,
                isHalfDay = isHalfDay,
                // Optional holidays are excluded: they are drawn from a pool
                // and have to be claimed, so a day somebody has not claimed is
                // an ordinary working day for them.
                holidays = closedDays.filter { !it.optional }.associate { it.date to it.name },
            )
        }
    }

    fun submit() {
        banner = null
        val found = LeaveRules.validate(draft, today)
        errors = found
        if (found.isNotEmpty()) return

        busy = true
        scope.launch {
            val payload = buildJsonObject {
                put("leaveType", leaveType)
                put("startDate", startDate)
                put("endDate", endDate)
                put("isHalfDay", isHalfDay)
                put("reason", reason.trim())
            }.toString()

            // Derived from the request itself, so tapping twice — or retrying
            // after a lost response — cannot book the same leave twice.
            val id = "leave-$startDate-$endDate-$leaveType-${if (isHalfDay) "half" else "full"}"
            container.queue.enqueue(id, "leave.apply", payload, streamKey = "leave")

            banner = try {
                container.repository.sendQueued("leave.apply", payload, id)
                container.queue.markSent(id)
                onDone()
                null
            } catch (e: com.circuvent.hrms.data.net.OfflineException) {
                container.queue.markFailed(id, null, e.message)
                Triple(
                    BannerTone.INFO,
                    "Saved on this device",
                    "It will be submitted when you have a connection.",
                )
            } catch (e: com.circuvent.hrms.data.net.ApiException) {
                container.queue.markFailed(id, e.status, e.message)
                if (container.queue.outcomeOf(id) == OfflineQueue.Status.QUARANTINED) {
                    // Permanently refused. Going back to the list would show no
                    // new request and no explanation for why.
                    Triple(
                        BannerTone.ERROR,
                        "This request was not submitted",
                        "It will not be retried. Check the dates and your balance, or speak to HR.",
                    )
                } else {
                    Triple(BannerTone.INFO, "Saved on this device", "It will be retried.")
                }
            } finally {
                busy = false
                viewModel.refreshQueueCounts()
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(formScroll)
            .padding(screenPadding()),
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.md),
    ) {
        banner?.let { (tone, title, description) ->
            Banner(tone = tone, title = title, description = description)
        }

        AppText("Leave type", size = Theme.type.footnote, lineHeight = Theme.type.footnoteLine, weight = FontWeight.Medium)

        // A row of chips rather than a dropdown. Seven options fit, and a
        // native picker on Android is a modal that hides the rest of the form
        // — including the error the person is trying to fix.
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(Theme.spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm),
        ) {
            LEAVE_TYPES.forEach { type ->
                Chip(
                    label = type.replaceFirstChar { it.uppercase() },
                    selected = leaveType == type,
                    enabled = !busy,
                    contentDescription = "${type.replaceFirstChar { it.uppercase() }} leave",
                ) { leaveType = type }
            }
        }

        errors[LeaveRules.Field.TYPE]?.let {
            AppText(it, tone = TextTone.DANGER, size = Theme.type.footnote, lineHeight = Theme.type.footnoteLine)
        }

        // A calendar, not two text fields wanting YYYY-MM-DD on a number
        // keypad. The typing was the smaller problem: the fields gave no way
        // to see that a chosen range runs through a weekend or a holiday, and
        // this employer deducts calendar days — so those days come out of
        // somebody's entitlement without anything on screen saying so.
        LeaveCalendar(
            selectedStart = runCatching { LocalDate.parse(startDate) }.getOrNull(),
            selectedEnd = runCatching { LocalDate.parse(endDate) }.getOrNull(),
            closed = closedDays,
            onSelect = { picked ->
                // Two taps: the first opens a one-day request, the second
                // extends it. An earlier version restarted whenever a range
                // already existed, which sounds reasonable and is unusable —
                // the form opens with today already chosen at both ends, so
                // the first tap made a range and every tap after it reset,
                // and a Friday-to-Monday request could not be selected at all.
                val start = runCatching { LocalDate.parse(startDate) }.getOrNull()

                when {
                    // A half day is a single date; a tap just moves it.
                    isHalfDay -> {
                        startDate = picked.toString()
                        endDate = picked.toString()
                    }

                    !awaitingEnd || start == null -> {
                        startDate = picked.toString()
                        endDate = picked.toString()
                        awaitingEnd = true
                    }

                    // Tapping before the start extends backwards rather than
                    // refusing. Somebody who picks the end first meant a range,
                    // not a mistake.
                    picked.isBefore(start) -> {
                        startDate = picked.toString()
                        awaitingEnd = false
                    }

                    else -> {
                        endDate = picked.toString()
                        awaitingEnd = false
                    }
                }
                errors = emptyMap()
            },
        )

        errors[LeaveRules.Field.START_DATE]?.let {
            AppText(it, tone = TextTone.DANGER, size = Theme.type.footnote, lineHeight = Theme.type.footnoteLine)
        }
        errors[LeaveRules.Field.END_DATE]?.let {
            AppText(it, tone = TextTone.DANGER, size = Theme.type.footnote, lineHeight = Theme.type.footnoteLine)
        }

        // What it costs, before they send it. Leads with the number that
        // leaves their balance, and only warns when there is something they
        // could actually do about it.
        summary?.let { s ->
            if (s.hasNonWorkingDays) {
                Banner(
                    tone = BannerTone.WARNING,
                    title = "This includes days nobody works",
                    description = LeaveCost.describe(s),
                )
            } else {
                AppText(
                    LeaveCost.describe(s),
                    size = Theme.type.footnote,
                    lineHeight = Theme.type.footnoteLine,
                    tone = TextTone.MUTED,
                )
            }
        }

        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AppText("Half day")
            Switch(
                checked = isHalfDay,
                onCheckedChange = {
                    isHalfDay = it
                    if (it) endDate = startDate
                },
                enabled = !busy,
                modifier = Modifier.semantics { contentDescription = "Half day" },
            )
        }

        if (cost != null) {
            // Shown before submitting, because the number of days is the thing
            // that comes off the balance and the one people get wrong.
            AppText(
                "This will use $cost ${if (cost == 1.0) "day" else "days"} of your balance.",
                size = Theme.type.footnote,
                lineHeight = Theme.type.footnoteLine,
                tone = TextTone.MUTED,
            )
        }

        OutlinedTextField(
            value = reason,
            onValueChange = { reason = it.take(1000) },
            label = { Text("Reason") },
            supportingText = { errors[LeaveRules.Field.REASON]?.let { Text(it) } },
            isError = errors.containsKey(LeaveRules.Field.REASON),
            minLines = 3,
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
        )

        AppButton("Submit request", ::submit, busy = busy)
        AppButton("Cancel", onDone, variant = ButtonVariant.GHOST, enabled = !busy)
    }
}

/** A selectable chip, with the role and the selected state in the semantics. */
@Composable
fun Chip(
    label: String,
    selected: Boolean,
    enabled: Boolean = true,
    contentDescription: String? = null,
    onClick: () -> Unit,
) {
    val colors = Theme.colors
    val shape = RoundedCornerShape(Theme.radius.pill)

    Box(
        modifier = Modifier
            .defaultMinSize(minHeight = MinTouchTarget)
            .clip(shape)
            .background(if (selected) colors.primary else colors.surfaceElevated)
            .border(1.dp, if (selected) colors.primary else colors.border, shape)
            .clickable(enabled = enabled, role = Role.RadioButton, onClick = onClick)
            .semantics {
                if (contentDescription != null) this.contentDescription = contentDescription
                this.selected = selected
            }
            .padding(horizontal = Theme.spacing.lg),
        contentAlignment = Alignment.Center,
    ) {
        AppText(
            label,
            size = Theme.type.footnote,
            lineHeight = Theme.type.footnoteLine,
            weight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            tone = if (selected) TextTone.ON_PRIMARY else TextTone.DEFAULT,
            maxLines = 1,
        )
    }
}

/**
 * One leave request.
 *
 * The rejection reason gets its own banner rather than another row. It is the
 * one thing on this screen somebody has to act on, and a row in a list of dates
 * is where it gets missed.
 */
@Composable
fun LeaveDetailScreen(container: AppContainer, requestId: String) {
    var state by remember { mutableStateOf<Loaded<LeaveRequestDto?>>(Loaded.Loading) }

    LaunchedEffect(requestId) {
        state = try {
            Loaded.Ready(container.repository.leaveRequest(requestId))
        } catch (e: Throwable) {
            failureOf("This request", e)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(screenPadding()),
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.md),
    ) {
        when (val current = state) {
            is Loaded.Loading -> SkeletonRows(count = 2, rowHeight = 90.dp)
            is Loaded.Failed -> Banner(BannerTone.ERROR, current.title, description = current.description)
            is Loaded.Ready -> {
                val request = current.value
                if (request == null) {
                    EmptyState(
                        title = "This request could not be found",
                        description = "It may have been cancelled, or it belongs to someone else.",
                    )
                } else {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        AppText(
                            "${request.leaveType.replaceFirstChar { it.uppercase() }} leave",
                            size = Theme.type.title2,
                            lineHeight = Theme.type.title2Line,
                            weight = FontWeight.Bold,
                            heading = true,
                        )
                        StatusPill(
                            request.status.replaceFirstChar { it.uppercase() },
                            when (request.status) {
                                "approved" -> PillTone.SUCCESS
                                "rejected" -> PillTone.DANGER
                                "pending" -> PillTone.WARNING
                                else -> PillTone.NEUTRAL
                            },
                        )
                    }

                    AppCard {
                        DetailRow("From", request.startDate)
                        DetailRow("To", request.endDate)
                        DetailRow(
                            "Days",
                            if (request.isHalfDay) "Half day" else "${request.totalDays.toInt()} days",
                        )
                        DetailRow("Reason", request.reason)
                    }
                }
            }
        }
    }
}

@Composable
fun DetailRow(label: String, value: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = Theme.spacing.sm)
            // Grouped, so a screen reader reads "From: 10 March" as one thing
            // rather than stopping on the label and the value separately.
            .semantics(mergeDescendants = true) { contentDescription = "$label: $value" },
    ) {
        AppText(label, size = Theme.type.caption, lineHeight = Theme.type.captionLine, tone = TextTone.MUTED)
        AppText(value)
    }
}
