package com.circuvent.hrms.feature

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.circuvent.hrms.AppContainer
import com.circuvent.hrms.core.design.Theme
import com.circuvent.hrms.core.ui.AppButton
import com.circuvent.hrms.core.ui.AppCard
import com.circuvent.hrms.core.ui.AppText
import com.circuvent.hrms.core.ui.ButtonVariant
import com.circuvent.hrms.core.ui.Banner
import com.circuvent.hrms.core.ui.BannerTone
import com.circuvent.hrms.core.ui.EmptyState
import com.circuvent.hrms.core.ui.PillTone
import com.circuvent.hrms.core.ui.SectionHeading
import com.circuvent.hrms.core.ui.SkeletonRows
import com.circuvent.hrms.core.ui.StatusPill
import com.circuvent.hrms.core.ui.TextTone
import com.circuvent.hrms.core.ui.screenPadding
import com.circuvent.hrms.data.LeaveBalanceDto
import com.circuvent.hrms.data.LeaveRequestDto
import com.circuvent.hrms.data.PayslipDto
import com.circuvent.hrms.data.ShiftDto
import com.circuvent.hrms.data.net.ApiException
import com.circuvent.hrms.data.net.OfflineException
import com.circuvent.hrms.domain.ShiftRules
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate

/**
 * The load states every list screen shares.
 *
 * Three, not two. `Loading` is distinct from an empty result, and keeping them
 * apart at the type level is what stops a screen saying "you have no leave"
 * before it has asked. The previous generation of this app shipped exactly
 * that: its leave list had no loading flag, so its first render reached the
 * empty branch and told people they had never applied.
 */
sealed interface Loaded<out T> {
    data object Loading : Loaded<Nothing>
    data class Ready<T>(val value: T) : Loaded<T>
    data class Failed(val title: String, val description: String?) : Loaded<Nothing>
}

/** Turns the two exceptions the client throws into something a person reads. */
internal fun failureOf(subject: String, error: Throwable): Loaded.Failed = when (error) {
    is OfflineException -> Loaded.Failed(
        "You are offline",
        "$subject is not stored on this device. Pull down when you have a connection.",
    )
    is ApiException -> Loaded.Failed("$subject could not be loaded", error.message)
    else -> Loaded.Failed("$subject could not be loaded", null)
}

@Composable
private fun <T> LoadedContent(
    state: Loaded<T>,
    skeletonRows: Int = 4,
    content: @Composable (T) -> Unit,
) {
    when (state) {
        is Loaded.Loading -> SkeletonRows(count = skeletonRows)
        is Loaded.Failed -> Banner(BannerTone.ERROR, state.title, description = state.description)
        is Loaded.Ready -> content(state.value)
    }
}

// ─── Leave ───────────────────────────────────────────────────

@Composable
fun LeaveScreen(container: AppContainer, onApply: () -> Unit, onOpen: (String) -> Unit) {
    var state by remember { mutableStateOf<Loaded<Pair<List<LeaveRequestDto>, List<LeaveBalanceDto>>>>(Loaded.Loading) }

    LaunchedEffect(Unit) {
        state = try {
            // Both at once. Sequential requests double the time somebody
            // stares at a spinner on a mobile connection, and neither depends
            // on the other.
            Loaded.Ready(container.repository.leaveRequests() to container.repository.leaveBalances())
        } catch (e: Throwable) {
            failureOf("Your leave", e)
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = screenPadding(bottomExtra = TabBarHeight),
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm),
    ) {
        item {
            AppButton(
                label = "Apply for leave",
                onClick = onApply,
                contentDescription = "Opens the leave request form",
            )
        }

        item {
            LoadedContent(state) { (requests, balances) ->
                Column(verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm)) {
                    if (balances.isNotEmpty()) {
                        SectionHeading("Your balance")
                        balances.forEach { balance ->
                            AppCard(
                                contentDescription = "${balance.leaveType}: " +
                                    "${balance.available.toInt()} of ${balance.entitled.toInt()} days available",
                            ) {
                                Row(
                                    Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    AppText(
                                        balance.leaveType.replaceFirstChar { it.uppercase() },
                                        weight = FontWeight.Medium,
                                    )
                                    AppText(
                                        "${balance.available.toInt()} of ${balance.entitled.toInt()} days",
                                        tone = TextTone.MUTED,
                                        size = Theme.type.footnote,
                                        lineHeight = Theme.type.footnoteLine,
                                    )
                                }
                            }
                        }
                    }

                    SectionHeading("Your requests")

                    if (requests.isEmpty()) {
                        EmptyState(
                            title = "No leave requests yet",
                            description = "Anything you apply for appears here, with where it has got to in the approval chain.",
                            action = { AppButton("Apply for leave", onApply, fullWidth = false) },
                        )
                    }
                }
            }
        }

        (state as? Loaded.Ready)?.value?.first?.let { requests ->
            items(requests, key = { it.id }) { request -> LeaveRow(request, onOpen) }
        }
    }
}

@Composable
private fun LeaveRow(request: LeaveRequestDto, onOpen: (String) -> Unit) {
    val tone = when (request.status) {
        "approved" -> PillTone.SUCCESS
        "rejected" -> PillTone.DANGER
        "pending" -> PillTone.WARNING
        else -> PillTone.NEUTRAL
    }

    AppCard(
        onClick = { onOpen(request.id) },
        contentDescription = "${request.leaveType} leave, ${request.startDate} to ${request.endDate}, ${request.status}",
    ) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AppText(request.leaveType.replaceFirstChar { it.uppercase() }, weight = FontWeight.Medium)
            // Status is a word as well as a colour. "Approved" and "Rejected"
            // are exactly the pair people confuse, and red-green is the common
            // colour vision deficiency.
            StatusPill(request.status.replaceFirstChar { it.uppercase() }, tone)
        }
        AppText(
            "${request.startDate} – ${request.endDate} · " +
                if (request.isHalfDay) "half day" else "${request.totalDays.toInt()} days",
            size = Theme.type.footnote,
            lineHeight = Theme.type.footnoteLine,
            tone = TextTone.MUTED,
        )
    }
}

// ─── Shifts ──────────────────────────────────────────────────

@Composable
fun ShiftsScreen(container: AppContainer) {
    var state by remember { mutableStateOf<Loaded<List<ShiftDto>>>(Loaded.Loading) }
    var offering by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<Pair<BannerTone, String>?>(null) }
    val today = remember { LocalDate.now() }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        state = try {
            Loaded.Ready(
                container.repository.myShifts(today.toString(), today.plusDays(28).toString())
            )
        } catch (e: Throwable) {
            failureOf("Your shifts", e)
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = screenPadding(bottomExtra = TabBarHeight),
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm),
    ) {
        notice?.let { (tone, text) -> item { Banner(tone, text) } }

        item {
            LoadedContent(state, skeletonRows = 4) { shifts ->
                if (shifts.isEmpty()) {
                    EmptyState(
                        title = "No shifts scheduled",
                        description = "Nothing has been published for you in the next four weeks. Published rosters appear here as soon as your manager releases them.",
                    )
                } else {
                    val rules = shifts.map { it.toRule() }
                    ShiftRules.next(rules, Instant.now())?.let { upcoming ->
                        NextShiftCard(upcoming, today)
                    }
                }
            }
        }

        (state as? Loaded.Ready)?.value?.let { shifts ->
            items(shifts, key = { it.id }) { shift ->
                ShiftRow(
                    shift = shift.toRule(),
                    offering = offering == shift.id,
                    onOffer = {
                        offering = shift.id
                        notice = null
                        scope.launch {
                            try {
                                container.repository.requestSwap(shift.id, null)
                                notice = BannerTone.SUCCESS to
                                    "Offered. Somebody on your team can now take it, and your manager decides."
                            } catch (e: Exception) {
                                notice = BannerTone.ERROR to
                                    (e.message ?: "That shift could not be offered.")
                            } finally {
                                offering = null
                            }
                        }
                    },
                )
            }
        }
    }
}

private fun ShiftDto.toRule() = ShiftRules.Shift(
    id = id,
    shiftDate = shiftDate,
    startsAt = startsAt,
    endsAt = endsAt,
    durationMinutes = durationMinutes,
    status = status,
    patternName = patternName,
    note = note,
)

@Composable
private fun NextShiftCard(shift: ShiftRules.Shift, today: LocalDate) {
    val running = ShiftRules.stateOf(shift, Instant.now()) == ShiftRules.State.IN_PROGRESS
    val overnight = ShiftRules.isOvernight(shift)
    val when_ = "${ShiftRules.dayLabel(shift.shiftDate, today)}, " +
        "${ShiftRules.formatClock(shift.startsAt)} to ${ShiftRules.formatClock(shift.endsAt)}"

    AppCard(
        highlighted = true,
        contentDescription = "${if (running) "On shift now" else "Next shift"}: $when_",
    ) {
        AppText(
            if (running) "ON SHIFT NOW" else "NEXT SHIFT",
            size = Theme.type.caption,
            lineHeight = Theme.type.captionLine,
            weight = FontWeight.SemiBold,
            tone = TextTone.PRIMARY,
        )
        AppText(
            shift.patternName ?: "Shift",
            size = Theme.type.title3,
            lineHeight = Theme.type.title3Line,
            weight = FontWeight.Bold,
        )
        AppText(when_, tone = TextTone.MUTED)
        AppText(
            ShiftRules.formatDuration(shift.durationMinutes) +
                if (overnight) " · finishes the next day" else "",
            size = Theme.type.footnote,
            lineHeight = Theme.type.footnoteLine,
            tone = TextTone.MUTED,
        )
    }
}

@Composable
private fun ShiftRow(shift: ShiftRules.Shift, offering: Boolean = false, onOffer: (() -> Unit)? = null) {
    val state = ShiftRules.stateOf(shift, Instant.now())
    val times = "${ShiftRules.formatClock(shift.startsAt)} – ${ShiftRules.formatClock(shift.endsAt)}"
    val name = shift.patternName ?: "Shift"

    AppCard(
        muted = state == ShiftRules.State.PAST,
        contentDescription = "$name, $times, ${ShiftRules.formatDuration(shift.durationMinutes)}",
    ) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                AppText(name, weight = FontWeight.Medium)
                AppText(
                    "$times · ${ShiftRules.formatDuration(shift.durationMinutes)}",
                    size = Theme.type.footnote,
                    lineHeight = Theme.type.footnoteLine,
                    tone = TextTone.MUTED,
                )
            }
            // The state in words. A past shift dimmed only by opacity is
            // indistinguishable from a disabled one.
            when (state) {
                ShiftRules.State.IN_PROGRESS -> StatusPill("Now", PillTone.SUCCESS)
                ShiftRules.State.PAST -> StatusPill("Finished", PillTone.NEUTRAL)
                ShiftRules.State.UPCOMING ->
                    if (ShiftRules.isOvernight(shift)) StatusPill("Overnight", PillTone.INFO)
            }
        }

        // Only on a shift that has not started. Offering one already being
        // worked, or already finished, is a request nobody can act on.
        if (onOffer != null && state == ShiftRules.State.UPCOMING) {
            AppButton(
                label = "Offer this shift",
                variant = ButtonVariant.GHOST,
                fullWidth = false,
                busy = offering,
                onClick = onOffer,
                contentDescription = "Offer $name on ${shift.shiftDate} to a colleague",
            )
        }
    }
}

// ─── Payslips ────────────────────────────────────────────────

@Composable
fun PayslipsScreen(container: AppContainer, onOpen: (String) -> Unit) {
    var state by remember { mutableStateOf<Loaded<List<PayslipDto>>>(Loaded.Loading) }

    LaunchedEffect(Unit) {
        state = try {
            Loaded.Ready(container.repository.payslips())
        } catch (e: Throwable) {
            failureOf("Your payslips", e)
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = screenPadding(bottomExtra = TabBarHeight),
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm),
    ) {
        item {
            LoadedContent(state, skeletonRows = 5) { payslips ->
                if (payslips.isEmpty()) {
                    EmptyState(
                        title = "No payslips yet",
                        description = "A payslip appears here once the payroll run covering it has been approved. Runs still being corrected are not shown.",
                    )
                }
            }
        }

        (state as? Loaded.Ready)?.value?.let { payslips ->
            items(payslips, key = { it.id }) { payslip -> PayslipRow(payslip, onOpen) }
        }
    }
}

@Composable
private fun PayslipRow(payslip: PayslipDto, onOpen: (String) -> Unit) {
    // No arithmetic. The amounts arrive already converted from the bigint minor
    // units they are stored in; adding them up on a phone would reintroduce
    // exactly the float error the bigint exists to prevent.
    val period = if (payslip.periodMonth != null && payslip.periodYear != null) {
        java.time.YearMonth.of(payslip.periodYear, payslip.periodMonth)
            .format(java.time.format.DateTimeFormatter.ofPattern("LLLL yyyy"))
    } else {
        "Payslip"
    }
    val amount = "₹%,.2f".format(payslip.netPay)

    AppCard(onClick = { onOpen(payslip.id) }, contentDescription = "$period, net pay $amount") {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AppText(period, weight = FontWeight.Medium)
            AppText(
                amount,
                size = Theme.type.callout,
                lineHeight = Theme.type.calloutLine,
                weight = FontWeight.SemiBold,
            )
        }
        AppText(
            "Net pay" + if (payslip.lopDays > 0) " · ${payslip.lopDays.toInt()} days loss of pay" else "",
            size = Theme.type.footnote,
            lineHeight = Theme.type.footnoteLine,
            tone = TextTone.MUTED,
        )
    }
}

// ─── Profile ─────────────────────────────────────────────────

/**
 * Profile.
 *
 * The fifth tab, and the hub for everything that is neither a daily action nor
 * one of the four things that earned a tab. Grouped by the question somebody is
 * asking rather than by which service answers it — "my record" and "my team"
 * mean something to an employee; "workflow engine" does not.
 */
@Composable
fun ProfileScreen(
    viewModel: AppViewModel,
    user: com.circuvent.hrms.data.SessionUser?,
    onNavigate: (String) -> Unit,
) {
    val pending by viewModel.pending.collectAsState()
    val canApprove = user?.role in setOf("owner", "admin", "hr", "manager")

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = screenPadding(bottomExtra = TabBarHeight),
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm),
    ) {
        item {
            AppCard {
                AppText(
                    if (user != null) "${user.firstName} ${user.lastName}".trim() else "Signed in",
                    size = Theme.type.title3,
                    lineHeight = Theme.type.title3Line,
                    weight = FontWeight.SemiBold,
                    heading = true,
                )
                AppText(
                    user?.email ?: "",
                    tone = TextTone.MUTED,
                    size = Theme.type.footnote,
                    lineHeight = Theme.type.footnoteLine,
                )
                if (user != null) {
                    AppText(
                        user.role.replaceFirstChar { it.uppercase() },
                        tone = TextTone.MUTED,
                        size = Theme.type.caption,
                        lineHeight = Theme.type.captionLine,
                    )
                }
            }
        }

        if (pending > 0) {
            item {
                Banner(
                    tone = BannerTone.INFO,
                    title = if (pending == 1) "1 action waiting to be sent" else "$pending actions waiting to be sent",
                    description = "They are saved on this device and will be sent when you have a connection.",
                )
            }
        }

        item { ProfileSectionHeading("Your record") }
        item { ProfileLink("Attendance history", "Your punches, month by month") { onNavigate("attendance") } }
        item {
            ProfileLink(
                "Correct attendance",
                "A missed punch, or a day the reader did not record",
            ) { onNavigate("attendance/regularise") }
        }
        item { ProfileLink("My equipment", "Laptops and other assets issued to you") { onNavigate("assets") } }
        item { ProfileLink("Benefits", "Your cover, the plans on offer, and dependants") { onNavigate("benefits") } }
        item { ProfileLink("Check-ins", "Notes and agreed actions from your one-to-ones") { onNavigate("check-ins") } }

        // Money the employee can act on, kept apart from the payslips tab:
        // a payslip is a record of what happened, a declaration changes what
        // happens next month.
        item { ProfileSectionHeading("Tax") }
        item {
            ProfileLink(
                "Tax declaration",
                "Declare your investments so less tax is deducted each month",
            ) { onNavigate("tax") }
        }
        item {
            ProfileLink("Form 16", "Your annual TDS certificate") { onNavigate("tax/form16") }
        }

        item { ProfileSectionHeading("Grow") }
        item { ProfileLink("Learning", "Courses assigned to you, and what you can start") { onNavigate("learning") } }
        item { ProfileLink("Referrals", "Put someone forward, and follow how they get on") { onNavigate("referrals") } }

        item { ProfileSectionHeading("Work") }
        item { ProfileLink("Shift swaps", "Offer a shift, or take one offered to you") { onNavigate("swaps") } }
        item { ProfileLink("Helpdesk", "Raise a ticket with HR or IT, and track it") { onNavigate("helpdesk") } }

        // Shown only to roles the server will accept. A row that always returns
        // 403 reads as a broken app rather than as a boundary.
        if (canApprove) {
            item { ProfileSectionHeading("Your team") }
            item { ProfileLink("Approvals inbox", "Anything routed to you for a decision") { onNavigate("inbox") } }
            item { ProfileLink("Leave approvals", "Leave requests waiting on you") { onNavigate("approvals") } }
        }

        item { ProfileSectionHeading("This device") }
        item { ProfileLink("Settings", "Biometric unlock and sign out") { onNavigate("settings") } }
    }
}

@Composable
private fun ProfileSectionHeading(text: String) {
    AppText(
        text,
        size = Theme.type.footnote,
        lineHeight = Theme.type.footnoteLine,
        weight = FontWeight.SemiBold,
        tone = TextTone.MUTED,
        heading = true,
        modifier = Modifier.padding(top = Theme.spacing.lg),
    )
}

@Composable
private fun ProfileLink(label: String, description: String, onClick: () -> Unit) {
    AppCard(
        onClick = onClick,
        contentDescription = "$label. $description",
    ) {
        AppText(label, weight = FontWeight.Medium)
        AppText(
            description,
            size = Theme.type.caption,
            lineHeight = Theme.type.captionLine,
            tone = TextTone.MUTED,
        )
    }
}
