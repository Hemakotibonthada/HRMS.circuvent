package com.circuvent.hrms.core.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.circuvent.hrms.core.design.MinTouchTarget
import com.circuvent.hrms.core.design.Theme

/**
 * The one surface on a screen that should be looked at first.
 *
 * Every other card in the app is a white rectangle, which is right for a list
 * of holidays and wrong for the thing somebody actually opened the app to do.
 * Without a focal point a screen is read top to bottom at uniform speed; with
 * one, the eye lands on the clock-in button and the rest becomes context.
 *
 * Used sparingly and deliberately — one per screen at most. A page where
 * everything is emphasised is a page where nothing is.
 *
 * Content on top of this is always [TextTone.ON_HERO]: the gradient is dark
 * at both ends in both themes precisely so that one text colour is legible
 * across the whole sweep, rather than the top of the card being readable and
 * the bottom not.
 */
@Composable
fun HeroCard(
    modifier: Modifier = Modifier,
    contentDescription: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = Theme.colors
    val shape = RoundedCornerShape(Theme.radius.lg)

    var box = modifier
        .fillMaxWidth()
        .shadow(
            elevation = Theme.elevation.hero,
            shape = shape,
            ambientColor = colors.shadow,
            spotColor = colors.shadow,
        )
        .clip(shape)
        .background(
            // Diagonal rather than vertical. A vertical sweep on a wide, short
            // card shows almost no change across it and is indistinguishable
            // from a flat fill; running it corner to corner gives the gradient
            // the whole diagonal to travel.
            Brush.linearGradient(listOf(colors.heroStart, colors.heroEnd))
        )
        .defaultMinSize(minHeight = MinTouchTarget)

    if (contentDescription != null) {
        box = box.semantics(mergeDescendants = true) {
            this.contentDescription = contentDescription
        }
    }

    Column(modifier = box.padding(Theme.spacing.lg), content = content)
}

/**
 * A thin gradient rule, for section headings that need a little weight.
 *
 * Cheap visual punctuation. A run of identically-styled grey headings down a
 * long screen gives a reader nothing to anchor on when they scroll back.
 */
@Composable
fun AccentRule(modifier: Modifier = Modifier) {
    val colors = Theme.colors
    Column(
        modifier
            .padding(top = Theme.spacing.xs)
            .clip(RoundedCornerShape(Theme.radius.pill))
            .background(Brush.horizontalGradient(listOf(colors.heroStart, colors.heroEnd)))
            .defaultMinSize(minWidth = 36.dp, minHeight = 3.dp)
    ) {}
}
