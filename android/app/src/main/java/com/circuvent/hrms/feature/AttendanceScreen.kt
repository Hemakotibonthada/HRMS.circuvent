package com.circuvent.hrms.feature

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.circuvent.hrms.AppContainer
import com.circuvent.hrms.R
import com.circuvent.hrms.core.design.MinTouchTarget
import com.circuvent.hrms.core.design.Theme
import com.circuvent.hrms.core.ui.AppCard
import com.circuvent.hrms.core.ui.AppText
import com.circuvent.hrms.core.ui.Banner
import com.circuvent.hrms.core.ui.BannerTone
import com.circuvent.hrms.core.ui.EmptyState
import com.circuvent.hrms.core.ui.PillTone
import com.circuvent.hrms.core.ui.SkeletonRows
import com.circuvent.hrms.core.ui.StatusPill
import com.circuvent.hrms.core.ui.TextTone
import com.circuvent.hrms.core.ui.rememberFormattedDate
import com.circuvent.hrms.core.ui.screenPadding
import com.circuvent.hrms.data.AttendanceRowDto
import com.circuvent.hrms.data.AttendanceSummaryDto
import com.circuvent.hrms.data.SessionUser
import com.circuvent.hrms.domain.AttendanceRules
import com.circuvent.hrms.domain.ShiftRules
import java.time.LocalDate
import java.time.YearMonth

/**
 * Attendance history.
 *
 * One month at a time, because that is the unit attendance is questioned in —
 * a payslip covers a month, and the argument that brings somebody here is
 * almost always about one.
 */
@Composable
fun AttendanceScreen(container: AppContainer, user: SessionUser?) {
    val today = remember { LocalDate.now() }
    var cursor by remember { mutableStateOf(YearMonth.from(today)) }
    var state by remember {
        mutableStateOf<Loaded<Pair<List<AttendanceRowDto>, AttendanceSummaryDto?>>>(Loaded.Loading)
    }

    LaunchedEffect(cursor) {
        state = Loaded.Loading
        val (from, to) = AttendanceRules.monthRange(cursor)
        state = try {
            Loaded.Ready(
                container.repository.attendance(from, to, user?.id) to
                    container.repository.attendanceSummary(cursor.monthValue, cursor.year, user?.id)
            )
        } catch (e: Throwable) {
            // Cleared rather than left showing the previous month's rows under
            // the new month's heading, which would be a quietly wrong screen.
            failureOf("This month", e)
        }
    }

    val canGoForward = AttendanceRules.canGoForward(cursor, today)

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = screenPadding(),
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm),
    ) {
        item {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                MonthStep(
                    forward = false,
                    label = stringResource(R.string.attendance_go_to_month_template, AttendanceRules.monthLabel(cursor.minusMonths(1))),
                ) { cursor = cursor.minusMonths(1) }

                AppText(
                    AttendanceRules.monthLabel(cursor),
                    size = Theme.type.callout,
                    lineHeight = Theme.type.calloutLine,
                    weight = FontWeight.SemiBold,
                    heading = true,
                )

                MonthStep(
                    forward = true,
                    enabled = canGoForward,
                    // Disabled rather than hidden. A control that disappears
                    // makes people think they broke something; one that is
                    // visibly inert says "this is as far as it goes".
                    label = if (canGoForward) {
                        stringResource(R.string.attendance_go_to_month_template, AttendanceRules.monthLabel(cursor.plusMonths(1)))
                    } else {
                        stringResource(R.string.attendance_current_month_label)
                    },
                ) { cursor = cursor.plusMonths(1) }
            }
        }

        item {
            when (val current = state) {
                is Loaded.Loading -> SkeletonRows(count = 5, rowHeight = 60.dp)
                is Loaded.Failed -> Banner(BannerTone.ERROR, current.title, description = current.description)
                is Loaded.Ready -> {
                    val (rows, summary) = current.value
                    Column(verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm)) {
                        if (summary != null) SummaryCard(summary)
                        if (rows.isEmpty()) {
                            EmptyState(
                                title = stringResource(R.string.attendance_empty_title),
                                description = stringResource(R.string.attendance_empty_description),
                            )
                        }
                    }
                }
            }
        }

        (state as? Loaded.Ready)?.value?.first?.let { rows ->
            items(rows, key = { it.id }) { row -> AttendanceRow(row) }
        }
    }
}

@Composable
private fun SummaryCard(summary: AttendanceSummaryDto) {
    val model = AttendanceRules.Summary(
        presentDays = summary.presentDays,
        absentDays = summary.absentDays,
        lateDays = summary.lateDays,
        halfDays = summary.halfDays,
        leaveDays = summary.leaveDays,
        wfhDays = summary.wfhDays,
        totalWorkedMinutes = summary.totalWorkedMinutes,
        totalOvertimeMinutes = summary.totalOvertimeMinutes,
    )
    val average = AttendanceRules.averageWorkedMinutes(model)

    AppCard {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Total(stringResource(R.string.attendance_present_label), summary.presentDays.toString())
            Total(stringResource(R.string.attendance_absent_label), summary.absentDays.toString())
            Total(stringResource(R.string.attendance_leave_label), summary.leaveDays.toString())
            Total(stringResource(R.string.attendance_remote_label), summary.wfhDays.toString())
        }
        Row(
            Modifier
                .fillMaxWidth()
                .padding(top = Theme.spacing.md),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Total(stringResource(R.string.attendance_worked_label), ShiftRules.formatDuration(summary.totalWorkedMinutes))
            Total(stringResource(R.string.attendance_overtime_label), ShiftRules.formatDuration(summary.totalOvertimeMinutes))
            // An em dash, not "0h". Nobody averaged nothing; there was nothing
            // to average.
            Total(stringResource(R.string.attendance_average_day_label), average?.let { ShiftRules.formatDuration(it) } ?: "—")
        }
    }
}

@Composable
private fun Total(label: String, value: String) {
    Column(
        // One stop per figure. Split across two nodes a screen reader reads the
        // number and then the word, with no way to tell they belong together.
        modifier = Modifier.semantics(mergeDescendants = true) {
            contentDescription = "$label: $value"
        },
    ) {
        AppText(label, size = Theme.type.caption, lineHeight = Theme.type.captionLine, tone = TextTone.MUTED)
        AppText(value, size = Theme.type.title3, lineHeight = Theme.type.title3Line, weight = FontWeight.Bold)
    }
}

@Composable
private fun MonthStep(
    forward: Boolean,
    label: String,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Column(
        modifier = Modifier
            .defaultMinSize(minWidth = MinTouchTarget, minHeight = MinTouchTarget)
            .alpha(if (enabled) 1f else 0.35f)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics {
                contentDescription = label
                if (!enabled) disabled()
            },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(
            imageVector = if (forward) Icons.Filled.ChevronRight else Icons.Filled.ChevronLeft,
            contentDescription = null,
            tint = Theme.colors.text,
        )
    }
}

@Composable
private fun AttendanceRow(row: AttendanceRowDto) {
    val times = if (row.clockInAt != null || row.clockOutAt != null) {
        "${row.clockInAt?.let { ShiftRules.formatClock(it) } ?: "—"} – " +
            "${row.clockOutAt?.let { ShiftRules.formatClock(it) } ?: "—"}"
    } else {
        stringResource(R.string.attendance_no_punches_label)
    }

    val tone = when (AttendanceRules.statusTone(row.status)) {
        AttendanceRules.Tone.SUCCESS -> PillTone.SUCCESS
        AttendanceRules.Tone.WARNING -> PillTone.WARNING
        AttendanceRules.Tone.DANGER -> PillTone.DANGER
        AttendanceRules.Tone.NEUTRAL -> PillTone.NEUTRAL
    }

    val workDate = rememberFormattedDate(row.workDate)

    AppCard(
        contentDescription = "$workDate, ${AttendanceRules.statusLabel(row.status)}, $times",
    ) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                AppText(workDate, weight = FontWeight.Medium)
                AppText(
                    times + (row.workedMinutes?.let { " · ${ShiftRules.formatDuration(it)}" } ?: ""),
                    size = Theme.type.footnote,
                    lineHeight = Theme.type.footnoteLine,
                    tone = TextTone.MUTED,
                )
            }
            StatusPill(AttendanceRules.statusLabel(row.status), tone)
        }

        if (row.requiresLocationReview) {
            // Stated plainly, and stated as requiring nothing. A flag somebody
            // cannot act on but is not told the meaning of reads as an
            // accusation.
            AppText(
                stringResource(R.string.attendance_location_check_notice),
                size = Theme.type.caption,
                lineHeight = Theme.type.captionLine,
                tone = TextTone.MUTED,
            )
        }
        if (row.isRegularized) {
            AppText(
                stringResource(R.string.attendance_regularized_notice),
                size = Theme.type.caption,
                lineHeight = Theme.type.captionLine,
                tone = TextTone.MUTED,
            )
        }
    }
}
