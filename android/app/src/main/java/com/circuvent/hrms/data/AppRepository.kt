package com.circuvent.hrms.data

import com.circuvent.hrms.data.net.ApiClient
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

// ═══════════════════════════════════════════════════════════════
// DTOs
// ═══════════════════════════════════════════════════════════════
// `ignoreUnknownKeys` is on, so a field added by the server does not crash a
// build that predates it. `explicitNulls` is off so an absent field and a null
// one arrive the same way, which is what the API actually does.

@Serializable
data class SessionUser(
    val id: String,
    val email: String,
    val firstName: String = "",
    val lastName: String = "",
    val role: String = "employee",
    val employeeId: String? = null,
    val organizationId: String = "",
)

@Serializable
private data class MeResponse(val user: SessionUser)

@Serializable
data class AttendanceRecordDto(
    val workDate: String = "",
    val clockInAt: String? = null,
    val clockOutAt: String? = null,
    val status: String = "",
    val workedMinutes: Int? = null,
    val lateByMinutes: Int = 0,
    val requiresLocationReview: Boolean = false,
)

@Serializable
data class FenceDto(
    val id: String,
    val name: String,
    val latitude: Double,
    val longitude: Double,
    @SerialName("radiusMetres") val radiusMetres: Double,
)

@Serializable
data class TodayResponse(
    val record: AttendanceRecordDto? = null,
    val fence: FenceDto? = null,
)

@Serializable
data class LeaveRequestDto(
    val id: String,
    val leaveType: String = "",
    val startDate: String = "",
    val endDate: String = "",
    val totalDays: Double = 0.0,
    val isHalfDay: Boolean = false,
    val reason: String = "",
    val status: String = "pending",
)

@Serializable
private data class LeaveListResponse(val items: List<LeaveRequestDto> = emptyList())

@Serializable
data class LeaveBalanceDto(
    val leaveType: String = "",
    val entitled: Double = 0.0,
    val used: Double = 0.0,
    val available: Double = 0.0,
)

@Serializable
private data class BalancesResponse(val balances: List<LeaveBalanceDto> = emptyList())

@Serializable
data class ShiftDto(
    val id: String,
    val shiftDate: String = "",
    val startsAt: String = "",
    val endsAt: String = "",
    val durationMinutes: Int = 0,
    val status: String = "",
    val patternName: String? = null,
    val note: String? = null,
)

@Serializable
private data class ShiftsResponse(val shifts: List<ShiftDto> = emptyList())

@Serializable
data class PayslipDto(
    val id: String,
    val periodMonth: Int? = null,
    val periodYear: Int? = null,
    val gross: Double = 0.0,
    val totalDeductions: Double = 0.0,
    val netPay: Double = 0.0,
    /** Exact whole paise. See [PayslipDetailDto]. */
    val grossMinor: String = "0",
    val totalDeductionsMinor: String = "0",
    val netPayMinor: String = "0",
    val lopDays: Double = 0.0,
    val status: String = "",
)

@Serializable
private data class PayslipsResponse(val payslips: List<PayslipDto> = emptyList())

@Serializable
private data class PayslipDetailsResponse(val payslips: List<PayslipDetailDto> = emptyList())

/**
 * Everything the app asks the server for.
 *
 * One class rather than a repository per feature. There are six endpoints and
 * no caching layer; splitting them into six interfaces with six
 * implementations would be structure for its own sake, and the seam that
 * matters — the one between the UI and the network — is already here.
 */
class AppRepository(private val api: ApiClient) {

    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    suspend fun me(): SessionUser =
        json.decodeFromString<MeResponse>(api.get("/api/auth/me")).user

    /**
     * Signs in, and returns the tokens for the caller to store.
     *
     * `native = true` matters: `/api/auth/login` sets a cookie for the web app
     * and only returns tokens in the body when the caller declares itself
     * native. The React Native client this replaces never declared it and read
     * `body.accessToken` rather than `body.tokens.accessToken`, so it could
     * not have signed anybody in — and its own tests encoded the wrong shape,
     * so they passed.
     */
    suspend fun signIn(email: String, password: String, totpCode: String?): Pair<String, String?> {
        val body = buildJsonObject {
            put("email", email)
            put("password", password)
            if (!totpCode.isNullOrBlank()) put("totpCode", totpCode)
            // The server tests `client === "native"`, a string under `client`.
            // This sent `native: true` — the right intent under the wrong key,
            // with the wrong type — so the condition never matched, the
            // response carried no tokens, and sign-in failed with "The server
            // did not return an access token" against an HTTP 200. The comment
            // above described the contract correctly the whole time; only the
            // field name was wrong, which is why reading it never showed it.
            put("client", "native")
        }

        val response = json.parseToJsonElement(api.post("/api/auth/login", body.toString())) as JsonObject
        val tokens = response["tokens"] as? JsonObject ?: response
        val access = tokens["accessToken"]?.jsonPrimitive?.content
            ?: error("The server did not return an access token")
        val refresh = tokens["refreshToken"]?.jsonPrimitive?.content
        return access to refresh
    }

    /**
     * Fetches the options a passkey ceremony needs.
     *
     * Passed to Credential Manager unmodified. The server speaks WebAuthn JSON
     * to this app, to the iOS app and to the browser, so reshaping it here
     * would be the first step towards three clients that disagree.
     */
    suspend fun passkeyLoginOptions(): String = api.get("/api/auth/passkey/login")

    suspend fun passkeyRegisterOptions(): String = api.get("/api/auth/passkey/register")

    /** Signs in with an assertion, returning the tokens as `signIn` does. */
    suspend fun passkeySignIn(fields: Map<String, String>): Pair<String, String?> {
        val body = buildJsonObject {
            for ((key, value) in fields) put(key, value)
            put("client", "native")
        }

        val response =
            json.parseToJsonElement(api.post("/api/auth/passkey/login", body.toString())) as JsonObject
        val tokens = response["tokens"] as? JsonObject ?: response
        val access = tokens["accessToken"]?.jsonPrimitive?.content
            ?: error("The server did not return an access token")
        return access to tokens["refreshToken"]?.jsonPrimitive?.content
    }

    /** Enrols a passkey against the signed-in account. */
    suspend fun passkeyRegister(fields: Map<String, Any>) {
        val body = buildJsonObject {
            for ((key, value) in fields) {
                if (key == "transports") continue
                put(key, value.toString())
            }
        }
        api.post("/api/auth/passkey/register", body.toString())
    }

    suspend fun signOut() {        // Best effort. The local session is cleared whatever this does — a
        // failed sign-out that leaves somebody signed in on their handset is
        // the worse of the two failures.
        runCatching { api.post("/api/auth/logout", null) }
    }

    suspend fun today(): TodayResponse =
        json.decodeFromString(api.get("/api/attendance/clock"))

    suspend fun leaveRequests(): List<LeaveRequestDto> =
        json.decodeFromString<LeaveListResponse>(
            api.get("/api/leave?pageSize=50&sortBy=startDate&sortDirection=desc")
        ).items

    suspend fun leaveBalances(): List<LeaveBalanceDto> =
        json.decodeFromString<BalancesResponse>(api.get("/api/leave/balances")).balances

    suspend fun myShifts(from: String, to: String): List<ShiftDto> =
        json.decodeFromString<ShiftsResponse>(
            api.get("/api/roster/my-shifts?from=$from&to=$to")
        ).shifts

    suspend fun payslips(): List<PayslipDto> =
        json.decodeFromString<PayslipsResponse>(api.get("/api/payroll/payslips")).payslips

    /**
     * One payslip, filtered from the list.
     *
     * There is no `GET /api/payroll/payslips/{id}` route on the server, and
     * inventing a client call to an endpoint that does not exist is how the
     * previous generation's contract mismatches happened. The list is already
     * scoped to the caller and is short.
     */
    suspend fun payslipDetail(id: String): PayslipDetailDto? =
        json.decodeFromString<PayslipDetailsResponse>(api.get("/api/payroll/payslips"))
            .payslips.firstOrNull { it.id == id }

    /** One leave request, filtered from the list, for the same reason. */
    suspend fun leaveRequest(id: String): LeaveRequestDto? =
        leaveRequests().firstOrNull { it.id == id }

    /** Sends a queued operation. The queue owns the retry policy, not this. */
    suspend fun sendQueued(kind: String, payload: String, idempotencyKey: String): String =
        when (kind) {
            "attendance.clock_in", "attendance.clock_out" ->
                api.post("/api/attendance/clock", payload, idempotencyKey)
            "leave.apply" -> api.post("/api/leave", payload, idempotencyKey)
            else -> error("No route for queued operation \"$kind\"")
        }

    // ─── Attendance history ──────────────────────────────────

    /**
     * A month of attendance for one person.
     *
     * The employee id is sent explicitly. `/api/attendance` scopes an ordinary
     * employee to themselves and ignores the parameter, but for a manager it is
     * the *filter*, and omitting it returns the whole organisation. A manager
     * opening their own attendance and being shown everybody's — with no names
     * attached — reads as a broken screen rather than as a permission.
     */
    suspend fun attendance(from: String, to: String, employeeId: String?): List<AttendanceRowDto> {
        val scope = employeeId?.takeIf { UUID.matches(it) }?.let { "&employeeId=$it" } ?: ""
        return json.decodeFromString<AttendancePageDto>(
            api.get("/api/attendance?from=$from&to=$to&pageSize=200$scope")
        ).items
    }

    suspend fun attendanceSummary(month: Int, year: Int, employeeId: String?): AttendanceSummaryDto {
        val scope = employeeId?.takeIf { UUID.matches(it) }?.let { "&employeeId=$it" } ?: ""
        return json.decodeFromString(
            api.get("/api/attendance/summary?month=$month&year=$year$scope")
        )
    }

    // ─── Helpdesk ────────────────────────────────────────────

    suspend fun tickets(): TicketsResponse =
        json.decodeFromString(api.get("/api/helpdesk"))

    suspend fun ticket(id: String): TicketDetailResponse =
        json.decodeFromString(api.get("/api/helpdesk/$id"))

    /**
     * Raises a ticket, immediately.
     *
     * Not queued, which is a departure from the clock-in and leave forms. Those
     * queue because they are records of something that already happened and
     * delay costs nothing. A ticket is a request for somebody's attention now:
     * one written in a basement and delivered three days later arrives after
     * the problem has either resolved itself or become an emergency, and in
     * both cases the SLA clock started at the wrong moment.
     */
    suspend fun raiseTicket(subject: String, body: String, priority: String): TicketDto {
        val payload = buildJsonObject {
            put("subject", subject)
            put("body", body)
            put("priority", priority)
        }
        return json.decodeFromString(api.post("/api/helpdesk", payload.toString()))
    }

    suspend fun commentOnTicket(id: String, body: String) {
        api.post("/api/helpdesk/$id/comments", buildJsonObject { put("body", body) }.toString())
    }

    // ─── Approvals ───────────────────────────────────────────

    /** The whole organisation's pending queue, for a privileged caller. */
    suspend fun pendingLeave(): List<PendingLeaveDto> =
        json.decodeFromString<PendingLeaveResponse>(
            api.get("/api/leave?status=pending&pageSize=100&sortBy=startDate&sortDirection=asc")
        ).items

    /**
     * Approves or rejects, immediately and never offline.
     *
     * An approval is a judgement about current state. One made against a
     * three-day-old cache — after the request was withdrawn, or decided by
     * somebody else — is a decision the manager did not actually make.
     */
    suspend fun decideLeave(id: String, action: String, reason: String?) {
        val payload = buildJsonObject {
            put("action", action)
            if (!reason.isNullOrBlank()) put("reason", reason)
        }
        api.post("/api/leave/$id/decision", payload.toString())
    }

    private companion object {
        val UUID = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
    }

    // ─── Learning ────────────────────────────────────────────
    // Every one of these is self-scoped by the server for an ordinary
    // employee: the `employeeId` parameter is ignored unless the caller is
    // privileged. Nothing here sends it, so nothing here can widen its own
    // scope by accident.

    suspend fun courses(): List<CourseDto> =
        json.decodeFromString<CoursesResponse>(api.get("/api/learning/courses")).courses

    suspend fun course(id: String): CourseDetailResponse =
        json.decodeFromString(api.get("/api/learning/courses/$id"))

    suspend fun enrolments(): List<EnrolmentDto> =
        json.decodeFromString<EnrolmentsResponse>(api.get("/api/learning/enrolments")).enrolments

    suspend fun enrol(courseId: String): EnrolmentDto = json.decodeFromString(
        api.post(
            "/api/learning/enrolments",
            buildJsonObject {
                put("action", "enrol")
                put("courseId", courseId)
            }.toString(),
        )
    )

    /**
     * Marks a module finished.
     *
     * The server recomputes the whole enrolment's progress from its modules and
     * returns it; this does not add a percentage locally. Progress weighted by
     * module duration is the server's arithmetic, and a second implementation
     * on the phone would disagree with it the first time a module's length
     * changed.
     */
    suspend fun completeModule(enrolmentId: String, moduleId: String, minutesSpent: Int?) {
        api.post(
            "/api/learning/enrolments/$enrolmentId/progress",
            buildJsonObject {
                put("moduleId", moduleId)
                if (minutesSpent != null) put("minutesSpent", minutesSpent)
            }.toString(),
        )
    }

    // ─── Benefits ────────────────────────────────────────────

    suspend fun benefitPlans(): List<BenefitPlanDto> =
        json.decodeFromString<BenefitPlansResponse>(api.get("/api/benefits/plans")).plans

    suspend fun benefitEnrolments(): List<BenefitEnrolmentDto> =
        json.decodeFromString<BenefitEnrolmentsResponse>(
            api.get("/api/benefits/enrolments")
        ).enrolments

    suspend fun dependants(): List<DependantDto> =
        json.decodeFromString<DependantsResponse>(api.get("/api/benefits/dependants")).dependants

    suspend fun electBenefit(planId: String, planYear: Int, dependantIds: List<String>) {
        api.post(
            "/api/benefits/enrolments",
            buildJsonObject {
                put("action", "elect")
                put("planId", planId)
                put("planYear", planYear)
                if (dependantIds.isNotEmpty()) {
                    put("dependantIds", JsonArray(dependantIds.map { JsonPrimitive(it) }))
                }
            }.toString(),
        )
    }

    /**
     * Declines a plan, with a reason.
     *
     * The reason is required by the server and is not a formality: a waiver is
     * the record that somebody was offered cover and chose not to take it, and
     * it is the document that gets read when they later say they were never
     * offered it.
     */
    suspend fun waiveBenefit(planId: String, planYear: Int, reason: String) {
        api.post(
            "/api/benefits/enrolments",
            buildJsonObject {
                put("action", "waive")
                put("planId", planId)
                put("planYear", planYear)
                put("reason", reason)
            }.toString(),
        )
    }

    // ─── Income tax ──────────────────────────────────────────

    /**
     * The employee's declaration for a financial year.
     *
     * The server creates an empty one on first read rather than answering 404,
     * because a first-time visitor has not missed a declaration — they simply
     * have not made one, and a blank form is the correct answer to that.
     */
    suspend fun taxDeclaration(financialYear: Int? = null): TaxDeclarationResponse {
        val path =
            if (financialYear == null) "/api/tax/declaration"
            else "/api/tax/declaration?financialYear=$financialYear"
        return json.decodeFromString(api.get(path))
    }

    /**
     * Saves a declaration.
     *
     * Sends every section the employee has entered, not only the changed ones:
     * the server replaces rather than merges, so a section removed on the phone
     * has to arrive as an absence. Merging would leave a withdrawn claim
     * standing for ever.
     */
    suspend fun saveTaxDeclaration(save: TaxDeclarationSave) {
        api.put("/api/tax/declaration", json.encodeToString(TaxDeclarationSave.serializer(), save))
    }

    /**
     * Form 16 Part B for a year.
     *
     * Assembled from approved payroll only, so a year still being processed
     * reports the months it actually covers rather than a projection. Part A
     * comes from TRACES and is not ours to issue.
     */
    suspend fun form16(financialYear: Int? = null): Form16Response {
        val path =
            if (financialYear == null) "/api/tax/form16"
            else "/api/tax/form16?financialYear=$financialYear"
        return json.decodeFromString(api.get(path))
    }

    // ─── Assets ──────────────────────────────────────────────

    /**
     * The assets issued to the caller.
     *
     * `assignedToId` is not sent: the server already scopes an ordinary
     * employee to themselves, and a privileged caller sending nothing gets the
     * whole organisation — which is the right behaviour for an admin console
     * and the wrong one for "my equipment". The state filter keeps it to what
     * is actually in somebody's possession.
     */
    suspend fun myAssets(): List<AssetDto> =
        json.decodeFromString<AssetsResponse>(api.get("/api/assets?state=assigned")).assets

    // ─── Referrals ───────────────────────────────────────────

    suspend fun referrals(): List<ReferralDto> =
        json.decodeFromString<ReferralPageDto>(api.get("/api/referrals?pageSize=50")).items

    suspend fun referralStats(): ReferralStatsDto =
        json.decodeFromString(api.get("/api/referrals/stats"))

    suspend fun refer(
        candidateName: String,
        candidateEmail: String,
        positionTitle: String,
        relationship: String?,
        recommendation: String?,
    ) {
        api.post(
            "/api/referrals",
            buildJsonObject {
                put("candidateName", candidateName)
                put("candidateEmail", candidateEmail)
                put("positionTitle", positionTitle)
                if (!relationship.isNullOrBlank()) put("relationship", relationship)
                if (!recommendation.isNullOrBlank()) put("recommendation", recommendation)
            }.toString(),
        )
    }

    // ─── Check-ins ───────────────────────────────────────────

    suspend fun checkIns(): List<CheckInDto> =
        json.decodeFromString<CheckInsResponse>(api.get("/api/performance/check-ins")).checkIns

    // ─── Workflow approvals ──────────────────────────────────

    suspend fun pendingApprovals(): PendingApprovalsResponse =
        json.decodeFromString(api.get("/api/workflows/pending"))

    /**
     * Approves or rejects a workflow step.
     *
     * A comment is required when rejecting — the server refuses without one,
     * and it is right to: somebody told only "rejected" has nothing to act on.
     */
    suspend fun decideWorkflow(instanceId: String, approved: Boolean, comment: String?) {
        api.post(
            "/api/workflows/$instanceId/decision",
            buildJsonObject {
                put("decision", if (approved) "approved" else "rejected")
                if (!comment.isNullOrBlank()) put("comment", comment)
            }.toString(),
        )
    }

    // ─── Shift swaps ─────────────────────────────────────────

    suspend fun swaps(): List<SwapDto> =
        json.decodeFromString<SwapsResponse>(api.get("/api/roster/swaps")).swaps

    suspend fun requestSwap(assignmentId: String, reason: String?) {
        api.post(
            "/api/roster/swaps",
            buildJsonObject {
                put("assignmentId", assignmentId)
                if (!reason.isNullOrBlank()) put("reason", reason)
            }.toString(),
        )
    }

    suspend fun acceptSwap(swapId: String) {
        api.post("/api/roster/swaps/$swapId", buildJsonObject { put("action", "accept") }.toString())
    }
}
