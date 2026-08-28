package com.circuvent.hrms.feature

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
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
import com.circuvent.hrms.core.ui.TextTone
import com.circuvent.hrms.data.PollCreate
import com.circuvent.hrms.data.PollDto
import com.circuvent.hrms.data.PollVote
import kotlinx.coroutines.launch

// ═══════════════════════════════════════════════════════════════
// POLLS — asking the company a question
// ═══════════════════════════════════════════════════════════════
//
// Said before anybody answers: these are not anonymous. A vote carries the
// voter's employee id, which is what makes one person one vote possible and
// what lets somebody change their mind. Whether that matters depends entirely
// on the question, and the person answering is the one who should decide —
// which they cannot do if the screen stays quiet about it.
//
// Results are shown after voting, not before. Seeing the tally first changes
// the answer: people move towards the option that is already winning, and a
// poll that measures its own leading answer measures nothing.

@Composable
fun PollList(container: AppContainer, polls: List<PollDto>, onChanged: () -> Unit) {
    polls.forEach { poll -> PollCard(container, poll, onChanged) }
}

@Composable
private fun PollCard(container: AppContainer, poll: PollDto, onChanged: () -> Unit) {
    var busy by remember(poll.id) { mutableStateOf(false) }
    var error by remember(poll.id) { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    val voted = poll.myVote != null

    AppCard {
        AppText(poll.question, weight = FontWeight.SemiBold)

        poll.authorName?.let {
            AppText(
                stringResource(R.string.poll_asked_by_template, it),
                tone = TextTone.MUTED,
                size = Theme.type.caption,
                lineHeight = Theme.type.captionLine,
            )
        }

        error?.let {
            AppText(it, tone = TextTone.DANGER, size = Theme.type.footnote)
        }

        Column(Modifier.padding(top = Theme.spacing.sm)) {
            poll.options.forEachIndexed { index, option ->
                val count = poll.votes.getOrElse(index) { 0 }
                val share = if (poll.totalVotes == 0) 0f else count.toFloat() / poll.totalVotes
                val mine = poll.myVote == index

                Box(
                    Modifier
                        .fillMaxWidth()
                        .padding(vertical = Theme.spacing.xs)
                        .clip(RoundedCornerShape(Theme.radius.sm))
                        .background(Theme.colors.surface)
                        .clickable(enabled = !busy) {
                            busy = true
                            error = null
                            scope.launch {
                                try {
                                    container.repository.votePoll(PollVote(poll.id, index))
                                    onChanged()
                                } catch (e: Throwable) {
                                    error = e.message
                                } finally {
                                    busy = false
                                }
                            }
                        }
                        .semantics {
                            role = Role.RadioButton
                            selected = mine
                        }
                ) {
                    // The share bar only appears once this person has voted.
                    // Before that it would be the tally, and the tally is the
                    // thing that biases the answer.
                    if (voted) {
                        Box(
                            Modifier
                                .fillMaxWidth(share)
                                .height(40.dp)
                                .clip(RoundedCornerShape(Theme.radius.sm))
                                .background(Theme.colors.primarySubtle)
                        )
                    }

                    Row(
                        Modifier
                            .fillMaxWidth()
                            .height(40.dp)
                            .padding(horizontal = Theme.spacing.md),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        AppText(
                            option,
                            modifier = Modifier.weight(1f),
                            weight = if (mine) FontWeight.SemiBold else FontWeight.Normal,
                            size = Theme.type.footnote,
                            lineHeight = Theme.type.footnoteLine,
                            maxLines = 1,
                        )

                        if (voted) {
                            // The count in words as well as a bar length, and a
                            // tick rather than colour for "yours" — a bar people
                            // have to compare by eye is a number withheld, and a
                            // colour alone is not a distinction for everyone.
                            AppText(
                                if (mine) stringResource(R.string.poll_your_choice_template, count)
                                else count.toString(),
                                tone = TextTone.MUTED,
                                size = Theme.type.caption,
                                lineHeight = Theme.type.captionLine,
                            )
                        }
                    }
                }
            }
        }

        AppText(
            if (voted) {
                stringResource(R.string.poll_change_hint, poll.totalVotes)
            } else {
                stringResource(R.string.poll_not_anonymous)
            },
            modifier = Modifier.padding(top = Theme.spacing.xs),
            tone = TextTone.MUTED,
            size = Theme.type.caption,
            lineHeight = Theme.type.captionLine,
        )
    }
}

/** The form for putting a question to everybody. */
@Composable
fun PollComposer(
    container: AppContainer,
    onCancel: () -> Unit,
    onPosted: () -> Unit,
) {
    var question by remember { mutableStateOf("") }
    var optionA by remember { mutableStateOf("") }
    var optionB by remember { mutableStateOf("") }
    var optionC by remember { mutableStateOf("") }
    var optionD by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val scope = rememberCoroutineScope()

    val options = listOf(optionA, optionB, optionC, optionD)
        .map { it.trim() }
        .filter { it.isNotEmpty() }

    AppCard {
        error?.let { Banner(BannerTone.ERROR, it) }

        OutlinedTextField(
            value = question,
            onValueChange = { question = it },
            label = { Text(stringResource(R.string.poll_question_field_label)) },
            modifier = Modifier.fillMaxWidth(),
        )

        listOf(
            optionA to { v: String -> optionA = v },
            optionB to { v: String -> optionB = v },
            optionC to { v: String -> optionC = v },
            optionD to { v: String -> optionD = v },
        ).forEachIndexed { index, (value, set) ->
            OutlinedTextField(
                value = value,
                onValueChange = set,
                label = {
                    Text(
                        if (index < 2) stringResource(R.string.poll_option_required_template, index + 1)
                        else stringResource(R.string.poll_option_optional_template, index + 1)
                    )
                },
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = Theme.spacing.xs),
            )
        }

        AppText(
            stringResource(R.string.poll_not_anonymous),
            modifier = Modifier.padding(top = Theme.spacing.sm),
            tone = TextTone.MUTED,
            size = Theme.type.caption,
            lineHeight = Theme.type.captionLine,
        )

        Row(
            Modifier.padding(top = Theme.spacing.sm),
            horizontalArrangement = Arrangement.spacedBy(Theme.spacing.sm),
        ) {
            AppButton(
                label = if (sending) stringResource(R.string.poll_posting_label)
                else stringResource(R.string.poll_post_action),
                enabled = !sending && question.trim().length >= 3 && options.size >= 2,
                busy = sending,
                fullWidth = false,
                modifier = Modifier.weight(1f),
                onClick = {
                    sending = true
                    error = null
                    scope.launch {
                        try {
                            container.repository.createPoll(
                                PollCreate(question = question.trim(), options = options)
                            )
                            onPosted()
                        } catch (e: Throwable) {
                            error = e.message
                        } finally {
                            sending = false
                        }
                    }
                },
            )
            AppButton(
                label = stringResource(R.string.expenses_cancel_action),
                variant = ButtonVariant.SECONDARY,
                fullWidth = false,
                modifier = Modifier.weight(1f),
                onClick = onCancel,
            )
        }
    }
}
