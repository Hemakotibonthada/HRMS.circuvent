package com.circuvent.hrms.feature

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import com.circuvent.hrms.AppContainer
import com.circuvent.hrms.core.design.Theme
import com.circuvent.hrms.core.ui.AppButton
import com.circuvent.hrms.core.ui.AppCard
import com.circuvent.hrms.core.ui.AppText
import com.circuvent.hrms.core.ui.Banner
import com.circuvent.hrms.core.ui.BannerTone
import com.circuvent.hrms.core.ui.ButtonVariant
import com.circuvent.hrms.core.ui.EmptyState
import com.circuvent.hrms.core.ui.PillTone
import com.circuvent.hrms.core.ui.SkeletonRows
import com.circuvent.hrms.core.ui.StatusPill
import com.circuvent.hrms.core.ui.TextTone
import com.circuvent.hrms.core.ui.screenPadding
import com.circuvent.hrms.data.WorkArrangementCreate
import com.circuvent.hrms.data.WorkArrangementDto
import com.circuvent.hrms.data.WorkArrangementsResponse
import kotlinx.coroutines.launch

// ═══════════════════════════════════════════════════════════════
// WORKING AWAY — from home, or on duty elsewhere
// ═══════════════════════════════════════════════════════════════
//
// Kept away from the Leave tab on purpose. A day worked from home is a day
// worked: nothing is deducted, no balance moves, and putting it beside a leave
// balance invites people to believe it costs them one. The screen says so once,
// plainly, because it is the assumption everybody arrives with.

private fun kindLabel(kind: String): String =
    if (kind == "on_duty") "On duty" else "Working from home"

private fun statusTone(status: String): PillTone = when (status) {
    "approved" -> PillTone.SUCCESS
    "rejected" -> PillTone.DANGER
    "cancelled" -> PillTone.NEUTRAL
    else -> PillTone.WARNING
}

private val MONTHS = listOf(
    "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
)

private fun shortDate(iso: String): String {
    if (iso.length < 10) return iso
    val month = iso.substring(5, 7).toIntOrNull() ?: return iso
    return "${iso.substring(8, 10).trimStart('0')} ${MONTHS.getOrElse(month) { "" }}"
}

@Composable
fun WorkArrangementScreen(container: AppContainer) {
    var state by remember { mutableStateOf<Loaded<WorkArrangementsResponse>>(Loaded.Loading) }
    var showForm by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<Pair<BannerTone, String>?>(null) }

    var kind by remember { mutableStateOf("wfh") }
    var startDate by remember { mutableStateOf("") }
    var endDate by remember { mutableStateOf("") }
    var location by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf("") }
    var submitting by remember { mutableStateOf(false) }

    val scope = rememberCoroutineScope()

    suspend fun load() {
        state = try {
            Loaded.Ready(container.repository.workArrangements())
        } catch (e: Throwable) {
            failureOf("Your requests", e)
        }
    }

    LaunchedEffect(Unit) { load() }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = screenPadding(),
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm),
    ) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm)) {
                message?.let { (tone, text) -> Banner(tone, text) }

                // The assumption everybody arrives with, corrected once.
                AppCard {
                    AppText("This is not leave", weight = FontWeight.SemiBold)
                    AppText(
                        "A day worked from home or on duty elsewhere counts as a day worked. " +
                            "Nothing comes off your leave balance.",
                        tone = TextTone.MUTED,
                        size = Theme.type.footnote,
                        lineHeight = Theme.type.footnoteLine,
                    )
                }

                if (!showForm) {
                    AppButton(label = "Request a day away", onClick = { showForm = true })
                } else {
                    AppCard {
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(Theme.spacing.xs),
                        ) {
                            AppButton(
                                label = "From home",
                                variant = if (kind == "wfh") ButtonVariant.PRIMARY
                                else ButtonVariant.SECONDARY,
                                fullWidth = false,
                                onClick = { kind = "wfh" },
                                modifier = Modifier.weight(1f),
                            )
                            AppButton(
                                label = "On duty",
                                variant = if (kind == "on_duty") ButtonVariant.PRIMARY
                                else ButtonVariant.SECONDARY,
                                fullWidth = false,
                                onClick = { kind = "on_duty" },
                                modifier = Modifier.weight(1f),
                            )
                        }

                        OutlinedTextField(
                            value = startDate,
                            onValueChange = { startDate = it },
                            label = { Text("First day (YYYY-MM-DD)") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth().padding(top = Theme.spacing.xs),
                        )
                        OutlinedTextField(
                            value = endDate,
                            onValueChange = { endDate = it },
                            label = { Text("Last day (YYYY-MM-DD)") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth().padding(top = Theme.spacing.xs),
                        )

                        // Only asked for where it is required, and the label says
                        // why rather than marking it with an asterisk.
                        if (kind == "on_duty") {
                            OutlinedTextField(
                                value = location,
                                onValueChange = { location = it },
                                label = { Text("Where you will be") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth().padding(top = Theme.spacing.xs),
                            )
                        }

                        OutlinedTextField(
                            value = reason,
                            onValueChange = { reason = it },
                            label = { Text("Why (optional)") },
                            modifier = Modifier.fillMaxWidth().padding(top = Theme.spacing.xs),
                        )

                        AppButton(
                            label = if (submitting) "Sending…" else "Send for approval",
                            enabled = !submitting && startDate.isNotBlank() && endDate.isNotBlank() &&
                                (kind != "on_duty" || location.isNotBlank()),
                            busy = submitting,
                            modifier = Modifier.padding(top = Theme.spacing.sm),
                            onClick = {
                                submitting = true
                                message = null
                                scope.launch {
                                    try {
                                        container.repository.requestWorkArrangement(
                                            WorkArrangementCreate(
                                                kind = kind,
                                                startDate = startDate.trim(),
                                                endDate = endDate.trim(),
                                                reason = reason.takeIf { it.isNotBlank() },
                                                location = location.takeIf { it.isNotBlank() },
                                            )
                                        )
                                        showForm = false
                                        startDate = ""; endDate = ""; location = ""; reason = ""
                                        load()
                                        message = BannerTone.SUCCESS to "Sent for approval."
                                    } catch (e: Throwable) {
                                        message = BannerTone.ERROR to
                                            (e.message ?: "The request could not be sent.")
                                    } finally {
                                        submitting = false
                                    }
                                }
                            },
                        )
                        AppButton(
                            label = "Cancel",
                            variant = ButtonVariant.SECONDARY,
                            onClick = { showForm = false },
                        )
                    }
                }

                SectionLabel("Your requests")
            }
        }

        val ready = state as? Loaded.Ready
        when {
            state is Loaded.Loading -> item { SkeletonRows(count = 3, rowHeight = 88.dp) }
            state is Loaded.Failed -> item {
                val failed = state as Loaded.Failed
                Banner(BannerTone.ERROR, failed.title, description = failed.description)
            }
            ready != null && ready.value.requests.isEmpty() -> item {
                EmptyState(
                    title = "Nothing requested",
                    description = "Days you ask to work from home or elsewhere appear here.",
                )
            }
            ready != null -> items(ready.value.requests, key = { it.id }) { request ->
                WorkArrangementRow(request)
            }
        }
    }
}

@Composable
private fun WorkArrangementRow(request: WorkArrangementDto) {
    AppCard(
        contentDescription =
            "${kindLabel(request.kind)}, ${shortDate(request.startDate)} to " +
                "${shortDate(request.endDate)}, ${request.status}",
    ) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AppText(kindLabel(request.kind), weight = FontWeight.Medium)
            StatusPill(
                request.status.replaceFirstChar { it.uppercase() },
                statusTone(request.status),
            )
        }

        AppText(
            if (request.startDate == request.endDate) shortDate(request.startDate)
            else "${shortDate(request.startDate)} – ${shortDate(request.endDate)}",
            tone = TextTone.MUTED,
            size = Theme.type.footnote,
        )

        request.location?.takeIf { it.isNotBlank() }?.let {
            AppText("at $it", tone = TextTone.MUTED, size = Theme.type.caption)
        }
        request.decisionReason?.takeIf { it.isNotBlank() }?.let {
            AppText("Reason: $it", tone = TextTone.MUTED, size = Theme.type.caption)
        }
    }
}
