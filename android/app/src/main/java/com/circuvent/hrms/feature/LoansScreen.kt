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
import androidx.compose.ui.res.stringArrayResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.circuvent.hrms.AppContainer
import com.circuvent.hrms.R
import com.circuvent.hrms.core.design.Theme
import com.circuvent.hrms.core.ui.AppButton
import com.circuvent.hrms.core.ui.AppCard
import com.circuvent.hrms.core.ui.AppSwitch
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

private val LOAN_TYPE_CODES = listOf(
    "salary_advance", "personal", "housing", "vehicle", "education", "medical",
)

@Composable
private fun typeLabel(code: String): String = when (code) {
    "salary_advance" -> stringResource(R.string.loans_type_salary_advance)
    "personal" -> stringResource(R.string.loans_type_personal)
    "housing" -> stringResource(R.string.loans_type_housing)
    "vehicle" -> stringResource(R.string.loans_type_vehicle)
    "education" -> stringResource(R.string.loans_type_education)
    "medical" -> stringResource(R.string.loans_type_medical)
    else -> code.replace('_', ' ').replaceFirstChar { it.uppercase() }
}

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

@Composable
fun LoansScreen(container: AppContainer) {
    var state by remember { mutableStateOf<Loaded<LoansResponse>>(Loaded.Loading) }
    var showForm by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<Pair<BannerTone, String>?>(null) }

    var loanType by remember { mutableStateOf(LOAN_TYPE_CODES.first()) }
    var amount by remember { mutableStateOf("") }
    var months by remember { mutableStateOf("12") }
    var purpose by remember { mutableStateOf("") }
    var submitting by remember { mutableStateOf(false) }

    val scope = rememberCoroutineScope()

    val requestSuccessMessage = stringResource(R.string.loans_request_success_message)
    val requestErrorFallback = stringResource(R.string.loans_request_error_fallback)

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
                        AppButton(
                            label = stringResource(R.string.loans_request_advance_action),
                            onClick = { showForm = true },
                        )
                    } else {
                        AppCard {
                            AppText(
                                stringResource(R.string.loans_request_advance_action),
                                weight = FontWeight.SemiBold,
                            )

                            LOAN_TYPE_CODES.forEach { code ->
                                val label = typeLabel(code)
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
                                    AppSwitch(
                                        checked = loanType == code,
                                        onCheckedChange = { if (it) loanType = code },
                                    )
                                }
                            }

                            OutlinedTextField(
                                value = amount,
                                onValueChange = { amount = it.filter(Char::isDigit) },
                                label = { Text(stringResource(R.string.loans_amount_field_label)) },
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                modifier = Modifier.fillMaxWidth().padding(top = Theme.spacing.xs),
                            )
                            OutlinedTextField(
                                value = months,
                                onValueChange = { months = it.filter(Char::isDigit) },
                                label = { Text(stringResource(R.string.loans_repay_over_field_label)) },
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                modifier = Modifier.fillMaxWidth().padding(top = Theme.spacing.xs),
                            )
                            OutlinedTextField(
                                value = purpose,
                                onValueChange = { purpose = it },
                                label = { Text(stringResource(R.string.loans_purpose_field_label)) },
                                modifier = Modifier.fillMaxWidth().padding(top = Theme.spacing.xs),
                            )

                            AppButton(
                                label = if (submitting) {
                                    stringResource(R.string.loans_sending_label)
                                } else {
                                    stringResource(R.string.loans_send_request_action)
                                },
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
                                            message = BannerTone.SUCCESS to requestSuccessMessage
                                        } catch (e: Throwable) {
                                            message = BannerTone.ERROR to
                                                (e.message ?: requestErrorFallback)
                                        } finally {
                                            submitting = false
                                        }
                                    }
                                },
                            )
                            AppButton(
                                label = stringResource(R.string.expenses_cancel_action),
                                variant = ButtonVariant.SECONDARY,
                                onClick = { showForm = false },
                            )
                        }
                    }

                    SectionLabel(stringResource(R.string.loans_your_loans_heading))
                }
            }
        }

        val ready = state as? Loaded.Ready
        if (ready != null) {
            if (ready.value.loans.isEmpty()) {
                item {
                    EmptyState(
                        title = stringResource(R.string.loans_empty_title),
                        description = stringResource(R.string.loans_empty_description),
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
    val monthAbbreviations = stringArrayResource(R.array.month_abbreviations)

    AppCard(
        contentDescription = stringResource(
            R.string.loans_outstanding_content_description,
            typeLabel(loan.loanType),
            rupees(loan.outstandingMinor),
        ),
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
                AppText(
                    stringResource(R.string.loans_borrowed_label),
                    tone = TextTone.MUTED,
                    size = Theme.type.caption,
                )
                AppText(rupees(loan.principalMinor), weight = FontWeight.Medium)
            }
            Column(Modifier.weight(1f)) {
                AppText(
                    stringResource(R.string.loans_left_to_repay_label),
                    tone = TextTone.MUTED,
                    size = Theme.type.caption,
                )
                AppText(rupees(loan.outstandingMinor), weight = FontWeight.SemiBold)
            }
            Column(Modifier.weight(1f)) {
                AppText(
                    stringResource(R.string.loans_each_month_label),
                    tone = TextTone.MUTED,
                    size = Theme.type.caption,
                )
                AppText(rupees(loan.instalmentMinor), weight = FontWeight.Medium)
            }
        }

        AppText(
            stringResource(
                R.string.loans_instalments_recovered,
                loan.instalmentsPaid,
                loan.tenureMonths,
            ) +
                if (loan.interestRatePercent == 0.0) {
                    stringResource(R.string.loans_interest_free_suffix)
                } else {
                    stringResource(R.string.loans_interest_rate_suffix, loan.interestRatePercent)
                },
            tone = TextTone.MUTED,
            size = Theme.type.caption,
            modifier = Modifier.padding(top = Theme.spacing.xs),
        )

        // The surprise on the payslip, explained where it comes from.
        if (loan.perquisite.known && !loan.perquisite.exempt) {
            Banner(
                BannerTone.INFO,
                stringResource(
                    R.string.loans_taxable_benefit_title,
                    rupees(loan.perquisite.taxableMinor),
                ),
                description = stringResource(R.string.loans_taxable_benefit_description),
            )
        } else if (loan.perquisite.known && loan.perquisite.exempt) {
            loan.perquisite.note?.let {
                AppText(it, tone = TextTone.MUTED, size = Theme.type.caption)
            }
        } else if (!loan.perquisite.known) {
            loan.perquisite.note?.let {
                Banner(
                    BannerTone.WARNING,
                    stringResource(R.string.loans_taxable_benefit_unknown_title),
                    description = it,
                )
            }
        }

        if (loan.schedule.isNotEmpty()) {
            AppButton(
                label = if (showSchedule) {
                    stringResource(R.string.loans_hide_schedule_action)
                } else {
                    stringResource(R.string.loans_show_schedule_action)
                },
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
                            "${monthAbbreviations.getOrNull(row.month - 1) ?: ""} ${row.year}",
                            size = Theme.type.caption,
                            tone = TextTone.MUTED,
                        )
                        AppText(rupees(row.totalMinor), size = Theme.type.caption)
                        AppText(
                            stringResource(
                                R.string.loans_schedule_left_balance,
                                rupees(row.closingBalanceMinor),
                            ),
                            size = Theme.type.caption,
                            tone = TextTone.MUTED,
                        )
                    }
                }
            }
        }
    }
}
