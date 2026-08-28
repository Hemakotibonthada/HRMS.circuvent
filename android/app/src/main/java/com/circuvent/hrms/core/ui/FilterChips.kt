package com.circuvent.hrms.core.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import com.circuvent.hrms.core.design.MinTouchTarget
import com.circuvent.hrms.core.design.Theme

/**
 * A row of mutually exclusive filters.
 *
 * Chips rather than a segmented control because the number of them varies and a
 * segmented control that scrolls is neither. They stay a single scrolling row
 * rather than wrapping: a filter bar that changes height as counts change makes
 * the list underneath jump while somebody is reading it.
 *
 * The count is part of the chip, not a separate summary line. "Not in yet"
 * matters entirely in proportion to how many people it is, and a manager
 * should not have to tap a filter to discover it selects nobody.
 *
 * `Role.RadioButton` rather than Tab or Button: exactly one is chosen at a
 * time, and a screen reader announcing "selected" against the others is what
 * makes that legible without sight of the fill.
 */
@Composable
fun <T> FilterChips(
    options: List<T>,
    selected: T,
    label: @Composable (T) -> String,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier,
    count: ((T) -> Int?)? = null,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(Theme.spacing.sm),
    ) {
        options.forEach { option ->
            val active = option == selected
            val n = count?.invoke(option)
            val text = if (n != null) "${label(option)}  $n" else label(option)

            Box(
                modifier = Modifier
                    .height(MinTouchTarget)
                    .clip(RoundedCornerShape(Theme.radius.pill))
                    .background(if (active) Theme.colors.primary else Theme.colors.surface)
                    .selectable(
                        selected = active,
                        role = Role.RadioButton,
                        onClick = { onSelect(option) },
                    )
                    .padding(horizontal = Theme.spacing.lg),
                contentAlignment = Alignment.Center,
            ) {
                AppText(
                    text,
                    size = Theme.type.footnote,
                    lineHeight = Theme.type.footnoteLine,
                    weight = if (active) FontWeight.SemiBold else FontWeight.Normal,
                    tone = if (active) TextTone.ON_PRIMARY else TextTone.DEFAULT,
                    maxLines = 1,
                )
            }
        }
    }
}
