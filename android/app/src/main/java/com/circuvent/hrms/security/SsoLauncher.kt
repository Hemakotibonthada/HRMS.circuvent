package com.circuvent.hrms.security

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent

/**
 * Federated sign-in, in a Custom Tab.
 *
 * Not a WebView, and the distinction is the whole point. A WebView is hosted
 * by this app, which means this app can read the password typed into the
 * identity provider — exactly what federating the sign-in was supposed to
 * avoid — and cannot see the browser's existing session, so the user is asked
 * to sign in again even though they already have. Google, Microsoft and Okta
 * all refuse to render in one for the first reason.
 *
 * A Custom Tab runs in the user's browser process: it shares cookies, shows
 * the real URL bar, and this app never sees the credentials.
 *
 * The flow is the one the web already implements — OIDC with PKCE, starting at
 * `/api/auth/sso/start`. Nothing about the protocol is reimplemented here;
 * this only opens the tab and receives the redirect.
 */
object SsoLauncher {

    /**
     * The scheme the identity provider redirects back to.
     *
     * Registered in the manifest as an intent filter. An app link on the real
     * domain would be stronger still — a custom scheme can be claimed by
     * another app on the same device — which is why the token exchange happens
     * server-side against a PKCE verifier this app never publishes: a hijacked
     * redirect yields a code that cannot be redeemed.
     */
    const val REDIRECT_SCHEME = "circuvent"
    const val REDIRECT_HOST = "sso"

    fun start(context: Context, baseUrl: String) {
        val url = Uri.parse(baseUrl.trimEnd('/') + "/api/auth/sso/start")
            .buildUpon()
            .appendQueryParameter("client", "android")
            .appendQueryParameter("redirect", "$REDIRECT_SCHEME://$REDIRECT_HOST")
            .build()

        val intent = CustomTabsIntent.Builder()
            .setShowTitle(true)
            // Closing the tab as soon as the redirect lands stops the browser
            // sitting in the recents list showing a half-finished sign-in.
            .setUrlBarHidingEnabled(false)
            .build()

        intent.intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        intent.launchUrl(context, url)
    }

    /** Reads the one-time code the provider handed back, if this is that redirect. */
    fun codeFrom(intent: Intent?): String? {
        val data = intent?.data ?: return null
        if (data.scheme != REDIRECT_SCHEME || data.host != REDIRECT_HOST) return null
        return data.getQueryParameter("code")?.takeIf { it.isNotBlank() }
    }

    /** Reads an error the provider reported, so it can be shown rather than swallowed. */
    fun errorFrom(intent: Intent?): String? {
        val data = intent?.data ?: return null
        if (data.scheme != REDIRECT_SCHEME || data.host != REDIRECT_HOST) return null
        return data.getQueryParameter("error")?.takeIf { it.isNotBlank() }
    }
}
