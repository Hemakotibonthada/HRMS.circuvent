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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountBalanceWallet
import androidx.compose.material.icons.filled.Badge
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.CardGiftcard
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.EditCalendar
import androidx.compose.material.icons.filled.EmojiEvents
import androidx.compose.material.icons.filled.EventAvailable
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.HealthAndSafety
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.ManageAccounts
import androidx.compose.material.icons.filled.PersonSearch
import androidx.compose.material.icons.filled.ReceiptLong
import androidx.compose.material.icons.filled.School
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SupportAgent
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material.icons.filled.TrackChanges
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.circuvent.hrms.R
import com.circuvent.hrms.core.design.AccentTone
import com.circuvent.hrms.core.design.MinTouchTarget
import com.circuvent.hrms.core.design.Theme
import com.circuvent.hrms.core.ui.AppCard
import com.circuvent.hrms.core.ui.AppText
import com.circuvent.hrms.core.ui.Avatar
import com.circuvent.hrms.core.ui.Banner
import com.circuvent.hrms.core.ui.BannerTone
import com.circuvent.hrms.core.ui.FeatureGrid
import com.circuvent.hrms.core.ui.FeatureGridItem
import com.circuvent.hrms.core.ui.Glyph
import com.circuvent.hrms.core.ui.TextTone
import com.circuvent.hrms.core.ui.screenPadding
import com.circuvent.hrms.data.SessionUser

/**
 * The sections of the hub.
 *
 * Twenty-odd destinations live behind this tab. As one flat list they were a
 * wall of near-identical rows that had to be read start to finish, because
 * "Form 16" and "Referrals" look exactly alike when both are a line of text.
 * Grouping by the question being asked — where did my time go, where did my
 * money go — lets somebody skip four fifths of it.
 *
 * The grouping is by *question*, not by which service answers it. Expenses sit
 * under Money rather than beside Attendance, because somebody claiming a taxi
 * fare is thinking about money.
 */
private enum class MeSection {
    TIME,
    MONEY,
    GROWTH,
    WORKPLACE,
    TEAM,
}

/** The label shown on each section's chip. */
@Composable
private fun meSectionLabel(section: MeSection): String = when (section) {
    MeSection.TIME -> stringResource(R.string.me_section_time)
    MeSection.MONEY -> stringResource(R.string.me_section_money)
    MeSection.GROWTH -> stringResource(R.string.me_section_growth)
    MeSection.WORKPLACE -> stringResource(R.string.me_section_workplace)
    MeSection.TEAM -> stringResource(R.string.me_section_team)
}

/**
 * The hub for everything that is neither a daily action nor one of the tabs.
 *
 * The section is remembered across configuration changes but deliberately not
 * across launches: somebody returning to the app is far more often starting a
 * new errand than resuming the last one, and reopening on "Growth" because that
 * is where they were a week ago costs a tap every time.
 */
@Composable
fun ProfileScreen(
    viewModel: AppViewModel,
    user: SessionUser?,
    onNavigate: (String) -> Unit,
) {
    val pending by viewModel.pending.collectAsState()
    val canApprove = user?.role in setOf("owner", "admin", "hr", "manager")

    val sections = remember(canApprove) {
        MeSection.entries.filter { it != MeSection.TEAM || canApprove }
    }
    var section by rememberSaveable { mutableStateOf(MeSection.TIME) }

    // A role can change under a running session. Falling back keeps the screen
    // from rendering an empty grid for a section the person can no longer see.
    val active = if (section in sections) section else MeSection.TIME

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = screenPadding(bottomExtra = TabBarHeight),
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.md),
    ) {
        item { IdentityHeader(user = user, onOpenIdCard = { onNavigate("profile/detail") }) }

        if (pending > 0) {
            item {
                Banner(
                    tone = BannerTone.INFO,
                    title = pluralStringResource(R.plurals.today_pending_actions, pending, pending),
                    description = stringResource(R.string.me_pending_actions_description),
                )
            }
        }

        item {
            SectionTabs(
                sections = sections,
                selected = active,
                onSelect = { section = it },
            )
        }

        item {
            FeatureGrid(items = itemsFor(active, onNavigate))
        }

        item {
            AppCard(
                onClick = { onNavigate("settings") },
                contentDescription = stringResource(R.string.me_settings_content_description),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    com.circuvent.hrms.core.ui.AccentBadge(
                        glyph = Glyph.Vector(Icons.Filled.Settings),
                        tone = AccentTone.Slate,
                    )
                    Spacer(Modifier.width(Theme.spacing.md))
                    Column {
                        AppText(stringResource(R.string.me_settings_title), weight = FontWeight.SemiBold)
                        AppText(
                            stringResource(R.string.me_settings_description),
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

/**
 * Name, role, and a way into the identity card.
 *
 * Shows the photograph when one is set and the initials when it is not, which
 * is almost always. The initials are not a placeholder waiting to be replaced —
 * they are the answer for most people, and a blank disc reads as a failed image
 * load rather than as a picture that does not exist.
 */
@Composable
private fun IdentityHeader(user: SessionUser?, onOpenIdCard: () -> Unit) {
    val name = remember(user) {
        val full = listOfNotNull(user?.firstName, user?.lastName)
            .joinToString(" ") { it.trim() }
            .trim()
        full.ifBlank { user?.email?.substringBefore('@').orEmpty() }
    }

    AppCard(
        onClick = onOpenIdCard,
        contentDescription = stringResource(R.string.me_open_id_card_content_description, name),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Avatar(name = name, imageUrl = user?.avatarUrl, size = 56.dp)

            Spacer(Modifier.width(Theme.spacing.md))

            Column(Modifier.weight(1f)) {
                AppText(
                    name.ifBlank { stringResource(R.string.me_signed_in_fallback) },
                    size = Theme.type.title3,
                    lineHeight = Theme.type.title3Line,
                    weight = FontWeight.SemiBold,
                    heading = true,
                )
                user?.email?.takeIf { it.isNotBlank() }?.let {
                    AppText(
                        it,
                        size = Theme.type.footnote,
                        lineHeight = Theme.type.footnoteLine,
                        tone = TextTone.MUTED,
                    )
                }
                user?.role?.takeIf { it.isNotBlank() }?.let {
                    AppText(
                        it.replaceFirstChar { c -> c.uppercase() },
                        size = Theme.type.caption,
                        lineHeight = Theme.type.captionLine,
                        tone = TextTone.MUTED,
                    )
                }
            }
        }
    }
}

/**
 * A scrolling row of section chips.
 *
 * Scrollable rather than evenly divided: five labels shared across a small
 * phone leaves about sixty pixels each, which truncates "Workplace" and
 * "My team" to the point of guesswork. Overflow that can be scrolled is better
 * than a label nobody can read.
 *
 * Each chip is a radio in the accessibility tree, not a button, because these
 * select among alternatives rather than perform actions.
 */
@Composable
private fun SectionTabs(
    sections: List<MeSection>,
    selected: MeSection,
    onSelect: (MeSection) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(Theme.spacing.sm),
    ) {
        sections.forEach { entry ->
            val active = entry == selected
            Box(
                modifier = Modifier
                    .height(MinTouchTarget)
                    .clip(RoundedCornerShape(Theme.radius.pill))
                    .background(if (active) Theme.colors.primary else Theme.colors.surface)
                    .selectable(
                        selected = active,
                        role = Role.RadioButton,
                        onClick = { onSelect(entry) },
                    )
                    .padding(horizontal = Theme.spacing.lg),
                contentAlignment = Alignment.Center,
            ) {
                AppText(
                    meSectionLabel(entry),
                    size = Theme.type.footnote,
                    lineHeight = Theme.type.footnoteLine,
                    weight = if (active) FontWeight.SemiBold else FontWeight.Normal,
                    tone = if (active) TextTone.ON_PRIMARY else TextTone.DEFAULT,
                )
            }
        }
    }
}

/**
 * The tiles in each section.
 *
 * A composable rather than a plain function because the hand-drawn glyphs are
 * resources and need [painterResource].
 */
@Composable
private fun itemsFor(section: MeSection, go: (String) -> Unit): List<FeatureGridItem> = when (section) {
    MeSection.TIME -> listOf(
        FeatureGridItem(
            stringResource(R.string.me_feature_attendance_title),
            stringResource(R.string.me_feature_attendance_subtitle),
            Glyph.Vector(Icons.Filled.History),
            AccentTone.Violet,
        ) { go("attendance") },
        FeatureGridItem(
            stringResource(R.string.me_feature_regularise_title),
            stringResource(R.string.me_feature_regularise_subtitle),
            Glyph.Vector(Icons.Filled.EditCalendar),
            AccentTone.Amber,
        ) { go("attendance/regularise") },
        FeatureGridItem(
            stringResource(R.string.me_feature_work_away_title),
            stringResource(R.string.me_feature_work_away_subtitle),
            Glyph.Drawable(painterResource(R.drawable.ic_action_wfh)),
            AccentTone.Teal,
        ) { go("work-away") },
        FeatureGridItem(
            stringResource(R.string.me_feature_shift_swaps_title),
            stringResource(R.string.me_feature_shift_swaps_subtitle),
            Glyph.Vector(Icons.Filled.SwapHoriz),
            AccentTone.Blue,
        ) { go("swaps") },
        FeatureGridItem(
            stringResource(R.string.me_feature_holidays_title),
            stringResource(R.string.me_feature_holidays_subtitle),
            Glyph.Vector(Icons.Filled.EventAvailable),
            AccentTone.Rose,
        ) { go("holidays") },
    )

    MeSection.MONEY -> listOf(
        FeatureGridItem(
            stringResource(R.string.me_feature_tax_declaration_title),
            stringResource(R.string.me_feature_tax_declaration_subtitle),
            Glyph.Vector(Icons.Filled.AccountBalanceWallet),
            AccentTone.Green,
        ) { go("tax") },
        FeatureGridItem(
            stringResource(R.string.me_feature_form16_title),
            stringResource(R.string.me_feature_form16_subtitle),
            Glyph.Drawable(painterResource(R.drawable.ic_action_payslip)),
            AccentTone.Blue,
        ) { go("tax/form16") },
        FeatureGridItem(
            stringResource(R.string.me_feature_loans_title),
            stringResource(R.string.me_feature_loans_subtitle),
            Glyph.Vector(Icons.Filled.ReceiptLong),
            AccentTone.Plum,
        ) { go("loans") },
        FeatureGridItem(
            stringResource(R.string.me_feature_expenses_title),
            stringResource(R.string.me_feature_expenses_subtitle),
            Glyph.Drawable(painterResource(R.drawable.ic_action_expense)),
            AccentTone.Amber,
        ) { go("expenses") },
        FeatureGridItem(
            stringResource(R.string.me_feature_benefits_title),
            stringResource(R.string.me_feature_benefits_subtitle),
            Glyph.Vector(Icons.Filled.HealthAndSafety),
            AccentTone.Rose,
        ) { go("benefits") },
    )

    MeSection.GROWTH -> listOf(
        FeatureGridItem(
            stringResource(R.string.me_feature_goals_title),
            stringResource(R.string.me_feature_goals_subtitle),
            Glyph.Vector(Icons.Filled.TrackChanges),
            AccentTone.Rose,
        ) { go("goals") },
        FeatureGridItem(
            stringResource(R.string.me_feature_learning_title),
            stringResource(R.string.me_feature_learning_subtitle),
            Glyph.Vector(Icons.Filled.School),
            AccentTone.Violet,
        ) { go("learning") },
        FeatureGridItem(
            stringResource(R.string.me_feature_checkins_title),
            stringResource(R.string.me_feature_checkins_subtitle),
            Glyph.Vector(Icons.Filled.Chat),
            AccentTone.Teal,
        ) { go("check-ins") },
        FeatureGridItem(
            stringResource(R.string.me_feature_referrals_title),
            stringResource(R.string.me_feature_referrals_subtitle),
            Glyph.Vector(Icons.Filled.CardGiftcard),
            AccentTone.Green,
        ) { go("referrals") },
    )

    MeSection.WORKPLACE -> listOf(
        FeatureGridItem(
            stringResource(R.string.me_feature_wall_title),
            stringResource(R.string.me_feature_wall_subtitle),
            Glyph.Vector(Icons.Filled.Forum),
            AccentTone.Plum,
        ) { go("wall") },
        FeatureGridItem(
            stringResource(R.string.me_feature_praise_title),
            stringResource(R.string.me_feature_praise_subtitle),
            Glyph.Vector(Icons.Filled.EmojiEvents),
            AccentTone.Amber,
        ) { go("praise") },
        FeatureGridItem(
            stringResource(R.string.me_feature_directory_title),
            stringResource(R.string.me_feature_directory_subtitle),
            Glyph.Vector(Icons.Filled.PersonSearch),
            AccentTone.Blue,
        ) { go("directory") },
        FeatureGridItem(
            stringResource(R.string.me_feature_announcements_title),
            stringResource(R.string.me_feature_announcements_subtitle),
            Glyph.Vector(Icons.Filled.Campaign),
            AccentTone.Amber,
        ) { go("announcements") },
        FeatureGridItem(
            stringResource(R.string.me_feature_my_details_title),
            stringResource(R.string.me_feature_my_details_subtitle),
            Glyph.Vector(Icons.Filled.ManageAccounts),
            AccentTone.Green,
        ) { go("my-details") },
        FeatureGridItem(
            stringResource(R.string.me_feature_id_card_title),
            stringResource(R.string.me_feature_id_card_subtitle),
            Glyph.Vector(Icons.Filled.Badge),
            AccentTone.Violet,
        ) { go("id-card") },
        FeatureGridItem(
            stringResource(R.string.me_feature_assets_title),
            stringResource(R.string.me_feature_assets_subtitle),
            Glyph.Vector(Icons.Filled.Devices),
            AccentTone.Slate,
        ) { go("assets") },
        FeatureGridItem(
            stringResource(R.string.me_feature_helpdesk_title),
            stringResource(R.string.me_feature_helpdesk_subtitle),
            Glyph.Vector(Icons.Filled.SupportAgent),
            AccentTone.Teal,
        ) { go("helpdesk") },
    )

    MeSection.TEAM -> listOf(
        FeatureGridItem(
            stringResource(R.string.me_feature_my_team_title),
            stringResource(R.string.me_feature_my_team_subtitle),
            Glyph.Vector(Icons.Filled.Groups),
            AccentTone.Teal,
        ) { go("my-team") },
        FeatureGridItem(
            stringResource(R.string.me_feature_approvals_title),
            stringResource(R.string.me_feature_approvals_subtitle),
            Glyph.Vector(Icons.Filled.Inbox),
            AccentTone.Amber,
        ) { go("inbox") },
        FeatureGridItem(
            stringResource(R.string.me_feature_leave_requests_title),
            stringResource(R.string.me_feature_leave_requests_subtitle),
            Glyph.Drawable(painterResource(R.drawable.ic_action_leave)),
            AccentTone.Violet,
        ) { go("approvals") },
    )
}
