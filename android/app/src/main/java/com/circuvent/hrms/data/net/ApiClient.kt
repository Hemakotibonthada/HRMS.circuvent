package com.circuvent.hrms.data.net

import com.circuvent.hrms.data.auth.TokenStore
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** The server refused, and said why. */
class ApiException(val status: Int, message: String, val body: String? = null) :
    Exception(message)

/** The request never left the device, or never got an answer. */
class OfflineException(message: String = "No connection") : Exception(message)

/** The session is gone and cannot be recovered without signing in again. */
class SignedOutException : Exception("Signed out")

/**
 * The HTTP client.
 *
 * The interesting part is [refreshOnce]. When an access token expires, several
 * screens usually discover it at the same moment — the app resumes, three
 * requests go out, all three get a 401. Refreshing per request would rotate the
 * refresh token three times; the server treats a reused refresh token as a
 * replay and revokes the whole session family, which is correct of it and
 * signs the user out for opening their phone.
 *
 * So refreshes are single-flight: the first 401 starts a refresh, every other
 * caller awaits the same [Deferred], and they all retry with whatever it
 * produced.
 */
class ApiClient(
    private val baseUrl: String,
    private val tokens: TokenStore,
    private val onSignedOut: () -> Unit,
) {
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    private val http = OkHttpClient.Builder()
        // Short enough that a dead network is reported rather than spun on.
        // Somebody standing at a door waiting to clock in will tap again long
        // before a 60-second timeout expires, and the second tap is how a
        // double punch happens.
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private val refreshLock = Mutex()
    private var inFlightRefresh: Deferred<Boolean>? = null

    suspend fun get(path: String): String = request("GET", path, null)

    suspend fun post(path: String, body: String?, idempotencyKey: String? = null): String =
        request("POST", path, body, idempotencyKey)

    /**
     * Replaces a resource outright.
     *
     * Used where a partial update would be wrong — a tax declaration is saved
     * whole, because a section the employee deleted has to arrive as an absence
     * rather than be merged back in from what the server already had.
     */
    suspend fun put(path: String, body: String?): String = request("PUT", path, body)

    suspend fun patch(path: String, body: String?): String = request("PATCH", path, body)

    private suspend fun request(
        method: String,
        path: String,
        body: String?,
        idempotencyKey: String? = null,
        isRetry: Boolean = false,
    ): String {
        val builder = Request.Builder()
            .url(baseUrl.trimEnd('/') + path)
            .header("Accept", "application/json")
            // Declares this as a native client. The web session is a cookie;
            // this one is a bearer token, and the login route only returns
            // tokens in the body when the caller says it is native.
            //
            // The name and the value both matter and both were wrong: this
            // sent `X-Client: android` while the server reads
            // `x-circuvent-client` and compares it to "native", so the
            // declaration was ignored on every request.
            .header("X-Circuvent-Client", "native")

        tokens.accessToken?.let { builder.header("Authorization", "Bearer $it") }
        idempotencyKey?.let { builder.header("Idempotency-Key", it) }

        val payload = body?.toRequestBody(JSON_MEDIA)
        when (method) {
            "GET" -> builder.get()
            "POST" -> builder.post(payload ?: EMPTY_BODY)
            "PUT" -> builder.put(payload ?: EMPTY_BODY)
            "PATCH" -> builder.patch(payload ?: EMPTY_BODY)
            else -> throw IllegalArgumentException("Unsupported method $method")
        }

        val response = execute(builder.build())

        // Read on the I/O dispatcher, not the caller's.
        //
        // `execute` dispatches the call correctly, but returning the `Response`
        // hands back an unread stream — and `body.string()` is the part that
        // actually touches the socket. Consuming it here meant the read
        // happened on whatever dispatcher the caller used, which for a Compose
        // screen is the main thread, and Android threw
        // NetworkOnMainThreadException on every request. The exception was
        // caught by a generic handler that reported "Something went wrong",
        // so the app looked like it was rejecting valid credentials.
        val (code, text) = withContext(Dispatchers.IO) {
            response.use { it.code to it.body?.string().orEmpty() }
        }

        if (code == 401 && !isRetry) {
            // One attempt, and only one. A retry loop on a 401 is an
            // infinite loop against a server that has revoked the session.
            return if (refreshOnce()) {
                request(method, path, body, idempotencyKey, isRetry = true)
            } else {
                onSignedOut()
                throw SignedOutException()
            }
        }

        if (code !in 200..299) {
            throw ApiException(code, errorMessageFrom(text, code), text)
        }

        return text
    }

    /**
     * Refreshes the session at most once, however many callers ask.
     *
     * The mutex guards only the decision to start one, not the network call —
     * holding a lock across I/O would serialise every caller behind the
     * timeout rather than letting them share the result.
     */
    private suspend fun refreshOnce(): Boolean {
        val existing = refreshLock.withLock {
            inFlightRefresh ?: CoroutineScope(Dispatchers.IO).async { doRefresh() }
                .also { inFlightRefresh = it }
        }

        return try {
            existing.await()
        } finally {
            refreshLock.withLock {
                if (inFlightRefresh === existing) inFlightRefresh = null
            }
        }
    }

    private suspend fun doRefresh(): Boolean {
        val refresh = tokens.refreshToken ?: return false

        val request = Request.Builder()
            .url(baseUrl.trimEnd('/') + "/api/auth/refresh")
            .header("Accept", "application/json")
            .header("X-Client", "android")
            .post("""{"refreshToken":"$refresh"}""".toRequestBody(JSON_MEDIA))
            .build()

        return try {
            execute(request).use { response ->
                if (!response.isSuccessful) return false
                val body = response.body?.string() ?: return false
                val parsed = json.parseToJsonElement(body) as? JsonObject ?: return false

                // The server nests them under `tokens`. The React Native client
                // this replaces read `body.accessToken` and could therefore
                // never have signed anybody in — and its own tests encoded the
                // wrong shape, so they passed.
                val holder = parsed["tokens"] as? JsonObject ?: parsed
                val access = holder["accessToken"]?.jsonPrimitive?.content ?: return false
                val newRefresh = holder["refreshToken"]?.jsonPrimitive?.content

                tokens.save(access, newRefresh)
                true
            }
        } catch (_: OfflineException) {
            // Offline is not signed out. Failing the refresh here and clearing
            // the session would sign somebody out for going through a tunnel.
            false
        } catch (_: IOException) {
            false
        }
    }

    private fun errorMessageFrom(body: String, status: Int): String {
        return try {
            val parsed = json.parseToJsonElement(body) as? JsonObject
            parsed?.get("error")?.jsonPrimitive?.content ?: "Request failed ($status)"
        } catch (_: Exception) {
            "Request failed ($status)"
        }
    }

    /** OkHttp's callback API as a suspending call that respects cancellation. */
    private suspend fun execute(request: Request): Response = withContext(Dispatchers.IO) {
        suspendCancellableCoroutine { continuation ->
            val call = http.newCall(request)
            continuation.invokeOnCancellation { call.cancel() }

            call.enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) {
                    if (continuation.isCancelled) return
                    // Every IOException here is "it did not reach the server or
                    // did not come back", which is the one thing the caller has
                    // to be able to tell apart from a refusal.
                    continuation.resumeWithException(OfflineException(e.message ?: "No connection"))
                }

                override fun onResponse(call: Call, response: Response) {
                    continuation.resume(response)
                }
            })
        }
    }

    private companion object {
        val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
        val EMPTY_BODY = "".toRequestBody(JSON_MEDIA)
    }
}
