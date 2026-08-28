package com.circuvent.hrms.desktop

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import com.circuvent.hrms.shared.model.Announcement
import com.circuvent.hrms.shared.model.Colleague
import com.circuvent.hrms.shared.model.DocumentSummary
import com.circuvent.hrms.shared.model.ExpenseClaim
import com.circuvent.hrms.shared.model.HelpdeskTicket
import com.circuvent.hrms.shared.model.Holiday
import com.circuvent.hrms.shared.model.Payslip
import com.circuvent.hrms.shared.model.Praise
import kotlinx.coroutines.launch

@Composable
private fun Page(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(Desk.spacing.lg),
        content = content,
    )
}

private fun nice(value: String): String =
    value.replace('_', ' ').replaceFirstChar { it.uppercase() }

private fun tone(status: String): PillTone = when (status.lowercase()) {
    "approved", "paid", "resolved", "completed", "signed", "active" -> PillTone.SUCCESS
    "pending", "open", "submitted", "in_progress", "sent" -> PillTone.WARNING
    "rejected", "cancelled", "failed", "expired" -> PillTone.DANGER
    else -> PillTone.NEUTRAL
}

private val MONTHS = arrayOf(
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)

/** Indian digit grouping. 12,34,567 rather than 1,234,567. */
private fun rupees(amount: Double?): String {
    if (amount == null) return "—"
    val whole = amount.toLong()
    val text = whole.toString()
    if (text.length <= 3) return "₹$text"
    val last3 = text.takeLast(3)
    val rest = text.dropLast(3)
    val grouped = rest.reversed().chunked(2).joinToString(",").reversed()
    return "₹$grouped,$last3"
}

// ═══════════════════════════════════════════════════════════════
// DIRECTORY
// ═══════════════════════════════════════════════════════════════

@Composable
fun DirectoryScreen(state: AppState) {
    var search by remember { mutableStateOf("") }
    var people by remember { mutableStateOf<Load<List<Colleague>>>(Load.Loading) }

    // Searched server-side on every change. The whole organisation is a lot of
    // rows to hold in a client to find one person, and the endpoint already
    // filters by what the caller may see.
    LaunchedEffect(search) {
        people = state.api.colleagues(search.trim().takeIf { it.isNotEmpty() }).toLoad()
    }

    Page {
        OutlinedTextField(
            value = search,
            onValueChange = { search = it },
            label = { Text("Search by name or role") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )

        Loaded(people) { list ->
            if (list.isEmpty()) {
                EmptyState("Nobody found", "Try part of a name, or a job title.")
            } else {
                DeskCard {
                    TableHeader("Name" to 2f, "Role" to 1.6f, "Team" to 1.4f)
                    list.forEach { p ->
                        TableRow {
                            Row(Modifier.weight(2f), verticalAlignment = Alignment.CenterVertically) {
                                Avatar(p.fullName, imageUrl = p.avatarUrl, size = 28.dp)
                                Spacer(Modifier.width(Desk.spacing.sm))
                                Text(
                                    p.fullName,
                                    color = Desk.colors.text,
                                    style = MaterialTheme.typography.bodyMedium,
                                    fontWeight = FontWeight.Medium,
                                )
                            }
                            Cell(p.designation.ifBlank { "—" }, 1.6f)
                            Cell(p.departmentName ?: "—", 1.4f)
                        }
                    }
                }
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// PRAISE
// ═══════════════════════════════════════════════════════════════

private val PRAISE_VALUES = listOf("teamwork", "ownership", "craft", "customer", "kindness")

@Composable
fun PraiseScreen(state: AppState) {
    var wall by remember { mutableStateOf<Load<List<Praise>>>(Load.Loading) }
    var composing by remember { mutableStateOf(false) }
    var search by remember { mutableStateOf("") }
    var matches by remember { mutableStateOf<List<Colleague>>(emptyList()) }
    var chosen by remember { mutableStateOf<Colleague?>(null) }
    var value by remember { mutableStateOf(PRAISE_VALUES.first()) }
    var words by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val scope = rememberCoroutineScope()

    suspend fun load() { wall = state.api.praise().toLoad() }

    LaunchedEffect(Unit) { load() }

    LaunchedEffect(search) {
        val term = search.trim()
        matches = if (term.length < 2) emptyList()
        else when (val r = state.api.colleagues(term)) {
            is HrmsApi.Result.Ok -> r.value
            else -> emptyList()
        }
    }

    Page {
        error?.let { ErrorBanner(it) }

        if (composing) {
            DeskCard {
                SectionTitle("Praise a colleague")
                Spacer(Modifier.height(Desk.spacing.md))

                val picked = chosen
                if (picked == null) {
                    OutlinedTextField(
                        value = search,
                        onValueChange = { search = it },
                        label = { Text("Who deserves it") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    matches.take(6).forEach { person ->
                        TableRow {
                            Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                                Avatar(person.fullName, imageUrl = person.avatarUrl, size = 26.dp)
                                Spacer(Modifier.width(Desk.spacing.sm))
                                Text(
                                    person.fullName,
                                    color = Desk.colors.text,
                                    style = MaterialTheme.typography.bodyMedium,
                                )
                            }
                            Cell(person.designation.ifBlank { "—" }, 1f)
                            DeskButtonView("Choose", { chosen = person; search = "" }, variant = DeskButton.SECONDARY)
                        }
                    }
                } else {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Avatar(picked.fullName, imageUrl = picked.avatarUrl, size = 30.dp)
                        Spacer(Modifier.width(Desk.spacing.sm))
                        Text(
                            picked.fullName,
                            color = Desk.colors.text,
                            style = MaterialTheme.typography.titleMedium,
                            modifier = Modifier.weight(1f),
                        )
                        DeskButtonView("Change", { chosen = null }, variant = DeskButton.GHOST)
                    }

                    Spacer(Modifier.height(Desk.spacing.md))
                    Muted("What for")
                    Row(
                        Modifier.padding(top = Desk.spacing.xs),
                        horizontalArrangement = Arrangement.spacedBy(Desk.spacing.sm),
                    ) {
                        PRAISE_VALUES.forEach { v ->
                            DeskButtonView(
                                label = nice(v),
                                onClick = { value = v },
                                variant = if (value == v) DeskButton.PRIMARY else DeskButton.SECONDARY,
                            )
                        }
                    }

                    OutlinedTextField(
                        value = words,
                        onValueChange = { words = it },
                        label = { Text("Say why") },
                        modifier = Modifier.fillMaxWidth().padding(top = Desk.spacing.md),
                    )

                    Spacer(Modifier.height(Desk.spacing.md))
                    Row(horizontalArrangement = Arrangement.spacedBy(Desk.spacing.sm)) {
                        DeskButtonView(
                            label = if (sending) "Sending…" else "Send praise",
                            enabled = !sending && words.trim().length >= 3,
                            busy = sending,
                            onClick = {
                                sending = true
                                error = null
                                scope.launch {
                                    when (val r = state.api.givePraise(picked.id, value, words.trim())) {
                                        is HrmsApi.Result.Ok -> {
                                            composing = false; chosen = null; words = ""
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
                        DeskButtonView("Cancel", { composing = false }, variant = DeskButton.SECONDARY)
                    }
                }
            }
        } else {
            DeskButtonView("Praise a colleague", { composing = true; error = null })
        }

        SectionTitle("Recent praise")

        Loaded(wall) { list ->
            if (list.isEmpty()) {
                EmptyState("No praise yet", "When somebody does good work, say so here. Everyone can see it.")
            } else {
                list.forEach { p ->
                    DeskCard {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Avatar(p.toName, imageUrl = p.toAvatarUrl, size = 32.dp)
                            Spacer(Modifier.width(Desk.spacing.md))
                            Text(
                                p.toName,
                                color = Desk.colors.text,
                                style = MaterialTheme.typography.titleMedium,
                                modifier = Modifier.weight(1f),
                            )
                            StatusPill(nice(p.value), PillTone.INFO)
                        }
                        Text(
                            p.message,
                            color = Desk.colors.text,
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.padding(top = Desk.spacing.sm),
                        )
                        p.fromName?.let { Muted("From $it", Modifier.padding(top = Desk.spacing.xs)) }
                    }
                }
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// PAYSLIPS, EXPENSES
// ═══════════════════════════════════════════════════════════════

@Composable
fun PayslipsScreen(state: AppState) {
    var slips by remember { mutableStateOf<Load<List<Payslip>>>(Load.Loading) }

    LaunchedEffect(Unit) {
        slips = when (val r = state.api.payslips().toLoad()) {
            is Load.Ready -> Load.Ready(r.value.items)
            is Load.Failed -> r
            Load.Loading -> Load.Loading
        }
    }

    Page {
        Loaded(slips) { list ->
            if (list.isEmpty()) EmptyState("No payslips yet", "Payslips appear here once payroll has run.")
            else DeskCard {
                TableHeader("Month" to 1.4f, "Gross" to 1f, "Deductions" to 1f, "Net" to 1f, "Status" to 1f)
                list.forEach { p ->
                    TableRow {
                        Cell("${MONTHS.getOrElse(p.month) { "" }} ${p.year}", 1.4f, bold = true)
                        Cell(rupees(p.grossPay), 1f)
                        Cell(rupees(p.totalDeductions), 1f)
                        Cell(rupees(p.netPay), 1f)
                        Box(Modifier.weight(1f)) {
                            val s = p.status ?: "—"
                            StatusPill(nice(s), tone(s))
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun ExpensesScreen(state: AppState) {
    var claims by remember { mutableStateOf<Load<List<ExpenseClaim>>>(Load.Loading) }

    LaunchedEffect(Unit) {
        claims = when (val r = state.api.expenses().toLoad()) {
            is Load.Ready -> Load.Ready(r.value.items)
            is Load.Failed -> r
            Load.Loading -> Load.Loading
        }
    }

    Page {
        Loaded(claims) { list ->
            if (list.isEmpty()) EmptyState("No claims", "Expense claims you submit appear here.")
            else DeskCard {
                TableHeader("Claim" to 1.6f, "Amount" to 1f, "Submitted" to 1.2f, "Status" to 1f)
                list.forEach { c ->
                    TableRow {
                        Cell(c.title ?: c.claimNumber ?: "Claim", 1.6f, bold = true)
                        Cell(rupees(c.totalAmount), 1f)
                        Cell(c.submittedAt?.take(10) ?: "—", 1.2f)
                        Box(Modifier.weight(1f)) { StatusPill(nice(c.status), tone(c.status)) }
                    }
                }
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// HELPDESK
// ═══════════════════════════════════════════════════════════════

@Composable
fun HelpdeskScreen(state: AppState) {
    var tickets by remember { mutableStateOf<Load<List<HelpdeskTicket>>>(Load.Loading) }
    var raising by remember { mutableStateOf(false) }
    var subject by remember { mutableStateOf("") }
    var detail by remember { mutableStateOf("") }
    var category by remember { mutableStateOf("it") }
    var priority by remember { mutableStateOf("normal") }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val scope = rememberCoroutineScope()

    suspend fun load() {
        tickets = when (val r = state.api.tickets().toLoad()) {
            is Load.Ready -> Load.Ready(r.value.items)
            is Load.Failed -> r
            Load.Loading -> Load.Loading
        }
    }

    LaunchedEffect(Unit) { load() }

    Page {
        error?.let { ErrorBanner(it) }

        if (raising) {
            DeskCard {
                SectionTitle("Raise a ticket")
                Spacer(Modifier.height(Desk.spacing.md))

                OutlinedTextField(
                    value = subject,
                    onValueChange = { subject = it },
                    label = { Text("Subject") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(
                    Modifier.padding(top = Desk.spacing.md),
                    horizontalArrangement = Arrangement.spacedBy(Desk.spacing.md),
                ) {
                    OutlinedTextField(
                        value = category,
                        onValueChange = { category = it },
                        label = { Text("Category") },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                    )
                    OutlinedTextField(
                        value = priority,
                        onValueChange = { priority = it },
                        label = { Text("Priority") },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                    )
                }
                OutlinedTextField(
                    value = detail,
                    onValueChange = { detail = it },
                    label = { Text("What is wrong") },
                    modifier = Modifier.fillMaxWidth().padding(top = Desk.spacing.md),
                )

                Spacer(Modifier.height(Desk.spacing.md))
                Row(horizontalArrangement = Arrangement.spacedBy(Desk.spacing.sm)) {
                    DeskButtonView(
                        label = if (sending) "Sending…" else "Raise ticket",
                        enabled = !sending && subject.isNotBlank() && detail.isNotBlank(),
                        busy = sending,
                        onClick = {
                            sending = true
                            error = null
                            scope.launch {
                                when (val r = state.api.raiseTicket(subject, detail, category, priority)) {
                                    is HrmsApi.Result.Ok -> {
                                        raising = false; subject = ""; detail = ""
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
                    DeskButtonView("Cancel", { raising = false }, variant = DeskButton.SECONDARY)
                }
            }
        } else {
            DeskButtonView("Raise a ticket", { raising = true; error = null })
        }

        Loaded(tickets) { list ->
            if (list.isEmpty()) EmptyState("No tickets", "Tickets you raise appear here with where they have got to.")
            else DeskCard {
                TableHeader("Ticket" to 0.9f, "Subject" to 2.2f, "Priority" to 1f, "Status" to 1f)
                list.forEach { t ->
                    TableRow {
                        Cell(t.ticketNumber ?: "—", 0.9f)
                        Cell(t.subject, 2.2f, bold = true)
                        Cell(nice(t.priority), 1f)
                        Box(Modifier.weight(1f)) { StatusPill(nice(t.status), tone(t.status)) }
                    }
                }
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// COMPANY
// ═══════════════════════════════════════════════════════════════

@Composable
fun HolidaysScreen(state: AppState) {
    var days by remember { mutableStateOf<Load<List<Holiday>>>(Load.Loading) }
    LaunchedEffect(Unit) { days = state.api.holidays().toLoad() }

    Page {
        Loaded(days) { list ->
            if (list.isEmpty()) EmptyState("No holidays published", "The holiday calendar has not been set for this year.")
            else DeskCard {
                TableHeader("Date" to 1.2f, "Holiday" to 2.4f, "Kind" to 1f)
                list.forEach { h ->
                    TableRow {
                        Cell(h.date, 1.2f)
                        Cell(h.name, 2.4f, bold = true)
                        Box(Modifier.weight(1f)) {
                            StatusPill(
                                if (h.isOptional) "Optional" else nice(h.type ?: "Public"),
                                if (h.isOptional) PillTone.NEUTRAL else PillTone.INFO,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun AnnouncementsScreen(state: AppState) {
    var notices by remember { mutableStateOf<Load<List<Announcement>>>(Load.Loading) }
    LaunchedEffect(Unit) { notices = state.api.announcements().toLoad() }

    Page {
        Loaded(notices) { list ->
            if (list.isEmpty()) EmptyState("Nothing announced", "Notices from your company appear here.")
            else list.forEach { a ->
                DeskCard {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            a.title,
                            color = Desk.colors.text,
                            style = MaterialTheme.typography.titleMedium,
                            modifier = Modifier.weight(1f),
                        )
                        a.priority?.let { StatusPill(nice(it), tone(it)) }
                    }
                    a.body?.let {
                        Text(
                            it,
                            color = Desk.colors.text,
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.padding(top = Desk.spacing.sm),
                        )
                    }
                    a.publishedAt?.let { Muted(it.take(10), Modifier.padding(top = Desk.spacing.xs)) }
                }
            }
        }
    }
}

@Composable
fun DocumentsScreen(state: AppState) {
    var docs by remember { mutableStateOf<Load<List<DocumentSummary>>>(Load.Loading) }

    // The endpoint behind this is the whole tenant's letters, restricted to the
    // people who issue them because a document carries salary. There is no
    // "my own documents" endpoint yet, so rather than show everybody a refusal
    // dressed as an error, the screen says what is true.
    val role = state.session?.role?.lowercase()
    val mayList = role in setOf("owner", "admin", "hr")

    LaunchedEffect(mayList) {
        if (mayList) docs = state.api.documents().toLoad()
    }

    Page {
        if (!mayList) {
            EmptyState(
                "Not available for your account",
                "This list is every letter in the company, so it is limited to HR. " +
                    "Ask HR for a copy of anything issued to you.",
            )
            return@Page
        }

        Loaded(docs) { list ->
            if (list.isEmpty()) EmptyState("No documents", "Letters and documents issued appear here.")
            else DeskCard {
                TableHeader("Document" to 2.4f, "Category" to 1.2f, "Sent" to 1.2f, "Status" to 1f)
                list.forEach { d ->
                    TableRow {
                        Cell(d.title, 2.4f, bold = true)
                        Cell(nice(d.category ?: "—"), 1.2f)
                        Cell(d.sentAt?.take(10) ?: "—", 1.2f)
                        Box(Modifier.weight(1f)) { StatusPill(nice(d.status), tone(d.status)) }
                    }
                }
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════

@Composable
fun SettingsScreen(state: AppState) {
    var server by remember { mutableStateOf(state.baseUrl) }
    val scope = rememberCoroutineScope()

    Page {
        DeskCard {
            SectionTitle("Server")
            Muted(
                "Where this app looks for your company's data. Changing it signs you out.",
                Modifier.padding(top = Desk.spacing.xs),
            )
            OutlinedTextField(
                value = server,
                onValueChange = { server = it },
                label = { Text("Server address") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(top = Desk.spacing.md),
            )
            Spacer(Modifier.height(Desk.spacing.md))
            DeskButtonView(
                label = "Use this server",
                enabled = server.trim().trimEnd('/') != state.baseUrl,
                onClick = { state.useServer(server) },
            )
        }

        DeskCard {
            SectionTitle("This account")
            state.session?.let { s ->
                Muted(s.email, Modifier.padding(top = Desk.spacing.xs))
                s.employeeCode?.let { Muted(it) }
            }
            Spacer(Modifier.height(Desk.spacing.md))
            DeskButtonView(
                label = "Sign out",
                variant = DeskButton.DANGER,
                onClick = { scope.launch { state.signOut() } },
            )
        }

        DeskCard {
            SectionTitle("About")
            Muted(
                "Circuvent HR for Windows. The rules this app applies — what a day of " +
                    "leave costs, whether a request overlaps one already filed, how an " +
                    "expired session is recovered — are the same code the Android app runs.",
                Modifier.padding(top = Desk.spacing.xs),
            )
        }
    }
}
