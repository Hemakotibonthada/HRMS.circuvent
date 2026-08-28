package com.circuvent.hrms.desktop

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The same palette as the phone, on a screen with more of it.
 *
 * The values are copied from the Android tokens rather than re-picked, because
 * two clients of one product disagreeing about what "approved" green is looks
 * like a bug in whichever one the reader saw second. Every pair here has
 * already been through a contrast audit; changing one to suit a large screen
 * would quietly undo that.
 *
 * What does change is density. A phone card has 16dp of padding because a thumb
 * needs the room; a desktop row does not, and a window that keeps phone spacing
 * shows six records where it has space for twenty. The spacing scale below is
 * tighter than the phone's at every step above `sm`.
 */
data class DeskColors(
    val background: Color,
    val surface: Color,
    val surfaceElevated: Color,
    val text: Color,
    val textMuted: Color,
    val primary: Color,
    val onPrimary: Color,
    val primarySubtle: Color,
    val danger: Color,
    val dangerSubtle: Color,
    val success: Color,
    val successSubtle: Color,
    val warning: Color,
    val warningSubtle: Color,
    val border: Color,
    val borderSubtle: Color,
    val sidebar: Color,
    val isDark: Boolean,
)

val LightDesk = DeskColors(
    background = Color(0xFFF3F1FA),
    surface = Color(0xFFFAF9FE),
    surfaceElevated = Color(0xFFFFFFFF),
    text = Color(0xFF14121F),
    textMuted = Color(0xFF56546A),
    primary = Color(0xFF6D33E8),
    onPrimary = Color(0xFFFFFFFF),
    primarySubtle = Color(0xFFEDE7FE),
    danger = Color(0xFFC2101C),
    dangerSubtle = Color(0xFFFDECEE),
    success = Color(0xFF157A31),
    successSubtle = Color(0xFFE7F6EB),
    warning = Color(0xFF8A5A00),
    warningSubtle = Color(0xFFFDF3E2),
    border = Color(0xFF9A96AE),
    borderSubtle = Color(0xFFE7E4F2),
    // Darker than the page, not lighter. A sidebar that is the brightest thing
    // on screen pulls the eye away from the record being read.
    sidebar = Color(0xFF1B1430),
    isDark = false,
)

val DarkDesk = DeskColors(
    background = Color(0xFF0B0B10),
    surface = Color(0xFF191922),
    surfaceElevated = Color(0xFF24242F),
    text = Color(0xFFEDEDF2),
    textMuted = Color(0xFF9A9AA6),
    primary = Color(0xFFA98CFF),
    onPrimary = Color(0xFF12071F),
    primarySubtle = Color(0xFF231A3B),
    danger = Color(0xFFFF6B75),
    dangerSubtle = Color(0xFF331419),
    success = Color(0xFF4ED16A),
    successSubtle = Color(0xFF102A18),
    warning = Color(0xFFF0B03E),
    warningSubtle = Color(0xFF2E2210),
    border = Color(0xFF74748A),
    borderSubtle = Color(0xFF26262F),
    sidebar = Color(0xFF14141C),
    isDark = true,
)

data class DeskSpacing(
    val xs: Dp = 4.dp,
    val sm: Dp = 8.dp,
    val md: Dp = 12.dp,
    val lg: Dp = 16.dp,
    val xl: Dp = 20.dp,
    val xxl: Dp = 28.dp,
)

data class DeskRadius(
    val sm: Dp = 6.dp,
    val md: Dp = 10.dp,
    val lg: Dp = 14.dp,
    val pill: Dp = 999.dp,
)

val LocalDeskColors: ProvidableCompositionLocal<DeskColors> = staticCompositionLocalOf { LightDesk }
val LocalDeskSpacing: ProvidableCompositionLocal<DeskSpacing> = staticCompositionLocalOf { DeskSpacing() }
val LocalDeskRadius: ProvidableCompositionLocal<DeskRadius> = staticCompositionLocalOf { DeskRadius() }

object Desk {
    val colors: DeskColors
        @Composable get() = LocalDeskColors.current
    val spacing: DeskSpacing
        @Composable get() = LocalDeskSpacing.current
    val radius: DeskRadius
        @Composable get() = LocalDeskRadius.current
}

/**
 * Material's scheme, mapped from the tokens above.
 *
 * Every role is overridden rather than the handful that look used. An unmapped
 * role keeps Material's baseline value and surfaces months later in whichever
 * component happens to read it — on the phone that was the time picker's AM/PM
 * chip drawing a pink this product uses nowhere.
 */
@Composable
fun DeskTheme(
    dark: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colors = if (dark) DarkDesk else LightDesk

    val scheme = (if (dark) darkColorScheme() else lightColorScheme()).copy(
        primary = colors.primary,
        onPrimary = colors.onPrimary,
        primaryContainer = colors.primarySubtle,
        onPrimaryContainer = colors.text,
        inversePrimary = colors.primarySubtle,
        secondary = colors.primary,
        onSecondary = colors.onPrimary,
        secondaryContainer = colors.primarySubtle,
        onSecondaryContainer = colors.text,
        tertiary = colors.primary,
        onTertiary = colors.onPrimary,
        tertiaryContainer = colors.primarySubtle,
        onTertiaryContainer = colors.text,
        background = colors.background,
        onBackground = colors.text,
        surface = colors.surface,
        onSurface = colors.text,
        surfaceVariant = colors.surfaceElevated,
        onSurfaceVariant = colors.textMuted,
        surfaceTint = colors.primary,
        inverseSurface = colors.text,
        inverseOnSurface = colors.background,
        surfaceBright = colors.surfaceElevated,
        surfaceDim = colors.surface,
        surfaceContainerLowest = colors.surfaceElevated,
        surfaceContainerLow = colors.surfaceElevated,
        surfaceContainer = colors.surfaceElevated,
        surfaceContainerHigh = colors.surfaceElevated,
        surfaceContainerHighest = colors.surfaceElevated,
        error = colors.danger,
        onError = colors.onPrimary,
        errorContainer = colors.dangerSubtle,
        onErrorContainer = colors.text,
        outline = colors.border,
        outlineVariant = colors.borderSubtle,
    )

    // Smaller than the phone's throughout. A 17sp body is right held at arm's
    // length and oversized at desk distance, where the same text is nearer and
    // there is far more of it on screen at once.
    val typography = Typography(
        headlineMedium = TextStyle(fontSize = 24.sp, lineHeight = 30.sp, fontWeight = FontWeight.Bold),
        titleLarge = TextStyle(fontSize = 18.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold),
        titleMedium = TextStyle(fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.SemiBold),
        bodyLarge = TextStyle(fontSize = 14.sp, lineHeight = 20.sp),
        bodyMedium = TextStyle(fontSize = 13.sp, lineHeight = 18.sp),
        bodySmall = TextStyle(fontSize = 12.sp, lineHeight = 16.sp),
        labelLarge = TextStyle(fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Medium),
    )

    CompositionLocalProvider(
        LocalDeskColors provides colors,
        LocalDeskSpacing provides DeskSpacing(),
        LocalDeskRadius provides DeskRadius(),
    ) {
        MaterialTheme(colorScheme = scheme, typography = typography, content = content)
    }
}
