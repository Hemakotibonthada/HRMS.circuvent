package com.circuvent.hrms.feature

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.EditCalendar
import androidx.compose.material.icons.filled.FactCheck
import androidx.compose.material.icons.filled.Home
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
import com.circuvent.hrms.core.design.AccentTone
import com.circuvent.hrms.core.design.Theme
import com.circuvent.hrms.core.ui.AccentBadge
import com.circuvent.hrms.core.ui.AppButton
import com.circuvent.hrms.core.ui.AppCard
import com.circuvent.hrms.core.ui.AppText
import com.circuvent.hrms.core.ui.Banner
import com.circuvent.hrms.core.ui.BannerTone
import com.circuvent.hrms.core.ui.ButtonVariant
import com.circuvent.hrms.core.ui.EmptyState
import com.circuvent.hrms.core.ui.Glyph
import com.circuvent.hrms.core.ui.SectionHeading
import com.circuvent.hrms.core.ui.SkeletonRows
import com.circuvent.hrms.core.ui.TextTone
import com.circuvent.hrms.core.ui.screenPadding
import com.circuvent.hrms.AppContainer
import com.circuvent.hrms.data.SessionUser
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

/**
 * One thing waiting for a decision, whatever kind of request it started as.
 *
 * Three queues feed this screen and all three word their decision differently:
 * leave takes the verb ("approve"), while work arrangements and
 * regularisations take the resulting status ("approved"). That asymmetry is
 * real and cannot be fixed from here without changing three server contracts,
 * so it is absorbed once — in [approve] and [reject] — rather than left as a
 * `when` in the screen that somebody eventually gets backwards. Sending
 * "approve" where "approved" was expected fails loudly; sending it the other
 * way round has, in other codebases, silently written a status no reader
 * recognised.
 */
private sealed interface InboxItem {
    val id: String
    val person: String
    val title: String
    val detail: String
    val period: String
    val requesterId: String
    val glyph: Glyph
    val tone: AccentTone

    suspend fun approve(container: AppContainer)

    suspend fun reject(container: AppContainer, reason: String)

    data class Leave(
        override val id: String,
        override val person: String,
        override val title: String,
        override val detail: String,
        override val period: String,
        override val requesterId: String,
    ) : InboxItem {
        override val glyph = Glyph.Vector(Icons.Filled.CalendarMonth)
        override val tone = AccentTone.Violet

        override suspend fun approve(container: AppContainer) =
            container.repository.decideLeave(id, "approve", null)

        override suspend fun reject(container: AppContainer, reason: String) =
            container.repository.decideLeave(id, "reject", reason)
    }

    data class Arrangement(
        override val id: String,
        override val person: String,
        override val title: String,
        override val detail: String,
        override val period: String,
        override val requesterId: String,
    ) : InboxItem {
        override val glyph = Glyph.Vector(Icons.Filled.Home)
        override val tone = AccentTone.Teal

        override suspend fun approve(container: AppContainer) =
            container.repository.decideWorkArrangement(id, "approved", null)

        override suspend fun reject(container: AppContainer, reason: String) =
            container.repository.decideWorkArrangement(id, "rejected", reason)
    }

    data class Regularisation(
        override val id: String,
        override val person: String,
        override val title: String,
        override val detail: String,
        override val period: String,
        override val requesterId: String,
    ) : InboxItem {
        override val glyph = Glyph.Vector(Icons.Filled.EditCalendar)
        override val tone = AccentTone.Amber

        override suspend fun approve(container: AppContainer) =
            container.repository.decideRegularisation(id, "approved", null)

        override suspend fun reject(container: AppContainer, reason: String) =
            container.repository.decideRegularisation(id, "rejected", reason)
    }

    /**
     * A step in the generic workflow engine.
     *
     * Anything routed for approval that is not one of the three above arrives
     * here, which is why it carries an entity type instead of a name. It is the
     * one kind whose subject the phone cannot resolve — the engine returns an
     * id and a type, not a person — so the card says what it honestly knows
     * rather than inventing a requester.
     */
    data class Workflow(
        override val id: String,
        override val title: String,
        override val detail: String,
        override val period: String,
    ) : InboxItem {
        override val person = "Awaiting your approval"
        override val requesterId = ""
        override val glyph = Glyph.Vector(Icons.Filled.FactCheck)
        override val tone = AccentTone.Blue

        override suspend fun approve(container: AppContainer) =
            container.repository.decideWorkflow(id, approved = true, comment = null)

        override suspend fun reject(container: AppContainer, reason: String) =
            container.repository.decideWorkflow(id, approved = false, comment = reason)
    }
}

/**
 * Everything waiting on this person, in one list.
 *
 * Before this screen existed the three queues lived on three different pages,
 * and a manager had to know that a work-from-home request is not a leave
 * request in order to find it. Requests were being missed for days — not
 * refused, just never seen.
 *
 * The three loads run concurrently and are merged. One queue failing does not
 * blank the screen: a manager who can still act on eight leave requests should
 * be allowed to, and told separately that regularisations could not be
 * fetched. Hiding everything because one call failed is the behaviour that
 * caused the missed requests in the first place.
 */
@Composable
fun InboxScreen(container: AppContainer, user: SessionUser?) {
    var items by remember { mutableStateOf<List<InboxItem>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var partial by remember { mutableStateOf<List<String>>(emptyList()) }
    var busyId by remember { mutableStateOf<String?>(null) }
    var rejecting by remember { mutableStateOf<String?>(null) }
    var reason by remember { mutableStateOf("") }
    var reasonError by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<Pair<String, String?>?>(null) }

    val scope = rememberCoroutineScope()

    suspend fun load() {
        val failures = mutableListOf<String>()

        coroutineScope {
            val leaveJob = async {
                runCatching { container.repository.pendingLeave() }
            }
            val arrangementJob = async {
                runCatching { container.repository.workArrangements(queue = true).requests }
            }
            val regularisationJob = async {
                runCatching { container.repository.regularisations(queue = true).requests }
            }
            val workflowJob = async {
                runCatching { container.repository.pendingApprovals().pending }
            }

            val collected = mutableListOf<InboxItem>()

            leaveJob.await()
                .onSuccess { list ->
                    list.filter { it.status == "pending" }.forEach { row ->
                        collected += InboxItem.Leave(
                            id = row.id,
                            person = row.employeeName?.takeIf { it.isNotBlank() } ?: "A colleague",
                            title = row.leaveType.ifBlank { "Leave" },
                            detail = row.reason.ifBlank { "No reason given" },
                            period = periodOf(row.startDate, row.endDate) +
                                " · ${trimDays(row.totalDays)} day${if (row.totalDays == 1.0) "" else "s"}",
                            requesterId = row.employeeId,
                        )
                    }
                }
                .onFailure { failures += "leave" }

            arrangementJob.await()
                .onSuccess { list ->
                    list.filter { it.status == "pending" }.forEach { row ->
                        collected += InboxItem.Arrangement(
                            id = row.id,
                            person = row.employeeName.takeIf { it.isNotBlank() } ?: "A colleague",
                            title = if (row.kind == "on_duty") "On duty" else "Work from home",
                            detail = listOfNotNull(
                                row.location?.takeIf { it.isNotBlank() },
                                row.reason?.takeIf { it.isNotBlank() },
                            ).joinToString(" · ").ifBlank { "No reason given" },
                            period = periodOf(row.startDate, row.endDate),
                            requesterId = row.employeeId,
                        )
                    }
                }
                .onFailure { failures += "work arrangements" }

            regularisationJob.await()
                .onSuccess { list ->
                    list.filter { it.status == "pending" }.forEach { row ->
                        collected += InboxItem.Regularisation(
                            id = row.id,
                            person = row.employeeName.takeIf { it.isNotBlank() } ?: "A colleague",
                            title = "Attendance correction",
                            detail = listOfNotNull(
                                row.reason.takeIf { it.isNotBlank() },
                                listOfNotNull(row.inTime, row.outTime)
                                    .joinToString(" to ")
                                    .takeIf { it.isNotBlank() },
                            ).joinToString(" · ").ifBlank { "No reason given" },
                            period = row.attendanceDate,
                            requesterId = row.employeeId,
                        )
                    }
                }
                .onFailure { failures += "regularisations" }

            workflowJob.await()
                .onSuccess { list ->
                    list.forEach { row ->
                        collected += InboxItem.Workflow(
                            id = row.instanceId,
                            title = row.stepName.ifBlank { "Approval" },
                            detail = buildString {
                                append(humanEntity(row.entityType))
                                if (row.isOverdue) append(" · Overdue")
                            },
                            period = row.dueAt?.take(10).orEmpty(),
                        )
                    }
                }
                .onFailure { failures += "workflow approvals" }

            // Oldest first. Somebody who has been waiting a week should not be
            // pushed below somebody who asked this morning. Workflow steps
            // without a due date sort last rather than first: a blank string
            // would otherwise beat every real date.
            items = collected.sortedBy { it.period.ifBlank { "9999-12-31" } }
            partial = failures
        }

        loading = false
    }

    LaunchedEffect(Unit) { load() }

    fun decide(item: InboxItem, approve: Boolean, why: String?) {
        busyId = item.id
        error = null
        scope.launch {
            try {
                if (approve) item.approve(container) else item.reject(container, why.orEmpty())
                rejecting = null
                reason = ""
                // Reloaded rather than removed locally: another manager may
                // have acted while this screen was open, and a queue that no
                // longer matches the server invites a second decision on an
                // already-decided request.
                load()
            } catch (e: Exception) {
                error = "The decision was not recorded" to e.message
            } finally {
                busyId = null
            }
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = screenPadding(bottomExtra = TabBarHeight),
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.md),
    ) {
        error?.let { (title, description) ->
            item { Banner(BannerTone.ERROR, title, description = description) }
        }

        if (partial.isNotEmpty()) {
            item {
                Banner(
                    BannerTone.WARNING,
                    "Part of your inbox could not be loaded",
                    description = "Anything waiting under ${partial.joinToString(" and ")} is missing " +
                        "from this list. Pull down to try again.",
                )
            }
        }

        item {
            when {
                loading -> SkeletonRows(count = 3, rowHeight = 150.dp)
                items.isEmpty() && partial.isEmpty() -> EmptyState(
                    title = "You are all caught up",
                    description = "Leave, work-from-home and attendance corrections needing your " +
                        "decision arrive here as soon as they are submitted.",
                )
            }
        }

        items(items, key = { "${it::class.simpleName}:${it.id}" }) { item ->
            // The server refuses a self-approval, and this mirrors it so the
            // refusal is visible before the tap rather than after it.
            val isOwn = item.requesterId == user?.employeeId || item.requesterId == user?.id

            AppCard {
                Row(verticalAlignment = Alignment.Top) {
                    AccentBadge(glyph = item.glyph, tone = item.tone)
                    Spacer(Modifier.width(Theme.spacing.md))
                    Column(Modifier.weight(1f)) {
                        AppText(item.person, weight = FontWeight.SemiBold)
                        AppText(
                            item.title,
                            size = Theme.type.footnote,
                            lineHeight = Theme.type.footnoteLine,
                            tone = TextTone.PRIMARY,
                        )
                    }
                }

                Spacer(Modifier.height(Theme.spacing.md))
                AppText(item.period, size = Theme.type.footnote, lineHeight = Theme.type.footnoteLine)
                AppText(
                    item.detail,
                    size = Theme.type.caption,
                    lineHeight = Theme.type.captionLine,
                    tone = TextTone.MUTED,
                )

                Spacer(Modifier.height(Theme.spacing.md))

                if (isOwn) {
                    Banner(
                        BannerTone.INFO,
                        "This is your own request",
                        description = "Someone else has to decide it.",
                    )
                } else if (rejecting == item.id) {
                    OutlinedTextField(
                        value = reason,
                        onValueChange = { reason = it.take(1000) },
                        label = { Text("Reason for rejection") },
                        // Somebody told only "rejected" has to come back and
                        // ask what was wrong, which is a conversation the
                        // system could have saved them.
                        supportingText = { Text(reasonError ?: "They will see this.") },
                        isError = reasonError != null,
                        minLines = 2,
                        enabled = busyId != item.id,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(Theme.spacing.sm))
                    Row(horizontalArrangement = Arrangement.spacedBy(Theme.spacing.sm)) {
                        AppButton(
                            label = "Confirm rejection",
                            variant = ButtonVariant.DANGER,
                            fullWidth = false,
                            busy = busyId == item.id,
                            onClick = {
                                // Matches the server, which refuses a rejection
                                // under three characters.
                                if (reason.trim().length < 3) {
                                    reasonError = "Give a reason. The person needs to know why."
                                } else {
                                    reasonError = null
                                    decide(item, approve = false, why = reason.trim())
                                }
                            },
                        )
                        AppButton(
                            label = "Back",
                            variant = ButtonVariant.GHOST,
                            fullWidth = false,
                            onClick = { rejecting = null; reason = ""; reasonError = null },
                        )
                    }
                } else {
                    Row(horizontalArrangement = Arrangement.spacedBy(Theme.spacing.sm)) {
                        AppButton(
                            label = "Approve",
                            fullWidth = false,
                            busy = busyId == item.id,
                            onClick = { decide(item, approve = true, why = null) },
                            contentDescription = "Approve ${item.person}'s ${item.title.lowercase()} request",
                        )
                        AppButton(
                            label = "Reject",
                            variant = ButtonVariant.SECONDARY,
                            fullWidth = false,
                            enabled = busyId != item.id,
                            onClick = { rejecting = item.id; reason = ""; reasonError = null },
                        )
                    }
                }
            }
        }
    }
}

private fun periodOf(from: String, to: String): String =
    if (from == to || to.isBlank()) from else "$from to $to"

/**
 * Turns a workflow entity type into something readable.
 *
 * The engine names its entities in snake_case after the table they live in.
 * Falling back to a de-underscored version is not a translation, but it beats
 * showing "expense_claim" to somebody being asked to approve one.
 */
private fun humanEntity(entityType: String): String = when (entityType) {
    "" -> "A request"
    "leave_request" -> "Leave request"
    "expense_claim" -> "Expense claim"
    "timesheet" -> "Timesheet"
    else -> entityType.replace('_', ' ').replaceFirstChar { it.uppercase() }
}

/** 1.0 reads as "1 day", not "1.0 days"; 1.5 has to keep its half. */
private fun trimDays(value: Double): String =
    if (value % 1.0 == 0.0) value.toInt().toString() else value.toString()
