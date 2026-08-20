package com.circuvent.hrms.feature

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.circuvent.hrms.AppContainer
import com.circuvent.hrms.R
import com.circuvent.hrms.core.design.Theme
import com.circuvent.hrms.core.ui.AppButton
import com.circuvent.hrms.core.ui.AppCard
import com.circuvent.hrms.core.ui.AppText
import com.circuvent.hrms.core.ui.DateField
import java.time.LocalDate
import com.circuvent.hrms.core.ui.Banner
import com.circuvent.hrms.core.ui.BannerTone
import com.circuvent.hrms.core.ui.ButtonVariant
import com.circuvent.hrms.core.ui.EmptyState
import com.circuvent.hrms.core.ui.PillTone
import com.circuvent.hrms.core.ui.SkeletonRows
import com.circuvent.hrms.core.ui.StatusPill
import com.circuvent.hrms.core.ui.TextTone
import com.circuvent.hrms.core.ui.rememberFormattedDate
import com.circuvent.hrms.core.ui.screenPadding
import com.circuvent.hrms.data.WorkArrangementCreate
import com.circuvent.hrms.data.WorkArrangementDto
import com.circuvent.hrms.data.WorkArrangementsResponse
import kotlinx.coroutines.launch

/**
 * The window the server enforces, mirrored so the calendar cannot offer a day
 * that will be refused. These match WorkArrangementLimitsDto's defaults; the
 * response carries the real values and this screen does not yet thread them
 * through, so a policy widened on the server narrows here until it does.
 */
private const val MAX_PAST_DAYS = 7L
private const val MAX_FUTURE_DAYS = 90L

// ═══════════════════════════════════════════════════════════════
// WORKING AWAY — from home, or on duty elsewhere
// ═══════════════════════════════════════════════════════════════
//
// Kept away from the Leave tab on purpose. A day worked from home is a day
// worked: nothing is deducted, no balance moves, and putting it beside a leave
// balance invites people to believe it costs them one. The screen says so once,
// plainly, because it is the assumption everybody arrives with.

@Composable
private fun kindLabel(kind: String): String =
    if (kind == "on_duty") stringResource(R.string.work_arrangement_kind_on_duty)
    else stringResource(R.string.work_arrangement_kind_wfh)

private fun statusTone(status: String): PillTone = when (status) {
    "approved" -> PillTone.SUCCESS
    "rejected" -> PillTone.DANGER
    "cancelled" -> PillTone.NEUTRAL
    else -> PillTone.WARNING
}

/**
 * Delegates to the app's single date formatter.
 *
 * Kept as a local name so the call sites below read the same as before, but it
 * no longer has its own opinion: this screen used to write "31 Mar" while the
 * directory wrote "31 March 2026" and the home screen printed raw ISO, so one
 * date could appear three ways in one app.
 */
@Composable
private fun shortDate(iso: String): String = rememberFormattedDate(iso)

@Composable
fun WorkArrangementScreen(container: AppContainer) {
    var state by remember { mutableStateOf<Loaded<WorkArrangementsResponse>>(Loaded.Loading) }
    var showForm by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<Pair<BannerTone, String>?>(null) }

    var kind by remember { mutableStateOf("wfh") }
    var startDate by remember { mutableStateOf("") }
    var endDate by remember { mutableStateOf("") }
    var location by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf("") }
    var submitting by remember { mutableStateOf(false) }

    val scope = rememberCoroutineScope()

    val sentSuccessMessage = stringResource(R.string.work_arrangement_sent_success_message)
    val sendErrorFallback = stringResource(R.string.work_arrangement_send_error_fallback)

    suspend fun load() {
        state = try {
            Loaded.Ready(container.repository.workArrangements())
        } catch (e: Throwable) {
            failureOf("Your requests", e)
        }
    }

    LaunchedEffect(Unit) { load() }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = screenPadding(),
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm),
    ) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm)) {
                message?.let { (tone, text) -> Banner(tone, text) }

                // The assumption everybody arrives with, corrected once.
                AppCard {
                    AppText(
                        stringResource(R.string.work_arrangement_not_leave_title),
                        weight = FontWeight.SemiBold,
                    )
                    AppText(
                        stringResource(R.string.work_arrangement_not_leave_description),
                        tone = TextTone.MUTED,
                        size = Theme.type.footnote,
                        lineHeight = Theme.type.footnoteLine,
                    )
                }

                if (!showForm) {
                    AppButton(
                        label = stringResource(R.string.work_arrangement_request_action),
                        onClick = { showForm = true },
                    )
                } else {
                    AppCard {
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(Theme.spacing.xs),
                        ) {
                            AppButton(
                                label = stringResource(R.string.work_arrangement_from_home_toggle_label),
                                variant = if (kind == "wfh") ButtonVariant.PRIMARY
                                else ButtonVariant.SECONDARY,
                                fullWidth = false,
                                onClick = { kind = "wfh" },
                                modifier = Modifier.weight(1f),
                            )
                            AppButton(
                                label = stringResource(R.string.work_arrangement_kind_on_duty),
                                variant = if (kind == "on_duty") ButtonVariant.PRIMARY
                                else ButtonVariant.SECONDARY,
                                fullWidth = false,
                                onClick = { kind = "on_duty" },
                                modifier = Modifier.weight(1f),
                            )
                        }

                        DateField(
                            label = stringResource(R.string.work_arrangement_first_day_field_label),
                            value = startDate,
                            onValueChange = {
                                startDate = it
                                // The last day cannot precede the first. Moving
                                // it along beats refusing the pair afterwards.
                                if (endDate.isBlank() || endDate < it) endDate = it
                            },
                            // The window the server enforces: a week back, three
                            // months forward.
                            minDate = LocalDate.now().minusDays(MAX_PAST_DAYS),
                            maxDate = LocalDate.now().plusDays(MAX_FUTURE_DAYS),
                            modifier = Modifier.padding(top = Theme.spacing.xs),
                        )
                        DateField(
                            label = stringResource(R.string.work_arrangement_last_day_field_label),
                            value = endDate,
                            onValueChange = { endDate = it },
                            // Never before the first day, so the invalid range
                            // cannot be built rather than being built and
                            // rejected.
                            minDate = runCatching { LocalDate.parse(startDate) }.getOrNull()
                                ?: LocalDate.now().minusDays(MAX_PAST_DAYS),
                            maxDate = LocalDate.now().plusDays(MAX_FUTURE_DAYS),
                            modifier = Modifier.padding(top = Theme.spacing.xs),
                        )

                        // Only asked for where it is required, and the label says
                        // why rather than marking it with an asterisk.
                        if (kind == "on_duty") {
                            OutlinedTextField(
                                value = location,
                                onValueChange = { location = it },
                                label = { Text(stringResource(R.string.work_arrangement_location_field_label)) },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth().padding(top = Theme.spacing.xs),
                            )
                        }

                        OutlinedTextField(
                            value = reason,
                            onValueChange = { reason = it },
                            label = { Text(stringResource(R.string.work_arrangement_reason_field_label)) },
                            modifier = Modifier.fillMaxWidth().padding(top = Theme.spacing.xs),
                        )

                        AppButton(
                            label = if (submitting) {
                                stringResource(R.string.work_arrangement_sending_label)
                            } else {
                                stringResource(R.string.work_arrangement_send_for_approval_action)
                            },
                            enabled = !submitting && startDate.isNotBlank() && endDate.isNotBlank() &&
                                (kind != "on_duty" || location.isNotBlank()),
                            busy = submitting,
                            modifier = Modifier.padding(top = Theme.spacing.sm),
                            onClick = {
                                submitting = true
                                message = null
                                scope.launch {
                                    try {
                                        container.repository.requestWorkArrangement(
                                            WorkArrangementCreate(
                                                kind = kind,
                                                startDate = startDate.trim(),
                                                endDate = endDate.trim(),
                                                reason = reason.takeIf { it.isNotBlank() },
                                                location = location.takeIf { it.isNotBlank() },
                                            )
                                        )
                                        showForm = false
                                        startDate = ""; endDate = ""; location = ""; reason = ""
                                        load()
                                        message = BannerTone.SUCCESS to sentSuccessMessage
                                    } catch (e: Throwable) {
                                        message = BannerTone.ERROR to
                                            (e.message ?: sendErrorFallback)
                                    } finally {
                                        submitting = false
                                    }
                                }
                            },
                        )
                        AppButton(
                            label = stringResource(R.string.expenses_cancel_action),
                            variant = ButtonVariant.SECONDARY,
                            onClick = { showForm = false },
                        )
                    }
                }

                SectionLabel(stringResource(R.string.work_arrangement_your_requests_heading))
            }
        }

        val ready = state as? Loaded.Ready
        when {
            state is Loaded.Loading -> item { SkeletonRows(count = 3, rowHeight = 88.dp) }
            state is Loaded.Failed -> item {
                val failed = state as Loaded.Failed
                Banner(BannerTone.ERROR, failed.title, description = failed.description)
            }
            ready != null && ready.value.requests.isEmpty() -> item {
                EmptyState(
                    title = stringResource(R.string.work_arrangement_empty_title),
                    description = stringResource(R.string.work_arrangement_empty_description),
                )
            }
            ready != null -> items(ready.value.requests, key = { it.id }) { request ->
                WorkArrangementRow(request)
            }
        }
    }
}

@Composable
private fun WorkArrangementRow(request: WorkArrangementDto) {
    AppCard(
        contentDescription = stringResource(
            R.string.work_arrangement_content_description,
            kindLabel(request.kind),
            shortDate(request.startDate),
            shortDate(request.endDate),
            request.status,
        ),
    ) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AppText(kindLabel(request.kind), weight = FontWeight.Medium)
            StatusPill(
                request.status.replaceFirstChar { it.uppercase() },
                statusTone(request.status),
            )
        }

        AppText(
            if (request.startDate == request.endDate) shortDate(request.startDate)
            else "${shortDate(request.startDate)} – ${shortDate(request.endDate)}",
            tone = TextTone.MUTED,
            size = Theme.type.footnote,
        )

        request.location?.takeIf { it.isNotBlank() }?.let {
            AppText(
                stringResource(R.string.work_arrangement_at_location_template, it),
                tone = TextTone.MUTED,
                size = Theme.type.caption,
            )
        }
        request.decisionReason?.takeIf { it.isNotBlank() }?.let {
            AppText(
                stringResource(R.string.work_arrangement_decision_reason_template, it),
                tone = TextTone.MUTED,
                size = Theme.type.caption,
            )
        }
    }
}
