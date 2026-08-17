package com.circuvent.hrms.feature

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccessTime
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.circuvent.hrms.core.design.MinTouchTarget
import com.circuvent.hrms.core.design.Theme
import com.circuvent.hrms.core.ui.AppText
import com.circuvent.hrms.core.ui.TextTone

/**
 * The five destinations.
 *
 * Five is the ceiling. A sixth is narrower than a thumb on a small phone and
 * the label under it stops fitting — at which point the icons go label-less and
 * become a guess, which is worst for the people who open the app least often.
 * Anything further down the list belongs behind Profile.
 */
enum class Destination(
    val route: String,
    val label: String,
    val icon: ImageVector,
) {
    TODAY("today", "Today", Icons.Filled.AccessTime),
    LEAVE("leave", "Leave", Icons.Filled.CalendarMonth),
    SHIFTS("shifts", "Shifts", Icons.Filled.Repeat),
    PAY("payslips", "Pay", Icons.Filled.Description),
    PROFILE("profile", "Profile", Icons.Filled.Person),
}

/** Height reserved for the bar, so scrolling content can clear it. */
val TabBarHeight = 72.dp

@Composable
fun TabBar(
    current: String,
    onSelect: (Destination) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Theme.colors

    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(colors.surfaceElevated)
    ) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(colors.border))

        Row(
            modifier = Modifier
                .fillMaxWidth()
                // The gesture bar's own space. Content flush against the home
                // indicator is content the OS gesture takes the tap for.
                .navigationBarsPadding()
                .padding(top = Theme.spacing.xs, bottom = Theme.spacing.sm),
            horizontalArrangement = Arrangement.SpaceEvenly,
        ) {
            Destination.entries.forEach { destination ->
                val selected = destination.route == current

                Column(
                    modifier = Modifier
                        .weight(1f)
                        .defaultMinSize(minHeight = MinTouchTarget)
                        .clickable(role = Role.Tab) {
                            // Already here. Navigating would rebuild the screen
                            // under the finger and lose the scroll position.
                            if (!selected) onSelect(destination)
                        }
                        .semantics {
                            contentDescription = destination.label
                            // Spoken as "selected", not merely drawn in the
                            // accent colour.
                            this.selected = selected
                        },
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Icon(
                        imageVector = destination.icon,
                        contentDescription = null,
                        tint = if (selected) colors.primary else colors.textMuted,
                    )
                    // The label is always visible, never only on the selected
                    // tab.
                    AppText(
                        text = destination.label,
                        size = Theme.type.caption,
                        lineHeight = Theme.type.captionLine,
                        tone = if (selected) TextTone.PRIMARY else TextTone.MUTED,
                        weight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                        maxLines = 1,
                    )
                }
            }
        }
    }
}
