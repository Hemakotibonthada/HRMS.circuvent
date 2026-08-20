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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.circuvent.hrms.shared.api.HrmsApi
import com.circuvent.hrms.shared.model.RegularisationRequest
import com.circuvent.hrms.shared.model.WorkArrangementRequest
import java.time.LocalDate
import kotlinx.coroutines.launch

@Composable
private fun Sheet(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(Desk.spacing.lg),
        content = content,
    )
}

private fun label(value: String): String =
    value.replace('_', ' ').replaceFirstChar { it.uppercase() }

private fun statusTone(status: String): PillTone = when (status.lowercase()) {
    "approved" -> PillTone.SUCCESS
    "pending" -> PillTone.WARNING
    "rejected", "cancelled" -> PillTone.DANGER
    else -> PillTone.NEUTRAL
}

// ═══════════════════════════════════════════════════════════════
// WORKING ELSEWHERE
// ═══════════════════════════════════════════════════════════════

/**
 * A day worked from home or on duty elsewhere.
 *
 * Said plainly at the top that this is not leave, because it is the thing
 * people get wrong: a day worked from home is a day worked, and nothing comes
 * off a leave balance. Somebody who believes otherwise books leave they did not
 * need to spend.
 */
@Composable
fun WorkAwayScreen(state: AppState) {
    var requests by remember { mutableStateOf<Load<List<WorkArrangementRequest>>>(Load.Loading) }
    var composing by remember { mutableStateOf(false) }
    var kind by remember { mutableStateOf("wfh") }
    var from by remember { mutableStateOf("") }
    var to by remember { mutableStateOf("") }
    var where by remember { mutableStateOf("") }
    var why by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val scope = rememberCoroutineScope()

    suspend fun load() { requests = state.api.workArrangements().toLoad() }
    LaunchedEffect(Unit) { load() }

    Sheet {
        error?.let { ErrorBanner(it) }

        DeskCard {
            Text(
                "This is not leave",
                style = androidx.compose.material3.MaterialTheme.typography.titleMedium,
                color = Desk.colors.text,
            )
            Muted(
                "A day worked from home or on duty elsewhere counts as a day worked. " +
                    "Nothing comes off your leave balance.",
                Modifier.padding(top = Desk.spacing.xs),
            )
        }

        if (composing) {
            DeskCard {
                Row(horizontalArrangement = Arrangement.spacedBy(Desk.spacing.sm)) {
                    DeskButtonView(
                        "From home", { kind = "wfh" },
                        variant = if (kind == "wfh") DeskButton.PRIMARY else DeskButton.SECONDARY,
                    )
                    DeskButtonView(
                        "On duty", { kind = "on_duty" },
                        variant = if (kind == "on_duty") DeskButton.PRIMARY else DeskButton.SECONDARY,
                    )
                }

                Spacer(Modifier.height(Desk.spacing.md))

                Row(horizontalArrangement = Arrangement.spacedBy(Desk.spacing.md)) {
                    DeskDateField(
                        label = "First day",
                        value = from,
                        onValueChange = {
                            from = it
                            if (to.isBlank() || to < it) to = it
                        },
                        modifier = Modifier.weight(1f),
                    )
                    DeskDateField(
                        label = "Last day",
                        value = to,
                        onValueChange = { to = it },
                        minDate = runCatching { LocalDate.parse(from) }.getOrNull(),
                        modifier = Modifier.weight(1f),
                    )
                }

                if (kind == "on_duty") {
                    OutlinedTextField(
                        value = where,
                        onValueChange = { where = it },
                        label = { Text("Where") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth().padding(top = Desk.spacing.md),
                    )
                }

                OutlinedTextField(
                    value = why,
                    onValueChange = { why = it },
                    label = { Text("Why (optional)") },
                    modifier = Modifier.fillMaxWidth().padding(top = Desk.spacing.md),
                )

                Spacer(Modifier.height(Desk.spacing.md))
                Row(horizontalArrangement = Arrangement.spacedBy(Desk.spacing.sm)) {
                    DeskButtonView(
                        label = if (sending) "Sending…" else "Send for approval",
                        enabled = !sending && from.isNotBlank() && to.isNotBlank() &&
                            (kind != "on_duty" || where.isNotBlank()),
                        busy = sending,
                        onClick = {
                            sending = true
                            error = null
                            scope.launch {
                                val r = state.api.requestWorkArrangement(
                                    kind = kind,
                                    startDate = from,
                                    endDate = to,
                                    reason = why.takeIf { it.isNotBlank() },
                                    location = where.takeIf { it.isNotBlank() },
                                )
                                when (r) {
                                    is HrmsApi.Result.Ok -> {
                                        composing = false; from = ""; to = ""; why = ""; where = ""
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
        } else {
            DeskButtonView("Request a day away", { composing = true; error = null })
        }

        SectionTitle("Your requests")

        Loaded(requests) { list ->
            if (list.isEmpty()) {
                EmptyState("Nothing requested", "Days you ask to work elsewhere appear here.")
            } else {
                DeskCard {
                    TableHeader("Kind" to 1.2f, "From" to 1f, "To" to 1f, "Where" to 1.4f, "Status" to 1f)
                    list.forEach { r ->
                        TableRow {
                            Cell(label(r.kind), 1.2f, bold = true)
                            Cell(r.startDate, 1f)
                            Cell(r.endDate, 1f)
                            Cell(r.location ?: "—", 1.4f)
                            Box(Modifier.weight(1f)) { StatusPill(label(r.status), statusTone(r.status)) }
                        }
                    }
                }
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// CORRECTING A DAY
// ═══════════════════════════════════════════════════════════════

private val CORRECTION_REASONS = listOf(
    "missed_punch" to "I forgot to clock in or out",
    "wrong_time" to "The recorded time is wrong",
    "on_duty" to "I was working elsewhere, on duty",
    "work_from_home" to "I worked from home",
    "device_failure" to "The reader or app failed",
    "shift_change" to "My shift changed",
)

/**
 * Correcting an attendance record.
 *
 * The window is the last 30 days and the picker offers only those, rather than
 * accepting any date and refusing it afterwards. Times are chosen, not typed:
 * `HH:MM` in a text box has the same problem `YYYY-MM-DD` does, one punctuation
 * mark along.
 */
@Composable
fun CorrectionsScreen(state: AppState) {
    var requests by remember { mutableStateOf<Load<List<RegularisationRequest>>>(Load.Loading) }
    var composing by remember { mutableStateOf(false) }
    var day by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf(CORRECTION_REASONS.first().first) }
    var inAt by remember { mutableStateOf("") }
    var outAt by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val scope = rememberCoroutineScope()

    suspend fun load() { requests = state.api.regularisations().toLoad() }
    LaunchedEffect(Unit) { load() }

    Sheet {
        error?.let { ErrorBanner(it) }

        DeskCard {
            Text(
                "What you can correct",
                style = androidx.compose.material3.MaterialTheme.typography.titleMedium,
                color = Desk.colors.text,
            )
            Muted(
                "Days from the last 30 days, and up to 3 corrections a month.",
                Modifier.padding(top = Desk.spacing.xs),
            )
        }

        if (composing) {
            DeskCard {
                DeskDateField(
                    label = "Which day",
                    value = day,
                    onValueChange = { day = it },
                    minDate = LocalDate.now().minusDays(30),
                    maxDate = LocalDate.now(),
                    modifier = Modifier.fillMaxWidth(),
                )

                Spacer(Modifier.height(Desk.spacing.md))
                Muted("What happened")
                Column(Modifier.padding(top = Desk.spacing.xs)) {
                    CORRECTION_REASONS.forEach { (code, text) ->
                        Row(
                            Modifier.fillMaxWidth().padding(vertical = 2.dp()),
                            verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                        ) {
                            DeskButtonView(
                                label = text,
                                onClick = { reason = code },
                                variant = if (reason == code) DeskButton.PRIMARY else DeskButton.SECONDARY,
                            )
                        }
                    }
                }

                Row(
                    Modifier.padding(top = Desk.spacing.md),
                    horizontalArrangement = Arrangement.spacedBy(Desk.spacing.md),
                ) {
                    DeskTimeField("In", inAt, { inAt = it }, Modifier.weight(1f))
                    DeskTimeField("Out", outAt, { outAt = it }, Modifier.weight(1f))
                }

                OutlinedTextField(
                    value = note,
                    onValueChange = { note = it },
                    label = { Text("Say what happened") },
                    modifier = Modifier.fillMaxWidth().padding(top = Desk.spacing.md),
                )

                Spacer(Modifier.height(Desk.spacing.md))
                Row(horizontalArrangement = Arrangement.spacedBy(Desk.spacing.sm)) {
                    DeskButtonView(
                        label = if (sending) "Sending…" else "Send for approval",
                        enabled = !sending && day.isNotBlank() && note.isNotBlank() &&
                            (inAt.isNotBlank() || outAt.isNotBlank()),
                        busy = sending,
                        onClick = {
                            sending = true
                            error = null
                            scope.launch {
                                val r = state.api.requestRegularisation(
                                    workDate = day,
                                    clockIn = inAt.takeIf { it.isNotBlank() },
                                    clockOut = outAt.takeIf { it.isNotBlank() },
                                    reason = reason,
                                    note = note.takeIf { it.isNotBlank() },
                                )
                                when (r) {
                                    is HrmsApi.Result.Ok -> {
                                        composing = false; day = ""; inAt = ""; outAt = ""; note = ""
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
        } else {
            DeskButtonView("Correct a day", { composing = true; error = null })
        }

        SectionTitle("Your corrections")

        Loaded(requests) { list ->
            if (list.isEmpty()) {
                EmptyState("Nothing to correct", "Corrections you raise appear here with where they have got to.")
            } else {
                DeskCard {
                    TableHeader("Day" to 1.2f, "Reason" to 2f, "In" to 0.8f, "Out" to 0.8f, "Status" to 1f)
                    list.forEach { r ->
                        TableRow {
                            Cell(r.workDate, 1.2f, bold = true)
                            Cell(
                                CORRECTION_REASONS.firstOrNull { it.first == r.reason }?.second
                                    ?: label(r.reason ?: "—"),
                                2f,
                            )
                            Cell(r.requestedClockIn ?: "—", 0.8f)
                            Cell(r.requestedClockOut ?: "—", 0.8f)
                            Box(Modifier.weight(1f)) { StatusPill(label(r.status), statusTone(r.status)) }
                        }
                    }
                }
            }
        }
    }
}

private fun Int.dp() = androidx.compose.ui.unit.Dp(this.toFloat())
