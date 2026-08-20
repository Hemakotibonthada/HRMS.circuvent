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
import com.circuvent.hrms.shared.model.LoanOverview
import com.circuvent.hrms.shared.model.MyDetails
import com.circuvent.hrms.shared.model.WallComment
import com.circuvent.hrms.shared.model.WallPost
import java.time.LocalDate
import kotlinx.coroutines.launch

@Composable
private fun Panel(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(Desk.spacing.lg),
        content = content,
    )
}

private fun words(value: String): String =
    value.replace('_', ' ').replaceFirstChar { it.uppercase() }

/** Indian digit grouping, from minor units. */
private fun money(minor: Long): String {
    val whole = minor / 100
    val text = whole.toString()
    if (text.length <= 3) return "₹$text"
    val last3 = text.takeLast(3)
    val rest = text.dropLast(3)
    return "₹" + rest.reversed().chunked(2).joinToString(",").reversed() + ",$last3"
}

// ═══════════════════════════════════════════════════════════════
// MY DETAILS
// ═══════════════════════════════════════════════════════════════

/**
 * The details a person owns about themselves.
 *
 * Split into what they may change and what only HR may. Showing both together
 * without saying which is which is how somebody spends five minutes trying to
 * correct a designation that was never theirs to edit.
 */
@Composable
fun MyDetailsScreen(state: AppState) {
    var loaded by remember { mutableStateOf<Load<MyDetails>>(Load.Loading) }
    var phone by remember { mutableStateOf("") }
    var personalEmail by remember { mutableStateOf("") }
    var dob by remember { mutableStateOf("") }
    var blood by remember { mutableStateOf("") }
    var address by remember { mutableStateOf("") }
    var city by remember { mutableStateOf("") }
    var region by remember { mutableStateOf("") }
    var postal by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    val scope = rememberCoroutineScope()

    suspend fun load() {
        val result = state.api.myDetails().toLoad()
        loaded = result
        if (result is Load.Ready) {
            val d = result.value
            phone = d.phone ?: ""
            personalEmail = d.personalEmail ?: ""
            dob = d.dateOfBirth ?: ""
            blood = d.bloodGroup ?: ""
            address = d.addressLine1 ?: ""
            city = d.city ?: ""
            region = d.state ?: ""
            postal = d.postalCode ?: ""
        }
    }

    LaunchedEffect(Unit) { load() }

    Panel {
        error?.let { ErrorBanner(it) }
        message?.let {
            DeskCard { Text(it, color = Desk.colors.success, style = MaterialTheme.typography.bodyMedium) }
        }

        Loaded(loaded) { d ->
            DeskCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Avatar("${d.firstName} ${d.lastName}", imageUrl = d.avatarUrl, size = 44.dp)
                    Spacer(Modifier.width(Desk.spacing.md))
                    Column(Modifier.weight(1f)) {
                        Text(
                            "${d.firstName} ${d.lastName}".trim(),
                            style = MaterialTheme.typography.titleLarge,
                            color = Desk.colors.text,
                        )
                        Muted(
                            listOfNotNull(
                                d.designation?.takeIf { it.isNotBlank() },
                                d.employeeCode.takeIf { it.isNotBlank() },
                            ).joinToString(" · ")
                        )
                    }
                }
            }

            DeskCard {
                SectionTitle("HR keeps these")
                Muted(
                    "Ask HR if any of these is wrong. They decide pay, statutory reporting " +
                        "and who approves your leave, so they are not yours to edit.",
                    Modifier.padding(top = Desk.spacing.xs),
                )
                Spacer(Modifier.height(Desk.spacing.md))
                TableHeader("Field" to 1f, "Value" to 2f)
                listOf(
                    "Employee code" to d.employeeCode,
                    "Work email" to d.workEmail,
                    "Designation" to (d.designation ?: "—"),
                    "Joined" to (d.joinDate ?: "—"),
                ).forEach { (k, v) ->
                    TableRow {
                        Cell(k, 1f)
                        Cell(v.ifBlank { "—" }, 2f, bold = true)
                    }
                }
            }

            DeskCard {
                SectionTitle("You can change these")

                Row(
                    Modifier.padding(top = Desk.spacing.md),
                    horizontalArrangement = Arrangement.spacedBy(Desk.spacing.md),
                ) {
                    OutlinedTextField(
                        value = phone,
                        onValueChange = { phone = it },
                        label = { Text("Phone") },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                    )
                    OutlinedTextField(
                        value = personalEmail,
                        onValueChange = { personalEmail = it },
                        label = { Text("Personal email") },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                    )
                }

                Row(
                    Modifier.padding(top = Desk.spacing.md),
                    horizontalArrangement = Arrangement.spacedBy(Desk.spacing.md),
                ) {
                    Box(Modifier.weight(1f)) {
                        if (d.dateOfBirthLocked) {
                            OutlinedTextField(
                                value = dob,
                                onValueChange = {},
                                label = { Text("Date of birth") },
                                readOnly = true,
                                enabled = false,
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        } else {
                            // Nobody working here is under fourteen, and a
                            // mistyped year here changes statutory entitlements
                            // rather than a label.
                            DeskDateField(
                                label = "Date of birth",
                                value = dob,
                                onValueChange = { dob = it },
                                maxDate = LocalDate.now().minusYears(14),
                                minDate = LocalDate.now().minusYears(80),
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                    }
                    OutlinedTextField(
                        value = blood,
                        onValueChange = { blood = it },
                        label = { Text("Blood group") },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                    )
                }

                if (d.dateOfBirthLocked) {
                    Muted(
                        "Your date of birth is set. Ask HR to correct it — it decides statutory age.",
                        Modifier.padding(top = Desk.spacing.xs),
                    )
                }

                OutlinedTextField(
                    value = address,
                    onValueChange = { address = it },
                    label = { Text("Address") },
                    modifier = Modifier.fillMaxWidth().padding(top = Desk.spacing.md),
                )

                Row(
                    Modifier.padding(top = Desk.spacing.md),
                    horizontalArrangement = Arrangement.spacedBy(Desk.spacing.md),
                ) {
                    OutlinedTextField(
                        value = city,
                        onValueChange = { city = it },
                        label = { Text("City") },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                    )
                    OutlinedTextField(
                        value = region,
                        onValueChange = { region = it },
                        label = { Text("State") },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                    )
                    OutlinedTextField(
                        value = postal,
                        onValueChange = { postal = it.filter(Char::isDigit) },
                        label = { Text("PIN code") },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                    )
                }

                Spacer(Modifier.height(Desk.spacing.md))
                DeskButtonView(
                    label = if (saving) "Saving…" else "Save changes",
                    enabled = !saving,
                    busy = saving,
                    onClick = {
                        saving = true
                        error = null
                        message = null
                        scope.launch {
                            val r = state.api.saveMyDetails(
                                phone = phone.takeIf { it.isNotBlank() },
                                personalEmail = personalEmail.takeIf { it.isNotBlank() },
                                dateOfBirth = dob.takeIf { it.isNotBlank() && !d.dateOfBirthLocked },
                                bloodGroup = blood.takeIf { it.isNotBlank() },
                                addressLine1 = address.takeIf { it.isNotBlank() },
                                city = city.takeIf { it.isNotBlank() },
                                state = region.takeIf { it.isNotBlank() },
                                postalCode = postal.takeIf { it.isNotBlank() },
                            )
                            when (r) {
                                is HrmsApi.Result.Ok -> { message = "Saved."; load() }
                                is HrmsApi.Result.Failed -> error = r.message
                                is HrmsApi.Result.Offline -> error = r.message
                                HrmsApi.Result.Unauthorised -> error = "Sign in again."
                            }
                            saving = false
                        }
                    },
                )
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// THE WALL
// ═══════════════════════════════════════════════════════════════

@Composable
fun WallScreen(state: AppState) {
    var posts by remember { mutableStateOf<Load<List<WallPost>>>(Load.Loading) }
    var composing by remember { mutableStateOf(false) }
    var draft by remember { mutableStateOf("") }
    var publishing by remember { mutableStateOf(false) }
    var openPostId by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    val scope = rememberCoroutineScope()

    suspend fun load() { posts = state.api.wallPosts().toLoad() }
    LaunchedEffect(Unit) { load() }

    Panel {
        error?.let { ErrorBanner(it) }

        if (composing) {
            DeskCard {
                OutlinedTextField(
                    value = draft,
                    onValueChange = { draft = it },
                    label = { Text("Share something with the company") },
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(Desk.spacing.md))
                Row(horizontalArrangement = Arrangement.spacedBy(Desk.spacing.sm)) {
                    DeskButtonView(
                        label = if (publishing) "Posting…" else "Post",
                        enabled = !publishing && draft.trim().length >= 3,
                        busy = publishing,
                        onClick = {
                            publishing = true
                            error = null
                            scope.launch {
                                when (val r = state.api.publishWallPost(draft.trim())) {
                                    is HrmsApi.Result.Ok -> { composing = false; draft = ""; load() }
                                    is HrmsApi.Result.Failed -> error = r.message
                                    is HrmsApi.Result.Offline -> error = r.message
                                    HrmsApi.Result.Unauthorised -> error = "Sign in again."
                                }
                                publishing = false
                            }
                        },
                    )
                    DeskButtonView("Cancel", { composing = false }, variant = DeskButton.SECONDARY)
                }
            }
        } else {
            DeskButtonView("Share something", { composing = true; error = null })
        }

        Loaded(posts) { list ->
            if (list.isEmpty()) {
                EmptyState(
                    "Nothing on the wall yet",
                    "Welcomes, thank-yous and news from around the company appear here. Yours can be the first.",
                )
            } else {
                list.forEach { post ->
                    DeskCard {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Initials(post.author.ifBlank { "?" }, 34.dp)
                            Spacer(Modifier.width(Desk.spacing.md))
                            Column(Modifier.weight(1f)) {
                                Text(
                                    post.author.ifBlank { "A colleague" },
                                    style = MaterialTheme.typography.titleMedium,
                                    color = Desk.colors.text,
                                )
                                Muted(
                                    listOfNotNull(
                                        post.department.takeIf { it.isNotBlank() },
                                        post.createdAt.take(10).takeIf { it.isNotBlank() },
                                    ).joinToString(" · ")
                                )
                            }
                            if (post.type != "post") StatusPill(words(post.type), PillTone.INFO)
                        }

                        Text(
                            post.content,
                            color = Desk.colors.text,
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.padding(top = Desk.spacing.md),
                        )

                        Spacer(Modifier.height(Desk.spacing.md))
                        DeskButtonView(
                            label = if (openPostId == post.id) "Hide replies" else "Reply",
                            variant = DeskButton.GHOST,
                            onClick = { openPostId = if (openPostId == post.id) null else post.id },
                        )

                        if (openPostId == post.id) {
                            WallReplies(state, post.id)
                        }
                    }
                }
            }
        }
    }
}

/**
 * Replies on one post, loaded when it is opened.
 *
 * Not fetched with the feed: most posts are never opened, and twenty posts
 * would otherwise be twenty extra queries for counts nobody read.
 */
@Composable
private fun WallReplies(state: AppState, postId: String) {
    var items by remember(postId) { mutableStateOf<List<WallComment>>(emptyList()) }
    var draft by remember(postId) { mutableStateOf("") }
    var sending by remember(postId) { mutableStateOf(false) }

    val scope = rememberCoroutineScope()

    suspend fun load() {
        items = when (val r = state.api.wallComments(postId)) {
            is HrmsApi.Result.Ok -> r.value
            else -> emptyList()
        }
    }

    LaunchedEffect(postId) { load() }

    Column(Modifier.padding(top = Desk.spacing.md)) {
        if (items.isEmpty()) {
            Muted("No replies yet. Be the first.")
        } else {
            items.forEach { c ->
                Column(Modifier.padding(top = Desk.spacing.sm)) {
                    Text(
                        c.authorName ?: "A colleague",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium,
                        color = Desk.colors.text,
                    )
                    Text(c.body, color = Desk.colors.text, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }

        Row(
            Modifier.padding(top = Desk.spacing.md),
            horizontalArrangement = Arrangement.spacedBy(Desk.spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = draft,
                onValueChange = { draft = it },
                label = { Text("Write a reply") },
                singleLine = true,
                modifier = Modifier.weight(1f),
            )
            DeskButtonView(
                label = if (sending) "Posting…" else "Post reply",
                enabled = !sending && draft.isNotBlank(),
                busy = sending,
                onClick = {
                    sending = true
                    scope.launch {
                        state.api.addWallComment(postId, draft.trim())
                        draft = ""
                        load()
                        sending = false
                    }
                },
            )
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// LOANS AND ADVANCES
// ═══════════════════════════════════════════════════════════════

/**
 * What may be borrowed, and what is owed.
 *
 * The ceiling comes from the server, measured on recorded monthly basic pay.
 * When no salary structure has been recorded the server refuses rather than
 * estimating, and the screen says so instead of showing a limit of zero — which
 * reads as "you may borrow nothing" rather than "nobody has recorded your pay".
 */
@Composable
fun LoansScreen(state: AppState) {
    var overview by remember { mutableStateOf<Load<LoanOverview>>(Load.Loading) }
    var requesting by remember { mutableStateOf(false) }
    var kind by remember { mutableStateOf("salary_advance") }
    var amount by remember { mutableStateOf("") }
    var months by remember { mutableStateOf("1") }
    var purpose by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val scope = rememberCoroutineScope()

    suspend fun load() { overview = state.api.loans().toLoad() }
    LaunchedEffect(Unit) { load() }

    Panel {
        error?.let { ErrorBanner(it) }

        Loaded(overview) { data ->
            if (data.monthlyBasicMinor == null) {
                EmptyState(
                    "No salary on record",
                    "What you may borrow is measured on your recorded monthly basic pay, " +
                        "and HR has not recorded it yet. Ask HR, and this will fill in.",
                )
            } else {
                DeskCard {
                    SectionTitle("What you may borrow")
                    Muted(
                        "Measured on ${money(data.monthlyBasicMinor!!)} monthly basic. " +
                            "Anything already outstanding comes off these.",
                        Modifier.padding(top = Desk.spacing.xs),
                    )
                    Spacer(Modifier.height(Desk.spacing.md))
                    TableHeader("Kind" to 1.6f, "Over" to 1f, "Ceiling" to 1.2f)
                    data.limits.forEach { l ->
                        TableRow {
                            Cell(words(l.kind), 1.6f, bold = true)
                            Cell(if (l.months == 1) "1 month" else "${l.months} months", 1f)
                            Cell(money(l.maxMinor), 1.2f)
                        }
                    }
                    if (data.outstandingMinor > 0) {
                        Muted(
                            "Outstanding today: ${money(data.outstandingMinor)}",
                            Modifier.padding(top = Desk.spacing.sm),
                        )
                    }
                }
            }

            if (requesting) {
                DeskCard {
                    SectionTitle("Ask for an advance")
                    Row(
                        Modifier.padding(top = Desk.spacing.md),
                        horizontalArrangement = Arrangement.spacedBy(Desk.spacing.sm),
                    ) {
                        data.limits.forEach { l ->
                            DeskButtonView(
                                label = words(l.kind),
                                onClick = { kind = l.kind },
                                variant = if (kind == l.kind) DeskButton.PRIMARY else DeskButton.SECONDARY,
                            )
                        }
                    }
                    Row(
                        Modifier.padding(top = Desk.spacing.md),
                        horizontalArrangement = Arrangement.spacedBy(Desk.spacing.md),
                    ) {
                        OutlinedTextField(
                            value = amount,
                            onValueChange = { amount = it.filter(Char::isDigit) },
                            label = { Text("Amount (₹)") },
                            singleLine = true,
                            modifier = Modifier.weight(1f),
                        )
                        OutlinedTextField(
                            value = months,
                            onValueChange = { months = it.filter(Char::isDigit) },
                            label = { Text("Repay over (months)") },
                            singleLine = true,
                            modifier = Modifier.weight(1f),
                        )
                    }
                    OutlinedTextField(
                        value = purpose,
                        onValueChange = { purpose = it },
                        label = { Text("What for") },
                        modifier = Modifier.fillMaxWidth().padding(top = Desk.spacing.md),
                    )

                    Spacer(Modifier.height(Desk.spacing.md))
                    Row(horizontalArrangement = Arrangement.spacedBy(Desk.spacing.sm)) {
                        DeskButtonView(
                            label = if (sending) "Sending…" else "Send request",
                            enabled = !sending && amount.isNotBlank() && purpose.isNotBlank(),
                            busy = sending,
                            onClick = {
                                sending = true
                                error = null
                                scope.launch {
                                    val r = state.api.requestLoan(
                                        kind = kind,
                                        amountMinor = (amount.toLongOrNull() ?: 0L) * 100,
                                        months = months.toIntOrNull() ?: 1,
                                        purpose = purpose,
                                    )
                                    when (r) {
                                        is HrmsApi.Result.Ok -> {
                                            requesting = false; amount = ""; purpose = ""
                                            load()
                                        }
                                        // The server refuses over the ceiling
                                        // with a reason worth repeating exactly.
                                        is HrmsApi.Result.Failed -> error = r.message
                                        is HrmsApi.Result.Offline -> error = r.message
                                        HrmsApi.Result.Unauthorised -> error = "Sign in again."
                                    }
                                    sending = false
                                }
                            },
                        )
                        DeskButtonView("Cancel", { requesting = false }, variant = DeskButton.SECONDARY)
                    }
                }
            } else if (data.monthlyBasicMinor != null) {
                DeskButtonView("Ask for an advance", { requesting = true; error = null })
            }

            SectionTitle("Your requests")

            if (data.items.isEmpty()) {
                EmptyState("Nothing borrowed", "Advances and loans you ask for appear here.")
            } else {
                DeskCard {
                    TableHeader("Kind" to 1.4f, "Amount" to 1f, "Outstanding" to 1.2f, "Over" to 0.8f, "Status" to 1f)
                    data.items.forEach { l ->
                        TableRow {
                            Cell(words(l.kind), 1.4f, bold = true)
                            Cell(money(l.principalMinor), 1f)
                            Cell(money(l.outstandingMinor), 1.2f)
                            Cell("${l.months}m", 0.8f)
                            Box(Modifier.weight(1f)) {
                                StatusPill(
                                    words(l.status),
                                    when (l.status.lowercase()) {
                                        "approved", "active", "repaid" -> PillTone.SUCCESS
                                        "pending" -> PillTone.WARNING
                                        "rejected" -> PillTone.DANGER
                                        else -> PillTone.NEUTRAL
                                    },
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
