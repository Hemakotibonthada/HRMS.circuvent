package com.circuvent.hrms.feature

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.circuvent.hrms.AppContainer
import com.circuvent.hrms.R
import com.circuvent.hrms.core.design.Theme
import com.circuvent.hrms.core.ui.AppCard
import com.circuvent.hrms.core.ui.AppText
import com.circuvent.hrms.core.ui.Avatar
import com.circuvent.hrms.core.ui.Banner
import com.circuvent.hrms.core.ui.BannerTone
import com.circuvent.hrms.core.ui.EmptyState
import com.circuvent.hrms.core.ui.FilterChips
import com.circuvent.hrms.core.ui.SkeletonRows
import com.circuvent.hrms.core.ui.TextTone
import com.circuvent.hrms.core.ui.rememberFormattedDate
import com.circuvent.hrms.core.ui.screenPadding
import com.circuvent.hrms.data.MyDetailsDto
import com.circuvent.hrms.data.TimelineEntryDto

// ═══════════════════════════════════════════════════════════════
// PROFILE — one record, four questions
// ═══════════════════════════════════════════════════════════════
//
// Summary, Timeline, Personal and Job. The split is not decoration: "what is my
// employee code" and "when was I confirmed" and "what is my blood group" are
// asked at different moments by different people, and one long column made all
// three equally hard to find.
//
// ─── On the timeline ───
//
// Keka shows promotions, transfers and role changes. This system now records
// role, team, manager and employment-type changes as they happen, alongside
// joining, confirmation, pay revisions and exit — but nothing before that
// recording started was ever kept, so the list says what it is built from at
// the bottom rather than implying it is complete.
//
// Inventing "Promoted to Senior Engineer" by diffing something would produce a
// plausible history no record supports, on the screen a person is most likely
// to quote back at HR.

private enum class ProfileTab { SUMMARY, TIMELINE, PERSONAL, JOB }

@Composable
private fun tabLabel(tab: ProfileTab): String = stringResource(
    when (tab) {
        ProfileTab.SUMMARY -> R.string.profile_tab_summary
        ProfileTab.TIMELINE -> R.string.profile_tab_timeline
        ProfileTab.PERSONAL -> R.string.profile_tab_personal
        ProfileTab.JOB -> R.string.profile_tab_job
    }
)

private fun pretty(value: String?): String =
    value?.takeIf { it.isNotBlank() }?.replace('_', ' ')?.replaceFirstChar { it.uppercase() } ?: "—"

@Composable
fun ProfileDetailScreen(container: AppContainer) {
    var tab by remember { mutableStateOf(ProfileTab.SUMMARY) }
    var details by remember { mutableStateOf<Loaded<MyDetailsDto>>(Loaded.Loading) }
    var timeline by remember { mutableStateOf<Loaded<Pair<List<TimelineEntryDto>, String>>>(Loaded.Loading) }

    LaunchedEffect(Unit) {
        details = try {
            Loaded.Ready(container.repository.myDetails())
        } catch (e: Throwable) {
            failureOf("Your record", e)
        }
    }

    // Only fetched when the tab is opened. Most visits are to Summary, and the
    // timeline reads a second table to answer a question nobody asked.
    LaunchedEffect(tab) {
        if (tab != ProfileTab.TIMELINE || timeline is Loaded.Ready) return@LaunchedEffect
        timeline = try {
            val r = container.repository.myTimeline()
            Loaded.Ready(r.items to r.note)
        } catch (e: Throwable) {
            failureOf("Your history", e)
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = screenPadding(),
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm),
    ) {
        item {
            when (val current = details) {
                is Loaded.Loading -> SkeletonRows(count = 4, rowHeight = 72.dp)
                is Loaded.Failed ->
                    Banner(BannerTone.ERROR, current.title, description = current.description)

                is Loaded.Ready -> {
                    val d = current.value
                    Column(verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm)) {
                        IdentityCard(d)

                        FilterChips(
                            options = ProfileTab.entries.toList(),
                            selected = tab,
                            label = { tabLabel(it) },
                            onSelect = { tab = it },
                        )

                        when (tab) {
                            ProfileTab.SUMMARY -> SummaryTab(d)
                            ProfileTab.TIMELINE -> TimelineTab(timeline)
                            ProfileTab.PERSONAL -> PersonalTab(d)
                            ProfileTab.JOB -> JobTab(d)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun IdentityCard(d: MyDetailsDto) {
    AppCard {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Theme.spacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Avatar(name = "${d.firstName} ${d.lastName}".trim(), size = 56.dp)
            Column(Modifier.weight(1f)) {
                AppText(
                    "${d.firstName} ${d.lastName}".trim(),
                    weight = FontWeight.SemiBold,
                    size = Theme.type.title3,
                    lineHeight = Theme.type.title3Line,
                )
                AppText(
                    listOfNotNull(
                        d.designation?.takeIf { it.isNotBlank() },
                        d.departmentName?.takeIf { it.isNotBlank() },
                    ).joinToString(" · ").ifBlank { "—" },
                    tone = TextTone.MUTED,
                    size = Theme.type.footnote,
                    lineHeight = Theme.type.footnoteLine,
                )
                d.employeeCode?.takeIf { it.isNotBlank() }?.let {
                    AppText(it, tone = TextTone.MUTED, size = Theme.type.caption)
                }
            }
        }
    }
}

/** A label and a value, the shape every tab below is made of. */
@Composable
private fun Fact(label: String, value: String) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = Theme.spacing.xs),
        verticalAlignment = Alignment.Top,
    ) {
        AppText(
            label,
            modifier = Modifier.weight(1f),
            tone = TextTone.MUTED,
            size = Theme.type.footnote,
            lineHeight = Theme.type.footnoteLine,
        )
        AppText(
            value,
            modifier = Modifier.weight(1.3f),
            size = Theme.type.footnote,
            lineHeight = Theme.type.footnoteLine,
            weight = FontWeight.Medium,
        )
    }
}

@Composable
private fun SummaryTab(d: MyDetailsDto) {
    AppCard {
        Fact(stringResource(R.string.profile_field_work_email), d.workEmail ?: "—")
        Fact(stringResource(R.string.profile_field_phone), d.phone ?: "—")
        Fact(stringResource(R.string.profile_field_department), d.departmentName ?: "—")
        Fact(stringResource(R.string.profile_field_manager), d.managerName ?: "—")
        Fact(
            stringResource(R.string.profile_field_joined),
            d.joinDate?.let { rememberFormattedDate(it) } ?: "—",
        )
    }
}

@Composable
private fun PersonalTab(d: MyDetailsDto) {
    AppCard {
        Fact(
            stringResource(R.string.profile_field_date_of_birth),
            d.dateOfBirth?.let { rememberFormattedDate(it) } ?: "—",
        )
        Fact(stringResource(R.string.profile_field_blood_group), d.bloodGroup ?: "—")
        Fact(stringResource(R.string.profile_field_marital_status), pretty(d.maritalStatus))
        Fact(stringResource(R.string.profile_field_personal_email), d.personalEmail ?: "—")
        Fact(stringResource(R.string.profile_field_phone), d.phone ?: "—")
        Fact(
            stringResource(R.string.profile_field_address),
            listOfNotNull(
                d.addressLine1?.takeIf { it.isNotBlank() },
                d.city?.takeIf { it.isNotBlank() },
                d.state?.takeIf { it.isNotBlank() },
                d.postalCode?.takeIf { it.isNotBlank() },
            ).joinToString(", ").ifBlank { "—" },
        )
    }

    AppText(
        stringResource(R.string.profile_personal_editable_hint),
        modifier = Modifier.padding(top = Theme.spacing.xs),
        tone = TextTone.MUTED,
        size = Theme.type.caption,
        lineHeight = Theme.type.captionLine,
    )
}

@Composable
private fun JobTab(d: MyDetailsDto) {
    AppCard {
        Fact(stringResource(R.string.profile_field_designation), d.designation ?: "—")
        Fact(stringResource(R.string.profile_field_department), d.departmentName ?: "—")
        Fact(stringResource(R.string.profile_field_manager), d.managerName ?: "—")
        Fact(stringResource(R.string.profile_field_employment_type), pretty(d.employmentType))
        Fact(
            stringResource(R.string.profile_field_joined),
            d.joinDate?.let { rememberFormattedDate(it) } ?: "—",
        )
        Fact(
            stringResource(R.string.profile_field_confirmed),
            d.confirmationDate?.let { rememberFormattedDate(it) } ?: "—",
        )
        Fact(stringResource(R.string.profile_field_employee_code), d.employeeCode ?: "—")
    }

    AppText(
        stringResource(R.string.profile_job_readonly_hint),
        modifier = Modifier.padding(top = Theme.spacing.xs),
        tone = TextTone.MUTED,
        size = Theme.type.caption,
        lineHeight = Theme.type.captionLine,
    )
}

@Composable
private fun TimelineTab(state: Loaded<Pair<List<TimelineEntryDto>, String>>) {
    when (state) {
        is Loaded.Loading -> SkeletonRows(count = 3, rowHeight = 64.dp)
        is Loaded.Failed -> Banner(BannerTone.ERROR, state.title, description = state.description)
        is Loaded.Ready -> {
            val (items, note) = state.value

            if (items.isEmpty()) {
                EmptyState(
                    title = stringResource(R.string.profile_timeline_empty_title),
                    description = stringResource(R.string.profile_timeline_empty_description),
                )
                return
            }

            Column {
                items.forEachIndexed { index, entry ->
                    Row(Modifier.fillMaxWidth()) {
                        // A dot and a rule, so the entries read as one thread
                        // rather than a stack of unrelated cards.
                        Column(
                            Modifier.width(24.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Box(
                                Modifier
                                    .padding(top = Theme.spacing.md)
                                    .size(9.dp)
                                    .clip(CircleShape)
                                    .background(Theme.colors.primary)
                            )
                            if (index != items.lastIndex) {
                                Box(
                                    Modifier
                                        .padding(top = 2.dp)
                                        .width(2.dp)
                                        .height(56.dp)
                                        .background(Theme.colors.borderSubtle)
                                )
                            }
                        }

                        Column(
                            Modifier
                                .weight(1f)
                                .padding(start = Theme.spacing.sm, bottom = Theme.spacing.sm)
                        ) {
                            AppCard {
                                AppText(entry.title, weight = FontWeight.SemiBold)
                                AppText(
                                    rememberFormattedDate(entry.date),
                                    tone = TextTone.MUTED,
                                    size = Theme.type.caption,
                                    lineHeight = Theme.type.captionLine,
                                )
                                entry.detail?.takeIf { it.isNotBlank() }?.let {
                                    AppText(
                                        it,
                                        modifier = Modifier.padding(top = Theme.spacing.xs),
                                        size = Theme.type.footnote,
                                        lineHeight = Theme.type.footnoteLine,
                                    )
                                }
                            }
                        }
                    }
                }

                // What the list is made of, said plainly. Without it a short
                // timeline reads as "nothing happened" rather than "this system
                // does not keep that".
                AppText(
                    note,
                    modifier = Modifier.padding(top = Theme.spacing.sm),
                    tone = TextTone.MUTED,
                    size = Theme.type.caption,
                    lineHeight = Theme.type.captionLine,
                )
            }
        }
    }
}
