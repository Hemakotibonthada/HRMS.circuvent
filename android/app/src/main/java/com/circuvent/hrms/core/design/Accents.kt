package com.circuvent.hrms.core.design

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/**
 * Accent hues for feature icons.
 *
 * The rest of the palette is deliberately narrow — one primary, plus success,
 * warning and danger that each carry a fixed meaning. These accents carry no
 * meaning at all. They exist so that a grid of a dozen feature cards can be
 * scanned by colour instead of read word by word, which is the whole reason
 * the cards beat the flat list they replaced.
 *
 * Because they are decorative, they must never be the only thing distinguishing
 * two actions: every card also carries its own glyph and its own label. Someone
 * who cannot separate the teal card from the green one loses nothing.
 *
 * Each tone resolves to a pair. [AccentColors.icon] is the glyph, and
 * [AccentColors.container] is the disc behind it. In light mode the container is
 * a pale wash and the glyph is the saturated hue. Dark mode cannot simply reuse
 * those: a pale disc on a near-black card glares, and the saturated hue that
 * looked solid on white turns muddy on black. So dark mode inverts the
 * relationship — a deep, desaturated container with a light glyph on top.
 *
 * Every pair below clears 4.5:1 glyph-on-container.
 */
enum class AccentTone {
    Violet,
    Amber,
    Teal,
    Rose,
    Blue,
    Green,
    Plum,
    Slate,
}

data class AccentColors(val icon: Color, val container: Color)

/**
 * Resolves a tone against the theme in scope.
 *
 * Kept as a function rather than baked into [AppColors] because accents are
 * looked up by tone at the call site, and threading eight extra pairs through
 * the colour scheme would double its size for something only the card
 * components consume.
 */
@Composable
fun AccentTone.colors(): AccentColors {
    val dark = Theme.colors.isDark
    return when (this) {
        AccentTone.Violet -> if (dark) {
            AccentColors(Color(0xFFC4ABFF), Color(0xFF2A1F47))
        } else {
            AccentColors(Color(0xFF5B21D6), Color(0xFFEDE7FE))
        }

        AccentTone.Amber -> if (dark) {
            AccentColors(Color(0xFFF5C264), Color(0xFF3A2A0C))
        } else {
            AccentColors(Color(0xFF8A5300), Color(0xFFFDF0DC))
        }

        AccentTone.Teal -> if (dark) {
            AccentColors(Color(0xFF67D3CE), Color(0xFF0D302F))
        } else {
            AccentColors(Color(0xFF0A6E68), Color(0xFFDFF3F1))
        }

        AccentTone.Rose -> if (dark) {
            AccentColors(Color(0xFFFF9CA8), Color(0xFF3D141B))
        } else {
            AccentColors(Color(0xFFB01B36), Color(0xFFFCE7EB))
        }

        AccentTone.Blue -> if (dark) {
            AccentColors(Color(0xFF8FBEFF), Color(0xFF12253F))
        } else {
            AccentColors(Color(0xFF11549E), Color(0xFFE3EDFB))
        }

        AccentTone.Green -> if (dark) {
            AccentColors(Color(0xFF7BD98F), Color(0xFF122E1A))
        } else {
            AccentColors(Color(0xFF15682C), Color(0xFFE4F4E8))
        }

        AccentTone.Plum -> if (dark) {
            AccentColors(Color(0xFFE3A5DC), Color(0xFF351A33))
        } else {
            AccentColors(Color(0xFF8B2280), Color(0xFFF9E6F7))
        }

        AccentTone.Slate -> if (dark) {
            AccentColors(Color(0xFFB4BAC9), Color(0xFF23262E))
        } else {
            AccentColors(Color(0xFF44506B), Color(0xFFEAEDF3))
        }
    }
}
