package com.circuvent.hrms.feature

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.EmojiEvents
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.WavingHand
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.circuvent.hrms.AppContainer
import com.circuvent.hrms.core.design.AccentTone
import com.circuvent.hrms.core.design.Theme
import com.circuvent.hrms.core.design.colors
import com.circuvent.hrms.core.ui.AccentBadge
import com.circuvent.hrms.core.ui.AppButton
import com.circuvent.hrms.core.ui.AppCard
import com.circuvent.hrms.core.ui.AppText
import com.circuvent.hrms.core.ui.Banner
import com.circuvent.hrms.core.ui.BannerTone
import com.circuvent.hrms.core.ui.ButtonVariant
import com.circuvent.hrms.core.ui.EmptyState
import com.circuvent.hrms.core.ui.Glyph
import com.circuvent.hrms.core.ui.SkeletonRows
import com.circuvent.hrms.core.ui.StatusPill
import com.circuvent.hrms.core.ui.PillTone
import com.circuvent.hrms.core.ui.TextTone
import com.circuvent.hrms.core.ui.screenPadding
import com.circuvent.hrms.data.SessionUser
import com.circuvent.hrms.data.WallPostDto
import kotlinx.coroutines.launch

/**
 * The company wall.
 *
 * Reads and writes the same `socialPosts` documents as the web dashboard, so a
 * post written on a phone appears on a desktop and the other way round. That
 * had never actually happened before: the collection was missing from the
 * route's allowlist, so every read answered 404 and the dashboard's wall showed
 * an empty feed while posting failed silently.
 *
 * There is no comment or share control. Neither has anywhere to go — the
 * documents carry counts but there is no comment store behind them — and a
 * button that does nothing is worse than an absent one, particularly on a
 * screen whose whole purpose is to make people feel heard. The counts are still
 * shown, because a post that already has comments from the dashboard should say
 * so.
 */
@Composable
fun WallScreen(container: AppContainer, user: SessionUser?) {
    var posts by remember { mutableStateOf<List<WallPostDto>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<Pair<String, String?>?>(null) }
    var composing by remember { mutableStateOf(false) }
    var draft by remember { mutableStateOf("") }
    var draftError by remember { mutableStateOf<String?>(null) }
    var publishing by remember { mutableStateOf(false) }
    var busyId by remember { mutableStateOf<String?>(null) }

    val scope = rememberCoroutineScope()

    suspend fun load() {
        try {
            // Newest first. The store returns insertion order, which puts the
            // oldest post at the top of a feed — the opposite of what a feed is.
            posts = container.repository.wallPosts().sortedByDescending { it.createdAt }
            error = null
        } catch (e: Throwable) {
            error = "The wall could not be loaded" to e.message
        } finally {
            loading = false
        }
    }

    LaunchedEffect(Unit) { load() }

    val authorName = remember(user) {
        listOfNotNull(user?.firstName, user?.lastName)
            .joinToString(" ") { it.trim() }
            .trim()
            .ifBlank { user?.email?.substringBefore('@').orEmpty() }
    }

    fun publish() {
        if (draft.trim().length < 3) {
            draftError = "Write something first."
            return
        }
        draftError = null
        publishing = true
        scope.launch {
            try {
                container.repository.publishWallPost(
                    WallPostDto(
                        // Replaced by the store's own uuid on the way back. Sent
                        // anyway so the document matches what the dashboard
                        // writes, rather than being the one post shaped
                        // differently from every other.
                        id = "WP-${System.currentTimeMillis()}",
                        author = authorName,
                        content = draft.trim(),
                        createdAt = java.time.Instant.now().toString(),
                    )
                )
                draft = ""
                composing = false
                load()
            } catch (e: Exception) {
                error = "That post was not published" to e.message
            } finally {
                publishing = false
            }
        }
    }

    fun toggleLike(post: WallPostDto) {
        busyId = post.id
        scope.launch {
            try {
                container.repository.setWallPostLiked(post, !post.liked)
                // Updated in place rather than reloaded: a reload would scroll
                // the reader back to the top of the feed to move one counter.
                posts = posts.map {
                    if (it.id == post.id) {
                        it.copy(
                            liked = !post.liked,
                            likes = (post.likes + if (post.liked) -1 else 1).coerceAtLeast(0),
                        )
                    } else {
                        it
                    }
                }
            } catch (e: Exception) {
                error = "That like was not saved" to e.message
            } finally {
                busyId = null
            }
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = screenPadding(bottomExtra = TabBarHeight),
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.md),
    ) {
        error?.let { (title, description) ->
            item { Banner(BannerTone.ERROR, title, description = description) }
        }

        item {
            AppCard {
                if (composing) {
                    OutlinedTextField(
                        value = draft,
                        onValueChange = { draft = it.take(2000); draftError = null },
                        label = { Text("Share something with the company") },
                        supportingText = { draftError?.let { Text(it) } },
                        isError = draftError != null,
                        minLines = 3,
                        enabled = !publishing,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(Theme.spacing.sm))
                    Row(horizontalArrangement = Arrangement.spacedBy(Theme.spacing.sm)) {
                        AppButton(
                            label = "Post",
                            onClick = ::publish,
                            fullWidth = false,
                            busy = publishing,
                        )
                        AppButton(
                            label = "Cancel",
                            onClick = { composing = false; draft = ""; draftError = null },
                            variant = ButtonVariant.GHOST,
                            fullWidth = false,
                        )
                    }
                } else {
                    AppButton(
                        label = "Share something",
                        onClick = { composing = true },
                        contentDescription = "Write a post for the company wall",
                    )
                }
            }
        }

        item {
            when {
                loading -> SkeletonRows(count = 3, rowHeight = 150.dp)
                posts.isEmpty() && error == null -> EmptyState(
                    title = "Nothing on the wall yet",
                    description = "Welcomes, thank-yous and news from around the company " +
                        "appear here. Yours can be the first.",
                )
            }
        }

        items(posts, key = { it.id }) { post ->
            AppCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Avatar(post.author)
                    Spacer(Modifier.width(Theme.spacing.md))
                    Column(Modifier.weight(1f)) {
                        AppText(
                            post.author.ifBlank { "Someone" },
                            weight = FontWeight.SemiBold,
                        )
                        val subtitle = listOfNotNull(
                            post.department.takeIf { it.isNotBlank() },
                            post.createdAt.take(10).takeIf { it.isNotBlank() },
                        ).joinToString(" · ")
                        if (subtitle.isNotBlank()) {
                            AppText(
                                subtitle,
                                size = Theme.type.caption,
                                lineHeight = Theme.type.captionLine,
                                tone = TextTone.MUTED,
                            )
                        }
                    }
                    kindOf(post.type)?.let { (label, tone) ->
                        StatusPill(label = label, tone = tone)
                    }
                }

                Spacer(Modifier.height(Theme.spacing.md))
                AppText(post.content)

                if (post.tags.isNotEmpty()) {
                    Spacer(Modifier.height(Theme.spacing.sm))
                    AppText(
                        post.tags.joinToString(" ") { "#$it" },
                        size = Theme.type.caption,
                        lineHeight = Theme.type.captionLine,
                        tone = TextTone.PRIMARY,
                    )
                }

                Spacer(Modifier.height(Theme.spacing.md))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    AppButton(
                        label = if (post.likes == 1) "1 like" else "${post.likes} likes",
                        onClick = { toggleLike(post) },
                        variant = if (post.liked) ButtonVariant.SECONDARY else ButtonVariant.GHOST,
                        fullWidth = false,
                        busy = busyId == post.id,
                        contentDescription = if (post.liked) {
                            "Remove your like from ${post.author}'s post"
                        } else {
                            "Like ${post.author}'s post"
                        },
                    )

                    // Shown, not actionable: the count is real and came from
                    // somewhere, but there is no comment store to open.
                    if (post.comments > 0) {
                        Spacer(Modifier.width(Theme.spacing.md))
                        Icon(
                            imageVector = Icons.Filled.Forum,
                            contentDescription = null,
                            tint = Theme.colors.textMuted,
                            modifier = Modifier.size(16.dp),
                        )
                        Spacer(Modifier.width(Theme.spacing.xs))
                        AppText(
                            if (post.comments == 1) "1 comment" else "${post.comments} comments",
                            size = Theme.type.caption,
                            lineHeight = Theme.type.captionLine,
                            tone = TextTone.MUTED,
                        )
                    }
                }
            }
        }
    }
}

/** The badge a post carries, or null for an ordinary one. */
private fun kindOf(type: String): Pair<String, PillTone>? = when (type) {
    "achievement" -> "Achievement" to PillTone.SUCCESS
    "welcome" -> "Welcome" to PillTone.INFO
    "announcement" -> "Announcement" to PillTone.WARNING
    else -> null
}

/**
 * Initials on a tinted disc.
 *
 * The tint is chosen from the name so the same person keeps the same colour
 * down the feed. It carries no meaning — nobody should read anything into
 * somebody being teal — it just makes a column of posts easier to skim.
 */
@Composable
private fun Avatar(name: String) {
    val initials = remember(name) {
        name.split(' ', '.', '_', '-')
            .filter { it.isNotBlank() }
            .take(2)
            .map { it.first().uppercaseChar() }
            .joinToString("")
            .ifBlank { "?" }
    }
    val tones = AccentTone.entries
    val tone = remember(name) {
        if (name.isBlank()) AccentTone.Slate else tones[(name.hashCode().mod(tones.size))]
    }
    val accent = tone.colors()

    Box(
        modifier = Modifier
            .size(40.dp)
            .clip(RoundedCornerShape(Theme.radius.pill))
            .background(accent.container),
        contentAlignment = Alignment.Center,
    ) {
        AppText(
            initials,
            size = Theme.type.footnote,
            lineHeight = Theme.type.footnoteLine,
            weight = FontWeight.SemiBold,
            color = accent.icon,
        )
    }
}
