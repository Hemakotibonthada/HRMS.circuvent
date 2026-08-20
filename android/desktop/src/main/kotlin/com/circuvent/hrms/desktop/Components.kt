package com.circuvent.hrms.desktop

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/** A grouping surface. Flat, with a hairline — a desk screen shows many at once. */
@Composable
fun DeskCard(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val shape = RoundedCornerShape(Desk.radius.md)
    var box = modifier
        .fillMaxWidth()
        .clip(shape)
        .background(Desk.colors.surfaceElevated)
        .border(BorderStroke(1.dp, Desk.colors.borderSubtle), shape)

    if (onClick != null) box = box.clickable(role = Role.Button, onClick = onClick)

    Column(box.padding(Desk.spacing.lg), content = content)
}

enum class DeskButton { PRIMARY, SECONDARY, GHOST, DANGER }

/**
 * A button.
 *
 * The disabled look comes from dimmed colours rather than a `Modifier.alpha`
 * layer, for the reason the phone learned the hard way: an alpha layer nested
 * inside a card's own layer could fail to compose, leaving an *enabled* primary
 * button painting nothing at all — a live, tappable, invisible control.
 */
@Composable
fun DeskButtonView(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: DeskButton = DeskButton.PRIMARY,
    enabled: Boolean = true,
    busy: Boolean = false,
    icon: ImageVector? = null,
) {
    val c = Desk.colors
    val inert = !enabled || busy

    val fillBase = when (variant) {
        DeskButton.PRIMARY -> c.primary
        DeskButton.SECONDARY -> c.surfaceElevated
        DeskButton.GHOST -> Color.Transparent
        DeskButton.DANGER -> c.danger
    }
    val inkBase = when (variant) {
        DeskButton.PRIMARY -> c.onPrimary
        DeskButton.SECONDARY -> c.text
        DeskButton.GHOST -> c.primary
        DeskButton.DANGER -> Color.White
    }

    val dim = 0.45f
    val fill = if (inert) fillBase.copy(alpha = fillBase.alpha * dim) else fillBase
    val ink = if (inert) inkBase.copy(alpha = inkBase.alpha * dim) else inkBase

    val shape = RoundedCornerShape(Desk.radius.sm)

    Box(
        modifier = modifier
            .defaultMinSize(minHeight = 34.dp)
            .clip(shape)
            .background(fill)
            .then(
                if (variant == DeskButton.SECONDARY) {
                    Modifier.border(BorderStroke(1.dp, c.border), shape)
                } else Modifier
            )
            .clickable(enabled = !inert, role = Role.Button, onClick = onClick)
            .padding(horizontal = Desk.spacing.lg, vertical = Desk.spacing.sm),
        contentAlignment = Alignment.Center,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (icon != null && !busy) {
                Icon(icon, contentDescription = null, tint = ink, modifier = Modifier.size(16.dp))
                Box(Modifier.size(Desk.spacing.sm, 1.dp))
            }
            Text(
                label,
                color = ink,
                style = MaterialTheme.typography.labelLarge,
                maxLines = 1,
            )
        }
        if (busy) {
            CircularProgressIndicator(modifier = Modifier.size(14.dp), color = ink, strokeWidth = 2.dp)
        }
    }
}

enum class PillTone { SUCCESS, WARNING, DANGER, NEUTRAL, INFO }

/**
 * A status, as a word on a tint.
 *
 * The word is not optional and there is no icon-only form. "Approved" and
 * "Rejected" are the pair people confuse, and distinguishing them by green
 * against red fails for the commonest form of colour blindness.
 */
@Composable
fun StatusPill(label: String, tone: PillTone) {
    val c = Desk.colors
    val (bg, fg) = when (tone) {
        PillTone.SUCCESS -> c.successSubtle to c.success
        PillTone.WARNING -> c.warningSubtle to c.warning
        PillTone.DANGER -> c.dangerSubtle to c.danger
        PillTone.INFO -> c.primarySubtle to c.primary
        PillTone.NEUTRAL -> c.surface to c.textMuted
    }

    Box(
        Modifier
            .clip(RoundedCornerShape(Desk.radius.pill))
            .background(bg)
            .padding(horizontal = 10.dp, vertical = 3.dp)
    ) {
        Text(label, color = fg, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium)
    }
}

/** Initials on a tinted disc, for when there is no photograph. */
@Composable
fun Initials(name: String, size: androidx.compose.ui.unit.Dp = 32.dp) {
    val initials = name.trim().split(" ").filter { it.isNotBlank() }
        .take(2).joinToString("") { it.first().uppercase() }
        .ifBlank { "?" }

    Box(
        Modifier.size(size).clip(CircleShape).background(Desk.colors.primarySubtle),
        contentAlignment = Alignment.Center,
    ) {
        Text(initials, color = Desk.colors.primary, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        modifier = modifier,
        color = Desk.colors.text,
        style = MaterialTheme.typography.titleLarge,
    )
}

@Composable
fun Muted(text: String, modifier: Modifier = Modifier) {
    Text(text, modifier = modifier, color = Desk.colors.textMuted, style = MaterialTheme.typography.bodyMedium)
}

/**
 * What a screen shows when there is nothing to show.
 *
 * Never a blank panel. A reader cannot tell an empty list from a failed load,
 * and the difference decides whether they wait or ask for help.
 */
@Composable
fun EmptyState(title: String, description: String) {
    DeskCard {
        Text(title, style = MaterialTheme.typography.titleMedium, color = Desk.colors.text)
        Muted(description, Modifier.padding(top = Desk.spacing.xs))
    }
}

@Composable
fun ErrorBanner(message: String) {
    val c = Desk.colors
    Box(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Desk.radius.md))
            .background(c.dangerSubtle)
            .border(BorderStroke(1.dp, c.danger.copy(alpha = 0.35f)), RoundedCornerShape(Desk.radius.md))
            .padding(Desk.spacing.md)
    ) {
        Text(message, color = c.danger, style = MaterialTheme.typography.bodyMedium)
    }
}

// ─── Tables ──────────────────────────────────────────────────
//
// A desktop has the width for columns, and a list of cards that each repeat
// their own labels wastes most of it. These are deliberately plain: a header
// row, hairline separators, and no zebra striping — stripes fight the status
// tints that carry the actual meaning.

@Composable
fun RowScope.TableHeaderCell(label: String, weight: Float) {
    Text(
        label.uppercase(),
        modifier = Modifier.weight(weight),
        color = Desk.colors.textMuted,
        style = MaterialTheme.typography.bodySmall,
        fontWeight = FontWeight.SemiBold,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
fun TableHeader(vararg columns: Pair<String, Float>) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = Desk.spacing.md, vertical = Desk.spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        columns.forEach { (label, weight) -> TableHeaderCell(label, weight) }
    }
}

@Composable
fun TableRow(content: @Composable RowScope.() -> Unit) {
    Column {
        Row(
            Modifier
                .fillMaxWidth()
                .defaultMinSize(minHeight = 44.dp)
                .padding(horizontal = Desk.spacing.md, vertical = Desk.spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Desk.spacing.sm),
            content = content,
        )
        Box(Modifier.fillMaxWidth().height(1.dp).background(Desk.colors.borderSubtle))
    }
}

@Composable
fun RowScope.Cell(text: String, weight: Float, bold: Boolean = false) {
    Text(
        text,
        modifier = Modifier.weight(weight),
        color = Desk.colors.text,
        style = MaterialTheme.typography.bodyMedium,
        fontWeight = if (bold) FontWeight.Medium else FontWeight.Normal,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}
