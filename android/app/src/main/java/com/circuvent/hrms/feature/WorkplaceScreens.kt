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
import com.circuvent.hrms.core.ui.AppText
import com.circuvent.hrms.core.ui.DateField
import java.time.LocalDate
import com.circuvent.hrms.core.ui.Banner
import com.circuvent.hrms.core.ui.BannerTone
import com.circuvent.hrms.core.ui.ButtonVariant
import com.circuvent.hrms.core.ui.EmptyState
import com.circuvent.hrms.core.ui.PillTone
import com.circuvent.hrms.core.ui.SkeletonRows
import com.circuvent.hrms.core.ui.StatusPill
import com.circuvent.hrms.core.ui.TextTone
import com.circuvent.hrms.core.ui.rememberFormattedDate
import com.circuvent.hrms.core.ui.screenPadding
import com.circuvent.hrms.data.AnnouncementsResponse
import com.circuvent.hrms.data.DirectoryResponse
import com.circuvent.hrms.data.ExpenseSubmission
import com.circuvent.hrms.data.ExpensesResponse
import com.circuvent.hrms.data.HolidaysResponse
import com.circuvent.hrms.data.SessionUser
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// ═══════════════════════════════════════════════════════════════
// THE WORKPLACE — colleagues, notices, days off, and money back
// ═══════════════════════════════════════════════════════════════
//
// Four things an employee reaches for that had no screen, and one that needed
// no server at all.

@Composable
private fun readableDate(iso: String): String {
    if (iso.length < 10) return iso
    val year = iso.substring(0, 4)
    val month = iso.substring(5, 7).toIntOrNull() ?: return iso
    val day = iso.substring(8, 10).trimStart('0')
    return "$day ${monthName(month)} $year"
}

@Composable
private fun monthName(month: Int): String =
    stringArrayResource(R.array.month_names_full).getOrNull(month - 1) ?: ""

/**
 * Delegates to the app's single date formatter.
 *
 * [readableDate] above renders a fixed "D Month YYYY" form for the handful of
 * call sites that pre-date this formatter; everything else goes through here so
 * it follows the reader's chosen format.
 */
@Composable
private fun preferredDate(iso: String): String = rememberFormattedDate(iso)

/**
 * The staff directory.
 *
 * Search goes to the server rather than filtering a downloaded list: an
 * organisation of any size is too many rows to hold on a phone, and the server
 * is already deciding what this caller may see.
 *
 * Debounced, because a request per keystroke is a request per keystroke.
 */
@Composable
fun DirectoryScreen(container: AppContainer) {
    var query by remember { mutableStateOf("") }
    var state by remember { mutableStateOf<Loaded<DirectoryResponse>>(Loaded.Loading) }

    LaunchedEffect(query) {
        if (query.isNotEmpty()) delay(350)
        state = try {
            Loaded.Ready(container.repository.directory(query))
        } catch (e: Throwable) {
            failureOf("The directory", e)
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = screenPadding(),
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm),
    ) {
        item {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                label = { Text(stringResource(R.string.directory_search_label)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        when (val current = state) {
            is Loaded.Loading -> item { SkeletonRows(count = 6, rowHeight = 72.dp) }
            is Loaded.Failed -> item {
                Banner(BannerTone.ERROR, current.title, description = current.description)
            }

            is Loaded.Ready -> {
                if (current.value.items.isEmpty()) {
                    item {
                        EmptyState(
                            title = if (query.isBlank()) stringResource(R.string.directory_empty_title)
                                else stringResource(R.string.directory_no_results_title),
                            description =
                                if (query.isBlank()) stringResource(R.string.directory_empty_description)
                                else stringResource(R.string.directory_no_results_description, query),
                        )
                    }
                } else {
                    items(current.value.items, key = { it.id }) { person ->
                        AppCard(
                            contentDescription = stringResource(
                                R.string.directory_person_content_description,
                                person.fullName,
                                person.designation,
                            ),
                        ) {
                            AppText(
                                person.fullName.ifBlank { "${person.firstName} ${person.lastName}".trim() },
                                weight = FontWeight.SemiBold,
                            )
                            if (person.designation.isNotBlank()) {
                                AppText(
                                    person.designation +
                                        (person.departmentName?.let { " · $it" } ?: ""),
                                    tone = TextTone.MUTED,
                                    size = Theme.type.footnote,
                                )
                            }
                            if (person.email.isNotBlank()) {
                                AppText(person.email, tone = TextTone.MUTED, size = Theme.type.caption)
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Company notices, pinned ones first. */
@Composable
fun AnnouncementsScreen(container: AppContainer) {
    var state by remember { mutableStateOf<Loaded<AnnouncementsResponse>>(Loaded.Loading) }

    LaunchedEffect(Unit) {
        state = try {
            Loaded.Ready(container.repository.announcements())
        } catch (e: Throwable) {
            failureOf("Announcements", e)
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = screenPadding(),
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm),
    ) {
        when (val current = state) {
            is Loaded.Loading -> item { SkeletonRows(count = 4, rowHeight = 96.dp) }
            is Loaded.Failed -> item {
                Banner(BannerTone.ERROR, current.title, description = current.description)
            }

            is Loaded.Ready -> {
                val sorted = current.value.items.sortedByDescending { it.isPinned }
                if (sorted.isEmpty()) {
                    item {
                        EmptyState(
                            title = stringResource(R.string.announcements_empty_title),
                            description = stringResource(R.string.announcements_empty_description),
                        )
                    }
                } else {
                    items(sorted, key = { it.id }) { notice ->
                        AppCard(contentDescription = notice.title) {
                            Row(
                                Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                AppText(notice.title, weight = FontWeight.SemiBold)
                                if (notice.isPinned) StatusPill(stringResource(R.string.announcements_pinned_pill), PillTone.INFO)
                            }
                            AppText(
                                notice.body,
                                tone = TextTone.MUTED,
                                size = Theme.type.footnote,
                                lineHeight = Theme.type.footnoteLine,
                            )
                            notice.publishedAt?.takeIf { it.length >= 10 }?.let {
                                AppText(
                                    preferredDate(it.substring(0, 10)),
                                    tone = TextTone.MUTED,
                                    size = Theme.type.caption,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * The holiday calendar.
 *
 * Optional holidays are marked rather than mixed in. They are chosen from a
 * pool rather than granted, and an employee who assumes an optional day is a
 * closure turns up to an empty office — or worse, does not turn up to a full
 * one.
 */
@Composable
fun HolidaysScreen(container: AppContainer) {
    var state by remember { mutableStateOf<Loaded<HolidaysResponse>>(Loaded.Loading) }

    LaunchedEffect(Unit) {
        state = try {
            Loaded.Ready(container.repository.holidays())
        } catch (e: Throwable) {
            failureOf("The holiday calendar", e)
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = screenPadding(),
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm),
    ) {
        when (val current = state) {
            is Loaded.Loading -> item { SkeletonRows(count = 8, rowHeight = 64.dp) }
            is Loaded.Failed -> item {
                Banner(BannerTone.ERROR, current.title, description = current.description)
            }

            is Loaded.Ready -> {
                val sorted = current.value.items.sortedBy { it.holidayDate }
                if (sorted.isEmpty()) {
                    item {
                        EmptyState(
                            title = stringResource(R.string.holidays_empty_title),
                            description = stringResource(R.string.holidays_empty_description),
                        )
                    }
                } else {
                    items(sorted, key = { it.id }) { holiday ->
                        AppCard(
                            contentDescription =
                                if (holiday.isOptional)
                                    stringResource(
                                        R.string.holidays_item_content_description_optional,
                                        holiday.name,
                                        readableDate(holiday.holidayDate),
                                    )
                                else
                                    stringResource(
                                        R.string.holidays_item_content_description,
                                        holiday.name,
                                        readableDate(holiday.holidayDate),
                                    ),
                        ) {
                            Row(
                                Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    AppText(holiday.name, weight = FontWeight.Medium)
                                    AppText(
                                        preferredDate(holiday.holidayDate),
                                        tone = TextTone.MUTED,
                                        size = Theme.type.footnote,
                                    )
                                }
                                if (holiday.isOptional) StatusPill(stringResource(R.string.holidays_optional_pill), PillTone.NEUTRAL)
                            }
                            holiday.description?.takeIf { it.isNotBlank() }?.let {
                                AppText(it, tone = TextTone.MUTED, size = Theme.type.caption)
                            }
                        }
                    }
                }
            }
        }
    }
}

private val EXPENSE_CATEGORIES = listOf("travel", "meals", "accommodation", "supplies", "other")

/** Expense claims, and a form to submit one. */
@Composable
fun ExpensesScreen(container: AppContainer) {
    var state by remember { mutableStateOf<Loaded<ExpensesResponse>>(Loaded.Loading) }
    var showForm by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<Pair<BannerTone, String>?>(null) }

    var title by remember { mutableStateOf("") }
    var category by remember { mutableStateOf(EXPENSE_CATEGORIES.first()) }
    var date by remember { mutableStateOf("") }
    var amount by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var submitting by remember { mutableStateOf(false) }

    val scope = rememberCoroutineScope()
    val claimSubmittedMessage = stringResource(R.string.expenses_claim_submitted)
    val claimFailedMessage = stringResource(R.string.expenses_claim_failed)

    suspend fun load() {
        state = try {
            Loaded.Ready(container.repository.expenses())
        } catch (e: Throwable) {
            failureOf("Your expenses", e)
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

                if (!showForm) {
                    AppButton(label = stringResource(R.string.expenses_claim_action), onClick = { showForm = true })
                } else {
                    AppCard {
                        AppText(stringResource(R.string.expenses_claim_action), weight = FontWeight.SemiBold)
                        OutlinedTextField(
                            value = title,
                            onValueChange = { title = it },
                            label = { Text(stringResource(R.string.expenses_field_title)) },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth().padding(top = Theme.spacing.xs),
                        )
                        DateField(
                            label = stringResource(R.string.expenses_field_date),
                            value = date,
                            onValueChange = { date = it },
                            // Money already spent. A claim dated next week is a
                            // typo, not a plan.
                            maxDate = LocalDate.now(),
                            modifier = Modifier.padding(top = Theme.spacing.xs),
                        )
                        OutlinedTextField(
                            value = amount,
                            onValueChange = { amount = it.filter(Char::isDigit) },
                            label = { Text(stringResource(R.string.expenses_field_amount)) },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            modifier = Modifier.fillMaxWidth().padding(top = Theme.spacing.xs),
                        )

                        AppText(
                            stringResource(R.string.expenses_category_label),
                            size = Theme.type.footnote,
                            tone = TextTone.MUTED,
                            modifier = Modifier.padding(top = Theme.spacing.sm),
                        )
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(Theme.spacing.xs),
                        ) {
                            EXPENSE_CATEGORIES.take(3).forEach { c ->
                                AppButton(
                                    label = when (c) {
                                        "travel" -> stringResource(R.string.expenses_category_travel)
                                        "meals" -> stringResource(R.string.expenses_category_meals)
                                        "accommodation" -> stringResource(R.string.expenses_category_accommodation)
                                        else -> c.replaceFirstChar { it.uppercase() }
                                    },
                                    variant = if (category == c) ButtonVariant.PRIMARY
                                    else ButtonVariant.SECONDARY,
                                    fullWidth = false,
                                    onClick = { category = c },
                                    modifier = Modifier.weight(1f),
                                )
                            }
                        }

                        OutlinedTextField(
                            value = description,
                            onValueChange = { description = it },
                            label = { Text(stringResource(R.string.expenses_field_notes)) },
                            modifier = Modifier.fillMaxWidth().padding(top = Theme.spacing.xs),
                        )

                        // Said rather than implied: a claim without a receipt is
                        // usually sent back, and finding that out a week later
                        // wastes everybody's time.
                        AppText(
                            stringResource(R.string.expenses_receipt_note),
                            tone = TextTone.MUTED,
                            size = Theme.type.caption,
                            modifier = Modifier.padding(top = Theme.spacing.xs),
                        )

                        AppButton(
                            label = if (submitting) stringResource(R.string.expenses_submitting_action)
                                else stringResource(R.string.expenses_submit_action),
                            enabled = !submitting && title.isNotBlank() &&
                                (amount.toLongOrNull() ?: 0L) > 0L && date.isNotBlank(),
                            busy = submitting,
                            modifier = Modifier.padding(top = Theme.spacing.sm),
                            onClick = {
                                submitting = true
                                message = null
                                scope.launch {
                                    try {
                                        container.repository.submitExpense(
                                            ExpenseSubmission(
                                                title = title.trim(),
                                                category = category,
                                                expenseDate = date.trim(),
                                                amountMinor =
                                                    ((amount.toLongOrNull() ?: 0L) * 100).toString(),
                                                description = description.takeIf { it.isNotBlank() },
                                            )
                                        )
                                        showForm = false
                                        title = ""; amount = ""; description = ""; date = ""
                                        load()
                                        message = BannerTone.SUCCESS to claimSubmittedMessage
                                    } catch (e: Throwable) {
                                        message = BannerTone.ERROR to
                                            (e.message ?: claimFailedMessage)
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

                SectionLabel(stringResource(R.string.expenses_section_claims))
            }
        }

        val ready = state as? Loaded.Ready
        if (ready != null) {
            if (ready.value.items.isEmpty()) {
                item {
                    EmptyState(
                        title = stringResource(R.string.expenses_empty_title),
                        description = stringResource(R.string.expenses_empty_description),
                    )
                }
            } else {
                items(ready.value.items, key = { it.id }) { claim ->
                    AppCard(
                        contentDescription = stringResource(
                            R.string.expenses_item_content_description,
                            claim.title,
                            claim.status,
                        ),
                    ) {
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            AppText(claim.title, weight = FontWeight.Medium)
                            StatusPill(
                                claim.status.replaceFirstChar { it.uppercase() },
                                when (claim.status) {
                                    "approved", "reimbursed" -> PillTone.SUCCESS
                                    "rejected" -> PillTone.DANGER
                                    else -> PillTone.WARNING
                                },
                            )
                        }
                        AppText(
                            if (claim.expenseDate.length >= 10)
                                stringResource(
                                    R.string.expenses_item_summary_dated,
                                    claim.amount.toLong().toString(),
                                    claim.category,
                                    readableDate(claim.expenseDate.substring(0, 10)),
                                )
                            else
                                stringResource(
                                    R.string.expenses_item_summary,
                                    claim.amount.toLong().toString(),
                                    claim.category,
                                ),
                            tone = TextTone.MUTED,
                            size = Theme.type.footnote,
                        )
                    }
                }
            }
        }
    }
}

/**
 * The digital ID card.
 *
 * Everything on it is already on the device — this asks nothing of the server,
 * which is the point: the moment somebody needs to prove who they work for is
 * often the moment they have no signal, at a reception desk in a basement.
 */
@Composable
fun IdCardScreen(user: SessionUser?) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = screenPadding(),
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm),
    ) {
        item {
            if (user == null) {
                EmptyState(
                    title = stringResource(R.string.id_card_signed_out_title),
                    description = stringResource(R.string.id_card_signed_out_description),
                )
            } else {
                AppCard {
                    AppText(stringResource(R.string.app_name), tone = TextTone.MUTED, size = Theme.type.caption)
                    AppText(
                        stringResource(R.string.id_card_full_name, user.firstName, user.lastName)
                            .trim().ifBlank { user.email },
                        weight = FontWeight.Bold,
                        size = Theme.type.title2,
                        lineHeight = Theme.type.title2Line,
                    )
                    AppText(user.email, tone = TextTone.MUTED, size = Theme.type.footnote)
                    Row(Modifier.fillMaxWidth().padding(top = Theme.spacing.sm)) {
                        Column(Modifier.weight(1f)) {
                            AppText(stringResource(R.string.id_card_role_label), tone = TextTone.MUTED, size = Theme.type.caption)
                            AppText(
                                user.role.replaceFirstChar { it.uppercase() },
                                weight = FontWeight.Medium,
                            )
                        }
                        if (user.employeeCode != null) {
                            Column(Modifier.weight(1f)) {
                                AppText(stringResource(R.string.id_card_employee_label), tone = TextTone.MUTED, size = Theme.type.caption)
                                // The code, not the id. The first eight characters
                                // of a UUID identify nobody to a human being, and
                                // this card exists to be shown to one.
                                AppText(
                                    user.employeeCode,
                                    weight = FontWeight.Medium,
                                )
                            }
                        }
                    }
                }

                AppCard {
                    AppText(
                        stringResource(R.string.id_card_disclaimer),
                        tone = TextTone.MUTED,
                        size = Theme.type.footnote,
                        lineHeight = Theme.type.footnoteLine,
                    )
                }
            }
        }
    }
}
