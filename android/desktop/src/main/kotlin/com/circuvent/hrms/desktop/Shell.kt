package com.circuvent.hrms.desktop

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountBalanceWallet
import androidx.compose.material.icons.filled.Badge
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.EditCalendar
import androidx.compose.material.icons.filled.EmojiEvents
import androidx.compose.material.icons.filled.EventAvailable
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.ManageAccounts
import androidx.compose.material.icons.filled.PersonSearch
import androidx.compose.material.icons.filled.ReceiptLong
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SupportAgent
import androidx.compose.material.icons.filled.Today
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * The window, once somebody is signed in.
 *
 * A persistent sidebar rather than a five-tab bar. The phone is capped at five
 * because a thumb cannot hit more; a mouse can, and hiding twelve destinations
 * behind a "More" screen on a 1400px window would be copying a constraint that
 * does not exist here.
 *
 * Grouped, because a flat list of fourteen is a menu nobody reads. The
 * groupings are the questions people arrive with: my day, my money, my
 * colleagues, my company.
 */
private data class NavItem(val screen: Screen, val icon: ImageVector)

private val NAV_GROUPS: List<Pair<String, List<NavItem>>> = listOf(
    "My day" to listOf(
        NavItem(Screen.HOME, Icons.Filled.Today),
        NavItem(Screen.LEAVE, Icons.Filled.EventAvailable),
        NavItem(Screen.ATTENDANCE, Icons.Filled.Schedule),
        NavItem(Screen.WORK_AWAY, Icons.Filled.Home),
        NavItem(Screen.CORRECTIONS, Icons.Filled.EditCalendar),
    ),
    "My team" to listOf(
        NavItem(Screen.TEAM, Icons.Filled.Groups),
        NavItem(Screen.INBOX, Icons.Filled.Inbox),
    ),
    "People" to listOf(
        NavItem(Screen.DIRECTORY, Icons.Filled.PersonSearch),
        NavItem(Screen.PRAISE, Icons.Filled.EmojiEvents),
        NavItem(Screen.WALL, Icons.Filled.Forum),
    ),
    "Money" to listOf(
        NavItem(Screen.PAYSLIPS, Icons.Filled.ReceiptLong),
        NavItem(Screen.EXPENSES, Icons.Filled.Badge),
        NavItem(Screen.LOANS, Icons.Filled.AccountBalanceWallet),
    ),
    "Company" to listOf(
        NavItem(Screen.HOLIDAYS, Icons.Filled.CalendarMonth),
        NavItem(Screen.ANNOUNCEMENTS, Icons.Filled.Campaign),
        NavItem(Screen.DOCUMENTS, Icons.Filled.Description),
        NavItem(Screen.HELPDESK, Icons.Filled.SupportAgent),
        NavItem(Screen.MY_DETAILS, Icons.Filled.ManageAccounts),
        NavItem(Screen.SETTINGS, Icons.Filled.Settings),
    ),
)

@Composable
fun Shell(state: AppState) {
    // The sidebar collapses to icons on a narrow window.
    //
    // Not a nicety. A 1280x800 laptop at 200% scaling gives 640x400dp of usable
    // space — less logical room than a large phone — and a fixed 232dp sidebar
    // takes over a third of it, leaving tables squeezed into 400dp. The rail
    // keeps every destination reachable and hands the width back to the content
    // that people actually came to read.
    BoxWithConstraints(Modifier.fillMaxSize().background(Desk.colors.background)) {
        val wide = maxWidth >= 860.dp

        Row(Modifier.fillMaxSize()) {
            Sidebar(state, wide)

            Column(Modifier.fillMaxSize()) {
                TopBar(state)
                Box(
                    Modifier
                        .fillMaxSize()
                        .padding(if (wide) Desk.spacing.xl else Desk.spacing.md)
                ) {
                    when (state.screen) {
                        Screen.HOME -> HomeScreen(state)
                        Screen.LEAVE -> LeaveScreen(state)
                        Screen.ATTENDANCE -> AttendanceScreen(state)
                        Screen.WORK_AWAY -> WorkAwayScreen(state)
                        Screen.CORRECTIONS -> CorrectionsScreen(state)
                        Screen.TEAM -> TeamScreen(state)
                        Screen.INBOX -> InboxScreen(state)
                        Screen.DIRECTORY -> DirectoryScreen(state)
                        Screen.PRAISE -> PraiseScreen(state)
                        Screen.WALL -> WallScreen(state)
                        Screen.MY_DETAILS -> MyDetailsScreen(state)
                        Screen.PAYSLIPS -> PayslipsScreen(state)
                        Screen.EXPENSES -> ExpensesScreen(state)
                        Screen.LOANS -> LoansScreen(state)
                        Screen.HELPDESK -> HelpdeskScreen(state)
                        Screen.HOLIDAYS -> HolidaysScreen(state)
                        Screen.ANNOUNCEMENTS -> AnnouncementsScreen(state)
                        Screen.DOCUMENTS -> DocumentsScreen(state)
                        Screen.SETTINGS -> SettingsScreen(state)
                    }
                }
            }
        }
    }
}

@Composable
private fun Sidebar(state: AppState, wide: Boolean) {
    Column(
        Modifier
            .width(if (wide) 232.dp else 60.dp)
            .fillMaxHeight()
            .background(Desk.colors.sidebar)
            .verticalScroll(rememberScrollState())
            .padding(vertical = Desk.spacing.lg),
        horizontalAlignment = if (wide) Alignment.Start else Alignment.CenterHorizontally,
    ) {
        if (wide) {
            Text(
                "Circuvent HR",
                modifier = Modifier.padding(horizontal = Desk.spacing.lg, vertical = Desk.spacing.sm),
                color = Color.White,
                style = MaterialTheme.typography.titleLarge,
            )
            Spacer(Modifier.height(Desk.spacing.md))
        }

        NAV_GROUPS.forEach { (group, items) ->
            if (wide) {
                Text(
                    group.uppercase(),
                    modifier = Modifier.padding(
                        start = Desk.spacing.lg,
                        top = Desk.spacing.md,
                        bottom = Desk.spacing.xs,
                    ),
                    color = Color.White.copy(alpha = 0.45f),
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.SemiBold,
                )
            } else {
                // A hairline instead of a heading. The grouping still reads,
                // and a truncated word would not.
                Box(
                    Modifier
                        .padding(vertical = Desk.spacing.sm)
                        .width(24.dp)
                        .height(1.dp)
                        .background(Color.White.copy(alpha = 0.18f))
                )
            }

            items.forEach { item ->
                val active = state.screen == item.screen
                Row(
                    Modifier
                        .then(if (wide) Modifier.fillMaxWidth() else Modifier.size(44.dp))
                        .padding(horizontal = if (wide) Desk.spacing.sm else 0.dp, vertical = 1.dp)
                        .clip(RoundedCornerShape(Desk.radius.sm))
                        .background(if (active) Desk.colors.primary else Color.Transparent)
                        .selectable(
                            selected = active,
                            role = Role.Tab,
                            onClick = { state.screen = item.screen },
                        )
                        .padding(
                            horizontal = if (wide) Desk.spacing.md else 0.dp,
                            vertical = if (wide) Desk.spacing.sm else 0.dp,
                        ),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = if (wide) Arrangement.Start else Arrangement.Center,
                ) {
                    Icon(
                        item.icon,
                        // Named even when the label is hidden, or the rail is
                        // twelve identical unlabelled targets to a screen reader.
                        contentDescription = if (wide) null else item.screen.title,
                        tint = if (active) Desk.colors.onPrimary else Color.White.copy(alpha = 0.75f),
                        modifier = Modifier.size(17.dp),
                    )
                    if (wide) {
                        Spacer(Modifier.width(Desk.spacing.md))
                        Text(
                            item.screen.title,
                            color = if (active) Desk.colors.onPrimary else Color.White.copy(alpha = 0.85f),
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
                            maxLines = 1,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun TopBar(state: AppState) {
    val session = state.session

    Column {
        Row(
            Modifier
                .fillMaxWidth()
                .background(Desk.colors.surfaceElevated)
                .padding(horizontal = Desk.spacing.xl, vertical = Desk.spacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                state.screen.title,
                color = Desk.colors.text,
                style = MaterialTheme.typography.headlineMedium,
            )

            Spacer(Modifier.weight(1f))

            if (session != null) {
                Column(horizontalAlignment = Alignment.End) {
                    Text(
                        session.displayName ?: session.email,
                        color = Desk.colors.text,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium,
                    )
                    // The organisation is named because a workstation may be
                    // pointed at a different server to the phone in the same
                    // pocket, and finding that out from the data is too late.
                    Muted(session.orgName ?: state.baseUrl.removePrefix("https://"))
                }
                Spacer(Modifier.width(Desk.spacing.md))
                Initials(session.displayName ?: session.email, 34.dp)
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(Desk.colors.borderSubtle))
    }
}
