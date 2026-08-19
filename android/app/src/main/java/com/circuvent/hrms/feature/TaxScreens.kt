package com.circuvent.hrms.feature

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
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
import com.circuvent.hrms.data.TaxDeclarationItemInput
import com.circuvent.hrms.data.TaxDeclarationResponse
import com.circuvent.hrms.data.TaxDeclarationSave
import com.circuvent.hrms.data.Form16Response
import kotlinx.coroutines.launch

// ═══════════════════════════════════════════════════════════════
// TAX — declaring investments, and the certificate at the end
// ═══════════════════════════════════════════════════════════════
//
// Two screens that belong together: what the employee tells payroll they will
// invest, and the Form 16 that comes out of it a year later.
//
// The declaration screen is the one that saves people money, and it is also the
// one an employee is most likely to fill in wrongly. Two things are therefore
// on screen rather than buried:
//
//   * **What each claim is actually worth.** A claim over its ceiling is shown
//     at both figures, so somebody entering ₹2,00,000 of 80C sees ₹1,50,000
//     beside it rather than discovering the difference in March.
//   * **Whether the regime they picked was the right one.** Under the new
//     regime almost nothing they declare counts, and the screen says so at the
//     point of entry instead of accepting the numbers and quietly ignoring
//     them.

/** Paise to a readable rupee figure, grouped the way an Indian reader expects. */
private fun rupees(minor: String?): String {
    val value = minor?.toLongOrNull() ?: return "₹0"
    val whole = value / 100
    val s = whole.toString()
    if (s.length <= 3) return "₹$s"
    val last3 = s.takeLast(3)
    val rest = s.dropLast(3)
    val grouped = rest.reversed().chunked(2).joinToString(",").reversed()
    return "₹$grouped,$last3"
}

private fun reasonText(reason: String?): String? = when (reason) {
    "not_allowed_in_new_regime" -> "Not allowed under the new regime"
    "over_section_cap" -> "Above this section's limit"
    "over_shared_cap" -> "The shared limit is already used"
    "proof_missing" -> "No proof was accepted"
    "excluded_by_other_section" -> "Replaced by another section"
    else -> null
}

/**
 * The declaration.
 *
 * Amounts are entered in whole rupees and converted to paise on the way out.
 * Asking somebody to type paise into a phone would be precise and unusable.
 */
@Composable
fun TaxDeclarationScreen(container: AppContainer, onOpenForm16: () -> Unit) {
    var state by remember { mutableStateOf<Loaded<TaxDeclarationResponse>>(Loaded.Loading) }
    var regime by remember { mutableStateOf("new") }
    var selfSenior by remember { mutableStateOf(false) }
    var parentsSenior by remember { mutableStateOf(false) }
    var rent by remember { mutableStateOf("") }
    var metro by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<Pair<BannerTone, String>?>(null) }

    val amounts = remember { mutableStateMapOf<String, String>() }
    val scope = rememberCoroutineScope()

    suspend fun load() {
        state = try {
            val loaded = container.repository.taxDeclaration()
            regime = loaded.declaration.regime
            selfSenior = loaded.declaration.selfOrFamilyIsSenior
            parentsSenior = loaded.declaration.parentsAreSenior
            metro = loaded.declaration.metroCity
            rent = (loaded.declaration.rentPaidMinor.toLongOrNull() ?: 0L)
                .let { if (it == 0L) "" else (it / 100).toString() }
            amounts.clear()
            loaded.items.forEach { item ->
                val whole = (item.declaredMinor.toLongOrNull() ?: 0L) / 100
                if (whole > 0) amounts[item.section] = whole.toString()
            }
            Loaded.Ready(loaded)
        } catch (e: Throwable) {
            failureOf("Your declaration", e)
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
                is Loaded.Loading -> SkeletonRows(count = 5, rowHeight = 80.dp)
                is Loaded.Failed ->
                    Banner(BannerTone.ERROR, current.title, description = current.description)

                is Loaded.Ready -> {
                    val data = current.value

                    Column(verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm)) {
                        message?.let { (tone, text) -> Banner(tone, text) }

                        AppCard {
                            AppText(
                                "Financial year ${data.declaration.financialYear}-" +
                                    "${(data.declaration.financialYear + 1) % 100}",
                                weight = FontWeight.SemiBold,
                            )
                            AppText(
                                "Declare what you will invest so tax is deducted against it " +
                                    "each month, rather than all at once in March.",
                                tone = TextTone.MUTED,
                                size = Theme.type.footnote,
                                lineHeight = Theme.type.footnoteLine,
                            )
                        }

                        SectionLabel("Tax regime")
                        AppCard {
                            Row(
                                Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    AppText(
                                        if (regime == "new") "New regime" else "Old regime",
                                        weight = FontWeight.Medium,
                                    )
                                    AppText(
                                        if (regime == "new")
                                            "Lower rates. Almost nothing below counts."
                                        else
                                            "Higher rates, but your investments reduce the tax.",
                                        tone = TextTone.MUTED,
                                        size = Theme.type.footnote,
                                        lineHeight = Theme.type.footnoteLine,
                                    )
                                }
                                Switch(
                                    checked = regime == "old",
                                    onCheckedChange = { regime = if (it) "old" else "new" },
                                )
                            }
                        }

                        // Said once, prominently, rather than repeated against
                        // every row: under the new regime the whole form below
                        // is informational.
                        if (regime == "new" && amounts.values.any { (it.toLongOrNull() ?: 0) > 0 }) {
                            Banner(
                                BannerTone.WARNING,
                                "These will not reduce your tax",
                                description =
                                    "The new regime allows the standard deduction and your " +
                                        "employer's NPS contribution, and nothing else on this form. " +
                                        "Switch to the old regime to use them.",
                            )
                        }

                        SectionLabel("House rent")
                        AppCard {
                            OutlinedTextField(
                                value = rent,
                                onValueChange = { rent = it.filter(Char::isDigit) },
                                label = { Text("Annual rent paid (₹)") },
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                modifier = Modifier.fillMaxWidth(),
                            )
                            Row(
                                Modifier.fillMaxWidth().padding(top = Theme.spacing.xs),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                AppText("Delhi, Mumbai, Kolkata or Chennai", size = Theme.type.footnote)
                                Switch(checked = metro, onCheckedChange = { metro = it })
                            }
                        }

                        SectionLabel("Health cover")
                        AppCard {
                            Row(
                                Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                AppText("I or my family are 60 or over", size = Theme.type.footnote)
                                Switch(checked = selfSenior, onCheckedChange = { selfSenior = it })
                            }
                            Row(
                                Modifier.fillMaxWidth().padding(top = Theme.spacing.xs),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                AppText("My parents are 60 or over", size = Theme.type.footnote)
                                Switch(checked = parentsSenior, onCheckedChange = { parentsSenior = it })
                            }
                        }

                        SectionLabel("What you are claiming")

                        val allowedBySection = data.summary.items.associateBy { it.section }

                        data.sections.forEach { section ->
                            val entered = amounts[section.code].orEmpty()
                            val allowed = allowedBySection[section.code]

                            AppCard {
                                Row(
                                    Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                ) {
                                    AppText(section.code, weight = FontWeight.SemiBold)
                                    section.capMinor?.let {
                                        AppText(
                                            "up to ${rupees(it)}",
                                            tone = TextTone.MUTED,
                                            size = Theme.type.caption,
                                        )
                                    }
                                }
                                AppText(
                                    section.label,
                                    tone = TextTone.MUTED,
                                    size = Theme.type.footnote,
                                    lineHeight = Theme.type.footnoteLine,
                                )
                                OutlinedTextField(
                                    value = entered,
                                    onValueChange = { amounts[section.code] = it.filter(Char::isDigit) },
                                    label = { Text("Amount (₹)") },
                                    singleLine = true,
                                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(top = Theme.spacing.xs),
                                )

                                // Shown only when the two differ, so the common
                                // case stays quiet.
                                if (allowed != null && allowed.allowedMinor != allowed.declaredMinor) {
                                    val why = reasonText(allowed.reason)
                                    AppText(
                                        "Counts as ${rupees(allowed.allowedMinor)}" +
                                            (why?.let { " — $it" } ?: ""),
                                        tone = TextTone.MUTED,
                                        size = Theme.type.caption,
                                    )
                                }

                                if (section.requiresProof && entered.isNotBlank()) {
                                    StatusPill("Proof needed", PillTone.WARNING)
                                }
                            }
                        }

                        SectionLabel("What this reduces")
                        AppCard {
                            LabelledRow("Claims allowed", rupees(data.summary.totalAllowedMinor))
                            LabelledRow("Standard deduction", rupees(data.summary.standardDeductionMinor))
                            LabelledRow(
                                "Total relief",
                                rupees(data.summary.totalReliefMinor),
                                emphasise = true,
                            )
                        }

                        AppButton(
                            label = if (saving) "Saving…" else "Save declaration",
                            enabled = !saving,
                            busy = saving,
                            onClick = {
                                saving = true
                                message = null
                                scope.launch {
                                    try {
                                        container.repository.saveTaxDeclaration(
                                            TaxDeclarationSave(
                                                regime = regime,
                                                selfOrFamilyIsSenior = selfSenior,
                                                parentsAreSenior = parentsSenior,
                                                rentPaidMinor =
                                                    ((rent.toLongOrNull() ?: 0L) * 100).toString(),
                                                metroCity = metro,
                                                items = amounts.mapNotNull { (section, value) ->
                                                    val whole = value.toLongOrNull() ?: 0L
                                                    if (whole <= 0L) null
                                                    else TaxDeclarationItemInput(
                                                        section = section,
                                                        declaredMinor = (whole * 100).toString(),
                                                    )
                                                },
                                            )
                                        )
                                        load()
                                        message = BannerTone.SUCCESS to "Declaration saved."
                                    } catch (e: Throwable) {
                                        message = BannerTone.ERROR to
                                            (e.message ?: "The declaration could not be saved.")
                                    } finally {
                                        saving = false
                                    }
                                }
                            },
                        )

                        AppButton(
                            label = "View Form 16",
                            variant = ButtonVariant.SECONDARY,
                            onClick = onOpenForm16,
                        )
                    }
                }
            }
        }
    }
}

/**
 * Form 16, Part B.
 *
 * Laid out in the order of the statutory annexure so an employee can hold it
 * beside the paper form and find the same numbers in the same places.
 *
 * The reconciliation is shown whether or not it balances. A certificate whose
 * deductions do not match its liability is not an error to hide — the employee
 * either owes the difference or is owed it, and finding out here beats finding
 * out by demand notice.
 */
@Composable
fun Form16Screen(container: AppContainer) {
    var state by remember { mutableStateOf<Loaded<Form16Response>>(Loaded.Loading) }

    LaunchedEffect(Unit) {
        state = try {
            Loaded.Ready(container.repository.form16())
        } catch (e: Throwable) {
            failureOf("Form 16", e)
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = screenPadding(),
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm),
    ) {
        item {
            when (val current = state) {
                is Loaded.Loading -> SkeletonRows(count = 6, rowHeight = 56.dp)
                is Loaded.Failed ->
                    Banner(BannerTone.ERROR, current.title, description = current.description)

                is Loaded.Ready -> {
                    val data = current.value
                    val b = data.partB

                    if (data.monthsCovered == 0) {
                        EmptyState(
                            title = "Nothing to certify yet",
                            description =
                                "Form 16 is built from approved payroll. Once a run for this " +
                                    "year has been approved, it appears here.",
                        )
                    } else {
                        Column(verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm)) {
                            AppCard {
                                AppText("Assessment year ${data.assessmentYear}", weight = FontWeight.SemiBold)
                                AppText(
                                    if (data.complete) "Covers all 12 months."
                                    else "Covers ${data.monthsCovered} month(s) of approved payroll.",
                                    tone = TextTone.MUTED,
                                    size = Theme.type.footnote,
                                )
                            }

                            if (!data.reconciliation.balanced) {
                                Banner(
                                    BannerTone.WARNING,
                                    "Deductions do not match the liability",
                                    description = data.reconciliation.message,
                                )
                            }

                            SectionLabel("Gross salary")
                            AppCard {
                                LabelledRow("Salary under 17(1)", rupees(b.grossSalaryMinor))
                                LabelledRow("Less: HRA exempt, 10(13A)", rupees(b.hraExemptUnder10_13AMinor))
                                LabelledRow("Net salary", rupees(b.netSalaryMinor), emphasise = true)
                            }

                            SectionLabel("Deductions under section 16")
                            AppCard {
                                LabelledRow("Standard deduction, 16(ia)", rupees(b.standardDeductionUnder16_iaMinor))
                                LabelledRow("Professional tax, 16(iii)", rupees(b.professionalTaxUnder16_iiiMinor))
                                LabelledRow("Total", rupees(b.totalSection16DeductionsMinor), emphasise = true)
                            }

                            SectionLabel("Chapter VI-A")
                            AppCard {
                                if (b.chapterVIA.isEmpty()) {
                                    AppText("Nothing claimed.", tone = TextTone.MUTED, size = Theme.type.footnote)
                                } else {
                                    b.chapterVIA.forEach { line ->
                                        LabelledRow(
                                            line.section,
                                            rupees(line.deductibleAmountMinor),
                                        )
                                        if (line.deductibleAmountMinor != line.grossAmountMinor) {
                                            AppText(
                                                "claimed ${rupees(line.grossAmountMinor)}",
                                                tone = TextTone.MUTED,
                                                size = Theme.type.caption,
                                            )
                                        }
                                    }
                                    LabelledRow("Total", rupees(b.aggregateDeductibleMinor), emphasise = true)
                                }
                            }

                            SectionLabel("Tax")
                            AppCard {
                                LabelledRow("Taxable income", rupees(b.totalTaxableIncomeMinor))
                                LabelledRow("Tax on income", rupees(b.taxOnTotalIncomeMinor))
                                LabelledRow("Less: rebate 87A", rupees(b.rebateUnder87AMinor))
                                LabelledRow("Surcharge", rupees(b.surchargeMinor))
                                LabelledRow("Cess", rupees(b.cessMinor))
                                LabelledRow("Tax payable", rupees(b.taxPayableMinor), emphasise = true)
                                if ((b.reliefUnder89Minor.toLongOrNull() ?: 0L) > 0L) {
                                    LabelledRow("Less: relief under 89", rupees(b.reliefUnder89Minor))
                                }
                                LabelledRow("Net tax payable", rupees(b.netTaxPayableMinor), emphasise = true)
                                LabelledRow("Tax deducted", rupees(b.taxDeductedAtSourceMinor))
                                if ((b.balancePayableMinor.toLongOrNull() ?: 0L) > 0L) {
                                    LabelledRow("Still to pay", rupees(b.balancePayableMinor), emphasise = true)
                                }
                                if ((b.refundDueMinor.toLongOrNull() ?: 0L) > 0L) {
                                    LabelledRow("Refund due", rupees(b.refundDueMinor), emphasise = true)
                                }
                            }

                            SectionLabel("Quarterly returns")
                            AppCard {
                                data.form24Q.forEach { q ->
                                    LabelledRow("Q${q.quarter}", rupees(q.taxDeductedMinor))
                                }
                                AppText(
                                    "These are the figures your employer files in Form 24Q.",
                                    tone = TextTone.MUTED,
                                    size = Theme.type.caption,
                                )
                            }

                            Banner(
                                BannerTone.INFO,
                                "Part A comes from TRACES",
                                description = data.partA.note,
                            )
                        }
                    }
                }
            }
        }
    }
}

/** A label on the left, a figure on the right. */
@Composable
private fun LabelledRow(label: String, value: String, emphasise: Boolean = false) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 2.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        AppText(
            label,
            size = Theme.type.footnote,
            lineHeight = Theme.type.footnoteLine,
            tone = if (emphasise) TextTone.PRIMARY else TextTone.MUTED,
            weight = if (emphasise) FontWeight.SemiBold else FontWeight.Normal,
        )
        AppText(
            value,
            size = Theme.type.footnote,
            lineHeight = Theme.type.footnoteLine,
            weight = if (emphasise) FontWeight.SemiBold else FontWeight.Medium,
        )
    }
}
