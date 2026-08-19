package com.circuvent.hrms.data

import kotlinx.serialization.Serializable

/**
 * A post on the company wall.
 *
 * Field names match the web dashboard's `WallPost` exactly, because both read
 * and write the same `socialPosts` documents. A phone that invented its own
 * names would write posts the dashboard could not render, and the two would
 * quietly stop showing the same wall.
 *
 * Everything except the id has a default. These are free-form documents with no
 * schema behind them, so a post written by an older build — or by hand — is
 * missing fields rather than malformed, and dropping the whole feed because one
 * post has no `department` would be the wrong trade.
 */
@Serializable
data class WallPostDto(
    val id: String,
    val author: String = "",
    val department: String = "",
    val content: String = "",
    val tags: List<String> = emptyList(),
    val likes: Int = 0,
    val comments: Int = 0,
    val shares: Int = 0,
    val createdAt: String = "",
    val liked: Boolean = false,
    /** "post", "achievement", "welcome" or "announcement". */
    val type: String = "post",
)

@Serializable
data class WallResponse(
    val items: List<WallPostDto> = emptyList(),
    val count: Int = 0,
)
