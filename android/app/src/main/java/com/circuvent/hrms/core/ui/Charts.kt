package com.circuvent.hrms.core.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.circuvent.hrms.core.design.Theme

/**
 * Charts, drawn rather than imported.
 *
 * The same three shapes the desktop client draws, on the same rules, because a
 * chart that means one thing on a laptop and another on a phone is worse than
 * no chart.
 *
 *  1. A line needs four points. Two points always look like a trend and never
 *     are, and a "50% drop" drawn from one bad Tuesday is the kind of thing
 *     that ends up in a performance conversation. Below four these print the
 *     numbers instead.
 *  2. Bars are zero-based. A truncated axis exaggerates every difference on it,
 *     which is the commonest way a chart misleads without anyone meaning it to.
 *  3. Nothing is carried by colour alone. Bars print their value, the ring
 *     prints its percentage, and the line reads its whole series out to a
 *     screen reader — otherwise it is a blank rectangle to anyone who cannot
 *     see it.
 */

data class ChartPoint(val label: String, val value: Float)

/** The fewest points a line may be drawn from. */
const val MIN_CHART_POINTS = 4

@Composable
fun LineChart(
    points: List<ChartPoint>,
    modifier: Modifier = Modifier,
    height: Dp = 120.dp,
    valueSuffix: String = "",
) {
    if (points.size < MIN_CHART_POINTS) {
        Column(modifier) {
            AppText(
                "Not enough history to chart yet.",
                tone = TextTone.MUTED,
                size = Theme.type.footnote,
                lineHeight = Theme.type.footnoteLine,
            )
            if (points.isNotEmpty()) {
                AppText(
                    points.joinToString("   ") { "${it.label} ${trimValue(it.value)}$valueSuffix" },
                    modifier = Modifier.padding(top = Theme.spacing.xs),
                    size = Theme.type.footnote,
                    lineHeight = Theme.type.footnoteLine,
                )
            }
        }
        return
    }

    val maxValue = points.maxOf { it.value }.coerceAtLeast(1f)
    val line = Theme.colors.primary
    val grid = Theme.colors.borderSubtle

    val description = "Chart. " + points.joinToString(", ") {
        "${it.label} ${trimValue(it.value)}$valueSuffix"
    }

    Column(modifier) {
        Canvas(
            Modifier
                .fillMaxWidth()
                .height(height)
                .semantics { contentDescription = description }
        ) {
            val w = size.width
            val usable = size.height - 4f

            for (i in 0..2) {
                val y = usable - (usable * i / 2f)
                drawLine(grid, Offset(0f, y), Offset(w, y), strokeWidth = 1f)
            }

            val step = w / (points.size - 1)
            fun px(i: Int) = step * i
            fun py(v: Float) = usable - (v / maxValue) * usable

            val path = Path()
            points.forEachIndexed { i, p ->
                if (i == 0) path.moveTo(px(i), py(p.value)) else path.lineTo(px(i), py(p.value))
            }
            drawPath(path, color = line, style = Stroke(width = 3f))

            val area = Path().apply {
                moveTo(0f, usable)
                points.forEachIndexed { i, p -> lineTo(px(i), py(p.value)) }
                lineTo(px(points.size - 1), usable)
                close()
            }
            drawPath(area, color = line.copy(alpha = 0.10f))

            points.forEachIndexed { i, p ->
                drawCircle(line, radius = 3.5f, center = Offset(px(i), py(p.value)))
            }
        }

        // First, middle and last. Every label on a fortnight of dates is
        // unreadable at phone width.
        Row(Modifier.fillMaxWidth().padding(top = Theme.spacing.xs)) {
            listOf(0, points.size / 2, points.size - 1).distinct().forEachIndexed { idx, i ->
                AppText(
                    points[i].label,
                    modifier = Modifier.weight(1f),
                    tone = TextTone.MUTED,
                    size = Theme.type.caption,
                    lineHeight = Theme.type.captionLine,
                    align = when (idx) {
                        0 -> TextAlign.Start
                        1 -> TextAlign.Center
                        else -> TextAlign.End
                    },
                )
            }
        }
    }
}

/**
 * Horizontal bars.
 *
 * Horizontal because the labels are words — leave type names — and vertical
 * bars would force them sideways or truncated on a phone.
 */
@Composable
fun BarChart(
    points: List<ChartPoint>,
    modifier: Modifier = Modifier,
    valueSuffix: String = "",
) {
    if (points.isEmpty()) {
        AppText("Nothing to chart.", tone = TextTone.MUTED, size = Theme.type.footnote)
        return
    }

    val max = points.maxOf { it.value }.coerceAtLeast(1f)
    val fill = Theme.colors.primary
    // Read here rather than inside the draw lambda: a DrawScope is not a
    // composable context and cannot look a theme colour up.
    val track = Theme.colors.borderSubtle

    Column(modifier) {
        points.forEach { p ->
            Row(
                Modifier.fillMaxWidth().padding(vertical = Theme.spacing.xs),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                AppText(
                    p.label,
                    modifier = Modifier.weight(1.2f),
                    size = Theme.type.footnote,
                    lineHeight = Theme.type.footnoteLine,
                    maxLines = 1,
                )

                Box(Modifier.weight(2f)) {
                    Canvas(Modifier.fillMaxWidth().height(12.dp)) {
                        drawRoundRect(
                            color = track,
                            size = Size(size.width, size.height),
                            cornerRadius = CornerRadius(6f, 6f),
                        )
                        val width = (p.value / max) * size.width
                        if (width > 0f) {
                            drawRoundRect(
                                color = fill,
                                size = Size(width, size.height),
                                cornerRadius = CornerRadius(6f, 6f),
                            )
                        }
                    }
                }

                // Printed as well as drawn. A bar somebody has to measure
                // against its neighbour is a number withheld.
                AppText(
                    "${trimValue(p.value)}$valueSuffix",
                    modifier = Modifier.weight(0.6f).padding(start = Theme.spacing.sm),
                    size = Theme.type.footnote,
                    lineHeight = Theme.type.footnoteLine,
                    weight = FontWeight.Medium,
                    maxLines = 1,
                )
            }
        }
    }
}

/**
 * A ring showing one part of a whole.
 *
 * For "leave taken out of leave entitled", where the pair really is a
 * proportion. Not for two numbers that merely sit together — a ring implies the
 * parts add to a meaningful total, and where they do not it invents a
 * relationship that is not there.
 */
@Composable
fun RingChart(
    used: Float,
    total: Float,
    label: String,
    modifier: Modifier = Modifier,
    diameter: Dp = 120.dp,
) {
    val safeTotal = total.coerceAtLeast(0f)
    val fraction = if (safeTotal <= 0f) 0f else (used / safeTotal).coerceIn(0f, 1f)
    val ring = Theme.colors.primary
    val track = Theme.colors.borderSubtle

    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Box(contentAlignment = Alignment.Center) {
            Canvas(
                Modifier
                    .size(diameter)
                    .semantics {
                        contentDescription =
                            "$label: ${trimValue(used)} of ${trimValue(safeTotal)} used"
                    }
            ) {
                val stroke = 14f
                val inset = stroke / 2
                val arc = Size(size.width - stroke, size.height - stroke)

                drawArc(
                    color = track,
                    startAngle = 0f,
                    sweepAngle = 360f,
                    useCenter = false,
                    topLeft = Offset(inset, inset),
                    size = arc,
                    style = Stroke(width = stroke),
                )

                if (fraction > 0f) {
                    drawArc(
                        color = ring,
                        // From the top, clockwise, or "a quarter used" does not
                        // look like a quarter.
                        startAngle = -90f,
                        sweepAngle = 360f * fraction,
                        useCenter = false,
                        topLeft = Offset(inset, inset),
                        size = arc,
                        style = Stroke(width = stroke),
                    )
                }
            }

            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                AppText(
                    if (safeTotal <= 0f) "—" else "${(fraction * 100).toInt()}%",
                    size = Theme.type.title2,
                    lineHeight = Theme.type.title2Line,
                    weight = FontWeight.Bold,
                )
                AppText(
                    "used",
                    tone = TextTone.MUTED,
                    size = Theme.type.caption,
                    lineHeight = Theme.type.captionLine,
                )
            }
        }

        AppText(
            label,
            modifier = Modifier.padding(top = Theme.spacing.sm),
            tone = TextTone.MUTED,
            size = Theme.type.footnote,
            lineHeight = Theme.type.footnoteLine,
            align = TextAlign.Center,
        )
    }
}

/** Whole numbers without a trailing .0; halves kept. */
internal fun trimValue(value: Float): String =
    if (value == value.toLong().toFloat()) value.toLong().toString()
    else String.format("%.1f", value)
