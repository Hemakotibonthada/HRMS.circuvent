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
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.EmojiEvents
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.WavingHand
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.circuvent.hrms.AppContainer
import com.circuvent.hrms.R
import com.circuvent.hrms.core.design.AccentTone
import com.circuvent.hrms.core.design.Theme
import com.circuvent.hrms.core.design.colors
import com.circuvent.hrms.core.ui.AccentBadge
import com.circuvent.hrms.core.ui.AccentRule
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
import com.circuvent.hrms.core.ui.rememberFormattedDate
import com.circuvent.hrms.core.ui.screenPadding
import com.circuvent.hrms.data.SessionUser
import com.circuvent.hrms.data.WallCommentCreate
import com.circuvent.hrms.data.WallCommentDto
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
    // Which post has its replies open. One at a time: the wall is a scrolling
    // list and several expanded threads turn it into a wall of somebody else's
    // conversations.
    var expandedPostId by remember { mutableStateOf<String?>(null) }

    val scope = rememberCoroutineScope()

    val wallLoadFailedTitle = stringResource(R.string.wall_load_failed_title)
    val writeSomethingFirst = stringResource(R.string.wall_draft_too_short)
    val postFailedTitle = stringResource(R.string.wall_post_failed_title)
    val likeFailedTitle = stringResource(R.string.wall_like_failed_title)

    suspend fun load() {
        try {
            // Newest first. The store returns insertion order, which puts the
            // oldest post at the top of a feed — the opposite of what a feed is.
            posts = container.repository.wallPosts().sortedByDescending { it.createdAt }
            error = null
        } catch (e: Throwable) {
            error = wallLoadFailedTitle to e.message
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
            draftError = writeSomethingFirst
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
                error = postFailedTitle to e.message
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
                error = likeFailedTitle to e.message
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
                        label = { Text(stringResource(R.string.wall_draft_label)) },
                        supportingText = { draftError?.let { Text(it) } },
                        isError = draftError != null,
                        minLines = 3,
                        enabled = !publishing,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(Theme.spacing.sm))
                    Row(horizontalArrangement = Arrangement.spacedBy(Theme.spacing.sm)) {
                        AppButton(
                            label = stringResource(R.string.wall_post_action),
                            onClick = ::publish,
                            fullWidth = false,
                            busy = publishing,
                        )
                        AppButton(
                            label = stringResource(R.string.expenses_cancel_action),
                            onClick = { composing = false; draft = ""; draftError = null },
                            variant = ButtonVariant.GHOST,
                            fullWidth = false,
                        )
                    }
                } else {
                    AppButton(
                        label = stringResource(R.string.wall_share_something_action),
                        onClick = { composing = true },
                        contentDescription = stringResource(R.string.wall_share_something_content_description),
                    )
                }
            }
        }

        item {
            when {
                loading -> SkeletonRows(count = 3, rowHeight = 150.dp)
                posts.isEmpty() && error == null -> EmptyState(
                    title = stringResource(R.string.wall_empty_title),
                    description = stringResource(R.string.wall_empty_description),
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
                            post.author.ifBlank { stringResource(R.string.wall_unknown_author_fallback) },
                            weight = FontWeight.SemiBold,
                        )
                        val subtitle = listOfNotNull(
                            post.department.takeIf { it.isNotBlank() },
                            post.createdAt.takeIf { it.isNotBlank() }?.let { rememberFormattedDate(it) },
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
                        label = pluralStringResource(R.plurals.wall_like_count, post.likes, post.likes),
                        onClick = { toggleLike(post) },
                        variant = if (post.liked) ButtonVariant.SECONDARY else ButtonVariant.GHOST,
                        fullWidth = false,
                        busy = busyId == post.id,
                        contentDescription = if (post.liked) {
                            stringResource(R.string.wall_remove_like_content_description, post.author)
                        } else {
                            stringResource(R.string.wall_add_like_content_description, post.author)
                        },
                    )

                    Spacer(Modifier.width(Theme.spacing.sm))
                    AppButton(
                        label = stringResource(R.string.wall_comment_action),
                        onClick = {
                            expandedPostId = if (expandedPostId == post.id) null else post.id
                        },
                        variant = ButtonVariant.GHOST,
                        fullWidth = false,
                    )
                }

                if (expandedPostId == post.id) {
                    WallComments(container = container, postId = post.id)
                }
            }
        }
    }
}

/**
 * The replies on one post, loaded when it is opened.
 *
 * Not fetched with the feed: most posts are never opened, and a wall of twenty
 * posts would otherwise be twenty extra queries to render counts nobody looked
 * at. The count shown is the number of replies actually present, because it is
 * derived from them rather than stored beside them — the old count came out of
 * the post document and had nothing behind it.
 */
@Composable
private fun WallComments(container: AppContainer, postId: String) {
    var items by remember(postId) { mutableStateOf<List<WallCommentDto>>(emptyList()) }
    var loading by remember(postId) { mutableStateOf(true) }
    var draft by remember(postId) { mutableStateOf("") }
    var sending by remember(postId) { mutableStateOf(false) }
    var error by remember(postId) { mutableStateOf<String?>(null) }

    val scope = rememberCoroutineScope()
    val failed = stringResource(R.string.wall_comment_failed)

    suspend fun load() {
        loading = true
        items = runCatching { container.repository.wallComments(postId).items }.getOrDefault(emptyList())
        loading = false
    }

    LaunchedEffect(postId) { load() }

    Column(Modifier.padding(top = Theme.spacing.sm)) {
        AccentRule()

        if (loading) {
            SkeletonRows(count = 1, rowHeight = 44.dp)
        } else {
            items.forEach { comment ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(top = Theme.spacing.sm),
                    horizontalArrangement = Arrangement.spacedBy(Theme.spacing.sm),
                ) {
                    Column(Modifier.weight(1f)) {
                        AppText(
                            comment.authorName
                                ?: stringResource(R.string.wall_unknown_author_fallback),
                            weight = FontWeight.Medium,
                            size = Theme.type.footnote,
                            lineHeight = Theme.type.footnoteLine,
                        )
                        AppText(
                            comment.body,
                            size = Theme.type.footnote,
                            lineHeight = Theme.type.footnoteLine,
                        )
                    }
                }
            }

            if (items.isEmpty()) {
                AppText(
                    stringResource(R.string.wall_no_comments),
                    modifier = Modifier.padding(top = Theme.spacing.sm),
                    size = Theme.type.caption,
                    tone = TextTone.MUTED,
                )
            }
        }

        error?.let {
            AppText(it, tone = TextTone.DANGER, size = Theme.type.caption)
        }

        OutlinedTextField(
            value = draft,
            onValueChange = { draft = it },
            label = { Text(stringResource(R.string.wall_comment_field_label)) },
            // Send sits inside the field rather than under it. Below the field
            // it was hidden by the keyboard the field itself raises: imePadding
            // keeps the focused input visible, not whatever follows it, so the
            // one control needed to finish the reply was the one you could not
            // reach without dismissing the keyboard first.
            trailingIcon = {
                val ready = !sending && draft.isNotBlank()
                IconButton(
                    onClick = {
                        sending = true
                        error = null
                        scope.launch {
                            try {
                                container.repository.addWallComment(
                                    WallCommentCreate(postId = postId, body = draft.trim())
                                )
                                draft = ""
                                load()
                            } catch (e: Throwable) {
                                error = e.message ?: failed
                            } finally {
                                sending = false
                            }
                        }
                    },
                    enabled = ready,
                ) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.Send,
                        contentDescription = stringResource(R.string.wall_comment_send_action),
                        tint = if (ready) Theme.colors.primary else Theme.colors.textMuted,
                    )
                }
            },
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = Theme.spacing.sm),
        )
    }
}

/** The badge a post carries, or null for an ordinary one. */
@Composable
private fun kindOf(type: String): Pair<String, PillTone>? = when (type) {
    "achievement" -> stringResource(R.string.wall_kind_achievement) to PillTone.SUCCESS
    "welcome" -> stringResource(R.string.wall_kind_welcome) to PillTone.INFO
    "announcement" -> stringResource(R.string.wall_kind_announcement) to PillTone.WARNING
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
