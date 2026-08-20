package com.circuvent.hrms.core.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DatePickerDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import com.circuvent.hrms.R
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/**
 * A date, chosen from a calendar.
 *
 * Every date in this app used to be a text box wanting `YYYY-MM-DD`, and on a
 * phone that box opens a number keypad — which does not have a hyphen. So the
 * format the field insisted on could not be typed with the keyboard the field
 * asked for. People got as far as "20082026" and gave up, and nothing told them
 * why it was refused.
 *
 * The field is read-only and opens a picker. It is still an
 * `OutlinedTextField` rather than a plain row because the label, the error
 * state and the disabled state are the ones every other field on the same form
 * has, and a date that looks unlike its neighbours reads as a different kind of
 * thing.
 *
 * The value stays ISO `yyyy-MM-dd` — that is what the server takes — while what
 * is *shown* respects the reader's date-format setting. Somebody who chose
 * "31 Mar 2026" should not be shown 2026-03-31 on one screen out of ten.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DateField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    isError: Boolean = false,
    supportingText: String? = null,
    /** Earliest date offerable. Null means no floor. */
    minDate: LocalDate? = null,
    /** Latest date offerable. Null means no ceiling. */
    maxDate: LocalDate? = null,
) {
    var showing by remember { mutableStateOf(false) }
    val shown = if (value.isBlank()) "" else rememberFormattedDate(value)

    // The overlay below *replaces* the field's own description rather than
    // adding to it, so naming only the label would hide the answer: TalkBack
    // read "First day, button" whether the field said 25 Aug 2026 or nothing at
    // all. The value a sighted reader can see has to be in here too.
    val description = if (shown.isBlank()) {
        stringResource(R.string.date_field_empty_description, label)
    } else {
        stringResource(R.string.date_field_value_description, label, shown)
    }
    val openAction = stringResource(R.string.date_field_open_action)

    // The tap is caught by a transparent overlay, not by a `clickable` on the
    // field itself. A read-only OutlinedTextField still takes focus, and its
    // own gesture handling swallows the click — the label floats up as though
    // something happened and no picker opens, which is worse than an inert
    // field because it looks like it worked.
    Box(modifier = modifier.fillMaxWidth()) {
        OutlinedTextField(
            value = shown,
            onValueChange = {},
            label = { Text(label) },
            readOnly = true,
            singleLine = true,
            enabled = enabled,
            isError = isError,
            supportingText = supportingText?.let { { Text(it) } },
            trailingIcon = {
                Icon(
                    imageVector = Icons.Filled.CalendarMonth,
                    contentDescription = null,
                )
            },
            modifier = Modifier.fillMaxWidth(),
        )

        // Sized to the field's box rather than the whole component, so the
        // supporting text underneath stays selectable and is not swallowed.
        Box(
            Modifier
                .matchParentSize()
                .clickable(enabled = enabled) { showing = true }
                .semantics {
                    role = Role.Button
                    contentDescription = description
                    onClick(label = openAction) { showing = true; true }
                }
        )
    }

    if (!showing) return

    // Dates outside the allowed range are not offered at all, rather than
    // offered and then refused. A calendar that lets you tap the 3rd and then
    // says the 3rd is not allowed has wasted the tap and taught nothing.
    val selectable = remember(minDate, maxDate) {
        object : SelectableDates {
            override fun isSelectableDate(utcTimeMillis: Long): Boolean {
                val day = Instant.ofEpochMilli(utcTimeMillis).atZone(ZoneOffset.UTC).toLocalDate()
                if (minDate != null && day.isBefore(minDate)) return false
                if (maxDate != null && day.isAfter(maxDate)) return false
                return true
            }

            override fun isSelectableYear(year: Int): Boolean {
                if (minDate != null && year < minDate.year) return false
                if (maxDate != null && year > maxDate.year) return false
                return true
            }
        }
    }

    val initial = remember(value) {
        val day = runCatching { LocalDate.parse(value) }.getOrNull()
            ?: maxDate?.takeIf { it.isBefore(LocalDate.now()) }
            ?: minDate?.takeIf { it.isAfter(LocalDate.now()) }
            ?: LocalDate.now()
        day.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
    }

    val state = rememberDatePickerState(
        initialSelectedDateMillis = initial,
        selectableDates = selectable,
    )

    DatePickerDialog(
        onDismissRequest = { showing = false },
        confirmButton = {
            TextButton(
                onClick = {
                    state.selectedDateMillis?.let { millis ->
                        val picked = Instant.ofEpochMilli(millis)
                            .atZone(ZoneOffset.UTC)
                            .toLocalDate()
                        onValueChange(picked.toString())
                    }
                    showing = false
                },
                enabled = state.selectedDateMillis != null,
            ) { Text(stringResource(R.string.date_field_confirm)) }
        },
        dismissButton = {
            TextButton(onClick = { showing = false }) {
                Text(stringResource(R.string.date_field_cancel))
            }
        },
        colors = DatePickerDefaults.colors(),
    ) {
        DatePicker(state = state, showModeToggle = true)
    }
}
