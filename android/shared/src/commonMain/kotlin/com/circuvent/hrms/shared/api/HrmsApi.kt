package com.circuvent.hrms.shared.api

import com.circuvent.hrms.shared.model.*
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
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
        }) { response ->
            // The web client keeps its session in httpOnly cookies. A mobile
            // app has no cookie jar it can rely on across process death, so
            // the tokens are read from the response and stored in the
            // platform keystore instead.
            captureTokens(response)
            json.decodeFromString<Session>(response.bodyAsText())
        }

    suspend fun me(): Result<Session> = get("/api/auth/me")

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

    suspend fun punch(
        kind: String,
        latitude: Double?,
        longitude: Double?,
        accuracy: Double?,
    ): Result<AttendanceRecord> =
        request("/api/attendance", method = "POST", body = buildJson {
            put("action", JsonPrimitive(kind))
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
                listOf("items", "data", "results", "notifications", "holidays", "balances")
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

                effective.status.value in 200..299 -> Result.Ok(parse(effective))

                else -> Result.Failed(effective.status.value, errorText(effective))
            }
        } catch (e: Exception) {
            // A phone loses signal constantly. This is an ordinary condition,
            // not an exception the user should see a stack trace for.
            Result.Offline(e.message ?: "No connection")
        }
    }

    private suspend fun send(path: String, method: String, body: JsonObject?): HttpResponse =
        if (method == "GET") {
            client.get("$baseUrl$path") { authorise() }
        } else {
            client.post("$baseUrl$path") {
                authorise()
                contentType(ContentType.Application.Json)
                if (body != null) setBody(body.toString())
            }
        }

    private fun io.ktor.client.request.HttpRequestBuilder.authorise() {
        tokens.accessToken()?.let { header("Authorization", "Bearer $it") }
    }

    private suspend fun refresh(): Boolean {
        val refreshToken = tokens.refreshToken() ?: return false
        return try {
            val response = client.post("$baseUrl/api/auth/refresh") {
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

        val access = obj["accessToken"]?.jsonPrimitive?.contentOrNull
        val refreshValue = obj["refreshToken"]?.jsonPrimitive?.contentOrNull
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
