package com.circuvent.hrms.core.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.circuvent.hrms.core.design.AccentTone
import com.circuvent.hrms.core.design.MinTouchTarget
import com.circuvent.hrms.core.design.Theme
import com.circuvent.hrms.core.design.colors

/**
 * The glyph a feature card or quick action shows.
 *
 * Two sources have to coexist: Compose's bundled [ImageVector]s cover most of
 * the app, and the hand-drawn drawables cover the few actions that had no
 * honest equivalent in the bundled set. Wrapping both means callers pass an
 * icon without caring which kind it is, and no screen ends up holding two
 * near-identical branches.
 */
sealed interface Glyph {
    data class Vector(val image: ImageVector) : Glyph

    data class Drawable(val painter: Painter) : Glyph
}

@Composable
private fun GlyphIcon(glyph: Glyph, tint: Color, size: Dp) {
    when (glyph) {
        is Glyph.Vector -> Icon(
            imageVector = glyph.image,
            contentDescription = null,
            tint = tint,
            modifier = Modifier.size(size),
        )

        is Glyph.Drawable -> Icon(
            painter = glyph.painter,
            contentDescription = null,
            tint = tint,
            modifier = Modifier.size(size),
        )
    }
}

/**
 * A glyph on a tinted disc.
 *
 * Pulled out because the disc geometry — the ratio of glyph to disc — is the
 * one thing that has to stay identical everywhere, and it drifted the first
 * time it was written inline in two places.
 */
@Composable
fun AccentBadge(
    glyph: Glyph,
    tone: AccentTone,
    modifier: Modifier = Modifier,
    diameter: Dp = 44.dp,
) {
    val accent = tone.colors()
    Box(
        modifier = modifier
            .size(diameter)
            .clip(RoundedCornerShape(Theme.radius.lg))
            .background(accent.container),
        contentAlignment = Alignment.Center,
    ) {
        GlyphIcon(glyph = glyph, tint = accent.icon, size = diameter * 0.5f)
    }
}

/**
 * A tappable feature tile: glyph, title, and a line explaining what it is for.
 *
 * The description is not decoration. Half of these features have names that are
 * only meaningful to someone who already knows the product — "Form 16",
 * "Regularisation", "On duty" — and the subtitle is where a new joiner finds
 * out which one they want.
 *
 * [AppCard] is given the click and the description rather than wrapping this in
 * a clickable, because it already collapses the tile into a single semantics
 * node. Announcing the title, the subtitle and an unnamed button separately
 * would be three stops for one destination.
 */
@Composable
fun FeatureCard(
    title: String,
    description: String,
    glyph: Glyph,
    tone: AccentTone,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    badge: String? = null,
) {
    AppCard(
        modifier = modifier,
        onClick = onClick,
        contentDescription = if (badge != null) {
            "$title. $description. $badge pending."
        } else {
            "$title. $description"
        },
    ) {
        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            AccentBadge(glyph = glyph, tone = tone)
            if (badge != null) {
                Spacer(Modifier.weight(1f))
                StatusPill(label = badge, tone = PillTone.WARNING)
            }
        }
        Spacer(Modifier.height(Theme.spacing.md))
        AppText(text = title, size = Theme.type.body, weight = FontWeight.SemiBold)
        Spacer(Modifier.height(Theme.spacing.xs))
        AppText(
            text = description,
            size = Theme.type.caption,
            lineHeight = Theme.type.captionLine,
            tone = TextTone.MUTED,
        )
    }
}

/**
 * Lays feature cards out two to a row.
 *
 * A [androidx.compose.foundation.lazy.grid.LazyVerticalGrid] cannot be used
 * here: these grids sit inside an already-scrolling column, and nesting two
 * scrollables in the same direction throws at runtime. Chunking into rows costs
 * the laziness, which is affordable — the largest grid in the app is eight
 * tiles.
 *
 * Rows are padded to even length with an invisible spacer so a trailing odd
 * card stays half-width instead of stretching across.
 */
@Composable
fun FeatureGrid(
    items: List<FeatureGridItem>,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.md),
    ) {
        items.chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(Theme.spacing.md)) {
                row.forEach { item ->
                    FeatureCard(
                        title = item.title,
                        description = item.description,
                        glyph = item.glyph,
                        tone = item.tone,
                        onClick = item.onClick,
                        badge = item.badge,
                        modifier = Modifier.weight(1f),
                    )
                }
                if (row.size == 1) {
                    Spacer(Modifier.weight(1f))
                }
            }
        }
    }
}

data class FeatureGridItem(
    val title: String,
    val description: String,
    val glyph: Glyph,
    val tone: AccentTone,
    val badge: String? = null,
    // Last, so call sites can pass the destination as a trailing lambda. With
    // `badge` after it every one of the twenty-odd tiles needed `onClick =`.
    val onClick: () -> Unit,
)

/**
 * A shortcut in the home screen's top strip: a tinted disc with a short label.
 *
 * No width of its own. The strip divides the row evenly between however many
 * shortcuts it holds, which is the only way five of them fit a 411dp screen
 * without the last hanging off the edge — a fixed 76dp each overflowed by
 * about 17dp and clipped "Balance" to "Balanc".
 *
 * The label gets two lines and centre alignment rather than an ellipsis: these
 * are the five things people came to do, and truncating one to "Regularis…"
 * saves nothing.
 */
@Composable
fun QuickAction(
    label: String,
    glyph: Glyph,
    tone: AccentTone,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .sizeIn(minHeight = MinTouchTarget)
            .clip(RoundedCornerShape(Theme.radius.md))
            .clickable(onClick = onClick)
            .clearAndSetSemantics {
                contentDescription = label
                role = Role.Button
            }
            .padding(vertical = Theme.spacing.sm, horizontal = Theme.spacing.xs),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        AccentBadge(glyph = glyph, tone = tone, diameter = 48.dp)
        Spacer(Modifier.height(Theme.spacing.sm))
        AppText(
            text = label,
            size = Theme.type.caption,
            lineHeight = Theme.type.captionLine,
            align = TextAlign.Center,
            maxLines = 2,
        )
    }
}
