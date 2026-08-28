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

@Composable
private fun reasonText(reason: String?): String? = when (reason) {
    "not_allowed_in_new_regime" -> stringResource(R.string.tax_reason_not_allowed_new_regime)
    "over_section_cap" -> stringResource(R.string.tax_reason_over_section_cap)
    "over_shared_cap" -> stringResource(R.string.tax_reason_over_shared_cap)
    "proof_missing" -> stringResource(R.string.tax_reason_proof_missing)
    "excluded_by_other_section" -> stringResource(R.string.tax_reason_excluded_by_other_section)
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
                                stringResource(
                                    R.string.tax_financial_year_label,
                                    data.declaration.financialYear,
                                    (data.declaration.financialYear + 1) % 100,
                                ),
                                weight = FontWeight.SemiBold,
                            )
                            AppText(
                                stringResource(R.string.tax_declaration_intro),
                                tone = TextTone.MUTED,
                                size = Theme.type.footnote,
                                lineHeight = Theme.type.footnoteLine,
                            )
                        }

                        SectionLabel(stringResource(R.string.tax_regime_heading))
                        AppCard {
                            Row(
                                Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    AppText(
                                        if (regime == "new")
                                            stringResource(R.string.tax_regime_new_label)
                                        else
                                            stringResource(R.string.tax_regime_old_label),
                                        weight = FontWeight.Medium,
                                    )
                                    AppText(
                                        if (regime == "new")
                                            stringResource(R.string.tax_regime_new_description)
                                        else
                                            stringResource(R.string.tax_regime_old_description),
                                        tone = TextTone.MUTED,
                                        size = Theme.type.footnote,
                                        lineHeight = Theme.type.footnoteLine,
                                    )
                                }
                                AppSwitch(
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
                                stringResource(R.string.tax_new_regime_warning_title),
                                description = stringResource(R.string.tax_new_regime_warning_description),
                            )
                        }

                        SectionLabel(stringResource(R.string.tax_house_rent_heading))
                        AppCard {
                            OutlinedTextField(
                                value = rent,
                                onValueChange = { rent = it.filter(Char::isDigit) },
                                label = { Text(stringResource(R.string.tax_annual_rent_label)) },
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                modifier = Modifier.fillMaxWidth(),
                            )
                            Row(
                                Modifier.fillMaxWidth().padding(top = Theme.spacing.xs),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                AppText(stringResource(R.string.tax_metro_cities_label), size = Theme.type.footnote)
                                AppSwitch(checked = metro, onCheckedChange = { metro = it })
                            }
                        }

                        SectionLabel(stringResource(R.string.tax_health_cover_heading))
                        AppCard {
                            Row(
                                Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                AppText(stringResource(R.string.tax_senior_self_label), size = Theme.type.footnote)
                                AppSwitch(checked = selfSenior, onCheckedChange = { selfSenior = it })
                            }
                            Row(
                                Modifier.fillMaxWidth().padding(top = Theme.spacing.xs),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                AppText(stringResource(R.string.tax_senior_parents_label), size = Theme.type.footnote)
                                AppSwitch(checked = parentsSenior, onCheckedChange = { parentsSenior = it })
                            }
                        }

                        SectionLabel(stringResource(R.string.tax_claiming_heading))

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
                                            stringResource(R.string.tax_cap_up_to_prefix, rupees(it)),
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
                                    label = { Text(stringResource(R.string.tax_amount_label)) },
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
                                        stringResource(R.string.tax_counts_as_prefix, rupees(allowed.allowedMinor)) +
                                            (why?.let { " — $it" } ?: ""),
                                        tone = TextTone.MUTED,
                                        size = Theme.type.caption,
                                    )
                                }

                                if (section.requiresProof && entered.isNotBlank()) {
                                    StatusPill(stringResource(R.string.tax_proof_needed_pill), PillTone.WARNING)
                                }
                            }
                        }

                        SectionLabel(stringResource(R.string.tax_reduces_heading))
                        AppCard {
                            LabelledRow(
                                stringResource(R.string.tax_claims_allowed_label),
                                rupees(data.summary.totalAllowedMinor),
                            )
                            LabelledRow(
                                stringResource(R.string.tax_standard_deduction_label),
                                rupees(data.summary.standardDeductionMinor),
                            )
                            LabelledRow(
                                stringResource(R.string.tax_total_relief_label),
                                rupees(data.summary.totalReliefMinor),
                                emphasise = true,
                            )
                        }

                        val declarationSavedMessage = stringResource(R.string.tax_declaration_saved)
                        val declarationSaveFailedMessage = stringResource(R.string.tax_declaration_save_failed)

                        AppButton(
                            label = if (saving) {
                                stringResource(R.string.tax_saving_action)
                            } else {
                                stringResource(R.string.tax_save_declaration_action)
                            },
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
                                        message = BannerTone.SUCCESS to declarationSavedMessage
                                    } catch (e: Throwable) {
                                        message = BannerTone.ERROR to
                                            (e.message ?: declarationSaveFailedMessage)
                                    } finally {
                                        saving = false
                                    }
                                }
                            },
                        )

                        AppButton(
                            label = stringResource(R.string.tax_view_form16_action),
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
                            title = stringResource(R.string.form16_empty_title),
                            description = stringResource(R.string.form16_empty_description),
                        )
                    } else {
                        Column(verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm)) {
                            AppCard {
                                AppText(
                                    stringResource(R.string.form16_assessment_year_label, data.assessmentYear),
                                    weight = FontWeight.SemiBold,
                                )
                                AppText(
                                    if (data.complete) {
                                        stringResource(R.string.form16_covers_all_months)
                                    } else {
                                        stringResource(R.string.form16_covers_partial_months, data.monthsCovered)
                                    },
                                    tone = TextTone.MUTED,
                                    size = Theme.type.footnote,
                                )
                            }

                            if (!data.reconciliation.balanced) {
                                Banner(
                                    BannerTone.WARNING,
                                    stringResource(R.string.form16_reconciliation_mismatch_title),
                                    description = data.reconciliation.message,
                                )
                            }

                            SectionLabel(stringResource(R.string.form16_gross_salary_heading))
                            AppCard {
                                LabelledRow(
                                    stringResource(R.string.form16_salary_under_17_1_label),
                                    rupees(b.grossSalaryMinor),
                                )
                                LabelledRow(
                                    stringResource(R.string.form16_hra_exempt_label),
                                    rupees(b.hraExemptUnder10_13AMinor),
                                )
                                LabelledRow(
                                    stringResource(R.string.form16_net_salary_label),
                                    rupees(b.netSalaryMinor),
                                    emphasise = true,
                                )
                            }

                            SectionLabel(stringResource(R.string.form16_section16_heading))
                            AppCard {
                                LabelledRow(
                                    stringResource(R.string.form16_standard_deduction_label),
                                    rupees(b.standardDeductionUnder16_iaMinor),
                                )
                                LabelledRow(
                                    stringResource(R.string.form16_professional_tax_label),
                                    rupees(b.professionalTaxUnder16_iiiMinor),
                                )
                                LabelledRow(
                                    stringResource(R.string.form16_section16_total_label),
                                    rupees(b.totalSection16DeductionsMinor),
                                    emphasise = true,
                                )
                            }

                            SectionLabel(stringResource(R.string.form16_chapter_via_heading))
                            AppCard {
                                if (b.chapterVIA.isEmpty()) {
                                    AppText(
                                        stringResource(R.string.form16_chapter_via_nothing_claimed),
                                        tone = TextTone.MUTED,
                                        size = Theme.type.footnote,
                                    )
                                } else {
                                    b.chapterVIA.forEach { line ->
                                        LabelledRow(
                                            line.section,
                                            rupees(line.deductibleAmountMinor),
                                        )
                                        if (line.deductibleAmountMinor != line.grossAmountMinor) {
                                            AppText(
                                                stringResource(
                                                    R.string.form16_claimed_amount_prefix,
                                                    rupees(line.grossAmountMinor),
                                                ),
                                                tone = TextTone.MUTED,
                                                size = Theme.type.caption,
                                            )
                                        }
                                    }
                                    LabelledRow(
                                        stringResource(R.string.form16_chapter_via_total_label),
                                        rupees(b.aggregateDeductibleMinor),
                                        emphasise = true,
                                    )
                                }
                            }

                            SectionLabel(stringResource(R.string.form16_tax_heading))
                            AppCard {
                                LabelledRow(
                                    stringResource(R.string.form16_taxable_income_label),
                                    rupees(b.totalTaxableIncomeMinor),
                                )
                                LabelledRow(
                                    stringResource(R.string.form16_tax_on_income_label),
                                    rupees(b.taxOnTotalIncomeMinor),
                                )
                                LabelledRow(
                                    stringResource(R.string.form16_rebate_87a_label),
                                    rupees(b.rebateUnder87AMinor),
                                )
                                LabelledRow(stringResource(R.string.form16_surcharge_label), rupees(b.surchargeMinor))
                                LabelledRow(stringResource(R.string.form16_cess_label), rupees(b.cessMinor))
                                LabelledRow(
                                    stringResource(R.string.form16_tax_payable_label),
                                    rupees(b.taxPayableMinor),
                                    emphasise = true,
                                )
                                if ((b.reliefUnder89Minor.toLongOrNull() ?: 0L) > 0L) {
                                    LabelledRow(
                                        stringResource(R.string.form16_relief_89_label),
                                        rupees(b.reliefUnder89Minor),
                                    )
                                }
                                LabelledRow(
                                    stringResource(R.string.form16_net_tax_payable_label),
                                    rupees(b.netTaxPayableMinor),
                                    emphasise = true,
                                )
                                LabelledRow(
                                    stringResource(R.string.form16_tax_deducted_label),
                                    rupees(b.taxDeductedAtSourceMinor),
                                )
                                if ((b.balancePayableMinor.toLongOrNull() ?: 0L) > 0L) {
                                    LabelledRow(
                                        stringResource(R.string.form16_still_to_pay_label),
                                        rupees(b.balancePayableMinor),
                                        emphasise = true,
                                    )
                                }
                                if ((b.refundDueMinor.toLongOrNull() ?: 0L) > 0L) {
                                    LabelledRow(
                                        stringResource(R.string.form16_refund_due_label),
                                        rupees(b.refundDueMinor),
                                        emphasise = true,
                                    )
                                }
                            }

                            SectionLabel(stringResource(R.string.form16_quarterly_returns_heading))
                            AppCard {
                                data.form24Q.forEach { q ->
                                    LabelledRow(
                                        stringResource(R.string.form16_quarter_label, q.quarter),
                                        rupees(q.taxDeductedMinor),
                                    )
                                }
                                AppText(
                                    stringResource(R.string.form16_form24q_note),
                                    tone = TextTone.MUTED,
                                    size = Theme.type.caption,
                                )
                            }

                            Banner(
                                BannerTone.INFO,
                                stringResource(R.string.form16_part_a_title),
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
