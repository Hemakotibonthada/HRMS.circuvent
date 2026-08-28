package com.circuvent.hrms.feature

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import com.circuvent.hrms.data.SessionUser
import com.circuvent.hrms.data.TicketDetailResponse
import com.circuvent.hrms.data.TicketDto
import com.circuvent.hrms.data.TicketsResponse
import com.circuvent.hrms.domain.HelpdeskRules
import kotlinx.coroutines.launch
import java.time.Instant

private fun HelpdeskRules.Tone.pill(): PillTone = when (this) {
    HelpdeskRules.Tone.SUCCESS -> PillTone.SUCCESS
    HelpdeskRules.Tone.WARNING -> PillTone.WARNING
    HelpdeskRules.Tone.DANGER -> PillTone.DANGER
    HelpdeskRules.Tone.INFO -> PillTone.INFO
    HelpdeskRules.Tone.NEUTRAL -> PillTone.NEUTRAL
}

private enum class TicketFilter { LIVE, WAITING, ALL }

@Composable
private fun TicketFilter.label(): String = when (this) {
    TicketFilter.LIVE -> stringResource(R.string.helpdesk_filter_live)
    TicketFilter.WAITING -> stringResource(R.string.helpdesk_filter_waiting)
    TicketFilter.ALL -> stringResource(R.string.helpdesk_filter_all)
}

/**
 * Helpdesk.
 *
 * Filtering happens on what has already been fetched rather than by asking the
 * server again per tab. The list is capped at 500 by the repository, the
 * summary is counted from those same rows, and a second round trip per tap on
 * a mobile connection buys nothing except a chance for the two to disagree.
 *
 * "Live" is the default rather than "All". A ticket closed in March is not what
 * somebody opening this screen came to find.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun HelpdeskScreen(
    container: AppContainer,
    onOpenTicket: (String) -> Unit,
    onRaise: () -> Unit,
) {
    var state by remember { mutableStateOf<Loaded<TicketsResponse>>(Loaded.Loading) }
    var filter by remember { mutableStateOf(TicketFilter.LIVE) }

    LaunchedEffect(Unit) {
        state = try {
            Loaded.Ready(container.repository.tickets())
        } catch (e: Throwable) {
            failureOf("Your tickets", e)
        }
    }

    val tickets = (state as? Loaded.Ready)?.value?.tickets.orEmpty().filter { ticket ->
        when (filter) {
            TicketFilter.ALL -> true
            TicketFilter.WAITING -> ticket.state == "pending_requester"
            TicketFilter.LIVE -> !HelpdeskRules.isSettled(ticket.state)
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = screenPadding(),
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm),
    ) {
        item {
            AppButton(
                stringResource(R.string.helpdesk_raise_ticket_action),
                onRaise,
                contentDescription = stringResource(R.string.helpdesk_raise_ticket_content_description),
            )
        }

        item {
            when (val current = state) {
                is Loaded.Loading -> SkeletonRows(count = 4, rowHeight = 76.dp)
                is Loaded.Failed -> Banner(BannerTone.ERROR, current.title, description = current.description)
                is Loaded.Ready -> {
                    val summary = current.value.summary
                    Column(verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm)) {
                        if (summary.total > 0) {
                            AppCard {
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    TicketTotal(
                                        stringResource(R.string.helpdesk_filter_live),
                                        summary.open + summary.waiting,
                                    )
                                    TicketTotal(
                                        stringResource(R.string.helpdesk_filter_waiting),
                                        summary.waiting,
                                    )
                                    TicketTotal(
                                        stringResource(R.string.helpdesk_total_settled_label),
                                        summary.resolved,
                                    )
                                }
                            }

                            FlowRow(horizontalArrangement = Arrangement.spacedBy(Theme.spacing.sm)) {
                                TicketFilter.entries.forEach { option ->
                                    val optionLabel = option.label()
                                    Chip(
                                        label = optionLabel,
                                        selected = filter == option,
                                        contentDescription = stringResource(
                                            R.string.helpdesk_show_filter_content_description,
                                            optionLabel.lowercase(),
                                        ),
                                    ) { filter = option }
                                }
                            }
                        }

                        if (tickets.isEmpty()) {
                            EmptyState(
                                title = when (filter) {
                                    TicketFilter.WAITING -> stringResource(R.string.helpdesk_empty_waiting_title)
                                    TicketFilter.LIVE -> stringResource(R.string.helpdesk_empty_live_title)
                                    TicketFilter.ALL -> stringResource(R.string.helpdesk_empty_all_title)
                                },
                                description = stringResource(R.string.helpdesk_empty_description),
                            )
                        }
                    }
                }
            }
        }

        items(tickets, key = { it.id }) { ticket -> TicketRow(ticket, onOpenTicket) }
    }
}

@Composable
private fun TicketTotal(label: String, value: Int) {
    Column {
        AppText(value.toString(), size = Theme.type.title3, lineHeight = Theme.type.title3Line, weight = FontWeight.Bold)
        AppText(label, size = Theme.type.caption, lineHeight = Theme.type.captionLine, tone = TextTone.MUTED)
    }
}

@Composable
private fun TicketRow(ticket: TicketDto, onOpen: (String) -> Unit) {
    val settled = HelpdeskRules.isSettled(ticket.state)
    val due = HelpdeskRules.dueState(
        ticket.resolutionDueAt,
        Instant.now(),
        ticket.resolutionBreached || ticket.responseBreached,
        settled,
    )

    AppCard(
        onClick = { onOpen(ticket.id) },
        muted = settled,
        contentDescription = "${ticket.reference}, ${ticket.subject}, " +
            HelpdeskRules.stateLabel(ticket.state) + (due?.let { ", ${it.text}" } ?: ""),
    ) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AppText(ticket.reference, size = Theme.type.caption, lineHeight = Theme.type.captionLine, tone = TextTone.MUTED)
            StatusPill(HelpdeskRules.stateLabel(ticket.state), HelpdeskRules.stateTone(ticket.state).pill())
        }
        AppText(ticket.subject, weight = FontWeight.Medium, maxLines = 2)
        due?.let {
            AppText(
                it.text,
                size = Theme.type.caption,
                lineHeight = Theme.type.captionLine,
                tone = when (it.tone) {
                    HelpdeskRules.Tone.DANGER -> TextTone.DANGER
                    HelpdeskRules.Tone.WARNING -> TextTone.WARNING
                    else -> TextTone.MUTED
                },
            )
        }
    }
}

/**
 * Raise a ticket.
 *
 * Sent immediately and never queued. See `AppRepository.raiseTicket` for why:
 * a ticket written in a basement and delivered three days later starts its SLA
 * clock at the wrong moment.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun NewTicketScreen(container: AppContainer, onRaised: (String) -> Unit, onCancel: () -> Unit) {
    var subject by remember { mutableStateOf("") }
    var body by remember { mutableStateOf("") }
    var priority by remember { mutableStateOf("normal") }
    var errors by remember { mutableStateOf<Map<HelpdeskRules.Field, String>>(emptyMap()) }
    var banner by remember { mutableStateOf<Pair<String, String?>?>(null) }
    var busy by remember { mutableStateOf(false) }

    val scope = rememberCoroutineScope()

    val sendErrorTitle = stringResource(R.string.helpdesk_send_error_title)
    val offlineDescription = stringResource(R.string.helpdesk_offline_description)
    val genericSendErrorFallback = stringResource(R.string.helpdesk_generic_send_error_fallback)

    fun raise() {
        banner = null
        val found = HelpdeskRules.validateTicket(subject, body)
        errors = found
        if (found.isNotEmpty()) return

        busy = true
        scope.launch {
            try {
                val ticket = container.repository.raiseTicket(subject.trim(), body.trim(), priority)
                onRaised(ticket.id)
            } catch (e: com.circuvent.hrms.data.net.OfflineException) {
                banner = sendErrorTitle to offlineDescription
            } catch (e: Exception) {
                banner = sendErrorTitle to (e.message ?: genericSendErrorFallback)
            } finally {
                busy = false
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(screenPadding()),
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.md),
    ) {
        banner?.let { (title, description) ->
            Banner(BannerTone.ERROR, title, description = description)
        }

        OutlinedTextField(
            value = subject,
            onValueChange = { subject = it.take(200) },
            label = { Text(stringResource(R.string.helpdesk_subject_field_label)) },
            supportingText = {
                Text(errors[HelpdeskRules.Field.SUBJECT] ?: stringResource(R.string.helpdesk_subject_hint_fallback))
            },
            isError = errors.containsKey(HelpdeskRules.Field.SUBJECT),
            singleLine = true,
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
        )

        AppText(
            stringResource(R.string.helpdesk_priority_label),
            size = Theme.type.footnote,
            lineHeight = Theme.type.footnoteLine,
            weight = FontWeight.Medium,
        )

        FlowRow(horizontalArrangement = Arrangement.spacedBy(Theme.spacing.sm)) {
            HelpdeskRules.selectablePriorities.forEach { option ->
                Chip(
                    label = HelpdeskRules.priorityLabel(option),
                    selected = priority == option,
                    enabled = !busy,
                    contentDescription = stringResource(
                        R.string.helpdesk_priority_content_description,
                        HelpdeskRules.priorityLabel(option),
                    ),
                ) { priority = option }
            }
        }

        // Said before it is chosen, not enforced afterwards. Every ticket
        // marked urgent is the same as none of them being marked urgent.
        AppText(
            stringResource(R.string.helpdesk_urgent_explainer),
            size = Theme.type.caption,
            lineHeight = Theme.type.captionLine,
            tone = TextTone.MUTED,
        )

        OutlinedTextField(
            value = body,
            onValueChange = { body = it.take(20_000) },
            label = { Text(stringResource(R.string.helpdesk_body_field_label)) },
            supportingText = {
                Text(
                    errors[HelpdeskRules.Field.BODY]
                        ?: stringResource(R.string.helpdesk_body_hint_fallback)
                )
            },
            isError = errors.containsKey(HelpdeskRules.Field.BODY),
            minLines = 5,
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
        )

        AppButton(stringResource(R.string.helpdesk_send_action), ::raise, busy = busy)
        AppButton(
            stringResource(R.string.expenses_cancel_action),
            onCancel,
            variant = ButtonVariant.GHOST,
            enabled = !busy,
        )
    }
}

/**
 * One ticket and its conversation.
 *
 * Internal notes never reach here — the repository filters them out for a
 * non-agent, structurally rather than by convention, because an internal note
 * shown to a requester is how a disciplinary discussion reaches the person it
 * is about. This screen still checks the flag before rendering, so that a
 * future change on the server which starts sending them does not silently
 * publish them on a phone.
 */
@Composable
fun TicketDetailScreen(container: AppContainer, ticketId: String, user: SessionUser?) {
    var state by remember { mutableStateOf<Loaded<TicketDetailResponse>>(Loaded.Loading) }
    var reply by remember { mutableStateOf("") }
    var replyError by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }

    val scope = rememberCoroutineScope()

    val replyEmptyError = stringResource(R.string.helpdesk_reply_empty_error)
    val replySendErrorFallback = stringResource(R.string.helpdesk_reply_send_error_fallback)

    suspend fun load() {
        state = try {
            Loaded.Ready(container.repository.ticket(ticketId))
        } catch (e: Throwable) {
            failureOf("This ticket", e)
        }
    }

    LaunchedEffect(ticketId) { load() }

    fun send() {
        val text = reply.trim()
        // Matches the server, which refuses an empty comment. Sending one and
        // being told no costs a round trip on a form somebody is typing
        // one-handed.
        if (text.isEmpty()) {
            replyError = replyEmptyError
            return
        }
        replyError = null
        sending = true
        scope.launch {
            try {
                container.repository.commentOnTicket(ticketId, text)
                reply = ""
                // Reloaded rather than appended locally. The reply may have
                // moved the ticket out of "waiting for you", and a thread that
                // grows while the status above it stays wrong is worse than a
                // short wait.
                load()
            } catch (e: Exception) {
                replyError = e.message ?: replySendErrorFallback
            } finally {
                sending = false
            }
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
            is Loaded.Loading -> SkeletonRows(count = 3, rowHeight = 80.dp)
            is Loaded.Failed -> Banner(BannerTone.ERROR, current.title, description = current.description)
            is Loaded.Ready -> {
                val ticket = current.value.ticket
                val settled = HelpdeskRules.isSettled(ticket.state)
                val due = HelpdeskRules.dueState(
                    ticket.resolutionDueAt,
                    Instant.now(),
                    ticket.resolutionBreached || ticket.responseBreached,
                    settled,
                )

                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    AppText(ticket.reference, size = Theme.type.caption, lineHeight = Theme.type.captionLine, tone = TextTone.MUTED)
                    StatusPill(HelpdeskRules.stateLabel(ticket.state), HelpdeskRules.stateTone(ticket.state).pill())
                }

                AppText(
                    ticket.subject,
                    size = Theme.type.title3,
                    lineHeight = Theme.type.title3Line,
                    weight = FontWeight.Bold,
                    heading = true,
                )

                StatusPill(
                    stringResource(R.string.helpdesk_priority_content_description, HelpdeskRules.priorityLabel(ticket.priority)),
                    HelpdeskRules.priorityTone(ticket.priority).pill(),
                )

                due?.let {
                    Banner(
                        tone = if (it.overdue) BannerTone.ERROR else BannerTone.INFO,
                        title = it.text,
                        description = if (it.overdue) {
                            stringResource(R.string.helpdesk_overdue_notified_description)
                        } else {
                            null
                        },
                    )
                }

                AppCard {
                    AppText(
                        stringResource(R.string.helpdesk_reported_label),
                        size = Theme.type.caption,
                        lineHeight = Theme.type.captionLine,
                        tone = TextTone.MUTED,
                    )
                    AppText(ticket.body)
                }

                AppText(
                    stringResource(R.string.helpdesk_replies_heading),
                    size = Theme.type.footnote,
                    lineHeight = Theme.type.footnoteLine,
                    weight = FontWeight.SemiBold,
                    tone = TextTone.MUTED,
                    heading = true,
                )

                val visible = current.value.comments.filter { !it.isInternal }
                if (visible.isEmpty()) {
                    AppText(
                        stringResource(R.string.helpdesk_no_replies_yet),
                        size = Theme.type.footnote,
                        lineHeight = Theme.type.footnoteLine,
                        tone = TextTone.MUTED,
                    )
                } else {
                    val youLabel = stringResource(R.string.helpdesk_comment_author_you)
                    val theHelpdeskPrefix = stringResource(R.string.helpdesk_comment_author_helpdesk_prefix)
                    val helpdeskLabel = stringResource(R.string.helpdesk_comment_author_helpdesk_label)
                    visible.forEach { comment ->
                        val mine = comment.authorId != null && comment.authorId == user?.id
                        AppCard(
                            muted = !mine,
                            contentDescription = stringResource(
                                R.string.helpdesk_comment_content_description,
                                if (mine) youLabel else theHelpdeskPrefix,
                                comment.body,
                            ),
                        ) {
                            // Named in words. A reply distinguished only by
                            // which side of the screen it sits on is unreadable
                            // to a screen reader and ambiguous at a glance.
                            AppText(
                                if (mine) youLabel else helpdeskLabel,
                                size = Theme.type.caption,
                                lineHeight = Theme.type.captionLine,
                                weight = FontWeight.SemiBold,
                                tone = if (mine) TextTone.PRIMARY else TextTone.DEFAULT,
                            )
                            AppText(comment.body)
                        }
                    }
                }

                if (settled) {
                    // No reply box on a closed ticket. A message typed into one
                    // nobody is watching is worse than being told to raise a
                    // new one.
                    Banner(
                        BannerTone.INFO,
                        stringResource(R.string.helpdesk_closed_ticket_title),
                        description = stringResource(R.string.helpdesk_closed_ticket_description),
                    )
                } else {
                    OutlinedTextField(
                        value = reply,
                        onValueChange = { reply = it.take(20_000) },
                        label = { Text(stringResource(R.string.helpdesk_reply_field_label)) },
                        supportingText = { replyError?.let { Text(it) } },
                        isError = replyError != null,
                        minLines = 3,
                        enabled = !sending,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    AppButton(stringResource(R.string.helpdesk_send_reply_action), ::send, busy = sending)
                }
            }
        }
    }
}
