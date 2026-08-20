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
import com.circuvent.hrms.core.ui.Avatar
import com.circuvent.hrms.core.ui.Banner
import com.circuvent.hrms.core.ui.BannerTone
import com.circuvent.hrms.core.ui.ButtonVariant
import com.circuvent.hrms.core.ui.EmptyState
import com.circuvent.hrms.core.ui.FilterChips
import com.circuvent.hrms.core.ui.PillTone
import com.circuvent.hrms.core.ui.SkeletonRows
import com.circuvent.hrms.core.ui.StatusPill
import com.circuvent.hrms.core.ui.TextTone
import com.circuvent.hrms.core.ui.rememberFormattedDate
import com.circuvent.hrms.core.ui.screenPadding
import com.circuvent.hrms.data.ColleagueDto
import com.circuvent.hrms.data.PraiseCreate
import com.circuvent.hrms.data.PraiseDto
import com.circuvent.hrms.data.PraiseResponse
import kotlinx.coroutines.launch

// ═══════════════════════════════════════════════════════════════
// PRAISE — saying so, where other people can see it
// ═══════════════════════════════════════════════════════════════
//
// Recognition existed on the web with a "from" text box: anybody could type
// anybody's name as the sender, and those strings were counted into a
// leaderboard. Forgeable praise is worth nothing to the person receiving it and
// actively misleading once it is ranked.
//
// Here the sender is the session. The screen never sends a name, only who it is
// for and what it is for, and the server fills in the rest.
//
// The recipient is chosen from the directory by searching, not typed. A free
// text name is how "Priya" ends up meaning three different people, none of whom
// can be told they were thanked.

private val PRAISE_VALUES = listOf("teamwork", "ownership", "craft", "customer", "kindness")

@Composable
private fun valueLabel(value: String): String = when (value) {
    "teamwork" -> stringResource(R.string.praise_value_teamwork)
    "ownership" -> stringResource(R.string.praise_value_ownership)
    "craft" -> stringResource(R.string.praise_value_craft)
    "customer" -> stringResource(R.string.praise_value_customer)
    "kindness" -> stringResource(R.string.praise_value_kindness)
    else -> value.replaceFirstChar { it.uppercase() }
}

private fun toneFor(value: String): PillTone = when (value) {
    "teamwork" -> PillTone.INFO
    "ownership" -> PillTone.WARNING
    "craft" -> PillTone.SUCCESS
    "customer" -> PillTone.NEUTRAL
    else -> PillTone.INFO
}

@Composable
fun PraiseScreen(container: AppContainer) {
    var state by remember { mutableStateOf<Loaded<PraiseResponse>>(Loaded.Loading) }
    var composing by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<Pair<BannerTone, String>?>(null) }

    val scope = rememberCoroutineScope()

    suspend fun load() {
        state = try {
            Loaded.Ready(container.repository.praise())
        } catch (e: Throwable) {
            failureOf("Praise", e)
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

                if (composing) {
                    PraiseComposer(
                        container = container,
                        onCancel = { composing = false },
                        onSent = {
                            composing = false
                            message = BannerTone.SUCCESS to it
                            scope.launch { load() }
                        },
                    )
                } else {
                    AppButton(
                        label = stringResource(R.string.praise_give_action),
                        onClick = { composing = true; message = null },
                    )
                }

                SectionLabel(stringResource(R.string.praise_recent_section_label))
            }
        }

        when (val current = state) {
            is Loaded.Loading -> item { SkeletonRows(count = 4, rowHeight = 96.dp) }
            is Loaded.Failed -> item {
                Banner(BannerTone.ERROR, current.title, description = current.description)
            }

            is Loaded.Ready -> {
                val items = current.value.items
                if (items.isEmpty()) {
                    item {
                        EmptyState(
                            title = stringResource(R.string.praise_empty_title),
                            description = stringResource(R.string.praise_empty_description),
                        )
                    }
                } else {
                    // Keyed so a new piece of praise arriving at the top does
                    // not make every card below it recompose and blink.
                    items(items, key = { it.id }) { PraiseCard(it) }
                }
            }
        }
    }
}

@Composable
private fun PraiseCard(praise: PraiseDto) {
    AppCard {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Theme.spacing.md),
        ) {
            Avatar(name = praise.toName, imageUrl = praise.toAvatarUrl, size = 44.dp)

            Column(Modifier.weight(1f)) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    AppText(praise.toName, weight = FontWeight.SemiBold, maxLines = 1)
                    StatusPill(valueLabel(praise.value), toneFor(praise.value))
                }

                AppText(
                    praise.message,
                    modifier = Modifier.padding(top = Theme.spacing.xs),
                    size = Theme.type.footnote,
                    lineHeight = Theme.type.footnoteLine,
                )

                val from = praise.fromName
                if (from != null) {
                    AppText(
                        stringResource(R.string.praise_from_template, from),
                        modifier = Modifier.padding(top = Theme.spacing.xs),
                        tone = TextTone.MUTED,
                        size = Theme.type.caption,
                    )
                }

                praise.createdAt?.let {
                    AppText(
                        rememberFormattedDate(it),
                        tone = TextTone.MUTED,
                        size = Theme.type.caption,
                    )
                }
            }
        }
    }
}

@Composable
private fun PraiseComposer(
    container: AppContainer,
    onCancel: () -> Unit,
    onSent: (String) -> Unit,
) {
    var search by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<ColleagueDto>>(emptyList()) }
    var chosen by remember { mutableStateOf<ColleagueDto?>(null) }
    var value by remember { mutableStateOf(PRAISE_VALUES.first()) }
    var words by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val scope = rememberCoroutineScope()
    val sentMessage = stringResource(R.string.praise_sent_message)
    val sendFailed = stringResource(R.string.praise_send_error_fallback)

    // Searched server-side rather than pulling the directory down, and against
    // the name-only lookup so an employee with no HR role is not refused.
    LaunchedEffect(search) {
        val term = search.trim()
        if (term.length < 2) {
            results = emptyList()
            return@LaunchedEffect
        }
        results = runCatching { container.repository.colleagues(term).items }.getOrDefault(emptyList())
    }

    AppCard {
        error?.let {
            AppText(it, tone = TextTone.DANGER, size = Theme.type.footnote)
        }

        val picked = chosen
        if (picked == null) {
            OutlinedTextField(
                value = search,
                onValueChange = { search = it },
                label = { Text(stringResource(R.string.praise_who_field_label)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )

            results.take(6).forEach { person ->
                AppCard(
                    onClick = { chosen = person; search = "" },
                    contentDescription = person.fullName,
                ) {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(Theme.spacing.md),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Avatar(name = person.fullName, imageUrl = person.avatarUrl, size = 36.dp)
                        Column(Modifier.weight(1f)) {
                            AppText(person.fullName, weight = FontWeight.Medium, maxLines = 1)
                            if (person.designation.isNotBlank()) {
                                AppText(
                                    person.designation,
                                    tone = TextTone.MUTED,
                                    size = Theme.type.caption,
                                    maxLines = 1,
                                )
                            }
                        }
                    }
                }
            }
        } else {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Theme.spacing.md),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Avatar(name = picked.fullName, imageUrl = picked.avatarUrl, size = 36.dp)
                AppText(picked.fullName, weight = FontWeight.Medium, modifier = Modifier.weight(1f))
                AppButton(
                    label = stringResource(R.string.praise_change_person_action),
                    variant = ButtonVariant.GHOST,
                    fullWidth = false,
                    onClick = { chosen = null },
                )
            }

            AppText(
                stringResource(R.string.praise_value_field_label),
                modifier = Modifier.padding(top = Theme.spacing.sm),
                size = Theme.type.footnote,
                tone = TextTone.MUTED,
            )
            FilterChips(
                options = PRAISE_VALUES,
                selected = value,
                label = { valueLabel(it) },
                onSelect = { value = it },
                modifier = Modifier.padding(top = Theme.spacing.xs),
            )

            OutlinedTextField(
                value = words,
                onValueChange = { words = it },
                label = { Text(stringResource(R.string.praise_message_field_label)) },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = Theme.spacing.sm),
            )

            AppButton(
                label = if (sending) stringResource(R.string.praise_sending_label)
                else stringResource(R.string.praise_send_action),
                enabled = !sending && words.trim().length >= 3,
                busy = sending,
                modifier = Modifier.padding(top = Theme.spacing.sm),
                onClick = {
                    sending = true
                    error = null
                    scope.launch {
                        try {
                            container.repository.givePraise(
                                PraiseCreate(
                                    toEmployeeId = picked.id,
                                    value = value,
                                    message = words.trim(),
                                )
                            )
                            onSent(sentMessage)
                        } catch (e: Throwable) {
                            error = e.message ?: sendFailed
                        } finally {
                            sending = false
                        }
                    }
                },
            )
        }

        AppButton(
            label = stringResource(R.string.expenses_cancel_action),
            variant = ButtonVariant.SECONDARY,
            onClick = onCancel,
        )
    }
}
