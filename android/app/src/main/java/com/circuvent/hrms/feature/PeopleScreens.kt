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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
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
import com.circuvent.hrms.core.ui.EmptyState
import com.circuvent.hrms.core.ui.PillTone
import com.circuvent.hrms.core.ui.SkeletonRows
import com.circuvent.hrms.core.ui.StatusPill
import com.circuvent.hrms.core.ui.TextTone
import com.circuvent.hrms.core.ui.screenPadding
import com.circuvent.hrms.data.ReferralDto
import com.circuvent.hrms.data.ReferralStatsDto
import com.circuvent.hrms.data.SwapDto
import com.circuvent.hrms.data.SessionUser
import kotlinx.coroutines.launch

private fun words(value: String): String =
    value.replace('_', ' ').trim().replaceFirstChar { it.uppercase() }

/**
 * Referrals.
 *
 * The bonus figures are deliberately absent for an ordinary employee — the
 * server strips them rather than zeroing them, so this screen renders their
 * absence as nothing at all. Showing "Bonus: ₹0" to somebody who is owed a
 * bonus would be worse than showing nothing, and it is what a naive default
 * would produce.
 */
@Composable
fun ReferralsScreen(container: AppContainer, onRefer: () -> Unit) {
    var state by remember {
        mutableStateOf<Loaded<Pair<List<ReferralDto>, ReferralStatsDto>>>(Loaded.Loading)
    }

    LaunchedEffect(Unit) {
        state = try {
            Loaded.Ready(container.repository.referrals() to container.repository.referralStats())
        } catch (e: Throwable) {
            failureOf("Your referrals", e)
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = screenPadding(),
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm),
    ) {
        item {
            AppButton(
                stringResource(R.string.referrals_refer_someone_action),
                onRefer,
                contentDescription = stringResource(R.string.referrals_refer_someone_content_description),
            )
        }

        item {
            when (val current = state) {
                is Loaded.Loading -> SkeletonRows(count = 3, rowHeight = 84.dp)
                is Loaded.Failed -> Banner(BannerTone.ERROR, current.title, description = current.description)
                is Loaded.Ready -> {
                    val (referrals, stats) = current.value
                    Column(verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm)) {
                        AppCard {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Figure(stringResource(R.string.referrals_figure_referred_label), stats.total.toString())
                                Figure(stringResource(R.string.referrals_figure_in_pipeline_label), stats.inPipeline.toString())
                                Figure(stringResource(R.string.referrals_figure_hired_label), stats.hired.toString())
                            }
                            // Rendered only when the server actually sent it.
                            stats.bonusPaid?.let {
                                AppText(
                                    stringResource(R.string.referrals_bonus_paid_template, "₹%,.0f".format(it)) +
                                        (stats.bonusPending?.let { p ->
                                            stringResource(R.string.referrals_bonus_pending_suffix, "₹%,.0f".format(p))
                                        } ?: ""),
                                    size = Theme.type.footnote,
                                    lineHeight = Theme.type.footnoteLine,
                                    tone = TextTone.MUTED,
                                    modifier = Modifier.padding(top = Theme.spacing.sm),
                                )
                            }
                        }

                        if (referrals.isEmpty()) {
                            EmptyState(
                                title = stringResource(R.string.referrals_empty_title),
                                description = stringResource(R.string.referrals_empty_description),
                            )
                        }
                    }
                }
            }
        }

        (state as? Loaded.Ready)?.value?.first?.let { referrals ->
            items(referrals, key = { it.id }) { referral ->
                AppCard(
                    contentDescription = stringResource(
                        R.string.referrals_content_description,
                        referral.candidateName,
                        referral.positionTitle,
                        words(referral.status),
                    ),
                ) {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        AppText(referral.candidateName, weight = FontWeight.Medium, maxLines = 1)
                        StatusPill(
                            words(referral.status),
                            when (referral.status) {
                                "hired" -> PillTone.SUCCESS
                                "rejected" -> PillTone.DANGER
                                "submitted", "screening", "interviewing" -> PillTone.INFO
                                else -> PillTone.NEUTRAL
                            },
                        )
                    }
                    AppText(
                        referral.positionTitle,
                        size = Theme.type.footnote,
                        lineHeight = Theme.type.footnoteLine,
                        tone = TextTone.MUTED,
                    )
                    referral.rejectionReason?.let {
                        AppText(
                            it,
                            size = Theme.type.caption,
                            lineHeight = Theme.type.captionLine,
                            tone = TextTone.MUTED,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun Figure(label: String, value: String) {
    Column {
        AppText(value, size = Theme.type.title3, lineHeight = Theme.type.title3Line, weight = FontWeight.Bold)
        AppText(label, size = Theme.type.caption, lineHeight = Theme.type.captionLine, tone = TextTone.MUTED)
    }
}

/**
 * Refer someone.
 *
 * Only what the server needs, and nothing that would be guesswork on a phone.
 * The candidate fills in their own details through the invite link the server
 * emails them, so asking for a CV upload here would be asking somebody to find
 * a file on a handset for no reason.
 */
@Composable
fun ReferScreen(container: AppContainer, onDone: () -> Unit) {
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var position by remember { mutableStateOf("") }
    var relationship by remember { mutableStateOf("") }
    var recommendation by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<Pair<String, String?>?>(null) }
    var busy by remember { mutableStateOf(false) }

    val scope = rememberCoroutineScope()

    // Mirrors the server's zod schema exactly. Stricter would reject what it
    // would have taken; looser costs a round trip to be told what the phone
    // already knew.
    val nameOk = name.trim().length in 2..150
    val emailOk = email.trim().let { it.length <= 320 && it.contains('@') && it.contains('.') }
    val positionOk = position.trim().length in 2..150

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(screenPadding()),
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.md),
    ) {
        error?.let { (title, description) -> Banner(BannerTone.ERROR, title, description = description) }

        OutlinedTextField(
            value = name,
            onValueChange = { name = it.take(150) },
            label = { Text(stringResource(R.string.refer_name_field_label)) },
            singleLine = true,
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = email,
            onValueChange = { email = it.take(320) },
            label = { Text(stringResource(R.string.refer_email_field_label)) },
            supportingText = { Text(stringResource(R.string.refer_email_field_supporting_text)) },
            singleLine = true,
            enabled = !busy,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = position,
            onValueChange = { position = it.take(150) },
            label = { Text(stringResource(R.string.refer_position_field_label)) },
            singleLine = true,
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = relationship,
            onValueChange = { relationship = it.take(120) },
            label = { Text(stringResource(R.string.refer_relationship_field_label)) },
            singleLine = true,
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = recommendation,
            onValueChange = { recommendation = it.take(2000) },
            label = { Text(stringResource(R.string.refer_recommendation_field_label)) },
            minLines = 3,
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
        )

        val notSentTitle = stringResource(R.string.refer_not_sent_title)
        val offlineDescription = stringResource(R.string.refer_offline_description)
        AppButton(
            label = stringResource(R.string.refer_send_action),
            enabled = nameOk && emailOk && positionOk,
            busy = busy,
            onClick = {
                busy = true
                error = null
                scope.launch {
                    try {
                        container.repository.refer(
                            name.trim(), email.trim(), position.trim(),
                            relationship.trim().ifBlank { null },
                            recommendation.trim().ifBlank { null },
                        )
                        onDone()
                    } catch (e: com.circuvent.hrms.data.net.OfflineException) {
                        error = notSentTitle to offlineDescription
                    } catch (e: Exception) {
                        error = notSentTitle to e.message
                    } finally {
                        busy = false
                    }
                }
            },
        )
        AppButton(stringResource(R.string.expenses_cancel_action), onDone, variant = ButtonVariant.GHOST, enabled = !busy)
    }
}

/**
 * Shift swaps.
 *
 * A swap is a two-step thing and the screen says so: somebody offers a shift,
 * somebody else accepts it, and a manager decides. The server re-checks its
 * rostering constraints at the accept, not at the offer, so an accepted swap
 * can still be refused — which is why the outcome is read back from the server
 * rather than assumed here.
 */
@Composable
fun SwapsScreen(container: AppContainer, user: SessionUser?) {
    var state by remember { mutableStateOf<Loaded<List<SwapDto>>>(Loaded.Loading) }
    var busyId by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    val scope = rememberCoroutineScope()

    suspend fun load() {
        state = try {
            Loaded.Ready(container.repository.swaps())
        } catch (e: Throwable) {
            failureOf("Your swaps", e)
        }
    }

    LaunchedEffect(Unit) { load() }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = screenPadding(),
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm),
    ) {
        error?.let { item { Banner(BannerTone.ERROR, stringResource(R.string.swaps_generic_error_title), description = it) } }

        item {
            when (val current = state) {
                is Loaded.Loading -> SkeletonRows(count = 3, rowHeight = 90.dp)
                is Loaded.Failed -> Banner(BannerTone.ERROR, current.title, description = current.description)
                is Loaded.Ready -> if (current.value.isEmpty()) {
                    EmptyState(
                        title = stringResource(R.string.swaps_empty_title),
                        description = stringResource(R.string.swaps_empty_description),
                    )
                }
            }
        }

        (state as? Loaded.Ready)?.value?.let { swaps ->
            items(swaps, key = { it.id }) { swap ->
                val mine = swap.requestedById == user?.id || swap.requestedById == user?.employeeId
                val busy = busyId == swap.id

                AppCard(contentDescription = stringResource(R.string.swaps_content_description, words(swap.status))) {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        AppText(
                            if (mine) stringResource(R.string.swaps_you_offered_label) else stringResource(R.string.swaps_offered_to_you_label),
                            weight = FontWeight.Medium,
                        )
                        StatusPill(
                            words(swap.status),
                            when (swap.status) {
                                "approved", "accepted" -> PillTone.SUCCESS
                                "rejected", "cancelled" -> PillTone.DANGER
                                "pending", "awaiting_approval" -> PillTone.WARNING
                                else -> PillTone.NEUTRAL
                            },
                        )
                    }

                    swap.reason?.let {
                        AppText(it, size = Theme.type.footnote, lineHeight = Theme.type.footnoteLine, tone = TextTone.MUTED)
                    }
                    swap.rejectionReason?.let {
                        AppText(it, size = Theme.type.caption, lineHeight = Theme.type.captionLine, tone = TextTone.DANGER)
                    }

                    // Offered to somebody else and still open: they can take it.
                    if (!mine && swap.status == "pending") {
                        AppButton(
                            label = stringResource(R.string.swaps_take_shift_action),
                            fullWidth = false,
                            busy = busy,
                            modifier = Modifier.padding(top = Theme.spacing.sm),
                            onClick = {
                                busyId = swap.id
                                error = null
                                scope.launch {
                                    try {
                                        container.repository.acceptSwap(swap.id)
                                        // Read back rather than assumed: the
                                        // rostering constraints are re-checked
                                        // at the accept, so this can still be
                                        // refused.
                                        load()
                                    } catch (e: Exception) {
                                        error = e.message
                                    } finally {
                                        busyId = null
                                    }
                                }
                            },
                        )
                    }
                }
            }
        }
    }
}
