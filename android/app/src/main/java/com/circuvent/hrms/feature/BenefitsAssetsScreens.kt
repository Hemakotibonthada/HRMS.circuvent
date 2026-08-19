package com.circuvent.hrms.feature

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.circuvent.hrms.AppContainer
import com.circuvent.hrms.core.design.Theme
import com.circuvent.hrms.core.ui.AppCard
import com.circuvent.hrms.core.ui.AppText
import com.circuvent.hrms.core.ui.Banner
import com.circuvent.hrms.core.ui.BannerTone
import com.circuvent.hrms.core.ui.EmptyState
import com.circuvent.hrms.core.ui.PillTone
import com.circuvent.hrms.core.ui.SkeletonRows
import com.circuvent.hrms.core.ui.StatusPill
import com.circuvent.hrms.core.ui.TextTone
import com.circuvent.hrms.core.ui.screenPadding
import com.circuvent.hrms.data.AssetDto
import com.circuvent.hrms.data.BenefitEnrolmentDto
import com.circuvent.hrms.data.BenefitPlanDto
import com.circuvent.hrms.data.CheckInDto
import com.circuvent.hrms.data.DependantDto

private fun readableWord(value: String): String =
    value.replace('_', ' ').trim().replaceFirstChar { it.uppercase() }

/**
 * Benefits.
 *
 * Three things, in the order somebody asks about them: what am I on, what could
 * I be on, and who is covered.
 *
 * Electing a plan is deliberately *not* offered here. The server accepts an
 * election only inside an enrolment window and only with a life event outside
 * one, and getting that wrong on a phone means telling somebody they have cover
 * they do not have. Read on mobile, elect on the web, where the window and the
 * cost comparison are on screen together.
 */
@Composable
fun BenefitsScreen(container: AppContainer) {
    var state by remember {
        mutableStateOf<Loaded<Triple<List<BenefitEnrolmentDto>, List<BenefitPlanDto>, List<DependantDto>>>>(
            Loaded.Loading
        )
    }

    LaunchedEffect(Unit) {
        state = try {
            Loaded.Ready(
                Triple(
                    container.repository.benefitEnrolments(),
                    container.repository.benefitPlans(),
                    container.repository.dependants(),
                )
            )
        } catch (e: Throwable) {
            failureOf("Your benefits", e)
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = screenPadding(),
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm),
    ) {
        item {
            when (val current = state) {
                is Loaded.Loading -> SkeletonRows(count = 4, rowHeight = 88.dp)
                is Loaded.Failed -> Banner(BannerTone.ERROR, current.title, description = current.description)
                is Loaded.Ready -> {
                    val (enrolments, plans, dependants) = current.value
                    if (enrolments.isEmpty() && plans.isEmpty() && dependants.isEmpty()) {
                        EmptyState(
                            title = "No benefits set up",
                            description = "Plans your employer offers, and anything you are enrolled in, appear here.",
                        )
                    } else {
                        Column {
                            SectionLabel("Your cover")
                            if (enrolments.isEmpty()) {
                                AppText(
                                    "You are not enrolled in any plan.",
                                    size = Theme.type.footnote,
                                    lineHeight = Theme.type.footnoteLine,
                                    tone = TextTone.MUTED,
                                )
                            }
                        }
                    }
                }
            }
        }

        (state as? Loaded.Ready)?.value?.let { (enrolments, plans, dependants) ->
            items(enrolments, key = { it.id }) { enrolment ->
                AppCard(
                    contentDescription = "${enrolment.planName ?: "Plan"}, ${readableWord(enrolment.status)}",
                ) {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        AppText(enrolment.planName ?: "Plan", weight = FontWeight.Medium)
                        StatusPill(
                            readableWord(enrolment.status),
                            when (enrolment.status) {
                                "active" -> PillTone.SUCCESS
                                "waived" -> PillTone.NEUTRAL
                                "pending" -> PillTone.WARNING
                                else -> PillTone.NEUTRAL
                            },
                        )
                    }
                    AppText(
                        listOfNotNull(
                            "Plan year ${enrolment.planYear}",
                            enrolment.coverageFrom?.let { "from $it" },
                        ).joinToString(" · "),
                        size = Theme.type.caption,
                        lineHeight = Theme.type.captionLine,
                        tone = TextTone.MUTED,
                    )
                    if (enrolment.employeeCost > 0) {
                        AppText(
                            "You pay ₹%,.2f".format(enrolment.employeeCost),
                            size = Theme.type.footnote,
                            lineHeight = Theme.type.footnoteLine,
                        )
                    }
                }
            }

            if (plans.isNotEmpty()) {
                item { SectionLabel("Available plans") }
                items(plans, key = { it.id }) { plan ->
                    AppCard(muted = plan.isEligible == false) {
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            AppText(plan.name, weight = FontWeight.Medium, maxLines = 2)
                            if (plan.isAutoEnrolled) StatusPill("Automatic", PillTone.INFO)
                        }
                        AppText(
                            listOfNotNull(
                                readableWord(plan.benefitType),
                                plan.provider,
                                plan.coverageAmount?.let { "cover ₹%,.0f".format(it) },
                            ).joinToString(" · "),
                            size = Theme.type.caption,
                            lineHeight = Theme.type.captionLine,
                            tone = TextTone.MUTED,
                        )
                        plan.unavailableReason?.let {
                            AppText(
                                it,
                                size = Theme.type.caption,
                                lineHeight = Theme.type.captionLine,
                                tone = TextTone.WARNING,
                            )
                        }
                    }
                }

                item {
                    // Said rather than left as a missing button. Somebody who
                    // came here to enrol needs to know where to go, not to
                    // conclude the app is broken.
                    Banner(
                        BannerTone.INFO,
                        "Enrolling is done on the web",
                        description = "Enrolment windows and the cost comparison need a bigger screen than this one. Sign in at hrms.circuvent.com.",
                    )
                }
            }

            if (dependants.isNotEmpty()) {
                item { SectionLabel("Dependants") }
                items(dependants, key = { it.id }) { dependant ->
                    AppCard(
                        contentDescription = "${dependant.fullName}, ${readableWord(dependant.relation)}",
                    ) {
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            AppText(dependant.fullName, weight = FontWeight.Medium)
                            if (dependant.isNominee) StatusPill("Nominee", PillTone.INFO)
                        }
                        AppText(
                            listOfNotNull(
                                readableWord(dependant.relation),
                                dependant.dateOfBirth,
                                dependant.nomineeSharePercent?.let { "$it% share" },
                            ).joinToString(" · "),
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

/**
 * The equipment issued to me.
 *
 * Filtered to `assigned`, so this is what is actually in somebody's possession
 * rather than everything the company owns. The asset history route is
 * manager-only, so no row here opens one — a tap that always returns 403 reads
 * as a broken app rather than as a boundary.
 */
@Composable
fun AssetsScreen(container: AppContainer) {
    var state by remember { mutableStateOf<Loaded<List<AssetDto>>>(Loaded.Loading) }

    LaunchedEffect(Unit) {
        state = try {
            Loaded.Ready(container.repository.myAssets())
        } catch (e: Throwable) {
            failureOf("Your equipment", e)
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = screenPadding(),
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm),
    ) {
        item {
            when (val current = state) {
                is Loaded.Loading -> SkeletonRows(count = 3, rowHeight = 84.dp)
                is Loaded.Failed -> Banner(BannerTone.ERROR, current.title, description = current.description)
                is Loaded.Ready -> if (current.value.isEmpty()) {
                    EmptyState(
                        title = "Nothing issued to you",
                        description = "Laptops, phones and other equipment assigned to you appear here.",
                    )
                }
            }
        }

        (state as? Loaded.Ready)?.value?.let { assets ->
            items(assets, key = { it.id }) { asset ->
                AppCard(
                    contentDescription = "${asset.name}, tag ${asset.assetTag}, ${readableWord(asset.condition)}",
                ) {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        AppText(asset.name, weight = FontWeight.Medium, maxLines = 2)
                        StatusPill(readableWord(asset.condition), PillTone.NEUTRAL)
                    }
                    AppText(
                        listOfNotNull(
                            asset.assetTag,
                            readableWord(asset.category),
                            asset.serialNumber,
                        ).joinToString(" · "),
                        size = Theme.type.caption,
                        lineHeight = Theme.type.captionLine,
                        tone = TextTone.MUTED,
                    )

                    // Warranty is the one fact on this card somebody acts on:
                    // it is the difference between reporting a fault today and
                    // paying for it next week.
                    when {
                        asset.warrantyExpiringSoon == true -> AppText(
                            "Warranty expires ${asset.warrantyExpiresOn ?: "soon"}",
                            size = Theme.type.caption,
                            lineHeight = Theme.type.captionLine,
                            tone = TextTone.WARNING,
                        )
                        asset.isUnderWarranty == true -> AppText(
                            "Under warranty until ${asset.warrantyExpiresOn ?: "—"}",
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

/**
 * Check-ins with my manager.
 *
 * Private manager notes are not sent to the employee — the server withholds
 * them, structurally. Their absence is therefore normal and is not reported as
 * a missing field; a screen that showed "Private notes: —" would invite
 * somebody to ask why they are empty.
 */
@Composable
fun CheckInsScreen(container: AppContainer) {
    var state by remember { mutableStateOf<Loaded<List<CheckInDto>>>(Loaded.Loading) }

    LaunchedEffect(Unit) {
        state = try {
            Loaded.Ready(container.repository.checkIns())
        } catch (e: Throwable) {
            failureOf("Your check-ins", e)
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = screenPadding(),
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm),
    ) {
        item {
            when (val current = state) {
                is Loaded.Loading -> SkeletonRows(count = 3, rowHeight = 100.dp)
                is Loaded.Failed -> Banner(BannerTone.ERROR, current.title, description = current.description)
                is Loaded.Ready -> if (current.value.isEmpty()) {
                    EmptyState(
                        title = "No check-ins recorded",
                        description = "Notes and agreed actions from your one-to-ones appear here once your manager records them.",
                    )
                }
            }
        }

        (state as? Loaded.Ready)?.value?.let { checkIns ->
            items(checkIns, key = { it.id }) { checkIn ->
                AppCard {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        AppText(checkIn.heldOn, weight = FontWeight.Medium)
                        checkIn.moodRating?.let { StatusPill("Mood $it of 5", PillTone.NEUTRAL) }
                    }

                    checkIn.managerNotes?.let {
                        AppText(
                            "From your manager",
                            size = Theme.type.caption,
                            lineHeight = Theme.type.captionLine,
                            tone = TextTone.MUTED,
                            modifier = Modifier.padding(top = Theme.spacing.sm),
                        )
                        AppText(it, size = Theme.type.footnote, lineHeight = Theme.type.footnoteLine)
                    }

                    checkIn.employeeNotes?.let {
                        AppText(
                            "Your notes",
                            size = Theme.type.caption,
                            lineHeight = Theme.type.captionLine,
                            tone = TextTone.MUTED,
                            modifier = Modifier.padding(top = Theme.spacing.sm),
                        )
                        AppText(it, size = Theme.type.footnote, lineHeight = Theme.type.footnoteLine)
                    }

                    if (checkIn.agreedActions.isNotEmpty()) {
                        AppText(
                            "Agreed actions",
                            size = Theme.type.caption,
                            lineHeight = Theme.type.captionLine,
                            tone = TextTone.MUTED,
                            modifier = Modifier.padding(top = Theme.spacing.sm),
                        )
                        checkIn.agreedActions.forEach { action ->
                            AppText(
                                "• ${action.description}" + (action.dueOn?.let { " (by $it)" } ?: ""),
                                size = Theme.type.footnote,
                                lineHeight = Theme.type.footnoteLine,
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * A small heading above a group of cards.
 *
 * Internal rather than private: several screens need it and a second copy would
 * drift from this one the first time the spacing changed.
 */
@Composable
internal fun SectionLabel(text: String) {
    AppText(
        text,
        size = Theme.type.footnote,
        lineHeight = Theme.type.footnoteLine,
        weight = FontWeight.SemiBold,
        tone = TextTone.MUTED,
        heading = true,
        modifier = Modifier.padding(top = Theme.spacing.lg),
    )
}
