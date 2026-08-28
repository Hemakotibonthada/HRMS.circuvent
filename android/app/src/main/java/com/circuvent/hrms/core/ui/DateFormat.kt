package com.circuvent.hrms.core.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.staticCompositionLocalOf
import com.circuvent.hrms.data.DateFormatChoice

/**
 * How a date coming off the API should be written on screen.
 *
 * Every date the server sends is an ISO `yyyy-MM-dd`, sometimes with a time
 * after it. That form is unambiguous, which is why the API uses it, and is also
 * what nobody writes by hand — so it reads as machine output in the middle of a
 * sentence about somebody's leave.
 *
 * The formatting was previously done three different ways: one screen wrote
 * "31 Mar", another "31 March 2026", and several printed the raw ISO string.
 * The same holiday could therefore appear in two forms on two screens of the
 * same app. This is the one place it is decided.
 *
 * Parsing is deliberately by substring rather than `LocalDate.parse`. These
 * strings arrive from a network boundary, a malformed one is not exceptional
 * enough to be worth a try/catch at every call site, and showing the raw value
 * back is more useful than showing nothing.
 */
val LocalDateFormat: ProvidableCompositionLocal<DateFormatChoice> =
    staticCompositionLocalOf { DateFormatChoice.DAY_FIRST }

@Composable
fun ProvideDateFormat(choice: DateFormatChoice, content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalDateFormat provides choice, content = content)
}

private val MONTHS = arrayOf(
    "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
)

/**
 * Formats an ISO date in the reader's chosen style.
 *
 * Returns the input unchanged when it is not a date this understands. A screen
 * showing "not-a-date" is a bug somebody can report; a screen showing an empty
 * space is a bug nobody can describe.
 */
fun formatIsoDate(iso: String, choice: DateFormatChoice): String {
    if (iso.length < 10) return iso
    val year = iso.substring(0, 4)
    val month = iso.substring(5, 7).toIntOrNull() ?: return iso
    if (month !in 1..12) return iso
    val day = iso.substring(8, 10).trimStart('0').ifEmpty { return iso }

    return when (choice) {
        DateFormatChoice.DAY_FIRST -> "$day ${MONTHS[month]} $year"
        DateFormatChoice.MONTH_FIRST -> "${MONTHS[month]} $day, $year"
        // Already ISO. Returned as the plain date so a timestamp does not leak
        // its time component into a place that only asked for a day.
        DateFormatChoice.ISO -> iso.substring(0, 10)
    }
}

/** [formatIsoDate] against the format in scope. */
@Composable
fun rememberFormattedDate(iso: String): String = formatIsoDate(iso, LocalDateFormat.current)

/**
 * A date range, collapsing a single day to one date.
 *
 * "30 Aug 2026 to 30 Aug 2026" is a one-day absence described twice, and it is
 * the form people misread as two days.
 */
@Composable
fun rememberFormattedRange(from: String, to: String): String {
    val choice = LocalDateFormat.current
    val start = formatIsoDate(from, choice)
    if (to.isBlank() || from == to) return start
    return "$start to ${formatIsoDate(to, choice)}"
}

private val ISO_DATE = Regex("""\d{4}-\d{2}-\d{2}""")

/**
 * Rewrites every ISO date inside a longer string.
 *
 * The inbox builds one line per request — "2026-08-30 to 2026-08-31 · 2 days" —
 * and sorts on it, so the ISO form has to survive in the data even though it
 * should not be what the reader sees. Rewriting at the point of display keeps
 * the sort correct and still shows the chosen format.
 *
 * Substitution rather than parsing the whole line: the surrounding words differ
 * per request kind, and a parser that had to know all of them would break every
 * time one was reworded.
 */
@Composable
fun formatIsoRangeText(text: String): String {
    val choice = LocalDateFormat.current
    if (choice == DateFormatChoice.ISO) return text
    return ISO_DATE.replace(text) { formatIsoDate(it.value, choice) }
}
