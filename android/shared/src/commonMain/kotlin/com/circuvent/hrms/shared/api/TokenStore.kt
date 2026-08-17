package com.circuvent.hrms.shared.api

/**
 * Where the session tokens live.
 *
 * `expect`/`actual` rather than a shared implementation, because this is the
 * one place the platforms genuinely differ and must: an access token is a
 * bearer credential for somebody's salary record, and the right home for it is
 * the Android Keystore on one platform and the iOS Keychain on the other.
 * Neither has an equivalent the other can use, and a shared file-based store
 * would be worse than both.
 */
expect class TokenStore {
    fun accessToken(): String?
    fun refreshToken(): String?
    suspend fun save(accessToken: String, refreshToken: String?)
    suspend fun clear()
}

/**
 * A store that keeps nothing beyond the process.
 *
 * Used by the tests, and deliberately not exported to either app: a token that
 * survives only until the app is closed means signing in again every launch,
 * which users respond to by choosing a shorter password.
 */
class InMemoryTokenStore {
    private var access: String? = null
    private var refresh: String? = null

    fun accessToken(): String? = access
    fun refreshToken(): String? = refresh

    fun save(accessToken: String, refreshToken: String?) {
        access = accessToken
        if (refreshToken != null) refresh = refreshToken
    }

    fun clear() {
        access = null
        refresh = null
    }
}
