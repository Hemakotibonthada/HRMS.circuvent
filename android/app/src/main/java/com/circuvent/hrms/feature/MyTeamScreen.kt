package com.circuvent.hrms.feature

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.circuvent.hrms.AppContainer
import com.circuvent.hrms.core.design.Theme
import com.circuvent.hrms.core.ui.AppCard
import com.circuvent.hrms.core.ui.AppText
import com.circuvent.hrms.core.ui.Banner
import com.circuvent.hrms.core.ui.BannerTone
import com.circuvent.hrms.core.ui.EmptyState
import com.circuvent.hrms.core.ui.PillTone
import com.circuvent.hrms.core.ui.SkeletonRows
import com.circuvent.hrms.core.ui.StatusPill
import com.circuvent.hrms.core.ui.TextTone
import com.circuvent.hrms.core.ui.screenPadding
import com.circuvent.hrms.data.TeamPulseResponse

// ═══════════════════════════════════════════════════════════════
// MY TEAM — who is away, and whose day it is
// ═══════════════════════════════════════════════════════════════
//
// The two things people open an HR app to find out about other people. Put
// together because they are the same glance: is the person I need in today, and
// have I missed somebody's anniversary.
//
// Today is separated from the rest rather than sorted to the top. "Away today"
// and "away on the 27th" are different questions, and a list that answers both
// at once answers neither at a glance.

private val MONTHS_SHORT = listOf(
    "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
)

private fun dayAndMonth(iso: String): String {
    if (iso.length < 10) return iso
    val month = iso.substring(5, 7).toIntOrNull() ?: return iso
    val day = iso.substring(8, 10).trimStart('0')
    return "$day ${MONTHS_SHORT.getOrElse(month) { "" }}"
}

private fun leaveLabel(type: String): String =
    type.replace('_', ' ').replaceFirstChar { it.uppercase() }

@Composable
fun MyTeamScreen(container: AppContainer) {
    var state by remember { mutableStateOf<Loaded<TeamPulseResponse>>(Loaded.Loading) }

    LaunchedEffect(Unit) {
        state = try {
            Loaded.Ready(container.repository.teamPulse())
        } catch (e: Throwable) {
            failureOf("Your team", e)
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = screenPadding(),
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm),
    ) {
        item {
            when (val current = state) {
                is Loaded.Loading -> SkeletonRows(count = 5, rowHeight = 72.dp)
                is Loaded.Failed ->
                    Banner(BannerTone.ERROR, current.title, description = current.description)

                is Loaded.Ready -> {
                    val data = current.value
                    val awayToday = data.onLeave.filter { it.today }
                    val awaySoon = data.onLeave.filterNot { it.today }

                    if (data.teamSize <= 1 &&
                        data.birthdays.isEmpty() &&
                        data.anniversaries.isEmpty()
                    ) {
                        EmptyState(
                            title = "No team yet",
                            description =
                                "Once you have colleagues who share a manager with you, who is " +
                                    "away and whose birthday is coming up appear here.",
                        )
                    } else {
                        Column(verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm)) {
                            SectionLabel("Away today")
                            if (awayToday.isEmpty()) {
                                AppCard {
                                    AppText(
                                        "Everyone is in.",
                                        tone = TextTone.MUTED,
                                        size = Theme.type.footnote,
                                    )
                                }
                            } else {
                                awayToday.forEach { absence ->
                                    AppCard(
                                        contentDescription =
                                            "${absence.name} is away today on ${leaveLabel(absence.leaveType)}",
                                    ) {
                                        Row(
                                            Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.SpaceBetween,
                                            verticalAlignment = Alignment.CenterVertically,
                                        ) {
                                            Column(Modifier.weight(1f)) {
                                                AppText(absence.name, weight = FontWeight.Medium)
                                                AppText(
                                                    "back on ${dayAndMonth(absence.endDate)}",
                                                    tone = TextTone.MUTED,
                                                    size = Theme.type.caption,
                                                )
                                            }
                                            StatusPill(leaveLabel(absence.leaveType), PillTone.INFO)
                                        }
                                    }
                                }
                            }

                            if (awaySoon.isNotEmpty()) {
                                SectionLabel("Away this week")
                                awaySoon.forEach { absence ->
                                    AppCard {
                                        Row(
                                            Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.SpaceBetween,
                                        ) {
                                            AppText(absence.name, weight = FontWeight.Medium)
                                            AppText(
                                                "${dayAndMonth(absence.startDate)} – " +
                                                    dayAndMonth(absence.endDate),
                                                tone = TextTone.MUTED,
                                                size = Theme.type.footnote,
                                            )
                                        }
                                    }
                                }
                            }

                            if (data.birthdays.isNotEmpty()) {
                                SectionLabel("Birthdays")
                                data.birthdays.forEach { birthday ->
                                    AppCard(
                                        contentDescription =
                                            "${birthday.name}'s birthday, ${dayAndMonth(birthday.on)}",
                                    ) {
                                        Row(
                                            Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.SpaceBetween,
                                            verticalAlignment = Alignment.CenterVertically,
                                        ) {
                                            Column(Modifier.weight(1f)) {
                                                AppText(birthday.name, weight = FontWeight.Medium)
                                                if (birthday.designation.isNotBlank()) {
                                                    AppText(
                                                        birthday.designation,
                                                        tone = TextTone.MUTED,
                                                        size = Theme.type.caption,
                                                    )
                                                }
                                            }
                                            if (birthday.isToday) {
                                                StatusPill("Today", PillTone.SUCCESS)
                                            } else {
                                                AppText(
                                                    dayAndMonth(birthday.on),
                                                    tone = TextTone.MUTED,
                                                    size = Theme.type.footnote,
                                                )
                                            }
                                        }
                                    }
                                }
                            }

                            if (data.anniversaries.isNotEmpty()) {
                                SectionLabel("Work anniversaries")
                                data.anniversaries.forEach { anniversary ->
                                    AppCard(
                                        contentDescription =
                                            "${anniversary.name}, ${anniversary.years} years",
                                    ) {
                                        Row(
                                            Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.SpaceBetween,
                                            verticalAlignment = Alignment.CenterVertically,
                                        ) {
                                            Column(Modifier.weight(1f)) {
                                                AppText(anniversary.name, weight = FontWeight.Medium)
                                                AppText(
                                                    "${anniversary.years} year" +
                                                        if (anniversary.years == 1) "" else "s",
                                                    tone = TextTone.MUTED,
                                                    size = Theme.type.caption,
                                                )
                                            }
                                            if (anniversary.isToday) {
                                                StatusPill("Today", PillTone.SUCCESS)
                                            } else {
                                                AppText(
                                                    dayAndMonth(anniversary.on),
                                                    tone = TextTone.MUTED,
                                                    size = Theme.type.footnote,
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
