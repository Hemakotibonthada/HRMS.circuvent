package com.circuvent.hrms.desktop

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
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
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * A date, chosen from a calendar.
 *
 * The phone version of this app used to ask for `YYYY-MM-DD` in a text box, and
 * on a phone that box opens a number keypad with no hyphen on it — the format
 * the label demanded could not be typed with the keyboard the field summoned.
 *
 * A desktop keyboard has a hyphen, so the defect is milder here, but the rest
 * of it survives the move: nothing says which of day-month-year the server
 * wants, a typo is only caught after submission, and a date outside the allowed
 * range is accepted and then refused. Offering only the days the rule permits
 * answers all three before anybody types.
 *
 * The value stays ISO `yyyy-MM-dd` because that is what the API takes; what is
 * shown is written the way people write dates.
 */
private val SHOWN = DateTimeFormatter.ofPattern("d MMM yyyy")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeskDateField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    /** Earliest date offerable. Null means no floor. */
    minDate: LocalDate? = null,
    /** Latest date offerable. Null means no ceiling. */
    maxDate: LocalDate? = null,
) {
    var showing by remember { mutableStateOf(false) }

    val parsed = remember(value) { runCatching { LocalDate.parse(value) }.getOrNull() }
    val shown = parsed?.format(SHOWN) ?: ""

    Box(modifier) {
        OutlinedTextField(
            value = shown,
            onValueChange = {},
            label = { Text(label) },
            readOnly = true,
            singleLine = true,
            enabled = enabled,
            trailingIcon = { Icon(Icons.Filled.CalendarMonth, contentDescription = null) },
            modifier = Modifier.fillMaxWidth(),
        )

        // A read-only text field still takes focus and swallows the click, so
        // the label floats as though something happened and no picker opens —
        // which looks like it worked and did not. The transparent overlay takes
        // the click instead.
        Box(
            Modifier
                .matchParentSize()
                .clickable(enabled = enabled) { showing = true }
        )
    }

    if (!showing) return

    // Dates outside the range are not offered rather than offered and then
    // refused. A calendar that lets you pick the 3rd and then says the 3rd is
    // not allowed has wasted the click and taught nothing.
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
        val day = parsed
            ?: maxDate?.takeIf { it.isBefore(LocalDate.now()) }
            ?: minDate?.takeIf { it.isAfter(LocalDate.now()) }
            ?: LocalDate.now()
        day.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
    }

    val pickerState = rememberDatePickerState(
        initialSelectedDateMillis = initial,
        selectableDates = selectable,
    )

    DatePickerDialog(
        onDismissRequest = { showing = false },
        confirmButton = {
            TextButton(
                onClick = {
                    pickerState.selectedDateMillis?.let { millis ->
                        onValueChange(
                            Instant.ofEpochMilli(millis).atZone(ZoneOffset.UTC).toLocalDate().toString()
                        )
                    }
                    showing = false
                },
                enabled = pickerState.selectedDateMillis != null,
            ) { Text("Choose") }
        },
        dismissButton = {
            TextButton(onClick = { showing = false }) { Text("Cancel") }
        },
    ) {
        DatePicker(state = pickerState, showModeToggle = true)
    }
}
