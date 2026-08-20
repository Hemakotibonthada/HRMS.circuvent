package com.circuvent.hrms.feature

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
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
import com.circuvent.hrms.core.ui.rememberFormattedRange
import com.circuvent.hrms.core.ui.screenPadding
import com.circuvent.hrms.data.PayslipDetailDto
import com.circuvent.hrms.data.PendingLeaveDto
import com.circuvent.hrms.data.SessionUser
import com.circuvent.hrms.security.Biometrics
import kotlinx.coroutines.launch
import java.time.YearMonth
import java.time.format.DateTimeFormatter

/**
 * The approvals queue.
 *
 * Decisions are sent immediately and are never queued offline. Everything else
 * in this app writes to the queue first, because a clock-in is a record of
 * something that already happened and delay costs nothing. An approval is the
 * opposite: it is a judgement about current state, and one made against a
 * three-day-old cache — after the request was withdrawn, or decided by somebody
 * else — is a decision the manager did not actually make.
 */
@Composable
fun ApprovalsScreen(container: AppContainer, user: SessionUser?) {
    var state by remember { mutableStateOf<Loaded<List<PendingLeaveDto>>>(Loaded.Loading) }
    var busyId by remember { mutableStateOf<String?>(null) }
    var rejecting by remember { mutableStateOf<String?>(null) }
    var reason by remember { mutableStateOf("") }
    var reasonError by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<Pair<String, String?>?>(null) }

    val scope = rememberCoroutineScope()
    val decisionErrorTitle = stringResource(R.string.approvals_decision_error)

    suspend fun load() {
        state = try {
            Loaded.Ready(container.repository.pendingLeave())
        } catch (e: Throwable) {
            failureOf("The queue", e)
        }
    }

    LaunchedEffect(Unit) { load() }

    fun decide(id: String, action: String, why: String?) {
        busyId = id
        error = null
        scope.launch {
            try {
                container.repository.decideLeave(id, action, why)
                rejecting = null
                reason = ""
                // Reloaded rather than removed locally. Another manager may
                // have acted on something else while this screen was open, and
                // showing a queue that no longer exists invites a second
                // decision on an already-decided request.
                load()
            } catch (e: Exception) {
                error = decisionErrorTitle to e.message
            } finally {
                busyId = null
            }
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = screenPadding(),
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.md),
    ) {
        error?.let { (title, description) ->
            item { Banner(BannerTone.ERROR, title, description = description) }
        }

        item {
            when (val current = state) {
                is Loaded.Loading -> SkeletonRows(count = 3, rowHeight = 140.dp)
                is Loaded.Failed -> Banner(BannerTone.ERROR, current.title, description = current.description)
                is Loaded.Ready -> if (current.value.isEmpty()) {
                    EmptyState(
                        title = stringResource(R.string.approvals_empty_title),
                        description = stringResource(R.string.approvals_empty_description),
                    )
                }
            }
        }

        (state as? Loaded.Ready)?.value?.let { requests ->
            items(requests, key = { it.id }) { request ->
                val isOwn = request.employeeId == user?.employeeId || request.employeeId == user?.id
                val busy = busyId == request.id
                val who = request.employeeName ?: stringResource(R.string.approvals_unknown_employee)
                val dateRange = rememberFormattedRange(request.startDate, request.endDate)
                val reasonRequiredMessage = stringResource(R.string.approvals_reason_required)

                AppCard {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        AppText(who, weight = FontWeight.SemiBold, maxLines = 1)
                        if (isOwn) StatusPill(stringResource(R.string.approvals_yours_pill), PillTone.INFO)
                    }

                    AppText(
                        if (request.isHalfDay)
                            stringResource(
                                R.string.approvals_item_half_day,
                                request.leaveType.replaceFirstChar { it.uppercase() },
                                dateRange,
                            )
                        else
                            pluralStringResource(
                                R.plurals.approvals_item_days,
                                request.totalDays.toInt(),
                                request.leaveType.replaceFirstChar { it.uppercase() },
                                dateRange,
                                request.totalDays.toInt(),
                            ),
                        size = Theme.type.footnote,
                        lineHeight = Theme.type.footnoteLine,
                        tone = TextTone.MUTED,
                    )
                    AppText(request.reason, size = Theme.type.footnote, lineHeight = Theme.type.footnoteLine)

                    when {
                        // The server refuses this outright. Saying so before
                        // the tap is better than a 403 that reads like a fault.
                        isOwn -> AppText(
                            stringResource(R.string.approvals_own_request_note),
                            size = Theme.type.caption,
                            lineHeight = Theme.type.captionLine,
                            tone = TextTone.MUTED,
                            modifier = Modifier.padding(top = Theme.spacing.md),
                        )

                        rejecting == request.id -> Column(Modifier.padding(top = Theme.spacing.md)) {
                            OutlinedTextField(
                                value = reason,
                                onValueChange = { reason = it.take(1000) },
                                label = { Text(stringResource(R.string.approvals_rejection_reason_label)) },
                                supportingText = { reasonError?.let { Text(it) } },
                                isError = reasonError != null,
                                minLines = 2,
                                enabled = !busy,
                                modifier = Modifier.fillMaxWidth(),
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(Theme.spacing.sm)) {
                                AppButton(
                                    label = stringResource(R.string.approvals_confirm_rejection_action),
                                    onClick = {
                                        // Matches the server, which refuses a
                                        // rejection under three characters.
                                        // Somebody told only "rejected" has
                                        // nothing to act on.
                                        if (reason.trim().length < 3) {
                                            reasonError = reasonRequiredMessage
                                        } else {
                                            reasonError = null
                                            decide(request.id, "reject", reason.trim())
                                        }
                                    },
                                    variant = ButtonVariant.DANGER,
                                    fullWidth = false,
                                    busy = busy,
                                )
                                AppButton(
                                    label = stringResource(R.string.approvals_back_action),
                                    onClick = { rejecting = null; reasonError = null; reason = "" },
                                    variant = ButtonVariant.GHOST,
                                    fullWidth = false,
                                )
                            }
                        }

                        else -> Row(
                            modifier = Modifier.padding(top = Theme.spacing.md),
                            horizontalArrangement = Arrangement.spacedBy(Theme.spacing.sm),
                        ) {
                            AppButton(
                                label = stringResource(R.string.approvals_approve_action),
                                onClick = { decide(request.id, "approve", null) },
                                fullWidth = false,
                                busy = busy,
                                contentDescription = stringResource(
                                    R.string.approvals_approve_content_description,
                                    who,
                                    request.leaveType,
                                ),
                            )
                            AppButton(
                                label = stringResource(R.string.approvals_reject_action),
                                onClick = { rejecting = request.id; reason = ""; reasonError = null },
                                variant = ButtonVariant.SECONDARY,
                                fullWidth = false,
                                enabled = !busy,
                                contentDescription = stringResource(
                                    R.string.approvals_reject_content_description,
                                    who,
                                    request.leaveType,
                                ),
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * Settings.
 *
 * The biometric toggle is proved before it is stored. Turning the lock on
 * without checking it works leaves somebody locked out on their next launch by
 * a setting they had no way to test.
 */
@Composable
fun SettingsScreen(container: AppContainer, viewModel: AppViewModel, user: SessionUser?) {
    val context = LocalContext.current
    val activity = context as? FragmentActivity
    val scope = rememberCoroutineScope()
    val pending by viewModel.pending.collectAsState()

    var enabled by remember { mutableStateOf(container.tokens.biometricEnabled) }
    var support by remember { mutableStateOf<Biometrics.Support?>(null) }
    var note by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { support = Biometrics.support(context) }

    val biometricUnlockLabel = stringResource(R.string.settings_biometric_unlock_label)
    val biometricConfirmPrompt = stringResource(R.string.settings_biometric_confirm_prompt)
    val biometricNotEnabledMessage = stringResource(R.string.settings_biometric_not_enabled_message)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(screenPadding()),
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.md),
    ) {
        if (user != null) {
            AppCard {
                AppText(
                    stringResource(R.string.settings_user_full_name, user.firstName, user.lastName).trim(),
                    size = Theme.type.title3,
                    lineHeight = Theme.type.title3Line,
                    weight = FontWeight.SemiBold,
                    heading = true,
                )
                AppText(user.email, size = Theme.type.footnote, lineHeight = Theme.type.footnoteLine, tone = TextTone.MUTED)
            }
        }

        AppearanceSettings(container)

        AppCard {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    AppText(support?.label ?: biometricUnlockLabel)
                    AppText(
                        when (val s = support) {
                            null -> stringResource(R.string.settings_biometric_checking)
                            is Biometrics.Support.Available -> stringResource(R.string.settings_biometric_locks_note)
                            is Biometrics.Support.NotEnrolled -> stringResource(R.string.settings_biometric_not_enrolled_note)
                            is Biometrics.Support.Unavailable -> stringResource(R.string.settings_biometric_unavailable_note)
                        },
                        size = Theme.type.caption,
                        lineHeight = Theme.type.captionLine,
                        tone = TextTone.MUTED,
                    )
                }

                AppSwitch(
                    checked = enabled,
                    enabled = support is Biometrics.Support.Available && activity != null,
                    onCheckedChange = { next ->
                        note = null
                        if (!next) {
                            container.tokens.biometricEnabled = false
                            enabled = false
                            return@AppSwitch
                        }
                        scope.launch {
                            // Proved once before the setting is stored.
                            val result = activity?.let { Biometrics.prompt(it, biometricConfirmPrompt) }
                            if (result == Biometrics.Result.UNLOCKED) {
                                container.tokens.biometricEnabled = true
                                enabled = true
                            } else {
                                note = biometricNotEnabledMessage
                            }
                        }
                    },
                    modifier = Modifier.semantics { contentDescription = biometricUnlockLabel },
                )
            }

            // Said here rather than only in a document: somebody turning this
            // on should not believe it does more than it does.
            AppText(
                stringResource(R.string.settings_biometric_disclaimer),
                size = Theme.type.caption,
                lineHeight = Theme.type.captionLine,
                tone = TextTone.MUTED,
                modifier = Modifier.padding(top = Theme.spacing.md),
            )
        }

        note?.let { Banner(BannerTone.ERROR, stringResource(R.string.settings_biometric_not_enabled_title), description = it) }

        AppButton(
            label = stringResource(R.string.settings_sign_out_action),
            onClick = viewModel::signOut,
            variant = ButtonVariant.SECONDARY,
            modifier = Modifier.padding(top = Theme.spacing.xl),
        )

        if (pending > 0) {
            // Warned before the tap. Signing out with unsent work is a decision
            // that should be made knowingly.
            AppText(
                pluralStringResource(R.plurals.settings_pending_actions, pending, pending),
                size = Theme.type.caption,
                lineHeight = Theme.type.captionLine,
                tone = TextTone.WARNING,
            )
        }
    }
}

/**
 * One payslip.
 *
 * Gross, deductions and net are shown as the server sent them. It would be easy
 * to render `gross - totalDeductions` as a check, and wrong: those are floats
 * converted from the stored minor units, and a subtraction here could disagree
 * with the authoritative figure by a paisa. If the numbers ever fail to
 * reconcile, that is a payroll bug to fix at source, not something to paper
 * over on a phone.
 */
@Composable
fun PayslipDetailScreen(container: AppContainer, payslipId: String) {
    var state by remember { mutableStateOf<Loaded<PayslipDetailDto?>>(Loaded.Loading) }

    LaunchedEffect(payslipId) {
        state = try {
            Loaded.Ready(container.repository.payslipDetail(payslipId))
        } catch (e: Throwable) {
            failureOf("This payslip", e)
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
            is Loaded.Loading -> SkeletonRows(count = 3, rowHeight = 70.dp)
            is Loaded.Failed -> Banner(BannerTone.ERROR, current.title, description = current.description)
            is Loaded.Ready -> {
                val payslip = current.value
                if (payslip == null) {
                    EmptyState(
                        title = stringResource(R.string.payslip_detail_not_found_title),
                        description = stringResource(R.string.payslip_detail_not_found_description),
                    )
                } else {
                    val period = if (payslip.periodMonth != null && payslip.periodYear != null) {
                        YearMonth.of(payslip.periodYear, payslip.periodMonth)
                            .format(DateTimeFormatter.ofPattern("LLLL yyyy"))
                    } else {
                        stringResource(R.string.payslips_fallback_period)
                    }

                    AppText(period, tone = TextTone.MUTED, heading = true)
                    AppText(
                        "₹%,.2f".format(payslip.netPay),
                        size = Theme.type.display,
                        lineHeight = Theme.type.displayLine,
                        weight = FontWeight.Bold,
                    )
                    AppText(
                        stringResource(R.string.payslips_net_pay_label),
                        size = Theme.type.footnote,
                        lineHeight = Theme.type.footnoteLine,
                        tone = TextTone.MUTED,
                    )

                    AppCard {
                        DetailRow(stringResource(R.string.payslip_detail_gross_label), "₹%,.2f".format(payslip.gross))
                        DetailRow(
                            stringResource(R.string.payslip_detail_total_deductions_label),
                            "₹%,.2f".format(payslip.totalDeductions),
                        )
                        DetailRow(stringResource(R.string.payslips_net_pay_label), "₹%,.2f".format(payslip.netPay))
                    }

                    AppCard {
                        DetailRow(
                            stringResource(R.string.payslip_detail_working_days_label),
                            payslip.workingDays.toInt().toString(),
                        )
                        DetailRow(
                            stringResource(R.string.payslip_detail_present_days_label),
                            payslip.presentDays.toInt().toString(),
                        )
                        if (payslip.lopDays > 0) {
                            DetailRow(
                                stringResource(R.string.payslip_detail_loss_of_pay_label),
                                pluralStringResource(
                                    R.plurals.payslip_detail_lop_days_value,
                                    payslip.lopDays.toInt(),
                                    payslip.lopDays.toInt(),
                                ),
                            )
                        }
                    }

                    if (payslip.anomalies.isNotEmpty()) {
                        // Surfaced rather than hidden. These are the payroll
                        // engine's own doubts about the figure, and the person
                        // it belongs to has more context than anyone to say
                        // whether they are right.
                        Banner(
                            BannerTone.WARNING,
                            stringResource(R.string.payslip_detail_flagged_title),
                            description = payslip.anomalies.joinToString("\n"),
                        )
                    }

                    AppText(
                        stringResource(R.string.payslip_detail_disclaimer),
                        size = Theme.type.caption,
                        lineHeight = Theme.type.captionLine,
                        tone = TextTone.MUTED,
                    )
                }
            }
        }
    }
}
