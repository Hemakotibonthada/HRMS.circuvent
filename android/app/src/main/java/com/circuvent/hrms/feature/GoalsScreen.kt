package com.circuvent.hrms.feature

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Slider
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
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.circuvent.hrms.AppContainer
import com.circuvent.hrms.R
import com.circuvent.hrms.core.design.MinTouchTarget
import com.circuvent.hrms.core.design.Theme
import com.circuvent.hrms.core.ui.AppButton
import com.circuvent.hrms.core.ui.AppCard
import com.circuvent.hrms.core.ui.AppText
import com.circuvent.hrms.core.ui.Banner
import com.circuvent.hrms.core.ui.BannerTone
import com.circuvent.hrms.core.ui.EmptyState
import com.circuvent.hrms.core.ui.PillTone
import com.circuvent.hrms.core.ui.SkeletonRows
import com.circuvent.hrms.core.ui.StatusPill
import com.circuvent.hrms.core.ui.TextTone
import com.circuvent.hrms.core.ui.rememberFormattedDate
import com.circuvent.hrms.core.ui.rememberFormattedRange
import com.circuvent.hrms.core.ui.screenPadding
import com.circuvent.hrms.data.GoalDto
import com.circuvent.hrms.data.GoalProgressUpdate
import com.circuvent.hrms.data.ReviewCycleDto
import kotlinx.coroutines.launch

/**
 * Goals for a review cycle, and a way to move them along.
 *
 * The point of this screen being on a phone at all is that progress gets
 * recorded when it happens rather than remembered in December. So the slider is
 * on the card, not behind a detail page — a goal you have to open before you
 * can update is a goal that gets updated once a quarter.
 */
@Composable
fun GoalsScreen(container: AppContainer) {
    var cycles by remember { mutableStateOf<List<ReviewCycleDto>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<Pair<String, String?>?>(null) }
    var selectedId by remember { mutableStateOf<String?>(null) }
    var busyGoal by remember { mutableStateOf<String?>(null) }
    var saved by remember { mutableStateOf<String?>(null) }

    val scope = rememberCoroutineScope()

    val goalsLoadErrorTitle = stringResource(R.string.goals_load_error_title)
    val goalsProgressSaveErrorTitle = stringResource(R.string.goals_progress_save_error_title)

    suspend fun load() {
        try {
            cycles = container.repository.reviewCycles()
            // The newest open cycle is the one somebody almost always wants.
            // Closed cycles are still reachable, but they are history.
            if (selectedId == null) {
                selectedId = cycles.firstOrNull { it.status == "active" }?.id ?: cycles.firstOrNull()?.id
            }
            error = null
        } catch (e: Throwable) {
            error = goalsLoadErrorTitle to e.message
        } finally {
            loading = false
        }
    }

    LaunchedEffect(Unit) { load() }

    val cycle = cycles.firstOrNull { it.id == selectedId }

    fun save(goal: GoalDto, percent: Int) {
        busyGoal = goal.id
        error = null
        scope.launch {
            try {
                container.repository.updateGoalProgress(
                    goal.id,
                    GoalProgressUpdate(progressPercent = percent),
                )
                saved = goal.id
                load()
            } catch (e: Exception) {
                // Includes the server's refusal for a goal with children, which
                // is a sentence worth showing verbatim rather than replacing
                // with "something went wrong".
                error = goalsProgressSaveErrorTitle to e.message
            } finally {
                busyGoal = null
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
            when {
                loading -> SkeletonRows(count = 3, rowHeight = 150.dp)
                cycles.isEmpty() && error == null -> EmptyState(
                    title = stringResource(R.string.goals_empty_cycle_title),
                    description = stringResource(R.string.goals_empty_cycle_description),
                )
            }
        }

        if (cycles.size > 1) {
            item {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(Theme.spacing.sm),
                ) {
                    cycles.forEach { entry ->
                        val active = entry.id == selectedId
                        Box(
                            modifier = Modifier
                                .height(MinTouchTarget)
                                .clip(RoundedCornerShape(Theme.radius.pill))
                                .background(if (active) Theme.colors.primary else Theme.colors.surface)
                                .selectable(
                                    selected = active,
                                    role = Role.RadioButton,
                                    onClick = { selectedId = entry.id },
                                )
                                .padding(horizontal = Theme.spacing.lg),
                            contentAlignment = Alignment.Center,
                        ) {
                            AppText(
                                entry.name.ifBlank { stringResource(R.string.goals_cycle_fallback) },
                                size = Theme.type.footnote,
                                lineHeight = Theme.type.footnoteLine,
                                weight = if (active) FontWeight.SemiBold else FontWeight.Normal,
                                tone = if (active) TextTone.ON_PRIMARY else TextTone.DEFAULT,
                            )
                        }
                    }
                }
            }
        }

        cycle?.let { current ->
            item {
                AppCard(muted = true) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            AppText(current.name.ifBlank { stringResource(R.string.goals_cycle_name_fallback) }, weight = FontWeight.SemiBold)
                            AppText(
                                rememberFormattedRange(current.periodStart, current.periodEnd),
                                size = Theme.type.caption,
                                lineHeight = Theme.type.captionLine,
                                tone = TextTone.MUTED,
                            )
                        }
                        if (current.status == "closed") {
                            StatusPill(label = stringResource(R.string.goals_status_closed), tone = PillTone.NEUTRAL)
                        }
                    }

                    current.selfReviewDueOn?.takeIf { current.status == "active" }?.let { due ->
                        Spacer(Modifier.height(Theme.spacing.sm))
                        AppText(
                            stringResource(R.string.goals_self_review_due, rememberFormattedDate(due)),
                            size = Theme.type.caption,
                            lineHeight = Theme.type.captionLine,
                            tone = TextTone.WARNING,
                        )
                    }
                }
            }

            if (current.goals.isEmpty()) {
                item {
                    EmptyState(
                        title = stringResource(R.string.goals_empty_goals_title),
                        description = stringResource(R.string.goals_empty_goals_description),
                    )
                }
            }

            items(current.goals, key = { it.id }) { goal ->
                GoalCard(
                    goal = goal,
                    editable = current.status == "active",
                    busy = busyGoal == goal.id,
                    justSaved = saved == goal.id,
                    onSave = { percent -> save(goal, percent) },
                )
            }
        }
    }
}

/**
 * One goal, with its progress slider.
 *
 * The slider holds a local value while it is being dragged and only sends on
 * release, because sending on every step would fire dozens of writes across one
 * gesture. The saved value is what comes back from the server, so a refused
 * write snaps the slider back rather than leaving it showing a number nobody
 * recorded.
 */
@Composable
private fun GoalCard(
    goal: GoalDto,
    editable: Boolean,
    busy: Boolean,
    justSaved: Boolean,
    onSave: (Int) -> Unit,
) {
    var draft by remember(goal.id, goal.progressPercent) {
        mutableStateOf(goal.progressPercent.toFloat())
    }
    val moved = draft.toInt() != goal.progressPercent

    AppCard {
        Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) {
                AppText(goal.title, weight = FontWeight.SemiBold)
                goal.category?.takeIf { it.isNotBlank() }?.let {
                    AppText(
                        it,
                        size = Theme.type.caption,
                        lineHeight = Theme.type.captionLine,
                        tone = TextTone.MUTED,
                    )
                }
            }
            StatusPill(label = goalStatusLabel(goal.status), tone = goalStatusTone(goal.status))
        }

        goal.description?.takeIf { it.isNotBlank() }?.let {
            Spacer(Modifier.height(Theme.spacing.sm))
            AppText(
                it,
                size = Theme.type.footnote,
                lineHeight = Theme.type.footnoteLine,
                tone = TextTone.MUTED,
            )
        }

        // The target is shown as given. A goal of "1200 tickets" means nothing
        // as a bare percentage, and the two together are what a conversation
        // with a manager actually uses.
        val target = listOfNotNull(
            goal.currentValue?.takeIf { it.isNotBlank() },
            goal.targetValue?.takeIf { it.isNotBlank() }?.let {
                stringResource(R.string.goals_target_of_value, it)
            },
            goal.unit?.takeIf { it.isNotBlank() },
        ).joinToString(" ")

        if (target.isNotBlank()) {
            Spacer(Modifier.height(Theme.spacing.sm))
            AppText(target, size = Theme.type.footnote, lineHeight = Theme.type.footnoteLine)
        }

        Spacer(Modifier.height(Theme.spacing.md))

        Row(verticalAlignment = Alignment.CenterVertically) {
            AppText(
                "${draft.toInt()}%",
                weight = FontWeight.SemiBold,
                modifier = Modifier.width(56.dp),
            )
            if (goal.weightPercent > 0) {
                Spacer(Modifier.weight(1f))
                AppText(
                    stringResource(R.string.goals_weight_percent, goal.weightPercent),
                    size = Theme.type.caption,
                    lineHeight = Theme.type.captionLine,
                    tone = TextTone.MUTED,
                )
            }
        }

        val progressContentDescription =
            stringResource(R.string.goals_progress_content_description, goal.title, draft.toInt())

        Slider(
            value = draft,
            onValueChange = { draft = it },
            valueRange = 0f..100f,
            steps = 19,
            enabled = editable && !busy,
            modifier = Modifier
                .fillMaxWidth()
                .clearAndSetSemantics {
                    contentDescription = progressContentDescription
                },
        )

        goal.dueDate?.takeIf { it.isNotBlank() }?.let {
            AppText(
                stringResource(R.string.goals_due_date, rememberFormattedDate(it)),
                size = Theme.type.caption,
                lineHeight = Theme.type.captionLine,
                tone = TextTone.MUTED,
            )
        }

        if (editable && moved) {
            Spacer(Modifier.height(Theme.spacing.sm))
            Row(horizontalArrangement = Arrangement.spacedBy(Theme.spacing.sm)) {
                AppButton(
                    label = stringResource(R.string.goals_save_progress_action),
                    onClick = { onSave(draft.toInt()) },
                    fullWidth = false,
                    busy = busy,
                )
                AppButton(
                    label = stringResource(R.string.goals_undo_action),
                    onClick = { draft = goal.progressPercent.toFloat() },
                    variant = com.circuvent.hrms.core.ui.ButtonVariant.GHOST,
                    fullWidth = false,
                    enabled = !busy,
                )
            }
        } else if (justSaved && !moved) {
            Spacer(Modifier.height(Theme.spacing.xs))
            AppText(
                stringResource(R.string.goals_saved_label),
                size = Theme.type.caption,
                lineHeight = Theme.type.captionLine,
                tone = TextTone.SUCCESS,
            )
        }
    }
}

@Composable
private fun goalStatusLabel(status: String): String = when (status) {
    "not_started" -> stringResource(R.string.goal_status_not_started)
    "in_progress" -> stringResource(R.string.goal_status_in_progress)
    "at_risk" -> stringResource(R.string.goal_status_at_risk)
    "completed" -> stringResource(R.string.goal_status_completed)
    "dropped" -> stringResource(R.string.goal_status_dropped)
    else -> status.replace('_', ' ').replaceFirstChar { it.uppercase() }
}

private fun goalStatusTone(status: String): PillTone = when (status) {
    "completed" -> PillTone.SUCCESS
    "at_risk" -> PillTone.DANGER
    "in_progress" -> PillTone.INFO
    "dropped" -> PillTone.NEUTRAL
    else -> PillTone.NEUTRAL
}
