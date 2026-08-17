package com.circuvent.hrms.feature

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.circuvent.hrms.AppContainer
import com.circuvent.hrms.core.design.Theme
import com.circuvent.hrms.core.ui.AppButton
import com.circuvent.hrms.core.ui.AppCard
import com.circuvent.hrms.core.ui.AppText
import com.circuvent.hrms.core.ui.Banner
import com.circuvent.hrms.core.ui.BannerTone
import com.circuvent.hrms.core.ui.ButtonVariant
import com.circuvent.hrms.core.ui.EmptyState
import com.circuvent.hrms.core.ui.PillTone
import com.circuvent.hrms.core.ui.SkeletonRows
import com.circuvent.hrms.core.ui.StatusPill
import com.circuvent.hrms.core.ui.TextTone
import com.circuvent.hrms.core.ui.screenPadding
import com.circuvent.hrms.data.CourseDetailResponse
import com.circuvent.hrms.data.CourseDto
import com.circuvent.hrms.data.EnrolmentDto
import com.circuvent.hrms.domain.ShiftRules
import kotlinx.coroutines.launch

private fun enrolmentTone(state: String?): PillTone = when (state) {
    "completed", "passed" -> PillTone.SUCCESS
    "in_progress", "enrolled" -> PillTone.INFO
    "overdue", "failed" -> PillTone.DANGER
    "expired" -> PillTone.WARNING
    else -> PillTone.NEUTRAL
}

private fun readable(value: String): String =
    value.replace('_', ' ').trim().replaceFirstChar { it.uppercase() }

/**
 * Learning.
 *
 * Two things share this screen: what somebody is part-way through, and what
 * they could start. In-progress first, because the reason people open a
 * learning app is to finish something rather than to browse.
 *
 * A course the server marks unavailable is shown with its reason rather than
 * hidden. "Complete Fire Safety first" is actionable; a course that silently
 * is not in the list is a support call.
 */
@Composable
fun LearningScreen(container: AppContainer, onOpenCourse: (String) -> Unit) {
    var state by remember {
        mutableStateOf<Loaded<Pair<List<CourseDto>, List<EnrolmentDto>>>>(Loaded.Loading)
    }

    LaunchedEffect(Unit) {
        state = try {
            Loaded.Ready(container.repository.courses() to container.repository.enrolments())
        } catch (e: Throwable) {
            failureOf("Your courses", e)
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = screenPadding(),
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm),
    ) {
        item {
            when (val current = state) {
                is Loaded.Loading -> SkeletonRows(count = 4, rowHeight = 84.dp)
                is Loaded.Failed -> Banner(BannerTone.ERROR, current.title, description = current.description)
                is Loaded.Ready -> {
                    val (courses, enrolments) = current.value
                    if (courses.isEmpty() && enrolments.isEmpty()) {
                        EmptyState(
                            title = "No courses yet",
                            description = "Courses assigned to you, and any you are free to take, appear here.",
                        )
                    } else if (enrolments.any { it.state != "completed" }) {
                        AppText(
                            "In progress",
                            size = Theme.type.footnote,
                            lineHeight = Theme.type.footnoteLine,
                            weight = FontWeight.SemiBold,
                            tone = TextTone.MUTED,
                            heading = true,
                        )
                    }
                }
            }
        }

        (state as? Loaded.Ready)?.value?.let { (courses, enrolments) ->
            val live = enrolments.filter { it.state != "completed" }
            items(live, key = { it.id }) { enrolment ->
                EnrolmentCard(enrolment) { onOpenCourse(enrolment.courseId) }
            }

            val started = enrolments.map { it.courseId }.toSet()
            val available = courses.filter { it.id !in started }

            if (available.isNotEmpty()) {
                item {
                    AppText(
                        "Available",
                        size = Theme.type.footnote,
                        lineHeight = Theme.type.footnoteLine,
                        weight = FontWeight.SemiBold,
                        tone = TextTone.MUTED,
                        heading = true,
                        modifier = Modifier.padding(top = Theme.spacing.lg),
                    )
                }
                items(available, key = { it.id }) { course ->
                    CourseCard(course) { onOpenCourse(course.id) }
                }
            }
        }
    }
}

@Composable
private fun EnrolmentCard(enrolment: EnrolmentDto, onOpen: () -> Unit) {
    AppCard(
        onClick = onOpen,
        contentDescription = "${enrolment.courseTitle ?: "Course"}, " +
            "${enrolment.progressPercent} percent complete, ${readable(enrolment.state)}",
    ) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AppText(enrolment.courseTitle ?: "Course", weight = FontWeight.Medium, maxLines = 2)
            StatusPill(readable(enrolment.state), enrolmentTone(enrolment.state))
        }

        // The bar carries a percentage in words beside it. A progress bar alone
        // is unreadable to a screen reader and imprecise to everyone else.
        LinearProgressIndicator(
            progress = { enrolment.progressPercent / 100f },
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = Theme.spacing.sm),
            color = Theme.colors.primary,
            trackColor = Theme.colors.borderSubtle,
        )
        AppText(
            "${enrolment.progressPercent}% complete" +
                (enrolment.dueOn?.let { " · due $it" } ?: ""),
            size = Theme.type.caption,
            lineHeight = Theme.type.captionLine,
            tone = TextTone.MUTED,
        )
    }
}

@Composable
private fun CourseCard(course: CourseDto, onOpen: () -> Unit) {
    val blocked = course.unavailableReason != null

    AppCard(
        onClick = onOpen,
        muted = blocked,
        contentDescription = "${course.title}${course.unavailableReason?.let { ". $it" } ?: ""}",
    ) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AppText(course.title, weight = FontWeight.Medium, maxLines = 2)
            if (course.isMandatory) StatusPill("Required", PillTone.WARNING)
        }

        AppText(
            listOfNotNull(
                course.category,
                course.durationMinutes?.let { ShiftRules.formatDuration(it) },
                course.moduleCount?.let { "$it modules" },
            ).joinToString(" · "),
            size = Theme.type.caption,
            lineHeight = Theme.type.captionLine,
            tone = TextTone.MUTED,
        )

        // Shown, not hidden. A course that silently is not in the list is a
        // support call; "Complete Fire Safety first" is something to act on.
        course.unavailableReason?.let {
            AppText(
                it,
                size = Theme.type.caption,
                lineHeight = Theme.type.captionLine,
                tone = TextTone.WARNING,
                modifier = Modifier.padding(top = Theme.spacing.xs),
            )
        }
    }
}

/**
 * One course.
 *
 * Marking a module done sends it and then takes the server's recomputed
 * progress. The percentage is weighted by module duration and that arithmetic
 * belongs in one place; a local increment would disagree with it the first time
 * a module's length changed.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CourseDetailScreen(container: AppContainer, courseId: String) {
    var state by remember { mutableStateOf<Loaded<CourseDetailResponse>>(Loaded.Loading) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val scope = rememberCoroutineScope()

    suspend fun load() {
        state = try {
            Loaded.Ready(container.repository.course(courseId))
        } catch (e: Throwable) {
            failureOf("This course", e)
        }
    }

    LaunchedEffect(courseId) { load() }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(screenPadding()),
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.md),
    ) {
        when (val current = state) {
            is Loaded.Loading -> SkeletonRows(count = 4, rowHeight = 70.dp)
            is Loaded.Failed -> Banner(BannerTone.ERROR, current.title, description = current.description)
            is Loaded.Ready -> {
                val course = current.value.course
                val enrolment = current.value.enrolment

                AppText(
                    course.title,
                    size = Theme.type.title3,
                    lineHeight = Theme.type.title3Line,
                    weight = FontWeight.Bold,
                    heading = true,
                )

                FlowRow(horizontalArrangement = Arrangement.spacedBy(Theme.spacing.sm)) {
                    if (course.isMandatory) StatusPill("Required", PillTone.WARNING)
                    enrolment?.let { StatusPill(readable(it.state), enrolmentTone(it.state)) }
                    course.durationMinutes?.let {
                        StatusPill(ShiftRules.formatDuration(it), PillTone.NEUTRAL)
                    }
                }

                course.description?.let { AppText(it) }

                error?.let { Banner(BannerTone.ERROR, "That did not work", description = it) }

                if (enrolment == null) {
                    if (course.unavailableReason != null) {
                        Banner(
                            BannerTone.WARNING,
                            "You cannot start this yet",
                            description = course.unavailableReason,
                        )
                    } else {
                        AppButton(
                            label = "Start this course",
                            busy = busy,
                            onClick = {
                                busy = true
                                error = null
                                scope.launch {
                                    try {
                                        container.repository.enrol(courseId)
                                        load()
                                    } catch (e: Exception) {
                                        error = e.message
                                    } finally {
                                        busy = false
                                    }
                                }
                            },
                        )
                    }
                } else {
                    LinearProgressIndicator(
                        progress = { enrolment.progressPercent / 100f },
                        modifier = Modifier.fillMaxWidth(),
                        color = Theme.colors.primary,
                        trackColor = Theme.colors.borderSubtle,
                    )
                    AppText(
                        "${enrolment.progressPercent}% complete",
                        size = Theme.type.caption,
                        lineHeight = Theme.type.captionLine,
                        tone = TextTone.MUTED,
                    )
                }

                AppText(
                    "Modules",
                    size = Theme.type.footnote,
                    lineHeight = Theme.type.footnoteLine,
                    weight = FontWeight.SemiBold,
                    tone = TextTone.MUTED,
                    heading = true,
                    modifier = Modifier.padding(top = Theme.spacing.md),
                )

                current.value.modules.sortedBy { it.sequence }.forEach { module ->
                    AppCard(
                        muted = module.isCompleted,
                        contentDescription = "${module.title}, " +
                            if (module.isCompleted) "completed" else "not started",
                    ) {
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                AppText(module.title, weight = FontWeight.Medium)
                                AppText(
                                    listOfNotNull(
                                        module.durationMinutes?.let { ShiftRules.formatDuration(it) },
                                        if (module.isOptional) "Optional" else null,
                                    ).joinToString(" · "),
                                    size = Theme.type.caption,
                                    lineHeight = Theme.type.captionLine,
                                    tone = TextTone.MUTED,
                                )
                            }

                            if (module.isCompleted) {
                                // A word, not a tick. A green check alone means
                                // nothing to a screen reader.
                                StatusPill("Done", PillTone.SUCCESS)
                            } else if (enrolment != null) {
                                AppButton(
                                    label = "Mark done",
                                    variant = ButtonVariant.GHOST,
                                    fullWidth = false,
                                    enabled = !busy,
                                    contentDescription = "Mark ${module.title} as done",
                                    onClick = {
                                        busy = true
                                        error = null
                                        scope.launch {
                                            try {
                                                container.repository.completeModule(
                                                    enrolment.id,
                                                    module.id,
                                                    module.durationMinutes,
                                                )
                                                load()
                                            } catch (e: Exception) {
                                                error = e.message
                                            } finally {
                                                busy = false
                                            }
                                        }
                                    },
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
