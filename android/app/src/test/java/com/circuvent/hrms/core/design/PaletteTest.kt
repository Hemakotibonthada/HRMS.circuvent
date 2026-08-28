package com.circuvent.hrms.core.design

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The palette contract.
 *
 * Every pair the app renders is measured here. This is the test that the
 * previous generation of this product did not have when it shipped fifteen
 * WCAG failures — a dark card at 1.04:1 that was not visibly there, a light
 * border at 1.27:1 that was the only marker of where an input began, white on
 * the success green at 3.03:1 on every approved and paid state.
 *
 * A failure names the pair, the measured ratio and the one it needed, because
 * "contrast test failed" tells whoever broke it nothing about which colour to
 * put back.
 */
class PaletteTest {

    @Test
    fun `every pair in the light palette meets its contrast requirement`() {
        assertContract(LightColors, "light")
    }

    @Test
    fun `every pair in the dark palette meets its contrast requirement`() {
        assertContract(DarkColors, "dark")
    }

    private fun assertContract(colors: AppColors, scheme: String) {
        val failures = ContractFailures(colors)
        assertTrue(
            "In the $scheme palette:\n" + failures.joinToString("\n"),
            failures.isEmpty(),
        )
    }

    private fun ContractFailures(colors: AppColors): List<String> =
        ContrastContract.mapNotNull { rule ->
            val fg = rule.foreground(colors).toArgbInt()
            val bg = rule.background(colors).toArgbInt()
            val measured = Contrast.ratio(fg, bg)
            if (measured >= rule.minimum - 0.005) {
                null
            } else {
                "  ${rule.name}: ${"%.2f".format(measured)}:1, needs ${rule.minimum}:1"
            }
        }

    @Test
    fun `the contract covers both schemes with the same rules`() {
        // A rule that applied to one scheme only is how a palette passes in
        // light mode and fails in dark, which is what happened before.
        assertTrue("The contract is empty", ContrastContract.isNotEmpty())
        assertEquals(20, ContrastContract.size)
    }

    @Test
    fun `white on black is the maximum ratio`() {
        // Pins the implementation itself. A contrast function that is subtly
        // wrong makes every other assertion in this file meaningless.
        assertEquals(21.0, Contrast.ratio(0xFFFFFF, 0x000000), 0.01)
        assertEquals(21.0, Contrast.ratio(0x000000, 0xFFFFFF), 0.01)
    }

    @Test
    fun `a colour against itself is 1 to 1`() {
        assertEquals(1.0, Contrast.ratio(0x783FF5, 0x783FF5), 0.001)
    }

    @Test
    fun `the ratio does not depend on the order of the arguments`() {
        val a = Contrast.ratio(0x157A31, 0xFFFFFF)
        val b = Contrast.ratio(0xFFFFFF, 0x157A31)
        assertEquals(a, b, 0.0001)
    }

    @Test
    fun `luminance uses the specification curve and not the squared shortcut`() {
        // 0.2158 is the specified relative luminance of mid grey. The common
        // shortcut of squaring the channel gives about 0.216 here and is wrong
        // at the ends of the range — which is exactly where the failures were.
        assertEquals(0.2158, Contrast.relativeLuminance(0x808080), 0.001)
        assertEquals(0.0, Contrast.relativeLuminance(0x000000), 0.0001)
        assertEquals(1.0, Contrast.relativeLuminance(0xFFFFFF), 0.0001)
    }

    @Test
    fun `the dark card is visibly distinct from the dark page`() {
        // The single worst defect in the original palette, pinned so it cannot
        // come back: at 1.04:1 every grouped surface in dark mode was invisible.
        val ratio = Contrast.ratio(
            DarkColors.surfaceElevated.toArgbInt(),
            DarkColors.background.toArgbInt(),
        )
        assertTrue("Dark card on dark page is only ${"%.2f".format(ratio)}:1", ratio >= 1.10)
    }
}

/** The 24-bit RGB of a Compose colour, which is what the contrast maths takes. */
private fun androidx.compose.ui.graphics.Color.toArgbInt(): Int {
    val r = (red * 255f + 0.5f).toInt()
    val g = (green * 255f + 0.5f).toInt()
    val b = (blue * 255f + 0.5f).toInt()
    return (r shl 16) or (g shl 8) or b
}
