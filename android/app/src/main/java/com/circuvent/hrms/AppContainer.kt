package com.circuvent.hrms

import android.content.Context
import com.circuvent.hrms.data.AppRepository
import com.circuvent.hrms.data.auth.TokenStore
import com.circuvent.hrms.data.net.ApiClient
import com.circuvent.hrms.data.queue.OfflineQueue

/**
 * Construction, in one place.
 *
 * No dependency-injection framework. There are four objects, each with one
 * instance, and Hilt would add an annotation processor, a compiler plugin and
 * a version to keep in step with Kotlin for a graph that fits in this file.
 * When the graph grows past what a reader can hold, that is the moment to
 * reconsider — not before.
 */
class AppContainer(context: Context) {

    private val appContext = context.applicationContext

    val tokens: TokenStore by lazy { TokenStore(appContext) }

    val queue: OfflineQueue by lazy { OfflineQueue(appContext) }

    /**
     * Set when the client discovers the session is gone and cannot be
     * recovered. The UI observes it and returns to sign-in.
     */
    var onSignedOut: () -> Unit = {}

    val api: ApiClient by lazy {
        ApiClient(
            // From BuildConfig, fixed at build time. A release build cannot be
            // repointed at a staging database by anything on the device.
            baseUrl = BuildConfig.API_BASE_URL,
            tokens = tokens,
            onSignedOut = {
                tokens.clearSession()
                onSignedOut()
            },
        )
    }

    val repository: AppRepository by lazy { AppRepository(api) }
}
