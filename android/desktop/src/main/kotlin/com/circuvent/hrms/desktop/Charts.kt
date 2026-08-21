package com.circuvent.hrms.desktop

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * Charts, drawn rather than imported.
 *
 * No charting library: the three shapes this product needs are a line, a bar
 * and a ring, and a dependency that draws forty is forty ways for a future
 * screen to show something misleading.
 *
 * Three rules hold throughout, and each exists because breaking it produces a
 * chart that lies:
 *
 *  1. A line chart needs at least four points. Two points always look like a
 *     trend and never are, and a "50% drop" drawn from one bad Tuesday is the
 *     kind of thing somebody screenshots into a performance conversation.
 *     Below four, these render the numbers instead.
 *  2. Nothing is distinguished by colour alone. Every series carries a line
 *     style and every chart carries labels, because roughly one man in twelve
 *     cannot tell the green line from the red one.
 *  3. An axis starts at zero. A bar chart truncated at the bottom exaggerates
 *     every difference on it, which is the single commonest way a chart
 *     misleads without anybody intending it to.
 */

data class Point(val label: String, val value: Float)

/** The minimum a line chart is allowed to be drawn from. */
const val MIN_LINE_POINTS = 4

@Composable
fun LineChart(
    points: List<Point>,
    modifier: Modifier = Modifier,
    height: androidx.compose.ui.unit.Dp = 140.dp,
    valueSuffix: String = "",
) {
    if (points.size < MIN_LINE_POINTS) {
        // Said plainly rather than drawn thinly. Two points joined by a line is
        // a trend claim made from no evidence.
        Column {
            Muted("Not enough history to chart yet.")
            if (points.isNotEmpty()) {
                Text(
                    points.joinToString("   ") { "${it.label} ${trim(it.value)}$valueSuffix" },
                    style = MaterialTheme.typography.bodyMedium,
                    color = Desk.colors.text,
                    modifier = Modifier.padding(top = Desk.spacing.xs),
                )
            }
        }
        return
    }

    val maxValue = (points.maxOf { it.value }).coerceAtLeast(1f)
    val line = Desk.colors.primary
    val grid = Desk.colors.borderSubtle
    val dot = Desk.colors.primary

    // The whole series read out in order, so this is not a blank rectangle to
    // anything that cannot see it.
    val description = "Chart. " + points.joinToString(", ") {
        "${it.label} ${trim(it.value)}$valueSuffix"
    }

    Column(modifier) {
        Canvas(
            Modifier
                .fillMaxWidth()
                .height(height)
                .semantics { contentDescription = description }
        ) {
            val w = size.width
            val h = size.height
            val padBottom = 4f
            val usable = h - padBottom

            // Zero baseline plus two guides. More than three lines turns into
            // graph paper and stops helping.
            for (i in 0..2) {
                val y = usable - (usable * i / 2f)
                drawLine(grid, Offset(0f, y), Offset(w, y), strokeWidth = 1f)
            }

            val step = if (points.size == 1) 0f else w / (points.size - 1)
            fun px(i: Int) = step * i
            fun py(v: Float) = usable - (v / maxValue) * usable

            val path = Path()
            points.forEachIndexed { i, p ->
                val x = px(i)
                val y = py(p.value)
                if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
            }
            drawPath(path, color = line, style = Stroke(width = 2f))

            // A filled area under the line, faint. It reads as volume without
            // competing with the line itself.
            val area = Path().apply {
                moveTo(0f, usable)
                points.forEachIndexed { i, p -> lineTo(px(i), py(p.value)) }
                lineTo(px(points.size - 1), usable)
                close()
            }
            drawPath(area, color = line.copy(alpha = 0.10f))

            points.forEachIndexed { i, p ->
                drawCircle(dot, radius = 2.5f, center = Offset(px(i), py(p.value)))
            }
        }

        // First, middle and last only. Every label on a fortnight of dates is
        // unreadable at this width.
        Row(Modifier.fillMaxWidth().padding(top = Desk.spacing.xs)) {
            listOf(0, points.size / 2, points.size - 1).distinct().forEachIndexed { idx, i ->
                Text(
                    points[i].label,
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.bodySmall,
                    color = Desk.colors.textMuted,
                    textAlign = when (idx) {
                        0 -> androidx.compose.ui.text.style.TextAlign.Start
                        1 -> androidx.compose.ui.text.style.TextAlign.Center
                        else -> androidx.compose.ui.text.style.TextAlign.End
                    },
                )
            }
        }
    }
}

/**
 * Horizontal bars.
 *
 * Horizontal rather than vertical because the labels are words — leave type
 * names — and vertical bars force them sideways or truncated.
 */
@Composable
fun BarChart(
    points: List<Point>,
    modifier: Modifier = Modifier,
    valueSuffix: String = "",
    barColor: Color? = null,
) {
    if (points.isEmpty()) {
        Muted("Nothing to chart.")
        return
    }

    val max = points.maxOf { it.value }.coerceAtLeast(1f)
    val fill = barColor ?: Desk.colors.primary
    // Read outside the draw lambda: `Desk.colors` is a composable lookup and a
    // DrawScope is not a composable context.
    val trackColor = Desk.colors.borderSubtle

    Column(modifier) {
        points.forEach { p ->
            Row(
                Modifier.fillMaxWidth().padding(vertical = 3.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    p.label,
                    modifier = Modifier.weight(1.1f),
                    style = MaterialTheme.typography.bodyMedium,
                    color = Desk.colors.text,
                    maxLines = 1,
                )

                Box(Modifier.weight(2.4f)) {
                    Canvas(Modifier.fillMaxWidth().height(14.dp)) {
                        val track = size.width
                        drawRoundRect(
                            color = trackColor,
                            size = Size(track, size.height),
                            cornerRadius = androidx.compose.ui.geometry.CornerRadius(7f, 7f),
                        )
                        // Zero-based by construction: the bar starts at the
                        // left edge, so lengths are comparable by eye.
                        val width = (p.value / max) * track
                        if (width > 0f) {
                            drawRoundRect(
                                color = fill,
                                size = Size(width, size.height),
                                cornerRadius = androidx.compose.ui.geometry.CornerRadius(7f, 7f),
                            )
                        }
                    }
                }

                // The number is printed as well as drawn. A bar people have to
                // measure against a neighbour is a number withheld.
                Text(
                    "${trim(p.value)}$valueSuffix",
                    modifier = Modifier.weight(0.7f).padding(start = Desk.spacing.sm),
                    style = MaterialTheme.typography.bodyMedium,
                    color = Desk.colors.text,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                )
            }
        }
    }
}

/**
 * A ring showing one part of a whole.
 *
 * Used for "leave taken out of leave entitled", where the pair is genuinely a
 * proportion. Not used for anything that is merely two numbers — a ring
 * implies the parts add to a meaningful total, and when they do not it invents
 * a relationship.
 */
@Composable
fun RingChart(
    used: Float,
    total: Float,
    label: String,
    modifier: Modifier = Modifier,
    size: androidx.compose.ui.unit.Dp = 108.dp,
) {
    val safeTotal = total.coerceAtLeast(0f)
    val fraction = if (safeTotal <= 0f) 0f else (used / safeTotal).coerceIn(0f, 1f)
    val ring = Desk.colors.primary
    val track = Desk.colors.borderSubtle

    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Box(contentAlignment = Alignment.Center) {
            Canvas(
                Modifier
                    .size(size)
                    .semantics {
                        contentDescription =
                            "$label: ${trim(used)} of ${trim(safeTotal)} used"
                    }
            ) {
                val stroke = 12f
                val inset = stroke / 2
                val arcSize = Size(this.size.width - stroke, this.size.height - stroke)

                drawArc(
                    color = track,
                    startAngle = 0f,
                    sweepAngle = 360f,
                    useCenter = false,
                    topLeft = Offset(inset, inset),
                    size = arcSize,
                    style = Stroke(width = stroke),
                )

                if (fraction > 0f) {
                    drawArc(
                        color = ring,
                        // From the top, clockwise. Starting anywhere else makes
                        // "a quarter used" not look like a quarter.
                        startAngle = -90f,
                        sweepAngle = 360f * fraction,
                        useCenter = false,
                        topLeft = Offset(inset, inset),
                        size = arcSize,
                        style = Stroke(width = stroke),
                    )
                }
            }

            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    if (safeTotal <= 0f) "—" else "${(fraction * 100).toInt()}%",
                    style = MaterialTheme.typography.titleLarge,
                    color = Desk.colors.text,
                )
                Text(
                    "used",
                    style = MaterialTheme.typography.bodySmall,
                    color = Desk.colors.textMuted,
                )
            }
        }

        Text(
            label,
            modifier = Modifier.padding(top = Desk.spacing.sm),
            style = MaterialTheme.typography.bodyMedium,
            color = Desk.colors.textMuted,
        )
    }
}

/** Whole numbers without a trailing .0, halves kept. */
internal fun trim(value: Float): String =
    if (value == value.toLong().toFloat()) value.toLong().toString()
    else String.format("%.1f", value)

/** Kept for a dashed second series when one is added. */
internal val DashedStroke: PathEffect =
    PathEffect.dashPathEffect(floatArrayOf(6f, 4f), 0f)
