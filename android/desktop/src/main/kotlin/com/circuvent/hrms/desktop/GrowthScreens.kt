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
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
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
import androidx.compose.ui.unit.dp
import com.circuvent.hrms.shared.api.HrmsApi
import com.circuvent.hrms.shared.model.AssetItem
import com.circuvent.hrms.shared.model.BenefitEnrolment
import com.circuvent.hrms.shared.model.BenefitPlan
import com.circuvent.hrms.shared.model.Course
import com.circuvent.hrms.shared.model.Enrolment
import com.circuvent.hrms.shared.model.Goal
import com.circuvent.hrms.shared.model.ReviewCycle
import com.circuvent.hrms.shared.model.ShiftSwap
import com.circuvent.hrms.shared.model.TaxDeclaration
import kotlinx.coroutines.launch

@Composable
private fun Sheet(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(Desk.spacing.lg),
        content = content,
    )
}

private fun pretty(value: String): String =
    value.replace('_', ' ').replaceFirstChar { it.uppercase() }

private fun rupeesOf(minor: Long): String {
    val whole = minor / 100
    val text = whole.toString()
    if (text.length <= 3) return "₹$text"
    val last3 = text.takeLast(3)
    val rest = text.dropLast(3)
    return "₹" + rest.reversed().chunked(2).joinToString(",").reversed() + ",$last3"
}

private fun statusPill(status: String): PillTone = when (status.lowercase()) {
    "completed", "approved", "active", "enrolled", "achieved", "assigned" -> PillTone.SUCCESS
    "in_progress", "pending", "open", "draft" -> PillTone.WARNING
    "rejected", "overdue", "missed", "returned" -> PillTone.DANGER
    else -> PillTone.NEUTRAL
}

// ═══════════════════════════════════════════════════════════════
// GOALS
// ═══════════════════════════════════════════════════════════════

/**
 * Goals for a review cycle, with progress recorded where it happens.
 *
 * The slider is on the row rather than behind a detail screen, because the
 * point of having this anywhere other than a spreadsheet is that progress gets
 * recorded when it is made instead of reconstructed in December.
 *
 * A parent goal refuses with a 409 explaining that it computes from its
 * children; that message is shown as-is rather than replaced with "failed".
 */
@Composable
fun GoalsScreen(state: AppState) {
    var cycles by remember { mutableStateOf<Load<List<ReviewCycle>>>(Load.Loading) }
    var chosen by remember { mutableStateOf<String?>(null) }
    var goals by remember { mutableStateOf<Load<List<Goal>>>(Load.Loading) }
    var busyId by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        val result = state.api.reviewCycles().toLoad()
        cycles = result
        if (result is Load.Ready) chosen = result.value.firstOrNull()?.id
    }

    LaunchedEffect(chosen) {
        val id = chosen
        goals = if (id == null) Load.Ready(emptyList()) else state.api.goals(id).toLoad()
    }

    Sheet {
        error?.let { ErrorBanner(it) }

        Loaded(cycles) { list ->
            if (list.isEmpty()) {
                EmptyState("No review cycle", "Goals belong to a review cycle, and none is open yet.")
                return@Loaded
            }

            Row(horizontalArrangement = Arrangement.spacedBy(Desk.spacing.sm)) {
                list.forEach { c ->
                    DeskButtonView(
                        label = c.name.ifBlank { pretty(c.status) },
                        onClick = { chosen = c.id },
                        variant = if (chosen == c.id) DeskButton.PRIMARY else DeskButton.SECONDARY,
                    )
                }
            }
        }

        Loaded(goals) { list ->
            if (list.isEmpty()) {
                EmptyState("No goals yet", "Goals set for you in this cycle appear here.")
            } else {
                list.forEach { goal ->
                    var local by remember(goal.id) { mutableStateOf(goal.progressPercent.toFloat()) }

                    DeskCard {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(
                                    goal.title,
                                    style = MaterialTheme.typography.titleMedium,
                                    color = Desk.colors.text,
                                )
                                goal.description?.takeIf { it.isNotBlank() }?.let { Muted(it) }
                            }
                            StatusPill(pretty(goal.status), statusPill(goal.status))
                        }

                        Spacer(Modifier.height(Desk.spacing.md))

                        if (goal.parentGoalId == null) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Slider(
                                    value = local,
                                    onValueChange = { local = it },
                                    valueRange = 0f..100f,
                                    steps = 19,
                                    modifier = Modifier.weight(1f),
                                )
                                Spacer(Modifier.width(Desk.spacing.md))
                                Text(
                                    "${local.toInt()}%",
                                    style = MaterialTheme.typography.titleMedium,
                                    color = Desk.colors.text,
                                )
                                Spacer(Modifier.width(Desk.spacing.md))
                                DeskButtonView(
                                    label = "Save",
                                    enabled = busyId != goal.id && local.toInt() != goal.progressPercent,
                                    busy = busyId == goal.id,
                                    onClick = {
                                        busyId = goal.id
                                        error = null
                                        scope.launch {
                                            val r = state.api.setGoalProgress(goal.id, local.toInt())
                                            when (r) {
                                                is HrmsApi.Result.Ok ->
                                                    chosen?.let { goals = state.api.goals(it).toLoad() }
                                                // 409 for a parent goal says
                                                // exactly why; repeat it.
                                                is HrmsApi.Result.Failed -> error = r.message
                                                is HrmsApi.Result.Offline -> error = r.message
                                                HrmsApi.Result.Unauthorised -> error = "Sign in again."
                                            }
                                            busyId = null
                                        }
                                    },
                                )
                            }
                        } else {
                            LinearProgressIndicator(
                                progress = { goal.progressPercent / 100f },
                                modifier = Modifier.fillMaxWidth(),
                            )
                            Muted(
                                "${goal.progressPercent}% · rolls up from its parent goal",
                                Modifier.padding(top = Desk.spacing.xs),
                            )
                        }
                    }
                }
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// TAX
// ═══════════════════════════════════════════════════════════════

/**
 * The investment declaration.
 *
 * Declared and proved are shown side by side because they are different
 * numbers and only one of them reduces tax. Somebody who declares 150,000 and
 * proves nothing finds out in February, from a payslip, when it is too late to
 * do anything about it.
 */
@Composable
fun TaxScreen(state: AppState) {
    var declaration by remember { mutableStateOf<Load<TaxDeclaration>>(Load.Loading) }
    LaunchedEffect(Unit) { declaration = state.api.taxDeclaration().toLoad() }

    Sheet {
        Loaded(declaration) { d ->
            DeskCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        SectionTitle("Financial year ${d.financialYear.ifBlank { "—" }}")
                        Muted("Regime: ${pretty(d.regime.ifBlank { "not chosen" })}")
                    }
                    if (d.annualRentMinor > 0) {
                        StatusPill(
                            if (d.metroCity) "Metro" else "Non-metro",
                            PillTone.INFO,
                        )
                    }
                }
            }

            if (d.items.isEmpty()) {
                EmptyState(
                    "Nothing declared",
                    "Investment declarations for this year appear here once you make them.",
                )
            } else {
                DeskCard {
                    TableHeader("Section" to 1f, "What" to 2f, "Declared" to 1f, "Proved" to 1f)
                    d.items.forEach { i ->
                        TableRow {
                            Cell(i.section, 1f, bold = true)
                            Cell(i.label, 2f)
                            Cell(rupeesOf(i.declaredMinor), 1f)
                            Cell(rupeesOf(i.provedMinor), 1f)
                        }
                    }
                }

                val declared = d.items.sumOf { it.declaredMinor }
                val proved = d.items.sumOf { it.provedMinor }
                if (declared > proved) {
                    DeskCard {
                        Text(
                            "You have declared ${rupeesOf(declared)} and proved ${rupeesOf(proved)}.",
                            style = MaterialTheme.typography.titleMedium,
                            color = Desk.colors.text,
                        )
                        Muted(
                            "Only what is proved reduces tax. The difference is " +
                                "${rupeesOf(declared - proved)}, and payroll will treat it as undeclared " +
                                "unless proof arrives before the cut-off.",
                            Modifier.padding(top = Desk.spacing.xs),
                        )
                    }
                }
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// BENEFITS AND ASSETS
// ═══════════════════════════════════════════════════════════════

@Composable
fun BenefitsScreen(state: AppState) {
    var plans by remember { mutableStateOf<Load<List<BenefitPlan>>>(Load.Loading) }
    var mine by remember { mutableStateOf<Load<List<BenefitEnrolment>>>(Load.Loading) }

    LaunchedEffect(Unit) {
        plans = state.api.benefitPlans().toLoad()
        mine = state.api.benefitEnrolments().toLoad()
    }

    Sheet {
        SectionTitle("You are enrolled in")
        Loaded(mine) { list ->
            if (list.isEmpty()) EmptyState("Not enrolled", "Benefits you join appear here.")
            else DeskCard {
                TableHeader("Plan" to 2.4f, "Joined" to 1.2f, "Status" to 1f)
                list.forEach { e ->
                    TableRow {
                        Cell(e.planName ?: e.planId, 2.4f, bold = true)
                        Cell(e.enrolledAt?.take(10) ?: "—", 1.2f)
                        Box(Modifier.weight(1f)) { StatusPill(pretty(e.status), statusPill(e.status)) }
                    }
                }
            }
        }

        SectionTitle("Available")
        Loaded(plans) { list ->
            if (list.isEmpty()) EmptyState("No plans", "Your company has not published any benefit plans.")
            else DeskCard {
                TableHeader("Plan" to 2f, "Category" to 1.2f, "You pay" to 1.2f)
                list.forEach { p ->
                    TableRow {
                        Cell(p.name, 2f, bold = true)
                        Cell(pretty(p.category ?: "—"), 1.2f)
                        Cell(p.employeeContributionMinor?.let { rupeesOf(it) } ?: "—", 1.2f)
                    }
                }
            }
        }
    }
}

@Composable
fun AssetsScreen(state: AppState) {
    var items by remember { mutableStateOf<Load<List<AssetItem>>>(Load.Loading) }
    LaunchedEffect(Unit) { items = state.api.assets().toLoad() }

    Sheet {
        Loaded(items) { list ->
            if (list.isEmpty()) {
                EmptyState("Nothing assigned", "Equipment issued to you appears here.")
            } else {
                DeskCard {
                    TableHeader("Asset" to 2f, "Tag" to 1.2f, "Category" to 1.2f, "Since" to 1.2f, "Status" to 1f)
                    list.forEach { a ->
                        TableRow {
                            Cell(a.name, 2f, bold = true)
                            Cell(a.assetTag ?: "—", 1.2f)
                            Cell(pretty(a.category ?: "—"), 1.2f)
                            Cell(a.assignedAt?.take(10) ?: "—", 1.2f)
                            Box(Modifier.weight(1f)) { StatusPill(pretty(a.status), statusPill(a.status)) }
                        }
                    }
                }
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// LEARNING
// ═══════════════════════════════════════════════════════════════

@Composable
fun LearningScreen(state: AppState) {
    var courses by remember { mutableStateOf<Load<List<Course>>>(Load.Loading) }
    var mine by remember { mutableStateOf<Load<List<Enrolment>>>(Load.Loading) }

    LaunchedEffect(Unit) {
        courses = state.api.courses().toLoad()
        mine = state.api.enrolments().toLoad()
    }

    Sheet {
        SectionTitle("Your courses")
        Loaded(mine) { list ->
            if (list.isEmpty()) EmptyState("Nothing started", "Courses you enrol on appear here.")
            else DeskCard {
                TableHeader("Course" to 2.4f, "Progress" to 1.2f, "Status" to 1f)
                list.forEach { e ->
                    TableRow {
                        Cell(e.courseTitle ?: e.courseId, 2.4f, bold = true)
                        Cell("${e.progressPercent}%", 1.2f)
                        Box(Modifier.weight(1f)) { StatusPill(pretty(e.status), statusPill(e.status)) }
                    }
                }
            }
        }

        SectionTitle("Catalogue")
        Loaded(courses) { list ->
            if (list.isEmpty()) EmptyState("No courses", "Your company has not published a catalogue.")
            else DeskCard {
                TableHeader("Course" to 2.4f, "Category" to 1.2f, "Length" to 1f, "Required" to 1f)
                list.forEach { c ->
                    TableRow {
                        Cell(c.title, 2.4f, bold = true)
                        Cell(pretty(c.category ?: "—"), 1.2f)
                        Cell(c.durationMinutes?.let { "${it / 60}h ${it % 60}m" } ?: "—", 1f)
                        Box(Modifier.weight(1f)) {
                            if (c.isMandatory) StatusPill("Required", PillTone.WARNING)
                            else Muted("Optional")
                        }
                    }
                }
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// SHIFT SWAPS
// ═══════════════════════════════════════════════════════════════

@Composable
fun SwapsScreen(state: AppState) {
    var swaps by remember { mutableStateOf<Load<List<ShiftSwap>>>(Load.Loading) }
    LaunchedEffect(Unit) { swaps = state.api.shiftSwaps().toLoad() }

    Sheet {
        Loaded(swaps) { list ->
            if (list.isEmpty()) {
                EmptyState("No swaps", "Shifts colleagues offer, and ones you offer, appear here.")
            } else {
                DeskCard {
                    TableHeader("Who" to 1.8f, "Shift" to 1.4f, "Note" to 2f, "Status" to 1f)
                    list.forEach { s ->
                        TableRow {
                            Cell(s.requesterName ?: "A colleague", 1.8f, bold = true)
                            Cell(s.shiftDate, 1.4f)
                            Cell(s.note ?: "—", 2f)
                            Box(Modifier.weight(1f)) { StatusPill(pretty(s.status), statusPill(s.status)) }
                        }
                    }
                }
            }
        }
    }
}
