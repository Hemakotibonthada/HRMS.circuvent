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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.circuvent.hrms.AppContainer
import com.circuvent.hrms.R
import com.circuvent.hrms.core.design.Theme
import com.circuvent.hrms.core.ui.AppButton
import com.circuvent.hrms.core.ui.AppCard
import com.circuvent.hrms.core.ui.AppSwitch
import com.circuvent.hrms.core.ui.AppText
import com.circuvent.hrms.core.ui.Banner
import com.circuvent.hrms.core.ui.BannerTone
import com.circuvent.hrms.core.ui.ButtonVariant
import com.circuvent.hrms.core.ui.EmptyState
import com.circuvent.hrms.core.ui.PillTone
import com.circuvent.hrms.core.ui.SkeletonRows
import com.circuvent.hrms.core.ui.StatusPill
import com.circuvent.hrms.core.ui.TextTone
import com.circuvent.hrms.core.ui.screenPadding
import com.circuvent.hrms.data.RegularisationCreate
import com.circuvent.hrms.data.RegularisationDto
import com.circuvent.hrms.data.RegularisationListResponse
import kotlinx.coroutines.launch

// ═══════════════════════════════════════════════════════════════
// ATTENDANCE REGULARISATION — correcting a day from the phone
// ═══════════════════════════════════════════════════════════════
//
// The reader on the door was down, or somebody left without clocking out. Left
// alone that becomes an absence and then a day's pay, and it has a deadline —
// which makes it exactly the kind of thing people deal with on a phone rather
// than waiting until they are next at a desk.
//
// Two things the screen does that the server also does, deliberately:
//
//   * It shows the window and the monthly allowance **before** the form, so an
//     employee is not told a day is out of range after typing an explanation.
//   * It shows the routing after submission. A correction to a month payroll
//     has already paid travels to the next run as an adjustment rather than
//     changing the payslip already issued, and being told that at the point of
//     asking is the difference between "it worked" and "why has nothing
//     changed".

private val REASON_CODES = listOf(
    "missed_punch", "wrong_time", "on_duty", "work_from_home", "system_error", "shift_change",
)

@Composable
private fun reasonLabel(code: String): String = when (code) {
    "missed_punch" -> stringResource(R.string.regularisation_reason_missed_punch)
    "wrong_time" -> stringResource(R.string.regularisation_reason_wrong_time)
    "on_duty" -> stringResource(R.string.regularisation_reason_on_duty)
    "work_from_home" -> stringResource(R.string.regularisation_reason_work_from_home)
    "system_error" -> stringResource(R.string.regularisation_reason_system_error)
    "shift_change" -> stringResource(R.string.regularisation_reason_shift_change)
    else -> code.replace('_', ' ').replaceFirstChar { it.uppercase() }
}

private fun statusTone(status: String): PillTone = when (status) {
    "approved" -> PillTone.SUCCESS
    "rejected" -> PillTone.DANGER
    "cancelled" -> PillTone.NEUTRAL
    else -> PillTone.WARNING
}

/**
 * The employee's own corrections, and the form to raise another.
 */
@Composable
fun RegularisationScreen(container: AppContainer) {
    var state by remember { mutableStateOf<Loaded<RegularisationListResponse>>(Loaded.Loading) }
    var showForm by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<Pair<BannerTone, String>?>(null) }

    var date by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf(REASON_CODES.first()) }
    var note by remember { mutableStateOf("") }
    var inTime by remember { mutableStateOf("") }
    var outTime by remember { mutableStateOf("") }
    var hasProof by remember { mutableStateOf(false) }
    var submitting by remember { mutableStateOf(false) }

    val scope = rememberCoroutineScope()

    val sentAdjustmentMessage = stringResource(R.string.regularisation_sent_adjustment_message)
    val sentSuccessMessage = stringResource(R.string.regularisation_sent_success_message)
    val sendErrorFallback = stringResource(R.string.regularisation_send_error_fallback)

    suspend fun load() {
        state = try {
            Loaded.Ready(container.repository.regularisations())
        } catch (e: Throwable) {
            failureOf("Your corrections", e)
        }
    }

    LaunchedEffect(Unit) { load() }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = screenPadding(),
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm),
    ) {
        item {
            when (val current = state) {
                is Loaded.Loading -> SkeletonRows(count = 4, rowHeight = 80.dp)
                is Loaded.Failed ->
                    Banner(BannerTone.ERROR, current.title, description = current.description)

                is Loaded.Ready -> {
                    val policy = current.value.policy

                    Column(verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm)) {
                        message?.let { (tone, text) -> Banner(tone, text) }

                        AppCard {
                            AppText(
                                stringResource(R.string.regularisation_what_you_can_correct_title),
                                weight = FontWeight.SemiBold,
                            )
                            AppText(
                                stringResource(
                                    R.string.regularisation_window_and_limit_description,
                                    policy.windowDays,
                                    policy.monthlyLimit,
                                ),
                                tone = TextTone.MUTED,
                                size = Theme.type.footnote,
                                lineHeight = Theme.type.footnoteLine,
                            )
                        }

                        if (!showForm) {
                            AppButton(
                                label = stringResource(R.string.regularisation_correct_a_day_action),
                                onClick = { showForm = true; message = null },
                            )
                        } else {
                            AppCard {
                                AppText(
                                    stringResource(R.string.regularisation_correct_a_day_action),
                                    weight = FontWeight.SemiBold,
                                )

                                OutlinedTextField(
                                    value = date,
                                    onValueChange = { date = it },
                                    label = { Text(stringResource(R.string.regularisation_date_field_label)) },
                                    singleLine = true,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(top = Theme.spacing.xs),
                                )

                                AppText(
                                    stringResource(R.string.regularisation_what_happened_label),
                                    size = Theme.type.footnote,
                                    tone = TextTone.MUTED,
                                    modifier = Modifier.padding(top = Theme.spacing.sm),
                                )
                                REASON_CODES.forEach { code ->
                                    val label = reasonLabel(code)
                                    Row(
                                        Modifier
                                            .fillMaxWidth()
                                            .padding(vertical = 2.dp),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        AppText(
                                            label,
                                            size = Theme.type.footnote,
                                            lineHeight = Theme.type.footnoteLine,
                                            weight = if (reason == code) FontWeight.SemiBold
                                            else FontWeight.Normal,
                                        )
                                        AppSwitch(
                                            checked = reason == code,
                                            onCheckedChange = { if (it) reason = code },
                                        )
                                    }
                                }

                                Row(
                                    Modifier.fillMaxWidth().padding(top = Theme.spacing.xs),
                                    horizontalArrangement = Arrangement.spacedBy(Theme.spacing.xs),
                                ) {
                                    OutlinedTextField(
                                        value = inTime,
                                        onValueChange = { inTime = it },
                                        label = { Text(stringResource(R.string.regularisation_in_time_field_label)) },
                                        singleLine = true,
                                        modifier = Modifier.weight(1f),
                                    )
                                    OutlinedTextField(
                                        value = outTime,
                                        onValueChange = { outTime = it },
                                        label = { Text(stringResource(R.string.regularisation_out_time_field_label)) },
                                        singleLine = true,
                                        modifier = Modifier.weight(1f),
                                    )
                                }

                                OutlinedTextField(
                                    value = note,
                                    onValueChange = { note = it },
                                    label = { Text(stringResource(R.string.regularisation_say_what_happened_field_label)) },
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(top = Theme.spacing.xs),
                                )

                                if (policy.reasonsNeedingProof.contains(reason)) {
                                    Row(
                                        Modifier.fillMaxWidth().padding(top = Theme.spacing.xs),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        AppText(
                                            stringResource(R.string.regularisation_can_provide_evidence_label),
                                            size = Theme.type.footnote,
                                        )
                                        AppSwitch(checked = hasProof, onCheckedChange = { hasProof = it })
                                    }
                                }

                                AppButton(
                                    label = if (submitting) {
                                        stringResource(R.string.regularisation_sending_label)
                                    } else {
                                        stringResource(R.string.regularisation_send_for_approval_action)
                                    },
                                    enabled = !submitting && date.isNotBlank(),
                                    busy = submitting,
                                    modifier = Modifier.padding(top = Theme.spacing.sm),
                                    onClick = {
                                        submitting = true
                                        message = null
                                        scope.launch {
                                            try {
                                                val created = container.repository.raiseRegularisation(
                                                    RegularisationCreate(
                                                        date = date.trim(),
                                                        reason = reason,
                                                        note = note.takeIf { it.isNotBlank() },
                                                        inTime = inTime.takeIf { it.isNotBlank() },
                                                        outTime = outTime.takeIf { it.isNotBlank() },
                                                        hasProof = hasProof,
                                                    )
                                                )
                                                showForm = false
                                                date = ""; note = ""; inTime = ""; outTime = ""
                                                hasProof = false
                                                load()
                                                message = BannerTone.SUCCESS to
                                                    if (created.routing == "adjustment")
                                                        sentAdjustmentMessage
                                                    else sentSuccessMessage
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
                                    onClick = { showForm = false; message = null },
                                )
                            }
                        }

                        SectionLabel(stringResource(R.string.regularisation_your_corrections_heading))
                    }
                }
            }
        }

        val ready = state as? Loaded.Ready
        if (ready != null) {
            if (ready.value.requests.isEmpty()) {
                item {
                    EmptyState(
                        title = stringResource(R.string.regularisation_empty_title),
                        description = stringResource(R.string.regularisation_empty_description),
                    )
                }
            } else {
                items(ready.value.requests, key = { it.id }) { request ->
                    RegularisationRow(request)
                }
            }
        }
    }
}

@Composable
private fun RegularisationRow(request: RegularisationDto) {
    AppCard(
        contentDescription =
            "${request.attendanceDate}, ${reasonLabel(request.reason)}, ${request.status}",
    ) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AppText(request.attendanceDate, weight = FontWeight.Medium)
            StatusPill(
                request.status.replaceFirstChar { it.uppercase() },
                statusTone(request.status),
            )
        }

        AppText(
            reasonLabel(request.reason),
            tone = TextTone.MUTED,
            size = Theme.type.footnote,
            lineHeight = Theme.type.footnoteLine,
        )

        if (request.inTime != null || request.outTime != null) {
            AppText(
                stringResource(
                    R.string.regularisation_time_range_template,
                    request.inTime ?: "—",
                    request.outTime ?: "—",
                ),
                tone = TextTone.MUTED,
                size = Theme.type.caption,
            )
        }

        // Said on the row, not only at submission: somebody coming back a week
        // later needs to know why an approved correction has not moved their pay.
        if (request.routing == "adjustment") {
            AppText(
                stringResource(R.string.regularisation_adjustment_note),
                tone = TextTone.MUTED,
                size = Theme.type.caption,
            )
        }

        request.decisionReason?.takeIf { it.isNotBlank() }?.let {
            AppText(
                stringResource(R.string.regularisation_decision_reason_template, it),
                size = Theme.type.caption,
                tone = TextTone.MUTED,
            )
        }
    }
}
