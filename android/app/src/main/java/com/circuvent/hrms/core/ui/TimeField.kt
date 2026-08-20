package com.circuvent.hrms.core.ui

import android.text.format.DateFormat
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Keyboard
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimeInput
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import com.circuvent.hrms.R

/**
 * A time of day, chosen from a clock.
 *
 * The same defect [DateField] fixed, one field along. "In (HH:MM)" was a text
 * box, and the colon it demands is not on the keypad a phone offers for it —
 * so the format the label asked for could not be typed with the keyboard the
 * field summoned. The server enforces `HH:MM` and rejects anything else, so the
 * failure landed after submission, on a correction somebody had already spent a
 * screen explaining.
 *
 * Stored 24-hour as `HH:mm`, which is what the API validates. *Shown* in the
 * device's own 12- or 24-hour convention, because someone whose phone clock
 * says 6:30 pm should not have to work out that 18:30 is the same moment.
 *
 * Both entry modes are offered. The dial is quicker for "about six"; the keypad
 * is quicker for 09:32, and a correction is nearly always an exact remembered
 * time rather than an approximate one.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TimeField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    isError: Boolean = false,
    supportingText: String? = null,
) {
    var showing by remember { mutableStateOf(false) }
    val is24Hour = DateFormat.is24HourFormat(LocalContext.current)
    val shown = formatClockTime(value, is24Hour)

    val description = if (shown.isBlank()) {
        stringResource(R.string.time_field_empty_description, label)
    } else {
        stringResource(R.string.time_field_value_description, label, shown)
    }
    val openAction = stringResource(R.string.time_field_open_action)

    // Transparent overlay rather than a `clickable` on the field, for the reason
    // given in DateField: a read-only OutlinedTextField takes focus and eats the
    // tap, so the label floats as though something happened and nothing opens.
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
                Icon(imageVector = Icons.Filled.Schedule, contentDescription = null)
            },
            modifier = Modifier.fillMaxWidth(),
        )

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

    val parsed = remember(value) { parseClockTime(value) }
    val state = rememberTimePickerState(
        initialHour = parsed?.first ?: 9,
        initialMinute = parsed?.second ?: 0,
        is24Hour = is24Hour,
    )
    var keypad by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = { showing = false },
        confirmButton = {
            TextButton(onClick = {
                onValueChange("%02d:%02d".format(state.hour, state.minute))
                showing = false
            }) { Text(stringResource(R.string.time_field_confirm)) }
        },
        dismissButton = {
            TextButton(onClick = { showing = false }) {
                Text(stringResource(R.string.time_field_cancel))
            }
        },
        title = {
            // The toggle sits in the title row, where the date picker puts its
            // own. Overlaid on the picker it landed on top of the hour digit.
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(label, modifier = Modifier.weight(1f))
                IconButton(onClick = { keypad = !keypad }) {
                    Icon(
                        imageVector = if (keypad) Icons.Filled.Schedule else Icons.Filled.Keyboard,
                        contentDescription = stringResource(
                            if (keypad) R.string.time_field_use_clock
                            else R.string.time_field_use_keypad
                        ),
                    )
                }
            }
        },
        text = {
            if (keypad) TimeInput(state = state) else TimePicker(state = state)
        },
    )
}

/** `HH:mm` to (hour, minute), or null when it is not a time. */
internal fun parseClockTime(value: String): Pair<Int, Int>? {
    val parts = value.trim().split(":")
    if (parts.size != 2) return null
    val hour = parts[0].toIntOrNull() ?: return null
    val minute = parts[1].toIntOrNull() ?: return null
    if (hour !in 0..23 || minute !in 0..59) return null
    return hour to minute
}

/**
 * `HH:mm` as the reader's own clock writes it.
 *
 * Anything unparseable is handed back untouched, on the same reasoning as
 * [formatIsoDate]: a visibly wrong value can be reported, a blank one cannot.
 */
fun formatClockTime(value: String, is24Hour: Boolean): String {
    if (value.isBlank()) return ""
    val (hour, minute) = parseClockTime(value) ?: return value
    if (is24Hour) return "%02d:%02d".format(hour, minute)
    val suffix = if (hour < 12) "am" else "pm"
    val display = when {
        hour % 12 == 0 -> 12
        else -> hour % 12
    }
    return "%d:%02d %s".format(display, minute, suffix)
}
