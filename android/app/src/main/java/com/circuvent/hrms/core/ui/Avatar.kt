package com.circuvent.hrms.core.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil3.compose.SubcomposeAsyncImage
import com.circuvent.hrms.core.design.Theme

/**
 * Somebody's face, or their initials.
 *
 * The initials are not a placeholder to be replaced later — they are the
 * answer for most people most of the time. Nobody in this organisation has a
 * picture set yet, and a broken-image glyph or an empty grey circle in the
 * place a face should be reads as the app having failed rather than as a
 * photograph simply not existing.
 *
 * So the initials are drawn first and the photograph replaces them if it
 * arrives. A load that fails — an expired signed URL, no connection, a picture
 * deleted from storage — falls back to exactly what was already there, which
 * is why the failure is invisible rather than ugly.
 *
 * Decorative by default. A screen reader announcing "photo of Vema Naidu"
 * immediately before the text "Vema Naidu" is noise; where the avatar is the
 * only identification, the caller passes a description.
 */
@Composable
fun Avatar(
    name: String,
    modifier: Modifier = Modifier,
    imageUrl: String? = null,
    size: Dp = 56.dp,
    contentDescription: String? = null,
) {
    val initials = remember(name) { initialsOf(name) }
    val shape = androidx.compose.foundation.shape.CircleShape

    val frame = modifier
        .size(size)
        .clip(shape)
        .background(Theme.colors.primarySubtle)
        .then(
            if (contentDescription == null) Modifier.clearAndSetSemantics {} else Modifier
        )

    if (imageUrl.isNullOrBlank()) {
        Box(frame, contentAlignment = Alignment.Center) {
            AppText(
                initials,
                weight = FontWeight.SemiBold,
                size = Theme.type.callout,
                lineHeight = Theme.type.calloutLine,
            )
        }
        return
    }

    // The initials belong in the loading and error slots, not underneath the
    // image. Underneath, they show *through* it — most avatars exported as PNG
    // carry some transparency, and the result is two letters printed across
    // somebody's face. Found by looking at it.
    SubcomposeAsyncImage(
        model = imageUrl,
        contentDescription = contentDescription,
        contentScale = ContentScale.Crop,
        modifier = frame,
        loading = {
            Box(Modifier.size(size), contentAlignment = Alignment.Center) {
                AppText(
                    initials,
                    weight = FontWeight.SemiBold,
                    size = Theme.type.callout,
                    lineHeight = Theme.type.calloutLine,
                )
            }
        },
        error = {
            // A load that fails — an expired signed URL, no connection, a
            // picture deleted from storage — lands on exactly what would have
            // been shown anyway, which is why the failure is invisible rather
            // than a broken-image glyph where a face should be.
            Box(Modifier.size(size), contentAlignment = Alignment.Center) {
                AppText(
                    initials,
                    weight = FontWeight.SemiBold,
                    size = Theme.type.callout,
                    lineHeight = Theme.type.calloutLine,
                )
            }
        },
    )
}

/**
 * Up to two initials from a name.
 *
 * Takes the first and last parts rather than the first two, because Indian
 * names frequently carry an expanded initial in the middle — "Vema Naidu
 * Kolli" should read VK, not VN. A single-word name gives one letter, which is
 * better than inventing a second from the middle of it.
 */
internal fun initialsOf(name: String): String {
    val parts = name.trim().split(Regex("\\s+")).filter { it.isNotBlank() }
    return when (parts.size) {
        0 -> "?"
        1 -> parts[0].take(1).uppercase()
        else -> (parts.first().take(1) + parts.last().take(1)).uppercase()
    }
}
