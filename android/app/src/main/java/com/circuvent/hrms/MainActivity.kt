package com.circuvent.hrms

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.circuvent.hrms.core.design.CircuventTheme
import com.circuvent.hrms.core.design.Theme
import com.circuvent.hrms.core.ui.AppText
import com.circuvent.hrms.feature.ApprovalsScreen
import com.circuvent.hrms.feature.AssetsScreen
import com.circuvent.hrms.feature.BenefitsScreen
import com.circuvent.hrms.feature.CheckInsScreen
import com.circuvent.hrms.feature.CourseDetailScreen
import com.circuvent.hrms.feature.Form16Screen
import com.circuvent.hrms.feature.LearningScreen
import com.circuvent.hrms.feature.AnnouncementsScreen
import com.circuvent.hrms.feature.DirectoryScreen
import com.circuvent.hrms.feature.ExpensesScreen
import com.circuvent.hrms.feature.HolidaysScreen
import com.circuvent.hrms.feature.IdCardScreen
import com.circuvent.hrms.feature.LoansScreen
import com.circuvent.hrms.feature.MyTeamScreen
import com.circuvent.hrms.feature.ReferScreen
import com.circuvent.hrms.feature.ReferralsScreen
import com.circuvent.hrms.feature.SwapsScreen
import com.circuvent.hrms.feature.WorkflowInboxScreen
import com.circuvent.hrms.feature.AppViewModel
import com.circuvent.hrms.feature.AttendanceScreen
import com.circuvent.hrms.feature.Destination
import com.circuvent.hrms.feature.HelpdeskScreen
import com.circuvent.hrms.feature.LeaveApplyScreen
import com.circuvent.hrms.feature.LeaveDetailScreen
import com.circuvent.hrms.feature.LeaveScreen
import com.circuvent.hrms.feature.NewTicketScreen
import com.circuvent.hrms.feature.PayslipDetailScreen
import com.circuvent.hrms.feature.PayslipsScreen
import com.circuvent.hrms.feature.ProfileScreen
import com.circuvent.hrms.feature.RegularisationScreen
import com.circuvent.hrms.feature.SessionState
import com.circuvent.hrms.feature.SettingsScreen
import com.circuvent.hrms.feature.ShiftsScreen
import com.circuvent.hrms.feature.SignInScreen
import com.circuvent.hrms.feature.TaxDeclarationScreen
import com.circuvent.hrms.feature.TabBar
import com.circuvent.hrms.feature.TicketDetailScreen
import com.circuvent.hrms.feature.TodayScreen

/**
 * A FragmentActivity, not a ComponentActivity.
 *
 * `BiometricPrompt` needs one — it hosts an invisible fragment to survive
 * configuration changes while the prompt is up. This is the only reason.
 */
class MainActivity : FragmentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        // Before setContent, so the first composition already knows the window
        // draws behind the system bars. Called afterwards it produces one frame
        // with the old insets and a visible jump.
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        val container = AppContainer(applicationContext)

        setContent {
            CircuventTheme {
                val viewModel: AppViewModel = viewModel(
                    factory = object : ViewModelProvider.Factory {
                        @Suppress("UNCHECKED_CAST")
                        override fun <T : ViewModel> create(modelClass: Class<T>): T =
                            AppViewModel(container) as T
                    }
                )
                AppRoot(container, viewModel)
            }
        }
    }
}

/** Routes that are pushed over a tab rather than being one. */
private object Routes {
    const val LEAVE_APPLY = "leave/apply"
    const val LEAVE_DETAIL = "leave/{id}"
    const val PAYSLIP_DETAIL = "payslips/{id}"
    const val ATTENDANCE = "attendance"
    const val APPROVALS = "approvals"
    const val SETTINGS = "settings"
    const val HELPDESK = "helpdesk"
    const val HELPDESK_NEW = "helpdesk/new"
    const val HELPDESK_DETAIL = "helpdesk/{id}"
    const val LEARNING = "learning"
    const val COURSE_DETAIL = "learning/{id}"
    const val BENEFITS = "benefits"
    const val ASSETS = "assets"
    const val REFERRALS = "referrals"
    const val REFER = "referrals/new"
    const val CHECKINS = "check-ins"
    const val INBOX = "inbox"
    const val SWAPS = "swaps"
    const val TAX = "tax"
    const val FORM16 = "tax/form16"
    const val REGULARISATION = "attendance/regularise"
    const val LOANS = "loans"
    const val DIRECTORY = "directory"
    const val ANNOUNCEMENTS = "announcements"
    const val HOLIDAYS = "holidays"
    const val EXPENSES = "expenses"
    const val ID_CARD = "id-card"
    const val MY_TEAM = "my-team"

    /** Titles for the pushed screens; the tabs take theirs from Destination. */
    val titles = mapOf(
        LEAVE_APPLY to "Apply for leave",
        LEAVE_DETAIL to "Leave request",
        PAYSLIP_DETAIL to "Payslip",
        ATTENDANCE to "Attendance",
        APPROVALS to "Leave approvals",
        SETTINGS to "Settings",
        HELPDESK to "Helpdesk",
        HELPDESK_NEW to "Raise a ticket",
        HELPDESK_DETAIL to "Ticket",
        LEARNING to "Learning",
        COURSE_DETAIL to "Course",
        BENEFITS to "Benefits",
        ASSETS to "My equipment",
        REFERRALS to "Referrals",
        REFER to "Refer someone",
        CHECKINS to "Check-ins",
        INBOX to "Approvals inbox",
        SWAPS to "Shift swaps",
        TAX to "Tax declaration",
        FORM16 to "Form 16",
        REGULARISATION to "Correct attendance",
        LOANS to "Loans and advances",
        DIRECTORY to "Directory",
        ANNOUNCEMENTS to "Announcements",
        HOLIDAYS to "Holidays",
        EXPENSES to "Expenses",
        ID_CARD to "Identity card",
        MY_TEAM to "My team",
    )
}

@Composable
private fun AppRoot(container: AppContainer, viewModel: AppViewModel) {
    val session by viewModel.session.collectAsState()

    Box(
        Modifier
            .fillMaxSize()
            .background(Theme.colors.background)
    ) {
        when (val state = session) {
            // A real state, not a shade of signed-out. On a cold start the
            // answer is unknown until the keystore has been read; showing
            // sign-in here would flash it on every launch.
            SessionState.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Theme.colors.primary)
            }

            SessionState.SignedOut -> SignInScreen(viewModel)

            is SessionState.SignedIn -> SignedInApp(container, viewModel, state)
        }
    }
}

@Composable
private fun SignedInApp(
    container: AppContainer,
    viewModel: AppViewModel,
    state: SessionState.SignedIn,
) {
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route

    val tabRoutes = Destination.entries.map { it.route }.toSet()
    val onTab = route in tabRoutes

    val title = when {
        route == null -> ""
        onTab -> Destination.entries.first { it.route == route }
            .let { if (it == Destination.PAY) "Payslips" else it.label }
        else -> Routes.titles[route] ?: ""
    }

    Column(Modifier.fillMaxSize()) {
        Column(
            Modifier
                .weight(1f)
                .statusBarsPadding()
        ) {
            ScreenHeader(
                title = title,
                // Back only where there is somewhere to go. A back arrow on a
                // tab root either does nothing or leaves the app, and both are
                // worse than not offering it.
                onBack = if (onTab) null else ({ nav.popBackStack() }),
            )

            Box(Modifier.weight(1f)) {
                NavHost(navController = nav, startDestination = Destination.TODAY.route) {
                    composable(Destination.TODAY.route) {
                        TodayScreen(container, viewModel, state.user)
                    }
                    composable(Destination.LEAVE.route) {
                        LeaveScreen(
                            container = container,
                            onApply = { nav.navigate(Routes.LEAVE_APPLY) },
                            onOpen = { id -> nav.navigate("leave/$id") },
                        )
                    }
                    composable(Destination.SHIFTS.route) { ShiftsScreen(container) }
                    composable(Destination.PAY.route) {
                        PayslipsScreen(container) { id -> nav.navigate("payslips/$id") }
                    }
                    composable(Destination.PROFILE.route) {
                        ProfileScreen(
                            viewModel = viewModel,
                            user = state.user,
                            onNavigate = { route -> nav.navigate(route) },
                        )
                    }

                    composable(Routes.LEAVE_APPLY) {
                        LeaveApplyScreen(container, viewModel) { nav.popBackStack() }
                    }
                    composable(Routes.LEAVE_DETAIL) { backStack ->
                        LeaveDetailScreen(container, backStack.arguments?.getString("id").orEmpty())
                    }
                    composable(Routes.PAYSLIP_DETAIL) { backStack ->
                        PayslipDetailScreen(container, backStack.arguments?.getString("id").orEmpty())
                    }
                    composable(Routes.ATTENDANCE) { AttendanceScreen(container, state.user) }
                    composable(Routes.TAX) {
                        TaxDeclarationScreen(container) { nav.navigate(Routes.FORM16) }
                    }
                    composable(Routes.FORM16) { Form16Screen(container) }
                    composable(Routes.REGULARISATION) { RegularisationScreen(container) }
                    composable(Routes.LOANS) { LoansScreen(container) }
                    composable(Routes.DIRECTORY) { DirectoryScreen(container) }
                    composable(Routes.ANNOUNCEMENTS) { AnnouncementsScreen(container) }
                    composable(Routes.HOLIDAYS) { HolidaysScreen(container) }
                    composable(Routes.EXPENSES) { ExpensesScreen(container) }
                    composable(Routes.ID_CARD) { IdCardScreen(state.user) }
                    composable(Routes.MY_TEAM) { MyTeamScreen(container) }
                    composable(Routes.APPROVALS) { ApprovalsScreen(container, state.user) }
                    composable(Routes.SETTINGS) { SettingsScreen(container, viewModel, state.user) }
                    composable(Routes.HELPDESK) {
                        HelpdeskScreen(
                            container = container,
                            onOpenTicket = { id -> nav.navigate("helpdesk/$id") },
                            onRaise = { nav.navigate(Routes.HELPDESK_NEW) },
                        )
                    }
                    composable(Routes.HELPDESK_NEW) {
                        NewTicketScreen(
                            container = container,
                            onRaised = { id ->
                                // Replaced, not pushed, so Back from the ticket
                                // returns to the list rather than to a form
                                // that has already been submitted.
                                nav.popBackStack()
                                nav.navigate("helpdesk/$id")
                            },
                            onCancel = { nav.popBackStack() },
                        )
                    }
                    composable(Routes.HELPDESK_DETAIL) { backStack ->
                        TicketDetailScreen(
                            container,
                            backStack.arguments?.getString("id").orEmpty(),
                            state.user,
                        )
                    }

                    composable(Routes.LEARNING) {
                        LearningScreen(container) { id -> nav.navigate("learning/$id") }
                    }
                    composable(Routes.COURSE_DETAIL) { backStack ->
                        CourseDetailScreen(container, backStack.arguments?.getString("id").orEmpty())
                    }
                    composable(Routes.BENEFITS) { BenefitsScreen(container) }
                    composable(Routes.ASSETS) { AssetsScreen(container) }
                    composable(Routes.REFERRALS) {
                        ReferralsScreen(container) { nav.navigate(Routes.REFER) }
                    }
                    composable(Routes.REFER) {
                        ReferScreen(container) { nav.popBackStack() }
                    }
                    composable(Routes.CHECKINS) { CheckInsScreen(container) }
                    composable(Routes.INBOX) { WorkflowInboxScreen(container) }
                    composable(Routes.SWAPS) { SwapsScreen(container, state.user) }
                }
            }
        }

        // Only on the five roots. A tab bar under a half-finished form is an
        // invitation to leave it.
        if (onTab) {
            TabBar(current = route.orEmpty(), onSelect = { destination ->
                nav.navigate(destination.route) {
                    popUpTo(Destination.TODAY.route) { saveState = true }
                    launchSingleTop = true
                    restoreState = true
                }
            })
        }
    }
}

@Composable
private fun ScreenHeader(title: String, onBack: (() -> Unit)?) {
    androidx.compose.foundation.layout.Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(
                start = if (onBack == null) Theme.spacing.lg else Theme.spacing.xs,
                end = Theme.spacing.lg,
                top = Theme.spacing.md,
            ),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (onBack != null) {
            IconButton(onClick = onBack) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Go back",
                    tint = Theme.colors.text,
                )
            }
        }
        AppText(
            title,
            size = Theme.type.title2,
            lineHeight = Theme.type.title2Line,
            weight = FontWeight.Bold,
            heading = true,
            maxLines = 1,
        )
    }
}
