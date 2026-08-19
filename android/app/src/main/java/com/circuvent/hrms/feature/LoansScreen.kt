package com.circuvent.hrms.feature

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
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
import androidx.compose.ui.text.input.KeyboardType
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
import com.circuvent.hrms.data.LoanDto
import com.circuvent.hrms.data.LoanRequest
import com.circuvent.hrms.data.LoansResponse
import kotlinx.coroutines.launch

// ═══════════════════════════════════════════════════════════════
// LOANS — what is owed, and what the concession costs in tax
// ═══════════════════════════════════════════════════════════════
//
// An employee wants two numbers: how much is left, and when it finishes. Both
// come from what payroll actually recovered rather than from the schedule,
// because a month of unpaid leave recovers nothing and a plan that assumes
// otherwise says a loan has closed while money is still owed.
//
// The third thing on this screen is the one nobody expects: an interest-free
// loan from an employer is a taxable perquisite. Saying so here, against the
// loan, is fairer than letting it appear unexplained on a payslip — and where
// the benchmark rate has not been configured the screen says the value is
// unknown rather than showing a zero that reads as "nothing to pay".

private val LOAN_TYPES = listOf(
    "salary_advance" to "Salary advance",
    "personal" to "Personal",
    "housing" to "Housing",
    "vehicle" to "Vehicle",
    "education" to "Education",
    "medical" to "Medical",
)

private fun typeLabel(code: String): String =
    LOAN_TYPES.firstOrNull { it.first == code }?.second
        ?: code.replace('_', ' ').replaceFirstChar { it.uppercase() }

private fun rupees(minor: String?): String {
    val value = minor?.toLongOrNull() ?: return "₹0"
    val whole = value / 100
    val s = whole.toString()
    if (s.length <= 3) return "₹$s"
    val last3 = s.takeLast(3)
    val rest = s.dropLast(3)
    return "₹${rest.reversed().chunked(2).joinToString(",").reversed()},$last3"
}

private fun statusTone(status: String): PillTone = when (status) {
    "active" -> PillTone.INFO
    "closed" -> PillTone.SUCCESS
    "rejected", "written_off" -> PillTone.DANGER
    else -> PillTone.WARNING
}

private val MONTHS = listOf(
    "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
)

@Composable
fun LoansScreen(container: AppContainer) {
    var state by remember { mutableStateOf<Loaded<LoansResponse>>(Loaded.Loading) }
    var showForm by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<Pair<BannerTone, String>?>(null) }

    var loanType by remember { mutableStateOf(LOAN_TYPES.first().first) }
    var amount by remember { mutableStateOf("") }
    var months by remember { mutableStateOf("12") }
    var purpose by remember { mutableStateOf("") }
    var submitting by remember { mutableStateOf(false) }

    val scope = rememberCoroutineScope()

    suspend fun load() {
        state = try {
            Loaded.Ready(container.repository.loans())
        } catch (e: Throwable) {
            failureOf("Your loans", e)
        }
    }

    LaunchedEffect(Unit) { load() }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = screenPadding(),
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm),
    ) {
        item {
            when (val current = state) {
                is Loaded.Loading -> SkeletonRows(count = 3, rowHeight = 120.dp)
                is Loaded.Failed ->
                    Banner(BannerTone.ERROR, current.title, description = current.description)

                is Loaded.Ready -> Column(
                    verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm)
                ) {
                    message?.let { (tone, text) -> Banner(tone, text) }

                    if (!showForm) {
                        AppButton(label = "Request an advance", onClick = { showForm = true })
                    } else {
                        AppCard {
                            AppText("Request an advance", weight = FontWeight.SemiBold)

                            LOAN_TYPES.forEach { (code, label) ->
                                Row(
                                    Modifier.fillMaxWidth().padding(vertical = 2.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    AppText(
                                        label,
                                        size = Theme.type.footnote,
                                        weight = if (loanType == code) FontWeight.SemiBold
                                        else FontWeight.Normal,
                                    )
                                    Switch(
                                        checked = loanType == code,
                                        onCheckedChange = { if (it) loanType = code },
                                    )
                                }
                            }

                            OutlinedTextField(
                                value = amount,
                                onValueChange = { amount = it.filter(Char::isDigit) },
                                label = { Text("Amount (₹)") },
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                modifier = Modifier.fillMaxWidth().padding(top = Theme.spacing.xs),
                            )
                            OutlinedTextField(
                                value = months,
                                onValueChange = { months = it.filter(Char::isDigit) },
                                label = { Text("Repay over (months)") },
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                modifier = Modifier.fillMaxWidth().padding(top = Theme.spacing.xs),
                            )
                            OutlinedTextField(
                                value = purpose,
                                onValueChange = { purpose = it },
                                label = { Text("What it is for") },
                                modifier = Modifier.fillMaxWidth().padding(top = Theme.spacing.xs),
                            )

                            AppButton(
                                label = if (submitting) "Sending…" else "Send request",
                                enabled = !submitting &&
                                    (amount.toLongOrNull() ?: 0L) > 0L &&
                                    (months.toIntOrNull() ?: 0) > 0,
                                busy = submitting,
                                modifier = Modifier.padding(top = Theme.spacing.sm),
                                onClick = {
                                    submitting = true
                                    message = null
                                    scope.launch {
                                        try {
                                            container.repository.requestLoan(
                                                LoanRequest(
                                                    loanType = loanType,
                                                    principalMinor =
                                                        ((amount.toLongOrNull() ?: 0L) * 100).toString(),
                                                    tenureMonths = months.toIntOrNull() ?: 12,
                                                    purpose = purpose.takeIf { it.isNotBlank() },
                                                )
                                            )
                                            showForm = false
                                            amount = ""; purpose = ""
                                            load()
                                            message = BannerTone.SUCCESS to
                                                "Requested. Recovery starts the month after approval."
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

                    SectionLabel("Your loans")
                }
            }
        }

        val ready = state as? Loaded.Ready
        if (ready != null) {
            if (ready.value.loans.isEmpty()) {
                item {
                    EmptyState(
                        title = "No loans or advances",
                        description = "Anything you borrow through payroll appears here, with what is left to repay.",
                    )
                }
            } else {
                items(ready.value.loans, key = { it.id }) { loan -> LoanCard(loan) }
            }
        }
    }
}

@Composable
private fun LoanCard(loan: LoanDto) {
    var showSchedule by remember { mutableStateOf(false) }

    AppCard(
        contentDescription =
            "${typeLabel(loan.loanType)}, ${rupees(loan.outstandingMinor)} outstanding",
    ) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AppText(typeLabel(loan.loanType), weight = FontWeight.SemiBold)
            StatusPill(loan.status.replaceFirstChar { it.uppercase() }, statusTone(loan.status))
        }

        loan.purpose?.takeIf { it.isNotBlank() }?.let {
            AppText(it, tone = TextTone.MUTED, size = Theme.type.footnote)
        }

        Row(Modifier.fillMaxWidth().padding(top = Theme.spacing.xs)) {
            Column(Modifier.weight(1f)) {
                AppText("Borrowed", tone = TextTone.MUTED, size = Theme.type.caption)
                AppText(rupees(loan.principalMinor), weight = FontWeight.Medium)
            }
            Column(Modifier.weight(1f)) {
                AppText("Left to repay", tone = TextTone.MUTED, size = Theme.type.caption)
                AppText(rupees(loan.outstandingMinor), weight = FontWeight.SemiBold)
            }
            Column(Modifier.weight(1f)) {
                AppText("Each month", tone = TextTone.MUTED, size = Theme.type.caption)
                AppText(rupees(loan.instalmentMinor), weight = FontWeight.Medium)
            }
        }

        AppText(
            "${loan.instalmentsPaid} of ${loan.tenureMonths} instalments recovered" +
                if (loan.interestRatePercent == 0.0) ", interest free"
                else " at ${loan.interestRatePercent}%",
            tone = TextTone.MUTED,
            size = Theme.type.caption,
            modifier = Modifier.padding(top = Theme.spacing.xs),
        )

        // The surprise on the payslip, explained where it comes from.
        if (loan.perquisite.known && !loan.perquisite.exempt) {
            Banner(
                BannerTone.INFO,
                "Taxable benefit ${rupees(loan.perquisite.taxableMinor)} this year",
                description =
                    "A loan below the benchmark rate is a taxable perquisite. This is " +
                        "added to your income, not deducted from your pay.",
            )
        } else if (loan.perquisite.known && loan.perquisite.exempt) {
            loan.perquisite.note?.let {
                AppText(it, tone = TextTone.MUTED, size = Theme.type.caption)
            }
        } else if (!loan.perquisite.known) {
            loan.perquisite.note?.let {
                Banner(BannerTone.WARNING, "Taxable benefit not yet known", description = it)
            }
        }

        if (loan.schedule.isNotEmpty()) {
            AppButton(
                label = if (showSchedule) "Hide schedule" else "Show schedule",
                variant = ButtonVariant.SECONDARY,
                onClick = { showSchedule = !showSchedule },
                modifier = Modifier.padding(top = Theme.spacing.xs),
            )

            if (showSchedule) {
                loan.schedule.forEach { row ->
                    Row(
                        Modifier.fillMaxWidth().padding(vertical = 1.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        AppText(
                            "${MONTHS.getOrElse(row.month) { "" }} ${row.year}",
                            size = Theme.type.caption,
                            tone = TextTone.MUTED,
                        )
                        AppText(rupees(row.totalMinor), size = Theme.type.caption)
                        AppText(
                            "left ${rupees(row.closingBalanceMinor)}",
                            size = Theme.type.caption,
                            tone = TextTone.MUTED,
                        )
                    }
                }
            }
        }
    }
}
