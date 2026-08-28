package com.circuvent.hrms.feature

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.circuvent.hrms.AppContainer
import com.circuvent.hrms.R
import com.circuvent.hrms.core.design.Theme
import com.circuvent.hrms.core.ui.AppCard
import com.circuvent.hrms.core.ui.AppText
import com.circuvent.hrms.core.ui.Avatar
import com.circuvent.hrms.core.ui.Banner
import com.circuvent.hrms.core.ui.BannerTone
import com.circuvent.hrms.core.ui.FilterChips
import com.circuvent.hrms.core.ui.PillTone
import com.circuvent.hrms.core.ui.SkeletonRows
import com.circuvent.hrms.core.ui.StatusPill
import com.circuvent.hrms.core.ui.TextTone
import com.circuvent.hrms.data.TeamAttendanceResponse
import com.circuvent.hrms.data.TeamMemberDayDto

// ═══════════════════════════════════════════════════════════════
// WHO IS IN — the team's day, filtered
// ═══════════════════════════════════════════════════════════════
//
// The question a manager actually opens this app to answer, and until now the
// app could not answer it: the team screen showed who had *booked* leave, which
// is the plan rather than the day.
//
// Ordered by who needs attention. Somebody who has not arrived is at the top,
// somebody already at their desk is at the bottom, and that ordering comes off
// the server so every client agrees. A list sorted alphabetically makes the
// manager read all of it to find the two rows that matter.
//
// The words are chosen carefully. "Not in yet" for today and "No punch" for a
// past day, because the same missing record means "might still arrive" this
// morning and "did not come in" last Tuesday — and the second is an HR matter
// that should not be phrased as though the day were still running.

private enum class TeamFilter { ALL, NOT_IN, LATE, ON_TIME }

@Composable
private fun filterLabel(filter: TeamFilter): String = stringResource(
    when (filter) {
        TeamFilter.ALL -> R.string.team_filter_all
        TeamFilter.NOT_IN -> R.string.team_filter_not_in
        TeamFilter.LATE -> R.string.team_filter_late
        TeamFilter.ON_TIME -> R.string.team_filter_on_time
    }
)

private fun matches(presence: String, filter: TeamFilter): Boolean = when (filter) {
    TeamFilter.ALL -> true
    TeamFilter.ON_TIME -> presence == "in"
    TeamFilter.LATE -> presence == "late"
    // A past absence is the same question a day later, so it stays in the same
    // bucket rather than vanishing the moment a manager looks at yesterday.
    TeamFilter.NOT_IN -> presence == "not_in" || presence == "absent"
}

private fun toneOf(presence: String): PillTone = when (presence) {
    "in" -> PillTone.SUCCESS
    "late" -> PillTone.WARNING
    "absent" -> PillTone.DANGER
    "not_in" -> PillTone.NEUTRAL
    else -> PillTone.INFO
}

@Composable
private fun presenceLabel(member: TeamMemberDayDto, isToday: Boolean): String = when (member.presence) {
    "in" -> stringResource(R.string.team_presence_in)
    "late" -> stringResource(R.string.team_presence_late)
    "absent" -> stringResource(R.string.team_presence_absent)
    "not_in" ->
        if (isToday) stringResource(R.string.team_presence_not_in)
        else stringResource(R.string.team_presence_absent)
    "on_leave" -> stringResource(R.string.team_presence_on_leave)
    else -> stringResource(R.string.team_presence_off)
}

/**
 * The clock-in time, as the server rendered it.
 *
 * The server sends the wall-clock time in the zone the working day is measured
 * in. The phone does not slice the ISO instant: characters 11..16 of that are
 * UTC, so a punch at 00:30 IST displayed as 19:00 the previous evening.
 */
private fun clockPart(member: TeamMemberDayDto): String? = member.clockInLocal

@Composable
fun TeamAttendanceSection(container: AppContainer) {
    var state by remember { mutableStateOf<Loaded<TeamAttendanceResponse>>(Loaded.Loading) }
    var filter by remember { mutableStateOf(TeamFilter.ALL) }

    LaunchedEffect(Unit) {
        state = try {
            Loaded.Ready(container.repository.teamAttendance())
        } catch (e: Throwable) {
            failureOf("Who is in", e)
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm)) {
        SectionLabel(stringResource(R.string.team_who_is_in_section_label))

        when (val current = state) {
            is Loaded.Loading -> SkeletonRows(count = 3, rowHeight = 72.dp)
            is Loaded.Failed ->
                Banner(BannerTone.ERROR, current.title, description = current.description)

            is Loaded.Ready -> {
                val data = current.value

                if (data.members.isEmpty()) {
                    AppCard {
                        AppText(
                            stringResource(R.string.team_no_colleagues),
                            tone = TextTone.MUTED,
                            size = Theme.type.footnote,
                        )
                    }
                } else {
                    FilterChips(
                        options = listOf(
                            TeamFilter.ALL,
                            TeamFilter.NOT_IN,
                            TeamFilter.LATE,
                            TeamFilter.ON_TIME,
                        ),
                        selected = filter,
                        label = { filterLabel(it) },
                        onSelect = { filter = it },
                        count = {
                            when (it) {
                                TeamFilter.ALL -> data.counts.all
                                TeamFilter.NOT_IN -> data.counts.not_in
                                TeamFilter.LATE -> data.counts.late
                                TeamFilter.ON_TIME -> data.counts.`in`
                            }
                        },
                    )

                    val shown = data.members.filter { matches(it.presence, filter) }

                    if (shown.isEmpty()) {
                        AppCard {
                            AppText(
                                // Phrased as the good news it usually is. An
                                // empty "Late arrivals" is a fact worth saying
                                // plainly rather than an empty list.
                                stringResource(
                                    when (filter) {
                                        TeamFilter.NOT_IN -> R.string.team_empty_not_in
                                        TeamFilter.LATE -> R.string.team_empty_late
                                        TeamFilter.ON_TIME -> R.string.team_empty_on_time
                                        TeamFilter.ALL -> R.string.team_no_colleagues
                                    }
                                ),
                                tone = TextTone.MUTED,
                                size = Theme.type.footnote,
                            )
                        }
                    } else {
                        shown.forEach { member ->
                            TeamMemberRow(member, data.isToday)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TeamMemberRow(member: TeamMemberDayDto, isToday: Boolean) {
    val label = presenceLabel(member, isToday)
    val arrived = clockPart(member)

    // One stop for a screen reader rather than four. Read as separate nodes,
    // the name and the status are not obviously about the same person.
    val description = if (arrived != null) {
        stringResource(R.string.team_member_content_description_with_time, member.name, label, arrived)
    } else {
        stringResource(R.string.team_member_content_description, member.name, label)
    }

    AppCard(contentDescription = description) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Theme.spacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Avatar(name = member.name, imageUrl = member.avatarUrl, size = 44.dp)

            Column(Modifier.weight(1f)) {
                AppText(member.name, weight = FontWeight.Medium, maxLines = 1)

                val detail = when {
                    member.presence == "on_leave" && member.leaveType != null ->
                        member.leaveType.replace('_', ' ').replaceFirstChar { it.uppercase() }

                    member.presence == "late" && member.lateByMinutes > 0 && arrived != null ->
                        stringResource(
                            R.string.team_late_by_template,
                            arrived,
                            member.lateByMinutes,
                        )

                    arrived != null -> stringResource(R.string.team_arrived_template, arrived)
                    member.designation.isNotBlank() -> member.designation
                    else -> null
                }

                if (detail != null) {
                    AppText(
                        detail,
                        tone = TextTone.MUTED,
                        size = Theme.type.caption,
                        maxLines = 1,
                    )
                }
            }

            StatusPill(label, toneOf(member.presence))
        }
    }
}
