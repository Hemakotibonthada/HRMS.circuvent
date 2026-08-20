package com.circuvent.hrms.desktop

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

/**
 * A time of day, chosen from a clock.
 *
 * The same defect as a date in a text box, one punctuation mark along: the
 * server enforces `HH:MM` and rejects anything else, so the failure lands after
 * submission on a correction somebody has already spent a form explaining.
 *
 * Stored 24-hour as the API validates it. Both entry modes are offered — the
 * dial is quicker for "about six", the keypad for 09:32, and a correction is
 * nearly always an exact remembered time.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeskTimeField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    var showing by remember { mutableStateOf(false) }
    var keypad by remember { mutableStateOf(false) }

    Box(modifier) {
        OutlinedTextField(
            value = value,
            onValueChange = {},
            label = { Text(label) },
            readOnly = true,
            singleLine = true,
            enabled = enabled,
            trailingIcon = { Icon(Icons.Filled.Schedule, contentDescription = null) },
            modifier = Modifier.fillMaxWidth(),
        )
        Box(
            Modifier
                .matchParentSize()
                .clickable(enabled = enabled) { showing = true }
        )
    }

    if (!showing) return

    val parsed = remember(value) { parseClock(value) }
    val pickerState = rememberTimePickerState(
        initialHour = parsed?.first ?: 9,
        initialMinute = parsed?.second ?: 0,
        is24Hour = true,
    )

    AlertDialog(
        onDismissRequest = { showing = false },
        confirmButton = {
            TextButton(onClick = {
                onValueChange("%02d:%02d".format(pickerState.hour, pickerState.minute))
                showing = false
            }) { Text("Choose") }
        },
        dismissButton = {
            TextButton(onClick = { showing = false }) { Text("Cancel") }
        },
        title = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(label, modifier = Modifier.weight(1f))
                IconButton(onClick = { keypad = !keypad }) {
                    Icon(
                        if (keypad) Icons.Filled.Schedule else Icons.Filled.Keyboard,
                        contentDescription = if (keypad) "Use the clock instead" else "Type the time instead",
                    )
                }
            }
        },
        text = {
            if (keypad) TimeInput(state = pickerState) else TimePicker(state = pickerState)
        },
    )
}

/** `HH:mm` to (hour, minute), or null when it is not a time. */
internal fun parseClock(value: String): Pair<Int, Int>? {
    val parts = value.trim().split(":")
    if (parts.size != 2) return null
    val hour = parts[0].toIntOrNull() ?: return null
    val minute = parts[1].toIntOrNull() ?: return null
    if (hour !in 0..23 || minute !in 0..59) return null
    return hour to minute
}
