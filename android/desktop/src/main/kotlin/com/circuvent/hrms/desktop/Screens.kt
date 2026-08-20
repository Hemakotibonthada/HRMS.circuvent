package com.circuvent.hrms.desktop

import androidx.compose.foundation.background
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.circuvent.hrms.shared.api.HrmsApi
import com.circuvent.hrms.shared.model.AttendanceRecord
import com.circuvent.hrms.shared.model.ClockState
import com.circuvent.hrms.shared.model.LeaveBalance
import com.circuvent.hrms.shared.model.LeaveRequest
import com.circuvent.hrms.shared.model.TeamAttendance
import com.circuvent.hrms.shared.model.WorkArrangementRequest
import com.circuvent.hrms.shared.model.RegularisationRequest
import kotlinx.coroutines.launch

/**
 * One place that turns a load into something on screen.
 *
 * Without this every screen writes the same `when`, and they drift: one shows a
 * spinner forever on failure, another shows an empty list, and a reader cannot
 * tell "nothing here" from "this did not load".
 */
@Composable
fun <T> Loaded(load: Load<T>, content: @Composable (T) -> Unit) {
    when (load) {
        is Load.Loading -> Box(
            Modifier.fillMaxWidth().padding(Desk.spacing.xxl),
            contentAlignment = Alignment.Center,
        ) {
            CircularProgressIndicator(Modifier.width(28.dp), color = Desk.colors.primary)
        }

        is Load.Failed -> ErrorBanner(load.message)
        is Load.Ready -> content(load.value)
    }
}

@Composable
private fun Scroller(content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(Desk.spacing.lg),
        content = content,
    )
}

private fun titleCase(value: String): String =
    value.replace('_', ' ').replaceFirstChar { it.uppercase() }

private fun statusTone(status: String): PillTone = when (status.lowercase()) {
    "approved", "present", "paid", "resolved", "active" -> PillTone.SUCCESS
    "pending", "submitted", "open", "in_progress" -> PillTone.WARNING
    "rejected", "absent", "cancelled", "failed" -> PillTone.DANGER
    else -> PillTone.NEUTRAL
}

// ═══════════════════════════════════════════════════════════════
// TODAY
// ═══════════════════════════════════════════════════════════════

@Composable
fun HomeScreen(state: AppState) {
    var clock by remember { mutableStateOf<Load<ClockState>>(Load.Loading) }
    var balances by remember { mutableStateOf<Load<List<LeaveBalance>>>(Load.Loading) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }

    val scope = rememberCoroutineScope()

    suspend fun refresh() {
        clock = state.api.clockState().toLoad()
        balances = state.api.leaveBalances().toLoad()
    }

    LaunchedEffect(Unit) { refresh() }

    Scroller {
        message?.let { ErrorBanner(it) }

        Loaded(clock) { value ->
            val record = value.record
            val inAt = record?.checkInAt
            val outAt = record?.checkOutAt

            DeskCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            when {
                                inAt != null && outAt != null -> "Your day is closed"
                                inAt != null -> "You are clocked in"
                                else -> "You have not clocked in"
                            },
                            style = MaterialTheme.typography.titleLarge,
                            color = Desk.colors.text,
                        )
                        Muted(
                            listOfNotNull(
                                inAt?.let { "In ${clockPart(it)}" },
                                outAt?.let { "Out ${clockPart(it)}" },
                            ).joinToString(" · ").ifBlank { "No punch recorded today" },
                            Modifier.padding(top = Desk.spacing.xs),
                        )
                    }

                    // A desktop punch carries no coordinates. The geofence is a
                    // phone question — a workstation is already at the desk it
                    // is bolted to, and inventing a location here would put a
                    // fabricated position into an attendance record.
                    DeskButtonView(
                        label = if (inAt == null) "Clock in" else "Clock out",
                        onClick = {
                            busy = true
                            message = null
                            scope.launch {
                                val result = state.api.punch(
                                    kind = if (inAt == null) "in" else "out",
                                    latitude = null,
                                    longitude = null,
                                    accuracy = null,
                                )
                                when (result) {
                                    is HrmsApi.Result.Ok -> refresh()
                                    is HrmsApi.Result.Failed -> message = result.message
                                    is HrmsApi.Result.Offline -> message = result.message
                                    HrmsApi.Result.Unauthorised -> message = "Sign in again."
                                }
                                busy = false
                            }
                        },
                        enabled = !busy && !(inAt != null && outAt != null),
                        busy = busy,
                    )
                }
            }
        }

        SectionTitle("Your leave")

        Loaded(balances) { list ->
            if (list.isEmpty()) {
                EmptyState("No leave types yet", "HR has not set up leave balances for you.")
            } else {
                DeskCard {
                    TableHeader(
                        "Type" to 2f, "Entitled" to 1f, "Taken" to 1f,
                        "Pending" to 1f, "Left" to 1f,
                    )
                    list.forEach { b ->
                        val entitled = b.openingDays + b.accruedDays + b.carryForwardDays
                        TableRow {
                            Cell(titleCase(b.leaveType), 2f, bold = true)
                            Cell(days(entitled), 1f)
                            Cell(days(b.usedDays), 1f)
                            Cell(days(b.pendingDays), 1f)
                            Cell(days(entitled - b.usedDays - b.pendingDays), 1f)
                        }
                    }
                }
            }
        }
    }
}

private fun days(value: Double): String =
    if (value == value.toLong().toDouble()) value.toLong().toString() else "%.1f".format(value)

/** `HH:mm` out of an ISO instant's *local* rendering, or the raw value. */
private fun clockPart(iso: String): String =
    runCatching {
        java.time.Instant.parse(iso)
            .atZone(java.time.ZoneId.systemDefault())
            .toLocalTime()
            .toString()
            .take(5)
    }.getOrElse { if (iso.length >= 16) iso.substring(11, 16) else iso }

// ═══════════════════════════════════════════════════════════════
// LEAVE
// ═══════════════════════════════════════════════════════════════

@Composable
fun LeaveScreen(state: AppState) {
    var requests by remember { mutableStateOf<Load<List<LeaveRequest>>>(Load.Loading) }
    var applying by remember { mutableStateOf(false) }
    var type by remember { mutableStateOf("casual") }
    var from by remember { mutableStateOf("") }
    var to by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val scope = rememberCoroutineScope()

    suspend fun load() {
        requests = state.api.leaveRequests().toLoad().let {
            when (it) {
                is Load.Ready -> Load.Ready(it.value.items)
                is Load.Failed -> it
                Load.Loading -> Load.Loading
            }
        }
    }

    LaunchedEffect(Unit) { load() }

    Scroller {
        error?.let { ErrorBanner(it) }

        if (applying) {
            DeskCard {
                SectionTitle("Apply for leave")
                Spacer(Modifier.height(Desk.spacing.md))

                Row(horizontalArrangement = Arrangement.spacedBy(Desk.spacing.md)) {
                    OutlinedTextField(
                        value = type,
                        onValueChange = { type = it },
                        label = { Text("Type") },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                    )
                    DeskDateField(
                        label = "First day",
                        value = from,
                        onValueChange = {
                            from = it
                            // A range that starts after it ends is not a
                            // choice anybody makes on purpose, and refusing it
                            // after submission wastes the whole form.
                            if (to.isBlank() || to < it) to = it
                        },
                        modifier = Modifier.weight(1f),
                    )
                    DeskDateField(
                        label = "Last day",
                        value = to,
                        onValueChange = { to = it },
                        minDate = runCatching { java.time.LocalDate.parse(from) }.getOrNull(),
                        modifier = Modifier.weight(1f),
                    )
                }

                OutlinedTextField(
                    value = reason,
                    onValueChange = { reason = it },
                    label = { Text("Reason") },
                    modifier = Modifier.fillMaxWidth().padding(top = Desk.spacing.md),
                )

                Spacer(Modifier.height(Desk.spacing.md))

                Row(horizontalArrangement = Arrangement.spacedBy(Desk.spacing.sm)) {
                    DeskButtonView(
                        label = if (sending) "Sending…" else "Send for approval",
                        enabled = !sending && from.isNotBlank() && to.isNotBlank() && reason.isNotBlank(),
                        busy = sending,
                        onClick = {
                            sending = true
                            error = null
                            scope.launch {
                                when (val r = state.api.applyForLeave(type, from, to, reason)) {
                                    is HrmsApi.Result.Ok -> {
                                        applying = false
                                        from = ""; to = ""; reason = ""
                                        load()
                                    }
                                    is HrmsApi.Result.Failed -> error = r.message
                                    is HrmsApi.Result.Offline -> error = r.message
                                    HrmsApi.Result.Unauthorised -> error = "Sign in again."
                                }
                                sending = false
                            }
                        },
                    )
                    DeskButtonView("Cancel", { applying = false }, variant = DeskButton.SECONDARY)
                }
            }
        } else {
            DeskButtonView("Apply for leave", { applying = true; error = null })
        }

        SectionTitle("Your requests")

        Loaded(requests) { list ->
            if (list.isEmpty()) {
                EmptyState("No leave requests", "Requests you send appear here with where they have got to.")
            } else {
                DeskCard {
                    TableHeader("Type" to 1.4f, "From" to 1f, "To" to 1f, "Days" to 0.6f, "Status" to 1f)
                    list.forEach { r ->
                        TableRow {
                            Cell(titleCase(r.leaveType), 1.4f, bold = true)
                            Cell(r.startDate, 1f)
                            Cell(r.endDate, 1f)
                            Cell(r.totalDays?.let { days(it) } ?: "—", 0.6f)
                            Box(Modifier.weight(1f)) {
                                StatusPill(titleCase(r.status), statusTone(r.status))
                            }
                        }
                    }
                }
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// ATTENDANCE
// ═══════════════════════════════════════════════════════════════

@Composable
fun AttendanceScreen(state: AppState) {
    var records by remember { mutableStateOf<Load<List<AttendanceRecord>>>(Load.Loading) }

    LaunchedEffect(Unit) {
        records = state.api.attendance().toLoad().let {
            when (it) {
                is Load.Ready -> Load.Ready(it.value.items)
                is Load.Failed -> it
                Load.Loading -> Load.Loading
            }
        }
    }

    Scroller {
        Loaded(records) { list ->
            if (list.isEmpty()) {
                EmptyState("No attendance yet", "Days you clock in for appear here.")
            } else {
                DeskCard {
                    TableHeader("Date" to 1.2f, "In" to 1f, "Out" to 1f, "Worked" to 1f, "Status" to 1f)
                    list.forEach { r ->
                        TableRow {
                            Cell(r.date, 1.2f, bold = true)
                            Cell(r.checkInAt?.let { clockPart(it) } ?: "—", 1f)
                            Cell(r.checkOutAt?.let { clockPart(it) } ?: "—", 1f)
                            Cell(r.workedMinutes?.let { "${it / 60}h ${it % 60}m" } ?: "—", 1f)
                            Box(Modifier.weight(1f)) {
                                val s = r.status ?: "—"
                                StatusPill(titleCase(s), statusTone(s))
                            }
                        }
                    }
                }
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// WHO IS IN
// ═══════════════════════════════════════════════════════════════

private enum class TeamFilter(val label: String) { ALL("Everyone"), NOT_IN("Not in"), LATE("Late"), ON_TIME("On time") }

@Composable
fun TeamScreen(state: AppState) {
    var data by remember { mutableStateOf<Load<TeamAttendance>>(Load.Loading) }
    var filter by remember { mutableStateOf(TeamFilter.ALL) }

    LaunchedEffect(Unit) { data = state.api.teamAttendance().toLoad() }

    Scroller {
        Loaded(data) { value ->
            if (value.members.isEmpty()) {
                EmptyState("Nobody on your team yet", "Colleagues appear here once HR records a reporting line.")
                return@Loaded
            }

            Row(horizontalArrangement = Arrangement.spacedBy(Desk.spacing.sm)) {
                TeamFilter.entries.forEach { f ->
                    val n = when (f) {
                        TeamFilter.ALL -> value.counts.all
                        TeamFilter.NOT_IN -> value.counts.notIn
                        TeamFilter.LATE -> value.counts.late
                        TeamFilter.ON_TIME -> value.counts.present
                    }
                    DeskButtonView(
                        label = "${f.label}  $n",
                        onClick = { filter = f },
                        variant = if (filter == f) DeskButton.PRIMARY else DeskButton.SECONDARY,
                    )
                }
            }

            val shown = value.members.filter {
                when (filter) {
                    TeamFilter.ALL -> true
                    TeamFilter.ON_TIME -> it.presence == "in"
                    TeamFilter.LATE -> it.presence == "late"
                    TeamFilter.NOT_IN -> it.presence == "not_in" || it.presence == "absent"
                }
            }

            if (shown.isEmpty()) {
                EmptyState(
                    when (filter) {
                        TeamFilter.NOT_IN -> "Everybody has started their day"
                        TeamFilter.LATE -> "No late arrivals"
                        TeamFilter.ON_TIME -> "Nobody has clocked in yet"
                        TeamFilter.ALL -> "Nobody on your team"
                    },
                    "Nothing matches this filter for ${value.date}.",
                )
            } else {
                DeskCard {
                    TableHeader("Colleague" to 2f, "Role" to 1.4f, "Arrived" to 1f, "Status" to 1f)
                    shown.forEach { m ->
                        TableRow {
                            Row(Modifier.weight(2f), verticalAlignment = Alignment.CenterVertically) {
                                Initials(m.name, 28.dp)
                                Spacer(Modifier.width(Desk.spacing.sm))
                                Text(
                                    m.name,
                                    color = Desk.colors.text,
                                    style = MaterialTheme.typography.bodyMedium,
                                    fontWeight = FontWeight.Medium,
                                )
                            }
                            Cell(m.designation.ifBlank { "—" }, 1.4f)
                            Cell(
                                m.clockInLocal ?: "—",
                                1f,
                            )
                            Box(Modifier.weight(1f)) {
                                val (label, tone) = when (m.presence) {
                                    "in" -> "In" to PillTone.SUCCESS
                                    "late" -> "Late" to PillTone.WARNING
                                    "absent" -> "No punch" to PillTone.DANGER
                                    "not_in" -> (if (value.isToday) "Not in yet" else "No punch") to PillTone.NEUTRAL
                                    "on_leave" -> "On leave" to PillTone.INFO
                                    else -> "Day off" to PillTone.INFO
                                }
                                StatusPill(label, tone)
                            }
                        }
                    }
                }
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// APPROVALS
// ═══════════════════════════════════════════════════════════════

/**
 * Every queue in one place.
 *
 * The phone learned this the hard way: approvals were split across four
 * screens, so a manager had to already know that a work-from-home request is
 * filed somewhere other than a leave request in order to find it.
 */
@Composable
fun InboxScreen(state: AppState) {
    var leave by remember { mutableStateOf<Load<List<LeaveRequest>>>(Load.Loading) }
    var away by remember { mutableStateOf<Load<List<WorkArrangementRequest>>>(Load.Loading) }
    var fixes by remember { mutableStateOf<Load<List<RegularisationRequest>>>(Load.Loading) }
    var busyId by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    val scope = rememberCoroutineScope()

    suspend fun load() {
        leave = state.api.leaveRequests().toLoad().let {
            when (it) {
                is Load.Ready -> Load.Ready(it.value.items.filter { r -> r.status == "pending" })
                is Load.Failed -> it
                Load.Loading -> Load.Loading
            }
        }
        away = state.api.workArrangements().toLoad().let {
            when (it) {
                is Load.Ready -> Load.Ready(it.value.filter { r -> r.status == "pending" })
                is Load.Failed -> it
                Load.Loading -> Load.Loading
            }
        }
        fixes = state.api.regularisations().toLoad().let {
            when (it) {
                is Load.Ready -> Load.Ready(it.value.filter { r -> r.status == "pending" })
                is Load.Failed -> it
                Load.Loading -> Load.Loading
            }
        }
    }

    LaunchedEffect(Unit) { load() }

    fun decide(id: String, approve: Boolean, call: suspend () -> HrmsApi.Result<Unit>) {
        busyId = id
        error = null
        scope.launch {
            when (val r = call()) {
                is HrmsApi.Result.Ok -> load()
                is HrmsApi.Result.Failed -> error = r.message
                is HrmsApi.Result.Offline -> error = r.message
                HrmsApi.Result.Unauthorised -> error = "Sign in again."
            }
            busyId = null
        }
    }

    Scroller {
        error?.let { ErrorBanner(it) }

        SectionTitle("Leave")
        Loaded(leave) { list ->
            if (list.isEmpty()) EmptyState("Nothing waiting", "Leave requests needing a decision appear here.")
            else DeskCard {
                TableHeader("Who" to 1.6f, "Type" to 1f, "Dates" to 1.6f, "" to 1.4f)
                list.forEach { r ->
                    TableRow {
                        Cell(r.employeeName ?: "A colleague", 1.6f, bold = true)
                        Cell(titleCase(r.leaveType), 1f)
                        Cell("${r.startDate} → ${r.endDate}", 1.6f)
                        Row(Modifier.weight(1.4f), horizontalArrangement = Arrangement.spacedBy(Desk.spacing.sm)) {
                            DeskButtonView(
                                "Approve", { decide(r.id, true) { state.api.decideLeave(r.id, true, null) } },
                                busy = busyId == r.id,
                            )
                            DeskButtonView(
                                "Reject", { decide(r.id, false) { state.api.decideLeave(r.id, false, null) } },
                                variant = DeskButton.SECONDARY,
                            )
                        }
                    }
                }
            }
        }

        SectionTitle("Working elsewhere")
        Loaded(away) { list ->
            if (list.isEmpty()) EmptyState("Nothing waiting", "Work-from-home and on-duty requests appear here.")
            else DeskCard {
                TableHeader("Who" to 1.6f, "Kind" to 1f, "Dates" to 1.6f, "" to 1.4f)
                list.forEach { r ->
                    TableRow {
                        Cell(r.employeeName ?: "A colleague", 1.6f, bold = true)
                        Cell(titleCase(r.kind), 1f)
                        Cell("${r.startDate} → ${r.endDate}", 1.6f)
                        Row(Modifier.weight(1.4f), horizontalArrangement = Arrangement.spacedBy(Desk.spacing.sm)) {
                            DeskButtonView(
                                "Approve",
                                { decide(r.id, true) { state.api.decideWorkArrangement(r.id, true, null) } },
                                busy = busyId == r.id,
                            )
                            DeskButtonView(
                                "Reject",
                                { decide(r.id, false) { state.api.decideWorkArrangement(r.id, false, null) } },
                                variant = DeskButton.SECONDARY,
                            )
                        }
                    }
                }
            }
        }

        SectionTitle("Attendance corrections")
        Loaded(fixes) { list ->
            if (list.isEmpty()) EmptyState("Nothing waiting", "Corrections needing a decision appear here.")
            else DeskCard {
                TableHeader("Who" to 1.6f, "Day" to 1.2f, "Reason" to 1.4f, "" to 1.4f)
                list.forEach { r ->
                    TableRow {
                        Cell(r.employeeName ?: "A colleague", 1.6f, bold = true)
                        Cell(r.workDate, 1.2f)
                        Cell(titleCase(r.reason ?: "—"), 1.4f)
                        Row(Modifier.weight(1.4f), horizontalArrangement = Arrangement.spacedBy(Desk.spacing.sm)) {
                            DeskButtonView(
                                "Approve",
                                { decide(r.id, true) { state.api.decideRegularisation(r.id, true, null) } },
                                busy = busyId == r.id,
                            )
                            DeskButtonView(
                                "Reject",
                                { decide(r.id, false) { state.api.decideRegularisation(r.id, false, null) } },
                                variant = DeskButton.SECONDARY,
                            )
                        }
                    }
                }
            }
        }
    }
}
