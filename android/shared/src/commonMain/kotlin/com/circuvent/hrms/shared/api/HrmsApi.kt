package com.circuvent.hrms.shared.api

import com.circuvent.hrms.shared.model.*
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.patch
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * The HRMS API, as both apps see it.
 *
 * One client for both platforms. Ktor supplies the engine — OkHttp on Android,
 * NSURLSession on iOS — so the transport is native on each while the request
 * shapes, the error handling and the session refresh are written once.
 *
 * The alternative, which is what these two apps were heading for, is Retrofit
 * on one side and URLSession on the other, each with its own idea of what a
 * 401 means and its own set of endpoint paths to keep in step by hand.
 */
class HrmsApi(
    private val baseUrl: String,
    private val tokens: TokenStore,
    engineClient: HttpClient? = null,
) {
    private val json = Json {
        ignoreUnknownKeys = true
        // A server that adds a field must not break a shipped app, and a
        // server that omits one it used to send must not either.
        explicitNulls = false
        coerceInputValues = true
    }

    private val client: HttpClient = engineClient ?: HttpClient {
        install(ContentNegotiation) { json(json) }
    }

    sealed interface Result<out T> {
        data class Ok<T>(val value: T) : Result<T>
        data class Failed(val status: Int, val message: String) : Result<Nothing>
        data object Unauthorised : Result<Nothing>
        data class Offline(val message: String) : Result<Nothing>
    }

    // ─── Session ─────────────────────────────────────────────

    suspend fun signIn(email: String, password: String): Result<Session> =
        request("/api/auth/login", method = "POST", body = buildJson {
            put("email", JsonPrimitive(email))
            put("password", JsonPrimitive(password))
            // Without this the server sets cookies and returns no tokens at
            // all: a browser has a cookie jar and is deliberately not handed a
            // JS-readable access token, and this client is neither. Every call
            // after a "successful" sign-in was therefore unauthenticated.
            put("client", JsonPrimitive("native"))
        }) { response ->
            // The web client keeps its session in httpOnly cookies. A native
            // app has no cookie jar it can rely on across process death, so
            // the tokens are read from the response and stored in the
            // platform keystore instead.
            captureTokens(response)
            parseSession(response.bodyAsText())
        }

    suspend fun me(): Result<Session> =
        request("/api/auth/me", method = "GET", body = null) { parseSession(it.bodyAsText()) }

    /**
     * The session out of an auth response.
     *
     * Both `/api/auth/login` and `/api/auth/me` wrap it in `user` and add
     * siblings — `tokens` on one, `expiresAt` on the other. Decoding the whole
     * body as a Session failed with "Fields [id, email] are required ...
     * missing at path: $", which is exactly what signing in on desktop did.
     *
     * The root is still accepted as a fallback, so an endpoint that returns a
     * bare session keeps working.
     */
    private fun parseSession(text: String): Session {
        val root = json.parseToJsonElement(text).jsonObject
        val user = root["user"] ?: root
        return json.decodeFromString<Session>(user.toString())
    }

    suspend fun signOut() {
        runCatching { client.post("$baseUrl/api/auth/logout") { authorise() } }
        tokens.clear()
    }

    // ─── Employee-facing reads ───────────────────────────────

    suspend fun directory(query: String? = null): Result<Page<Employee>> =
        get("/api/employees" + (query?.let { "?search=$it" } ?: ""))

    suspend fun leaveBalances(): Result<List<LeaveBalance>> = getList("/api/leave/balances")

    suspend fun leaveRequests(): Result<Page<LeaveRequest>> = get("/api/leave")

    suspend fun attendance(): Result<Page<AttendanceRecord>> = get("/api/attendance")

    suspend fun payslips(): Result<Page<Payslip>> = get("/api/payroll/payslips")

    suspend fun holidays(): Result<List<Holiday>> = getList("/api/holidays")

    suspend fun announcements(): Result<List<Announcement>> = getList("/api/announcements")

    suspend fun tickets(): Result<Page<HelpdeskTicket>> = get("/api/helpdesk")

    suspend fun expenses(): Result<Page<ExpenseClaim>> = get("/api/expenses")

    suspend fun notifications(): Result<List<NotificationItem>> = getList("/api/notifications")

    suspend fun documents(): Result<List<DocumentSummary>> = getList("/api/documents")

    // ─── Writes ──────────────────────────────────────────────

    suspend fun applyForLeave(
        leaveType: String,
        startDate: String,
        endDate: String,
        reason: String,
        isHalfDay: Boolean = false,
    ): Result<LeaveRequest> =
        request("/api/leave", method = "POST", body = buildJson {
            put("leaveType", JsonPrimitive(leaveType))
            put("startDate", JsonPrimitive(startDate))
            put("endDate", JsonPrimitive(endDate))
            put("reason", JsonPrimitive(reason))
            put("isHalfDay", JsonPrimitive(isHalfDay))
        }) { json.decodeFromString(it.bodyAsText()) }

    /**
     * Clocks in or out.
     *
     * `/api/attendance/clock`, not `/api/attendance`. The latter exports GET
     * only — it is the history list — so this posted into a route with no POST
     * handler and every punch came back 405. It was the shared module's only
     * write path for attendance, which means clocking in has never once worked
     * from iOS.
     *
     * `method` is sent because the server records how a punch was made, and its
     * default is "web". A punch from a phone that files itself as web is a
     * small lie in an attendance record, which is the one place records are
     * meant to be trustworthy.
     */
    suspend fun punch(
        kind: String,
        latitude: Double?,
        longitude: Double?,
        accuracy: Double?,
    ): Result<AttendanceRecord> =
        request("/api/attendance/clock", method = "POST", body = buildJson {
            put("action", JsonPrimitive(kind))
            put("method", JsonPrimitive("mobile"))
            latitude?.let { put("latitude", JsonPrimitive(it)) }
            longitude?.let { put("longitude", JsonPrimitive(it)) }
            accuracy?.let { put("accuracyMetres", JsonPrimitive(it)) }
        }) { json.decodeFromString(it.bodyAsText()) }

    suspend fun raiseTicket(
        subject: String,
        description: String,
        category: String,
        priority: String,
    ): Result<HelpdeskTicket> =
        request("/api/helpdesk", method = "POST", body = buildJson {
            put("subject", JsonPrimitive(subject))
            put("description", JsonPrimitive(description))
            put("category", JsonPrimitive(category))
            put("priority", JsonPrimitive(priority))
        }) { json.decodeFromString(it.bodyAsText()) }

    suspend fun decideLeave(id: String, approve: Boolean, reason: String?): Result<Unit> =
        request("/api/leave/$id/decision", method = "POST", body = buildJson {
            put("action", JsonPrimitive(if (approve) "approve" else "reject"))
            reason?.let { put("reason", JsonPrimitive(it)) }
        }) { }

    // ─── Today's punch, and where it is judged from ──────────

    /** Today's record and the geofence, for the punch button's state. */
    suspend fun clockState(): Result<ClockState> = get("/api/attendance/clock")

    // ─── Team ────────────────────────────────────────────────

    suspend fun teamPulse(): Result<TeamPulse> = get("/api/team/pulse")

    /** Who is in, who is late, who has not arrived. */
    suspend fun teamAttendance(date: String? = null): Result<TeamAttendance> =
        get("/api/team/attendance" + (date?.let { "?date=$it" } ?: ""))

    // ─── People, and saying thank you ────────────────────────

    /**
     * Colleagues by name, for anyone signed in.
     *
     * Distinct from [directory], which calls the HR endpoint and needs an HR
     * role. Most of a company has no role at all, so that one answers 403 to
     * exactly the people trying to look somebody up.
     */
    suspend fun colleagues(query: String? = null): Result<List<Colleague>> =
        getList("/api/directory" + (query?.let { "?search=$it" } ?: ""))

    suspend fun praise(): Result<List<Praise>> = getList("/api/praise")

    suspend fun givePraise(toEmployeeId: String, value: String, message: String): Result<Unit> =
        request("/api/praise", method = "POST", body = buildJson {
            put("toEmployeeId", JsonPrimitive(toEmployeeId))
            put("value", JsonPrimitive(value))
            put("message", JsonPrimitive(message))
        }) { }

    // ─── Your own record ─────────────────────────────────────

    suspend fun myDetails(): Result<MyDetails> = get("/api/employees/me")

    /**
     * Corrects your own details.
     *
     * Only the fields a person owns are sendable. Designation, join date and
     * anything to do with pay are HR's to change, and a client that offered
     * them would be offering an edit the server refuses.
     */
    suspend fun saveMyDetails(
        phone: String?,
        personalEmail: String?,
        dateOfBirth: String?,
        bloodGroup: String?,
        addressLine1: String?,
        city: String?,
        state: String?,
        postalCode: String?,
    ): Result<Unit> =
        request("/api/employees/me", method = "PATCH", body = buildJson {
            phone?.let { put("phone", JsonPrimitive(it)) }
            personalEmail?.let { put("personalEmail", JsonPrimitive(it)) }
            dateOfBirth?.let { put("dateOfBirth", JsonPrimitive(it)) }
            bloodGroup?.let { put("bloodGroup", JsonPrimitive(it)) }
            addressLine1?.let { put("addressLine1", JsonPrimitive(it)) }
            city?.let { put("city", JsonPrimitive(it)) }
            state?.let { put("state", JsonPrimitive(it)) }
            postalCode?.let { put("postalCode", JsonPrimitive(it)) }
        }) { }

    // ─── The wall ────────────────────────────────────────────

    suspend fun wallPosts(): Result<List<WallPost>> = getList("/api/collections/socialPosts")

    suspend fun publishWallPost(content: String): Result<Unit> =
        request("/api/collections/socialPosts", method = "POST", body = buildJson {
            put("content", JsonPrimitive(content))
            put("type", JsonPrimitive("post"))
            put("likes", JsonPrimitive(0))
        }) { }

    suspend fun wallComments(postId: String): Result<List<WallComment>> =
        getList("/api/wall/comments?postId=$postId")

    suspend fun addWallComment(postId: String, body: String): Result<Unit> =
        request("/api/wall/comments", method = "POST", body = buildJson {
            put("postId", JsonPrimitive(postId))
            put("body", JsonPrimitive(body))
        }) { }

    // ─── Money owed ──────────────────────────────────────────

    suspend fun loans(): Result<LoanOverview> = get("/api/loans")

    suspend fun requestLoan(kind: String, amountMinor: Long, months: Int, purpose: String): Result<Unit> =
        request("/api/loans", method = "POST", body = buildJson {
            put("kind", JsonPrimitive(kind))
            put("principalMinor", JsonPrimitive(amountMinor))
            put("months", JsonPrimitive(months))
            put("purpose", JsonPrimitive(purpose))
        }) { }

    // ─── Working elsewhere ───────────────────────────────────

    suspend fun workArrangements(): Result<List<WorkArrangementRequest>> =
        getList("/api/work-arrangements")

    suspend fun requestWorkArrangement(
        kind: String,
        startDate: String,
        endDate: String,
        reason: String?,
        location: String?,
    ): Result<Unit> =
        request("/api/work-arrangements", method = "POST", body = buildJson {
            put("kind", JsonPrimitive(kind))
            put("startDate", JsonPrimitive(startDate))
            put("endDate", JsonPrimitive(endDate))
            reason?.let { put("reason", JsonPrimitive(it)) }
            location?.let { put("location", JsonPrimitive(it)) }
        }) { }

    // ─── Correcting a day ────────────────────────────────────

    suspend fun regularisations(): Result<List<RegularisationRequest>> =
        getList("/api/attendance/regularisation")

    suspend fun requestRegularisation(
        workDate: String,
        clockIn: String?,
        clockOut: String?,
        reason: String,
        note: String?,
    ): Result<Unit> =
        request("/api/attendance/regularisation", method = "POST", body = buildJson {
            put("workDate", JsonPrimitive(workDate))
            clockIn?.let { put("requestedClockIn", JsonPrimitive(it)) }
            clockOut?.let { put("requestedClockOut", JsonPrimitive(it)) }
            put("reason", JsonPrimitive(reason))
            note?.let { put("note", JsonPrimitive(it)) }
        }) { }

    // ─── Deciding ────────────────────────────────────────────

    /**
     * Approving or rejecting anything that is not leave.
     *
     * The word differs by queue and it is not a typo to fix here: leave takes
     * "approve", these take "approved". Absorbing the difference in one place
     * beats every screen remembering which endpoint wants which.
     */
    suspend fun decideWorkArrangement(id: String, approve: Boolean, reason: String?): Result<Unit> =
        request("/api/work-arrangements", method = "PATCH", body = buildJson {
            put("id", JsonPrimitive(id))
            put("status", JsonPrimitive(if (approve) "approved" else "rejected"))
            reason?.let { put("reason", JsonPrimitive(it)) }
        }) { }

    suspend fun decideRegularisation(id: String, approve: Boolean, reason: String?): Result<Unit> =
        request("/api/attendance/regularisation", method = "PATCH", body = buildJson {
            put("id", JsonPrimitive(id))
            put("status", JsonPrimitive(if (approve) "approved" else "rejected"))
            reason?.let { put("reason", JsonPrimitive(it)) }
        }) { }

    // ─── Plumbing ────────────────────────────────────────────

    private suspend inline fun <reified T> get(path: String): Result<T> =
        request(path, method = "GET", body = null) { json.decodeFromString(it.bodyAsText()) }

    /**
     * Reads a list that the API may return either bare or wrapped.
     *
     * Some endpoints answer `[...]`, others `{"items": [...]}` and others
     * `{"notifications": [...]}`. Rather than encode which is which — a list
     * that goes stale the first time an endpoint changes shape — this accepts
     * any of them.
     */
    private suspend inline fun <reified T> getList(path: String): Result<List<T>> =
        request(path, method = "GET", body = null) { response ->
            val text = response.bodyAsText()
            val element = json.parseToJsonElement(text)

            val array = if (element is kotlinx.serialization.json.JsonArray) {
                element
            } else {
                val obj = element.jsonObject
                listOf(
                    "items", "data", "results", "notifications", "holidays",
                    "balances", "documents", "requests", "payslips", "cycles",
                    "pending", "swaps", "assets", "plans", "enrolments",
                    "dependants", "courses", "tickets", "goals",
                )
                    .firstNotNullOfOrNull { obj[it] as? kotlinx.serialization.json.JsonArray }
                    ?: kotlinx.serialization.json.JsonArray(emptyList())
            }

            // Re-encoded and decoded as text rather than resolved through the
            // serializers module, because a reified lookup there does not
            // survive Kotlin/Native's lack of reflection.
            json.decodeFromString<List<T>>(array.toString())
        }

    private suspend fun <T> request(
        path: String,
        method: String,
        body: JsonObject?,
        parse: suspend (HttpResponse) -> T,
    ): Result<T> {
        return try {
            val response = send(path, method, body)

            // One retry after refreshing, and only one: a refresh that keeps
            // failing must surface as a sign-in prompt rather than a loop that
            // drains the battery in the background.
            val effective = if (response.status == HttpStatusCode.Unauthorized && refresh()) {
                send(path, method, body)
            } else {
                response
            }

            when {
                effective.status == HttpStatusCode.Unauthorized -> {
                    tokens.clear()
                    Result.Unauthorised
                }

                effective.status.value in 200..299 ->
                    // Parsing is attempted separately from the transport, so a
                    // response the client cannot read is not reported as a
                    // network failure. It said "could not reach the server"
                    // about a server that had answered perfectly, which sends
                    // somebody to check their wifi over a serialisation bug.
                    try {
                        Result.Ok(parse(effective))
                    } catch (e: Exception) {
                        Result.Failed(
                            effective.status.value,
                            "The server's answer could not be read. ${e.message ?: "Unexpected format"}"
                        )
                    }

                else -> Result.Failed(effective.status.value, errorText(effective))
            }
        } catch (e: Exception) {
            // A phone loses signal constantly. This is an ordinary condition,
            // not an exception the user should see a stack trace for.
            Result.Offline(e.message ?: "No connection")
        }
    }

    private suspend fun send(path: String, method: String, body: JsonObject?): HttpResponse {
        val url = "$baseUrl$path"

        // Every verb the callers actually declare. This used to be "GET or
        // POST", so the two decision routes that take PATCH — approving a work
        // arrangement and approving an attendance correction — were posted
        // instead, landing on the *create* handler with a decision payload.
        return when (method.uppercase()) {
            "GET" -> client.get(url) {
                nativeClient()
                authorise()
            }

            "PATCH" -> client.patch(url) {
                nativeClient()
                authorise()
                contentType(ContentType.Application.Json)
                if (body != null) setBody(body.toString())
            }

            "PUT" -> client.put(url) {
                nativeClient()
                authorise()
                contentType(ContentType.Application.Json)
                if (body != null) setBody(body.toString())
            }

            "DELETE" -> client.delete(url) {
                nativeClient()
                authorise()
            }

            else -> client.post(url) {
                nativeClient()
                authorise()
                contentType(ContentType.Application.Json)
                if (body != null) setBody(body.toString())
            }
        }
    }

    /**
     * Marks the caller as a native client.
     *
     * The login and refresh routes return tokens in the body only when asked:
     * a browser has a cookie jar and is deliberately not handed a JS-readable
     * access token. Without this header those routes set cookies this client
     * cannot keep and return no tokens at all, so a sign-in that looked
     * successful left every later call unauthenticated.
     */
    private fun io.ktor.client.request.HttpRequestBuilder.nativeClient() {
        header("x-circuvent-client", "native")
    }

    private fun io.ktor.client.request.HttpRequestBuilder.authorise() {
        tokens.accessToken()?.let { header("Authorization", "Bearer $it") }
    }

    private suspend fun refresh(): Boolean {
        val refreshToken = tokens.refreshToken() ?: return false
        return try {
            val response = client.post("$baseUrl/api/auth/refresh") {
                nativeClient()
                contentType(ContentType.Application.Json)
                setBody(buildJson { put("refreshToken", JsonPrimitive(refreshToken)) }.toString())
            }
            if (response.status.value in 200..299) {
                captureTokens(response)
                true
            } else {
                false
            }
        } catch (_: Exception) {
            false
        }
    }

    private suspend fun captureTokens(response: HttpResponse) {
        val text = response.bodyAsText()
        val obj = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull() ?: return

        // `/api/auth/login` and `/api/auth/refresh` both nest these under
        // `tokens`. Reading them from the root found nothing, so nothing was
        // ever stored and every later call went out unauthenticated. The root
        // is still checked second, so an endpoint that returns them flat keeps
        // working.
        val holder = (obj["tokens"] as? JsonObject) ?: obj

        val access = holder["accessToken"]?.jsonPrimitive?.contentOrNull
        val refreshValue = holder["refreshToken"]?.jsonPrimitive?.contentOrNull
        if (access != null) tokens.save(access, refreshValue)
    }

    private suspend fun errorText(response: HttpResponse): String {
        val text = runCatching { response.bodyAsText() }.getOrNull() ?: return "Request failed"
        val message = runCatching {
            json.parseToJsonElement(text).jsonObject["error"]?.jsonPrimitive?.contentOrNull
        }.getOrNull()
        return message ?: "Request failed"
    }

    private fun buildJson(build: MutableMap<String, kotlinx.serialization.json.JsonElement>.() -> Unit): JsonObject {
        val map = mutableMapOf<String, kotlinx.serialization.json.JsonElement>()
        map.build()
        return JsonObject(map)
    }
}

private val kotlinx.serialization.json.JsonPrimitive.contentOrNull: String?
    get() = if (this is kotlinx.serialization.json.JsonNull) null else content
