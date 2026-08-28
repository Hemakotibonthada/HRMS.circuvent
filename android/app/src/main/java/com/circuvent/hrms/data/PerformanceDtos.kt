package com.circuvent.hrms.data

import kotlinx.serialization.Serializable

/**
 * A review cycle, with this employee's goals inside it.
 *
 * Goals arrive with the cycle rather than behind a second call. A cycle with no
 * goals and a cycle whose goals have not loaded yet look identical on screen,
 * and the difference decides whether somebody waits or starts typing.
 */
@Serializable
data class ReviewCycleDto(
    val id: String,
    val name: String = "",
    val periodStart: String = "",
    val periodEnd: String = "",
    /** "active" or "closed". Drafts are not sent. */
    val status: String = "active",
    val selfReviewDueOn: String? = null,
    val includesSelfReview: Boolean = true,
    val goals: List<GoalDto> = emptyList(),
)

/**
 * One goal.
 *
 * [targetValue] and [currentValue] cross the wire as strings. They are numeric
 * in Postgres, and a target of 1000000.05 parsed into a Double on the way to a
 * screen that only ever displays it is a rounding error introduced for nothing.
 */
@Serializable
data class GoalDto(
    val id: String,
    val title: String = "",
    val description: String? = null,
    val category: String? = null,
    val weightPercent: Int = 0,
    val progressPercent: Int = 0,
    val status: String = "not_started",
    val dueDate: String? = null,
    val targetValue: String? = null,
    val currentValue: String? = null,
    val unit: String? = null,
)

@Serializable
data class ReviewCyclesResponse(
    val cycles: List<ReviewCycleDto> = emptyList(),
)

@Serializable
data class GoalProgressUpdate(
    val progressPercent: Int? = null,
    val currentValue: String? = null,
    val status: String? = null,
)

