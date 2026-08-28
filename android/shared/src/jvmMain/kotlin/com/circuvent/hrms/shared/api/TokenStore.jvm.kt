package com.circuvent.hrms.shared.api

/**
 * JVM: memory only.
 *
 * The JVM target is not shipped — it exists so the shared logic can be tested
 * on a machine without Xcode, which is most CI runners and every Windows
 * workstation. There is no user to keep signed in, so there is nothing to
 * persist, and writing a token to a file here would be a credential on disk
 * for no benefit.
 */
actual class TokenStore {
    private var access: String? = null
    private var refresh: String? = null

    actual fun accessToken(): String? = access

    actual fun refreshToken(): String? = refresh

    actual suspend fun save(accessToken: String, refreshToken: String?) {
        access = accessToken
        if (refreshToken != null) refresh = refreshToken
    }

    actual suspend fun clear() {
        access = null
        refresh = null
    }
}
