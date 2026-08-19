package com.circuvent.hrms.feature

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BeachAccess
import androidx.compose.material.icons.filled.Cake
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.EventAvailable
import androidx.compose.material.icons.filled.WorkspacePremium
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.circuvent.hrms.AppContainer
import com.circuvent.hrms.R
import com.circuvent.hrms.core.design.AccentTone
import com.circuvent.hrms.core.design.Theme
import com.circuvent.hrms.core.ui.AccentBadge
import com.circuvent.hrms.core.ui.AppCard
import com.circuvent.hrms.core.ui.AppText
import com.circuvent.hrms.core.ui.Glyph
import com.circuvent.hrms.core.ui.QuickAction
import com.circuvent.hrms.core.ui.rememberFormattedDate
import com.circuvent.hrms.core.ui.rememberFormattedRange
import com.circuvent.hrms.core.ui.TextTone
import com.circuvent.hrms.data.AnnouncementDto
import com.circuvent.hrms.data.HolidayDto
import com.circuvent.hrms.data.TeamPulseResponse
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

/**
 * The five things people open the app to do.
 *
 * Chosen from what the app is actually used for rather than from what is
 * cheapest to link: four of the five were three or more taps away before this
 * strip existed, and two of them — an expense claim and a work-from-home
 * request — were behind a tab most people never opened.
 *
 * Deliberately five. A sixth does not fit the width of a small phone without
 * either shrinking the discs below a comfortable target or letting the last one
 * hang half off the edge, which reads as a rendering fault rather than as an
 * invitation to scroll.
 */
@Composable
fun HomeShortcuts(onNavigate: (String) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Theme.spacing.xs),
    ) {
        QuickAction(
            modifier = Modifier.weight(1f),
            label = "Apply leave",
            glyph = Glyph.Drawable(painterResource(R.drawable.ic_action_leave)),
            tone = AccentTone.Violet,
            onClick = { onNavigate("leave/apply") },
        )

        QuickAction(
            modifier = Modifier.weight(1f),
            label = "Work away",
            glyph = Glyph.Drawable(painterResource(R.drawable.ic_action_wfh)),
            tone = AccentTone.Teal,
            onClick = { onNavigate("work-away") },
        )

        QuickAction(
            modifier = Modifier.weight(1f),
            label = "Payslip",
            glyph = Glyph.Drawable(painterResource(R.drawable.ic_action_payslip)),
            tone = AccentTone.Blue,
            onClick = { onNavigate("payslips") },
        )

        QuickAction(
            modifier = Modifier.weight(1f),
            label = "Expense",
            glyph = Glyph.Drawable(painterResource(R.drawable.ic_action_expense)),
            tone = AccentTone.Amber,
            onClick = { onNavigate("expenses") },
        )

        QuickAction(
            modifier = Modifier.weight(1f),
            label = "Balance",
            glyph = Glyph.Drawable(painterResource(R.drawable.ic_action_balance)),
            tone = AccentTone.Green,
            onClick = { onNavigate("leave") },
        )
    }
}

/**
 * Everything on the home screen that is about other people or about dates.
 *
 * All three sources load concurrently and each renders only if it returned
 * something. Nothing here is essential to the screen's job — clocking in — so a
 * failure is silent: a red banner about announcements above a working clock-in
 * button would be alarming out of all proportion to what was lost, and the
 * clock-in card runs its own error handling for the thing that does matter.
 *
 * Sections vanish when empty rather than showing "no announcements". An empty
 * state is worth its space when somebody navigated somewhere expecting content;
 * on a home screen it is just a row that never says anything.
 */
@Composable
fun HomeFeed(container: AppContainer, onNavigate: (String) -> Unit) {
    var pulse by remember { mutableStateOf<TeamPulseResponse?>(null) }
    var announcements by remember { mutableStateOf<List<AnnouncementDto>>(emptyList()) }
    var holidays by remember { mutableStateOf<List<HolidayDto>>(emptyList()) }

    LaunchedEffect(Unit) {
        coroutineScope {
            val pulseJob = async { runCatching { container.repository.teamPulse() } }
            val announcementJob = async { runCatching { container.repository.announcements() } }
            val holidayJob = async { runCatching { container.repository.holidays() } }

            pulseJob.await().onSuccess { pulse = it }
            announcementJob.await().onSuccess { response ->
                announcements = response.items
                    .sortedByDescending { it.isPinned }
                    .take(3)
            }
            holidayJob.await().onSuccess { response ->
                holidays = response.items.take(3)
            }
        }
    }

    val celebrations = remember(pulse) {
        val birthdays = pulse?.birthdays.orEmpty().map {
            Celebration(
                name = it.name,
                // Whose day it is *today* is the only version anybody acts on.
                // The rest are a heads-up, so they carry their date.
                occasion = if (it.isToday) "Birthday today" else "Birthday · ${it.on}",
                tone = AccentTone.Rose,
                icon = Icons.Filled.Cake,
                today = it.isToday,
            )
        }
        val anniversaries = pulse?.anniversaries.orEmpty().map {
            val years = if (it.years == 1) "1 year" else "${it.years} years"
            Celebration(
                name = it.name,
                occasion = if (it.isToday) "$years today" else "$years · ${it.on}",
                tone = AccentTone.Amber,
                icon = Icons.Filled.WorkspacePremium,
                today = it.isToday,
            )
        }
        // Today's first: they are the ones that stop being useful tomorrow.
        (birthdays + anniversaries).sortedByDescending { it.today }
    }

    val away = pulse?.onLeave.orEmpty()

    if (celebrations.isNotEmpty()) {
        HomeSection(
            title = "Wish them",
            actionLabel = "My team",
            onAction = { onNavigate("my-team") },
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(Theme.spacing.sm),
            ) {
                celebrations.forEach { CelebrationChip(it) }
            }
        }
    }

    if (away.isNotEmpty()) {
        HomeSection(
            title = "Off this week",
            actionLabel = "My team",
            onAction = { onNavigate("my-team") },
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm)) {
                away.take(4).forEach { absence ->
                    AppCard(muted = true) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            AccentBadge(
                                glyph = Glyph.Vector(Icons.Filled.BeachAccess),
                                tone = if (absence.today) AccentTone.Amber else AccentTone.Slate,
                            )
                            Spacer(Modifier.width(Theme.spacing.md))
                            Column(Modifier.weight(1f)) {
                                AppText(absence.name, weight = FontWeight.SemiBold)
                                AppText(
                                    // Whether somebody is away *right now* is
                                    // what changes who you ask; a date range
                                    // alone makes the reader work that out.
                                    if (absence.today) {
                                        "Away today · ${absence.leaveType}"
                                    } else {
                                        rememberFormattedRange(absence.startDate, absence.endDate)
                                    },
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
    }

    if (announcements.isNotEmpty()) {
        HomeSection(
            title = "Announcements",
            actionLabel = "All",
            onAction = { onNavigate("announcements") },
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm)) {
                announcements.forEach { announcement ->
                    AppCard(
                        onClick = { onNavigate("announcements") },
                        contentDescription = "${announcement.title}. Open announcements",
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            AccentBadge(
                                glyph = Glyph.Vector(Icons.Filled.Campaign),
                                tone = if (announcement.isPinned) AccentTone.Rose else AccentTone.Blue,
                            )
                            Spacer(Modifier.width(Theme.spacing.md))
                            Column(Modifier.weight(1f)) {
                                AppText(
                                    announcement.title,
                                    weight = FontWeight.SemiBold,
                                    maxLines = 2,
                                )
                                announcement.body.takeIf { it.isNotBlank() }?.let {
                                    AppText(
                                        it,
                                        size = Theme.type.caption,
                                        lineHeight = Theme.type.captionLine,
                                        tone = TextTone.MUTED,
                                        maxLines = 2,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (holidays.isNotEmpty()) {
        HomeSection(
            title = "Coming up",
            actionLabel = "All",
            onAction = { onNavigate("holidays") },
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm)) {
                holidays.forEach { holiday ->
                    AppCard(muted = true) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            AccentBadge(
                                glyph = Glyph.Vector(Icons.Filled.EventAvailable),
                                tone = if (holiday.isOptional) AccentTone.Slate else AccentTone.Green,
                            )
                            Spacer(Modifier.width(Theme.spacing.md))
                            Column(Modifier.weight(1f)) {
                                AppText(holiday.name, weight = FontWeight.SemiBold)
                                AppText(
                                    // "Optional" is not decoration. An optional
                                    // holiday is drawn from a pool and has to be
                                    // claimed; somebody who reads it as a closure
                                    // does not come to work.
                                    if (holiday.isOptional) {
                                        "${rememberFormattedDate(holiday.holidayDate)} · Optional, must be claimed"
                                    } else {
                                        rememberFormattedDate(holiday.holidayDate)
                                    },
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
    }
}

private data class Celebration(
    val name: String,
    val occasion: String,
    val tone: AccentTone,
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
    val today: Boolean,
)

/**
 * One person's celebration.
 *
 * Shows a name and an occasion, and nothing that looks like a button. There is
 * no "send wishes" action because there is nothing behind it — the app has no
 * messaging — and a control that silently does nothing is worse than an
 * honest reminder to go and say it in person.
 */
@Composable
private fun CelebrationChip(celebration: Celebration) {
    AppCard(modifier = Modifier.width(150.dp), muted = true) {
        AccentBadge(glyph = Glyph.Vector(celebration.icon), tone = celebration.tone, diameter = 36.dp)
        Spacer(Modifier.height(Theme.spacing.sm))
        AppText(
            celebration.name,
            size = Theme.type.footnote,
            lineHeight = Theme.type.footnoteLine,
            weight = FontWeight.SemiBold,
            maxLines = 2,
        )
        AppText(
            celebration.occasion,
            size = Theme.type.caption,
            lineHeight = Theme.type.captionLine,
            tone = TextTone.MUTED,
        )
    }
}

/** A heading with an optional link to the full list. */
@Composable
private fun HomeSection(
    title: String,
    actionLabel: String,
    onAction: () -> Unit,
    content: @Composable () -> Unit,
) {
    Column(Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AppText(
                title,
                size = Theme.type.footnote,
                lineHeight = Theme.type.footnoteLine,
                weight = FontWeight.SemiBold,
                tone = TextTone.MUTED,
                heading = true,
                modifier = Modifier.weight(1f),
            )
            com.circuvent.hrms.core.ui.AppButton(
                label = actionLabel,
                onClick = onAction,
                variant = com.circuvent.hrms.core.ui.ButtonVariant.GHOST,
                fullWidth = false,
                contentDescription = "$actionLabel $title",
            )
        }
        Spacer(Modifier.height(Theme.spacing.sm))
        content()
    }
}
