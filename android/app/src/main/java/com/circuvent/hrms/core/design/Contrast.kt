package com.circuvent.hrms.core.design

/**
 * WCAG contrast, computed rather than asserted from memory.
 *
 * A direct port of `src/lib/color/contrast.ts`, which the web app and the
 * React Native app both used. It exists as one implementation on purpose: the
 * previous generation of this codebase briefly had two haversine functions with
 * different Earth radii, and they disagreed about whether somebody standing at
 * the edge of an office was at work. Two contrast implementations would let the
 * web and the phone disagree about whether a colour is readable, which is the
 * same class of defect applied to something a person has to see.
 *
 * The maths is the WCAG 2.x definition and nothing else: sRGB channels
 * linearised, weighted, and compared as (lighter + 0.05) / (darker + 0.05).
 */
object Contrast {

    /** Normal text, AA. */
    const val AA_NORMAL = 4.5

    /** Large text (18.66pt bold or 24pt regular), AA. */
    const val AA_LARGE = 3.0

    /** Interface components and graphical objects — borders, icons, focus rings. */
    const val AA_NON_TEXT = 3.0

    /** Normal text, AAA. */
    const val AAA_NORMAL = 7.0

    /**
     * Relative luminance of an sRGB colour, 0 for black and 1 for white.
     *
     * The 0.03928 threshold and the 2.4 exponent are from the specification.
     * The often-seen shortcut of squaring the channel is close for mid tones
     * and wrong at both ends, which is exactly where the failures live.
     */
    fun relativeLuminance(argb: Int): Double {
        val r = channel((argb shr 16 and 0xFF) / 255.0)
        val g = channel((argb shr 8 and 0xFF) / 255.0)
        val b = channel((argb and 0xFF) / 255.0)
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }

    private fun channel(value: Double): Double =
        if (value <= 0.03928) value / 12.92 else Math.pow((value + 0.055) / 1.055, 2.4)

    /** Contrast ratio between two opaque colours, from 1.0 to 21.0. */
    fun ratio(foreground: Int, background: Int): Double {
        val a = relativeLuminance(foreground)
        val b = relativeLuminance(background)
        val lighter = maxOf(a, b)
        val darker = minOf(a, b)
        return (lighter + 0.05) / (darker + 0.05)
    }

    /** Whether a pair clears a threshold, with the rounding the tools use. */
    fun meets(foreground: Int, background: Int, minimum: Double): Boolean {
        // Rounded to two decimals before comparing, so a 4.4999 does not pass a
        // 4.5 check on a floating point accident and a 4.495 does not fail one
        // that every contrast checker in the world reports as 4.5.
        return Math.round(ratio(foreground, background) * 100.0) / 100.0 >= minimum
    }
}
