package com.circuvent.hrms.core.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.circuvent.hrms.core.design.Theme
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.YearMonth

/**
 * A day the office is closed, and why.
 *
 * The reason is carried so the calendar can say "Bhogi" rather than colouring
 * a square and leaving the reader to guess.
 */
data class ClosedDay(val date: LocalDate, val name: String, val optional: Boolean)

/**
 * A month, for choosing leave dates.
 *
 * Replaces two text fields that wanted `YYYY-MM-DD` typed on a number keypad —
 * which needs a symbol keyboard for the hyphens, gives no feedback until
 * submission, and above all hides the thing that actually costs money: this
 * employer deducts *calendar* days, so a Friday-to-Monday request spends four
 * days of entitlement and two of them are the weekend. Nobody could see that
 * before pressing send.
 *
 * Weekends and holidays are therefore marked, and named. A square that is
 * merely a different colour tells somebody there is something special about
 * the day without telling them what, and colour alone is not available to
 * everybody — so every non-working day also carries its reason in the
 * description a screen reader reads.
 */
@Composable
fun LeaveCalendar(
    selectedStart: LocalDate?,
    selectedEnd: LocalDate?,
    onSelect: (LocalDate) -> Unit,
    modifier: Modifier = Modifier,
    closed: List<ClosedDay> = emptyList(),
    weekend: Set<DayOfWeek> = setOf(DayOfWeek.SATURDAY, DayOfWeek.SUNDAY),
    earliest: LocalDate? = null,
) {
    val colors = Theme.colors
    val closedByDate = remember(closed) { closed.associateBy { it.date } }

    // Opens on the month of whatever is already chosen, not on today. Somebody
    // editing a request for next month should not be sent back to this one.
    var month by remember(selectedStart) {
        mutableStateOf(YearMonth.from(selectedStart ?: LocalDate.now()))
    }

    Column(modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            MonthArrow(
                icon = Icons.Filled.ChevronLeft,
                label = "Previous month",
                onClick = { month = month.minusMonths(1) },
            )
            AppText(
                text = "${month.month.name.lowercase().replaceFirstChar { it.uppercase() }} ${month.year}",
                weight = FontWeight.SemiBold,
                align = TextAlign.Center,
                modifier = Modifier.weight(1f),
            )
            MonthArrow(
                icon = Icons.Filled.ChevronRight,
                label = "Next month",
                onClick = { month = month.plusMonths(1) },
            )
        }

        Spacer(Modifier.height(Theme.spacing.sm))

        Row(Modifier.fillMaxWidth()) {
            // Monday first: the working week is the unit people plan leave in,
            // and a grid starting on Sunday splits it across two rows.
            for (day in DayOfWeek.entries) {
                AppText(
                    text = day.name.take(1),
                    size = Theme.type.caption,
                    lineHeight = Theme.type.captionLine,
                    tone = TextTone.MUTED,
                    align = TextAlign.Center,
                    modifier = Modifier.weight(1f),
                )
            }
        }

        val first = month.atDay(1)
        val blanks = first.dayOfWeek.value - 1
        val cells = blanks + month.lengthOfMonth()
        val rows = (cells + 6) / 7

        for (row in 0 until rows) {
            Row(Modifier.fillMaxWidth()) {
                for (column in 0 until 7) {
                    val index = row * 7 + column
                    val dayOfMonth = index - blanks + 1

                    if (dayOfMonth < 1 || dayOfMonth > month.lengthOfMonth()) {
                        Spacer(Modifier.weight(1f).aspectRatio(1f))
                        continue
                    }

                    val date = month.atDay(dayOfMonth)
                    DayCell(
                        date = date,
                        closed = closedByDate[date],
                        isWeekend = date.dayOfWeek in weekend,
                        inRange = inRange(date, selectedStart, selectedEnd),
                        isEdge = date == selectedStart || date == selectedEnd,
                        enabled = earliest == null || !date.isBefore(earliest),
                        onClick = { onSelect(date) },
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }

        // Named, not just coloured. Somebody who cannot separate the tints — or
        // who is reading this aloud — still needs to know which days are
        // closed and why.
        val closedInMonth = closed.filter { YearMonth.from(it.date) == month }
        if (closedInMonth.isNotEmpty()) {
            Spacer(Modifier.height(Theme.spacing.sm))
            closedInMonth.sortedBy { it.date }.forEach { day ->
                AppText(
                    text = "${day.date.dayOfMonth} ${monthShort(day.date)} · ${day.name}" +
                        if (day.optional) " (optional)" else "",
                    size = Theme.type.caption,
                    lineHeight = Theme.type.captionLine,
                    tone = TextTone.MUTED,
                )
            }
        }

        Spacer(Modifier.height(Theme.spacing.xs))
        Box(
            Modifier
                .fillMaxWidth()
                .height(1.dp)
                .background(colors.borderSubtle)
        )
    }
}

@Composable
private fun MonthArrow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    onClick: () -> Unit,
) {
    Box(
        modifier = Modifier
            .size(com.circuvent.hrms.core.design.MinTouchTarget)
            .clip(RoundedCornerShape(Theme.radius.pill))
            .clickable(onClick = onClick)
            .clearAndSetSemantics {
                contentDescription = label
                role = Role.Button
            },
        contentAlignment = Alignment.Center,
    ) {
        Icon(imageVector = icon, contentDescription = null, tint = Theme.colors.text)
    }
}

@Composable
private fun DayCell(
    date: LocalDate,
    closed: ClosedDay?,
    isWeekend: Boolean,
    inRange: Boolean,
    isEdge: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Theme.colors

    val background = when {
        isEdge -> colors.primary
        inRange -> colors.primarySubtle
        closed != null -> colors.warningSubtle
        isWeekend -> colors.surface
        else -> Color.Transparent
    }

    val tone = when {
        isEdge -> TextTone.ON_PRIMARY
        !enabled -> TextTone.MUTED
        closed != null -> TextTone.WARNING
        isWeekend -> TextTone.MUTED
        else -> TextTone.DEFAULT
    }

    // Everything the square conveys visually, said in words. "23, Saturday,
    // weekend" and "26, Bhogi, holiday" are the two facts that change whether
    // somebody should pick this day.
    val description = buildString {
        append(date.dayOfMonth)
        append(", ")
        append(date.dayOfWeek.name.lowercase().replaceFirstChar { it.uppercase() })
        if (closed != null) append(", ${closed.name}, holiday")
        else if (isWeekend) append(", weekend")
        if (isEdge || inRange) append(", selected")
        if (!enabled) append(", unavailable")
    }

    Box(
        modifier = modifier
            .aspectRatio(1f)
            .padding(2.dp)
            .clip(RoundedCornerShape(Theme.radius.sm))
            .background(background)
            .clickable(enabled = enabled, onClick = onClick)
            .clearAndSetSemantics {
                contentDescription = description
                role = Role.Button
                selected = isEdge || inRange
            },
        contentAlignment = Alignment.Center,
    ) {
        AppText(
            text = date.dayOfMonth.toString(),
            size = Theme.type.footnote,
            lineHeight = Theme.type.footnoteLine,
            tone = tone,
            weight = if (isEdge) FontWeight.Bold else FontWeight.Normal,
        )
    }
}

private fun inRange(date: LocalDate, start: LocalDate?, end: LocalDate?): Boolean {
    if (start == null || end == null) return false
    return !date.isBefore(start) && !date.isAfter(end)
}

private fun monthShort(date: LocalDate): String =
    date.month.name.take(3).lowercase().replaceFirstChar { it.uppercase() }
