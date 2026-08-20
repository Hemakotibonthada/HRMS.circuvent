package com.circuvent.hrms.core.design

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
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

/**
 * Corner radii.
 *
 * Generous rather than tight. The first version used 6–14dp, which is correct
 * for a dense desktop table and reads as sharp and boxy on a phone screen made
 * almost entirely of stacked cards — the app looked like a wireframe of itself.
 * Softer corners are the single cheapest thing that makes a surface look like a
 * finished object rather than a div with a border.
 */
data class AppRadius(
    val sm: Dp = 10.dp,
    val md: Dp = 16.dp,
    val lg: Dp = 20.dp,
    val xl: Dp = 28.dp,
    val pill: Dp = 999.dp,
)

/**
 * Elevation.
 *
 * Cards used to carry a 1dp border in a mid-grey, which came from a palette
 * audit that found the *input* outline invisible at 1.27:1 against the page.
 * That fix was right for a control somebody has to find the edge of, and wrong
 * when it was applied to every grouping surface as well: a page of outlined
 * rectangles reads as a mockup.
 *
 * A card is separated by lift and by surface colour instead. The strong border
 * stays where it earns its keep — inputs, focus rings, anything whose boundary
 * is the affordance.
 *
 * Dark mode gets no useful shadow at any elevation, which is why the dark
 * palette keeps a real step between background, surface and surfaceElevated
 * rather than relying on this.
 */
data class AppElevation(
    val flat: Dp = 0.dp,
    val card: Dp = 2.dp,
    val raised: Dp = 6.dp,
    val hero: Dp = 12.dp,
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
val LocalAppElevation: ProvidableCompositionLocal<AppElevation> =
    staticCompositionLocalOf { AppElevation() }

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
    val colors = if (darkTheme) DarkColors else LightColors
    CompositionLocalProvider(
        LocalAppColors provides colors,
        LocalAppSpacing provides AppSpacing(),
        LocalAppRadius provides AppRadius(),
        LocalAppElevation provides AppElevation(),
        LocalAppTypography provides AppTypography(),
        LocalAppMotion provides AppMotion(),
    ) {
        // Material's scheme is still not where this app's own components read
        // their colour from — they read the tokens above, which is what keeps
        // the audited pairs intact.
        //
        // It is provided anyway, mapped from those same tokens, because the
        // handful of Material components used directly — thirty-five text
        // fields, nine switches, a slider — do not read tokens. Without this
        // they fall back to Material's *baseline* palette: a different purple,
        // a grey outline heavy enough that an unchecked switch reads as
        // disabled, and none of it responding to dark mode the way the rest of
        // the app does. Mapping once here is what makes a form look like it
        // belongs to the same product as the screen around it.
        MaterialTheme(
            colorScheme = materialScheme(colors, darkTheme),
            content = content,
        )
    }
}

/**
 * Material's scheme, expressed in this app's tokens.
 *
 * Built by copying the baseline and overriding *every* role, rather than naming
 * the handful that looked used. An unmapped role is not an unused one — it
 * silently keeps Material's baseline value, and that shows up months later in
 * whichever component happens to read it.
 *
 * That is exactly how it went: the roles a text field and a switch read were
 * mapped, and the time picker's AM/PM chip reads `tertiaryContainer`, which was
 * not. It drew Material's baseline pink — a colour this product uses nowhere,
 * on a control where pink carries no meaning, an inch from the violet dial. The
 * fix for one missing role is the same as the fix for all of them.
 */
private fun materialScheme(colors: AppColors, dark: Boolean): ColorScheme =
    (if (dark) darkColorScheme() else lightColorScheme()).copy(
        primary = colors.primary,
        onPrimary = colors.onPrimary,
        primaryContainer = colors.primarySubtle,
        onPrimaryContainer = colors.text,
        inversePrimary = colors.primarySubtle,

        // The accent does duty for all three families. This product has one
        // brand colour; inventing a secondary and a tertiary to fill the scheme
        // would put two colours on screen that no designer chose.
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

        // Dialogs, menus and sheets read these. Left unmapped they carry
        // Material's tonal tint, which is why the date picker sat on a lavender
        // panel while every card behind it was white.
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
        scrim = colors.scrim,
    )

/** Shorthand so screens read `Theme.colors.text` rather than a local lookup. */
object Theme {
    val colors: AppColors
        @Composable get() = LocalAppColors.current
    val spacing: AppSpacing
        @Composable get() = LocalAppSpacing.current
    val radius: AppRadius
        @Composable get() = LocalAppRadius.current
    val elevation: AppElevation
        @Composable get() = LocalAppElevation.current
    val type: AppTypography
        @Composable get() = LocalAppTypography.current
    val motion: AppMotion
        @Composable get() = LocalAppMotion.current
}
