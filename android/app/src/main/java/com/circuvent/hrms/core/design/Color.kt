package com.circuvent.hrms.core.design

import androidx.compose.ui.graphics.Color

/**
 * The palette.
 *
 * These are the sRGB values audited in the previous generation of this app, and
 * they are carried over unchanged. Fifteen pairs in the original web palette
 * failed WCAG AA when they were finally measured — a dark card that sat at
 * 1.04:1 against its own background and so was not visibly there at all, a
 * light border at 1.27:1 that was the only thing marking where an input began,
 * white on the success green at 3.03:1 on every approved and paid state.
 *
 * Three of the fixes are judgement rather than arithmetic and are worth keeping
 * the reasons for:
 *
 *   * The light page is not pure white. A white page cannot show a white card.
 *   * Dark primary buttons take a dark label rather than a white one. A light
 *     accent on a dark surface is the case for dark text, not for white.
 *   * Borders are heavier than the current fashion, deliberately.
 *
 * `PaletteTest` measures every pair the app actually renders. A colour adjusted
 * to taste that drops below AA fails the build and names the pair.
 */
data class AppColors(
    /** App background, behind everything. */
    val background: Color,
    /** A recessed surface — muted groupings, disabled rows. */
    val surface: Color,
    /** A raised surface — cards, sheets, the tab bar. */
    val surfaceElevated: Color,
    /** Body text. */
    val text: Color,
    /** Secondary text: captions, dates, helper lines. */
    val textMuted: Color,
    /** Brand accent, and the colour of the primary action. */
    val primary: Color,
    /** The label on top of [primary]. */
    val onPrimary: Color,
    /** A tint of the accent, for selected regions and informational pills. */
    val primarySubtle: Color,
    val danger: Color,
    val dangerSubtle: Color,
    val success: Color,
    val successSubtle: Color,
    val warning: Color,
    val warningSubtle: Color,
    /** Visible against both [background] and [surfaceElevated]. */
    val border: Color,
    /** A quieter rule, for dividers inside a card. */
    val borderSubtle: Color,
    /** The focus ring. */
    val focus: Color,
    /** Behind a modal. */
    val scrim: Color,
    val isDark: Boolean,
)

val LightColors = AppColors(
    // Not #FFFFFF. A white page cannot show a white card, and every grouped
    // surface in this app is a card.
    //
    // Tinted towards the brand hue rather than a neutral grey. A flat
    // #F4F4F7 page under a violet button reads as an unfinished wireframe:
    // there is one colour in the design and everything else is the absence of
    // one. A few points of violet in the background costs nothing, keeps every
    // contrast ratio below intact, and makes the surfaces above it look
    // deliberate instead of default.
    background = Color(0xFFF3F1FA),
    surface = Color(0xFFFAF9FE),
    surfaceElevated = Color(0xFFFFFFFF),
    // Warmed very slightly off pure near-black, which reads softer on an OLED
    // panel without giving up any contrast.
    text = Color(0xFF14121F),
    textMuted = Color(0xFF56546A),
    primary = Color(0xFF6D33E8),
    onPrimary = Color(0xFFFFFFFF),
    primarySubtle = Color(0xFFEDE7FE),
    // Darkened from the web original, which sat at 4.11:1 against white — on
    // the delete button, the one you least want misread.
    danger = Color(0xFFC2101C),
    dangerSubtle = Color(0xFFFDECEE),
    // The web original was 3.02:1, two thirds of what it needed, on every
    // approved and paid state in the product.
    success = Color(0xFF157A31),
    successSubtle = Color(0xFFE7F6EB),
    warning = Color(0xFF8A5A00),
    warningSubtle = Color(0xFFFDF3E2),
    // Heavier than the current fashion, deliberately. At 1.27:1 the original
    // was an input outline nobody could see.
    border = Color(0xFF8A8A99),
    borderSubtle = Color(0xFFE1DEF0),
    focus = Color(0xFF7E55F0),
    scrim = Color(0x7314121F),
    isDark = false,
)

val DarkColors = AppColors(
    background = Color(0xFF0B0B10),
    surface = Color(0xFF191922),
    // Lifted well clear of the background. The web original measured 1.04:1
    // against it, which is a card that is not visibly there.
    surfaceElevated = Color(0xFF24242F),
    text = Color(0xFFEDEDF2),
    textMuted = Color(0xFF9A9AA6),
    primary = Color(0xFFA98CFF),
    // Dark, not white. A light accent on a dark surface is the case for a dark
    // label; white on this measured 3.60:1 on every primary button in the app.
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
    focus = Color(0xFFA98CFF),
    scrim = Color(0x9903000A),
    isDark = true,
)

/** One pair the app renders, and the ratio it has to clear. */
data class ContrastRule(
    val name: String,
    val foreground: (AppColors) -> Color,
    val background: (AppColors) -> Color,
    val minimum: Double,
)

/**
 * Every pair the app actually puts on screen.
 *
 * Listing them is the point. The first audit of the web palette found four
 * failures by inspection; checking every pair the app renders found fifteen —
 * which is the argument for enumerating them rather than eyeballing.
 */
val ContrastContract: List<ContrastRule> = listOf(
    ContrastRule("body text on the page", { it.text }, { it.background }, Contrast.AA_NORMAL),
    ContrastRule("body text on a card", { it.text }, { it.surfaceElevated }, Contrast.AA_NORMAL),
    ContrastRule("muted text on the page", { it.textMuted }, { it.background }, Contrast.AA_NORMAL),
    ContrastRule("muted text on a card", { it.textMuted }, { it.surfaceElevated }, Contrast.AA_NORMAL),
    ContrastRule("muted text on a muted surface", { it.textMuted }, { it.surface }, Contrast.AA_NORMAL),
    ContrastRule("primary button label", { it.onPrimary }, { it.primary }, Contrast.AA_NORMAL),
    ContrastRule("accent text on the page", { it.primary }, { it.background }, Contrast.AA_NORMAL),
    ContrastRule("accent text on a card", { it.primary }, { it.surfaceElevated }, Contrast.AA_NORMAL),
    ContrastRule("accent text on its own tint", { it.primary }, { it.primarySubtle }, Contrast.AA_NORMAL),
    ContrastRule("success text on its tint", { it.success }, { it.successSubtle }, Contrast.AA_NORMAL),
    ContrastRule("warning text on its tint", { it.warning }, { it.warningSubtle }, Contrast.AA_NORMAL),
    ContrastRule("danger text on its tint", { it.danger }, { it.dangerSubtle }, Contrast.AA_NORMAL),
    ContrastRule("success text on a card", { it.success }, { it.surfaceElevated }, Contrast.AA_NORMAL),
    ContrastRule("warning text on a card", { it.warning }, { it.surfaceElevated }, Contrast.AA_NORMAL),
    ContrastRule("danger text on a card", { it.danger }, { it.surfaceElevated }, Contrast.AA_NORMAL),
    // Non-text: a border is a component boundary, so 3:1 rather than 4.5:1.
    ContrastRule("card border against the page", { it.border }, { it.background }, Contrast.AA_NON_TEXT),
    ContrastRule("border inside a card", { it.border }, { it.surfaceElevated }, Contrast.AA_NON_TEXT),
    ContrastRule("focus ring on the page", { it.focus }, { it.background }, Contrast.AA_NON_TEXT),
    ContrastRule("focus ring on a card", { it.focus }, { it.surfaceElevated }, Contrast.AA_NON_TEXT),
    ContrastRule("a card against the page", { it.surfaceElevated }, { it.background }, 1.10),
)
