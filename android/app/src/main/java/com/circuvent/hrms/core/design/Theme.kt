package com.circuvent.hrms.core.design

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Spacing, on a scale rather than by eye.
 *
 * Every gap in the app is one of these. The value of a scale is not tidiness:
 * it is that "a bit more space here" becomes a choice between two numbers
 * instead of a free parameter that drifts screen by screen.
 */
data class AppSpacing(
    val xs: Dp = 4.dp,
    val sm: Dp = 8.dp,
    val md: Dp = 12.dp,
    val lg: Dp = 16.dp,
    val xl: Dp = 24.dp,
    val xxl: Dp = 32.dp,
    val xxxl: Dp = 48.dp,
)

data class AppRadius(
    val sm: Dp = 6.dp,
    val md: Dp = 10.dp,
    val lg: Dp = 14.dp,
    val xl: Dp = 20.dp,
    val pill: Dp = 999.dp,
)

/**
 * Minimum interactive size.
 *
 * 44dp is Apple's guidance and the WCAG 2.2 target-size minimum; Android's is
 * 48dp. Taking the larger of the two costs four points of layout and removes a
 * whole class of complaint about mis-taps — which, on the clock-in button, is
 * somebody's attendance record.
 */
val MinTouchTarget: Dp = 48.dp

/**
 * The type scale.
 *
 * Sizes are in `sp`, so they follow the reader's own text-size setting. Line
 * heights are in `sp` as well, and that is the whole difference from the app
 * this replaces.
 *
 * React Native's `lineHeight` is in raw points and is *not* scaled with the
 * font, so an absolute line height left 30sp glyphs on a 22px line at 200% and
 * clipped every screen — for exactly the people who had turned the setting up
 * because they were already struggling. Compose scales `sp` for both, so
 * stating the line height in `sp` keeps the ratio the designer chose at every
 * setting, with no arithmetic and nothing to remember.
 */
data class AppTypography(
    val caption: TextUnit = 12.sp,
    val footnote: TextUnit = 13.sp,
    val body: TextUnit = 15.sp,
    val callout: TextUnit = 17.sp,
    val title3: TextUnit = 20.sp,
    val title2: TextUnit = 24.sp,
    val title1: TextUnit = 30.sp,
    val display: TextUnit = 36.sp,

    val captionLine: TextUnit = 16.sp,
    val footnoteLine: TextUnit = 18.sp,
    val bodyLine: TextUnit = 22.sp,
    val calloutLine: TextUnit = 24.sp,
    val title3Line: TextUnit = 26.sp,
    val title2Line: TextUnit = 30.sp,
    val title1Line: TextUnit = 36.sp,
    val displayLine: TextUnit = 42.sp,
)

/**
 * Motion, dialled down.
 *
 * This is an app people open to clock in while walking into a building.
 * Animation is for continuity — showing where a sheet came from — never for
 * delight. The system's own "remove animations" setting is honoured by Compose
 * for its built-in transitions; nothing here fights it.
 */
data class AppMotion(
    /** State changes: press, toggle, colour. */
    val instant: Int = 120,
    /** The default. Long enough to follow, short enough not to wait for. */
    val short: Int = 200,
    /** Sheets and screen transitions. */
    val medium: Int = 280,
)

val LocalAppColors: ProvidableCompositionLocal<AppColors> =
    staticCompositionLocalOf { LightColors }
val LocalAppSpacing: ProvidableCompositionLocal<AppSpacing> =
    staticCompositionLocalOf { AppSpacing() }
val LocalAppRadius: ProvidableCompositionLocal<AppRadius> =
    staticCompositionLocalOf { AppRadius() }
val LocalAppTypography: ProvidableCompositionLocal<AppTypography> =
    staticCompositionLocalOf { AppTypography() }
val LocalAppMotion: ProvidableCompositionLocal<AppMotion> =
    staticCompositionLocalOf { AppMotion() }

/**
 * The theme.
 *
 * Follows the operating system and offers no in-app toggle, which is a decision
 * rather than an omission: people set dark mode once, at the system level,
 * usually for a reason — light sensitivity, migraine, working nights. An app
 * that ignores it, or that needs its own switch set separately, is one more
 * thing to get wrong.
 *
 * Material 3's own `MaterialTheme` is deliberately not used as the source of
 * colour. Its scheme is a different vocabulary — primaryContainer, surfaceTint,
 * onSurfaceVariant — and mapping an audited palette onto it loses the audit:
 * the pairs the contract measures stop being the pairs the components draw.
 */
@Composable
fun CircuventTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    CompositionLocalProvider(
        LocalAppColors provides if (darkTheme) DarkColors else LightColors,
        LocalAppSpacing provides AppSpacing(),
        LocalAppRadius provides AppRadius(),
        LocalAppTypography provides AppTypography(),
        LocalAppMotion provides AppMotion(),
        content = content,
    )
}

/** Shorthand so screens read `Theme.colors.text` rather than a local lookup. */
object Theme {
    val colors: AppColors
        @Composable get() = LocalAppColors.current
    val spacing: AppSpacing
        @Composable get() = LocalAppSpacing.current
    val radius: AppRadius
        @Composable get() = LocalAppRadius.current
    val type: AppTypography
        @Composable get() = LocalAppTypography.current
    val motion: AppMotion
        @Composable get() = LocalAppMotion.current
}
