package com.circuvent.hrms.desktop

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.painter.BitmapPainter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.loadImageBitmap
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import java.net.URI
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Somebody's face, or their initials.
 *
 * The desktop client drew initials for everybody, including people who had
 * uploaded a photograph, because nothing here ever loaded an image. Two
 * separate reasons: the shared `Session` did not carry `avatarUrl` even though
 * the API returns it, and there was no image loader at all.
 *
 * Initials are the *fallback*, not a layer underneath. Drawing them behind a
 * transparent PNG shows both at once, which is the mistake the Android client
 * made and had to be caught by looking at it.
 *
 * https only. A profile picture fetched over http on a corporate network is a
 * request that can be watched and rewritten, for a decoration.
 */
@Composable
fun Avatar(
    name: String,
    modifier: Modifier = Modifier,
    imageUrl: String? = null,
    size: Dp = 32.dp,
) {
    var bitmap by remember(imageUrl) { mutableStateOf<ImageBitmap?>(null) }

    LaunchedEffect(imageUrl) {
        val url = imageUrl?.trim()
        if (url.isNullOrEmpty() || !url.startsWith("https://")) {
            bitmap = null
            return@LaunchedEffect
        }

        bitmap = withContext(Dispatchers.IO) {
            runCatching {
                URI(url).toURL().openStream().use { loadImageBitmap(it) }
            }.getOrNull()
        }
    }

    Box(
        modifier.size(size).clip(CircleShape).background(Desk.colors.primarySubtle),
        contentAlignment = Alignment.Center,
    ) {
        val loaded = bitmap
        if (loaded != null) {
            Image(
                painter = BitmapPainter(loaded),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Text(
                initialsOf(name),
                color = Desk.colors.primary,
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

/**
 * Up to two initials.
 *
 * Takes the first and last name parts rather than the first two, so
 * "Hema Koteswara Rao Bonthada" reads HB — the pair a colleague would
 * recognise — rather than HK.
 */
internal fun initialsOf(name: String): String {
    val parts = name.trim().split(" ").filter { it.isNotBlank() }
    return when {
        parts.isEmpty() -> "?"
        parts.size == 1 -> parts[0].take(2).uppercase()
        else -> "${parts.first().first()}${parts.last().first()}".uppercase()
    }
}

