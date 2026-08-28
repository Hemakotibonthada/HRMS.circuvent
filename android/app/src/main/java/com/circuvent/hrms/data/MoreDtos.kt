package com.circuvent.hrms.data

import kotlinx.serialization.Serializable

// ═══════════════════════════════════════════════════════════════
// DTOs — learning, benefits, assets, referrals, check-ins,
//        workflow approvals, shift swaps
// ═══════════════════════════════════════════════════════════════
// Every field defaulted, for the same reason as the rest: a response that omits
// something must not crash a build that predates it.

// ─── Learning ────────────────────────────────────────────────

@Serializable
data class CourseDto(
    val id: String,
    val title: String = "",
    val code: String = "",
    val description: String? = null,
    val category: String? = null,
    val format: String = "",
    val durationMinutes: Int? = null,
    val skills: List<String> = emptyList(),
    val isMandatory: Boolean = false,
    val moduleCount: Int? = null,
    val enrolmentState: String? = null,
    val progressPercent: Int? = null,
    /** Why this course cannot be started — usually an unmet prerequisite. */
    val unavailableReason: String? = null,
)

@Serializable
data class CoursesResponse(val courses: List<CourseDto> = emptyList())

@Serializable
data class ModuleDto(
    val id: String,
    val title: String = "",
    val sequence: Int = 0,
    val contentType: String = "",
    val durationMinutes: Int? = null,
    val isOptional: Boolean = false,
    val isCompleted: Boolean = false,
)

@Serializable
data class EnrolmentDto(
    val id: String,
    val courseId: String = "",
    val courseTitle: String? = null,
    val state: String = "",
    val progressPercent: Int = 0,
    val scorePercent: Int? = null,
    val attempts: Int = 0,
    val dueOn: String? = null,
    val expiresOn: String? = null,
    val completedAt: String? = null,
)

@Serializable
data class CourseDetailResponse(
    val course: CourseDto,
    val modules: List<ModuleDto> = emptyList(),
    val enrolment: EnrolmentDto? = null,
)

@Serializable
data class EnrolmentsResponse(val enrolments: List<EnrolmentDto> = emptyList())

// ─── Benefits ────────────────────────────────────────────────

@Serializable
data class BenefitPlanDto(
    val id: String,
    val name: String = "",
    val benefitType: String = "",
    val provider: String? = null,
    val description: String? = null,
    val employerContribution: Double = 0.0,
    val employeeContribution: Double = 0.0,
    val coverageAmount: Double? = null,
    val currency: String = "INR",
    val allowsDependants: Boolean = false,
    val isAutoEnrolled: Boolean = false,
    val isEligible: Boolean? = null,
    val unavailableReason: String? = null,
)

@Serializable
data class BenefitPlansResponse(val plans: List<BenefitPlanDto> = emptyList())

@Serializable
data class BenefitEnrolmentDto(
    val id: String,
    val planId: String = "",
    val planName: String? = null,
    val status: String = "",
    val planYear: Int = 0,
    val coverageFrom: String? = null,
    val coverageTo: String? = null,
    val employeeCost: Double = 0.0,
    val employerCost: Double = 0.0,
    val dependantIds: List<String> = emptyList(),
)

@Serializable
data class BenefitEnrolmentsResponse(val enrolments: List<BenefitEnrolmentDto> = emptyList())

@Serializable
data class DependantDto(
    val id: String,
    val fullName: String = "",
    val relation: String = "",
    val dateOfBirth: String? = null,
    val isNominee: Boolean = false,
    val nomineeSharePercent: Int? = null,
)

@Serializable
data class DependantsResponse(val dependants: List<DependantDto> = emptyList())

// ─── Assets ──────────────────────────────────────────────────

@Serializable
data class AssetDto(
    val id: String,
    val assetTag: String = "",
    val name: String = "",
    val category: String = "",
    val serialNumber: String? = null,
    val state: String = "",
    val condition: String = "",
    val purchaseDate: String? = null,
    val warrantyExpiresOn: String? = null,
    val isUnderWarranty: Boolean? = null,
    val warrantyExpiringSoon: Boolean? = null,
    val nextServiceDue: String? = null,
)

@Serializable
data class AssetsResponse(val assets: List<AssetDto> = emptyList())

// ─── Referrals ───────────────────────────────────────────────

@Serializable
data class ReferralDto(
    val id: String,
    val candidateName: String = "",
    val candidateEmail: String = "",
    val positionTitle: String = "",
    val status: String = "",
    val payoutStatus: String = "",
    val rejectionReason: String? = null,
    val submittedAt: String = "",
)

@Serializable
data class ReferralPageDto(val items: List<ReferralDto> = emptyList(), val total: Int = 0)

/**
 * Referral statistics.
 *
 * `bonusPaid` and `bonusPending` are **absent** for an ordinary employee — the
 * server strips them rather than zeroing them. They are nullable here for that
 * reason, and the screen must render their absence as nothing at all rather
 * than as a bonus of zero.
 */
@Serializable
data class ReferralStatsDto(
    val total: Int = 0,
    val hired: Int = 0,
    val inPipeline: Int = 0,
    val conversionPercent: Double = 0.0,
    val bonusPaid: Double? = null,
    val bonusPending: Double? = null,
)

// ─── Check-ins ───────────────────────────────────────────────

@Serializable
data class AgreedActionDto(val description: String = "", val dueOn: String? = null)

@Serializable
data class CheckInDto(
    val id: String,
    val heldOn: String = "",
    val employeeNotes: String? = null,
    val managerNotes: String? = null,
    val moodRating: Int? = null,
    val agreedActions: List<AgreedActionDto> = emptyList(),
)

@Serializable
data class CheckInsResponse(val checkIns: List<CheckInDto> = emptyList())

// ─── Workflow approvals ──────────────────────────────────────

@Serializable
data class PendingApprovalDto(
    val instanceId: String,
    val entityType: String = "",
    val entityId: String = "",
    val stepName: String = "",
    val dueAt: String? = null,
    val isOverdue: Boolean = false,
)

@Serializable
data class PendingApprovalsResponse(
    val pending: List<PendingApprovalDto> = emptyList(),
    val counts: ApprovalCounts = ApprovalCounts(),
)

@Serializable
data class ApprovalCounts(val total: Int = 0, val overdue: Int = 0)

// ─── Shift swaps ─────────────────────────────────────────────

@Serializable
data class SwapDto(
    val id: String,
    val assignmentId: String = "",
    val requestedById: String = "",
    val targetEmployeeId: String? = null,
    val status: String = "",
    val reason: String? = null,
    val rejectionReason: String? = null,
)

@Serializable
data class SwapsResponse(val swaps: List<SwapDto> = emptyList())
