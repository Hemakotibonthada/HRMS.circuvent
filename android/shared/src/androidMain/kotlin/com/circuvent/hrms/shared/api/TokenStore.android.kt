package com.circuvent.hrms.shared.api

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Android: the Keystore, by way of EncryptedSharedPreferences.
 *
 * Plain SharedPreferences are readable from a rooted device or an ADB backup,
 * and an access token there is a working credential for somebody's payroll
 * record. The master key is held by the Keystore, which on most devices means
 * hardware-backed and non-exportable.
 */
actual class TokenStore(context: Context) {

    private val prefs by lazy {
        val key = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()

        EncryptedSharedPreferences.create(
            context,
            "circuvent.session",
            key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    actual fun accessToken(): String? = prefs.getString(ACCESS, null)

    actual fun refreshToken(): String? = prefs.getString(REFRESH, null)

    actual suspend fun save(accessToken: String, refreshToken: String?) {
        val editor = prefs.edit()
        editor.putString(ACCESS, accessToken)
        // Only overwritten when a new one was issued. A refresh response that
        // returns just an access token would otherwise wipe the credential
        // needed for the refresh after it.
        if (refreshToken != null) editor.putString(REFRESH, refreshToken)
        editor.apply()
    }

    actual suspend fun clear() {
        val editor = prefs.edit()
        editor.remove(ACCESS)
        editor.remove(REFRESH)
        editor.apply()
    }

    private companion object {
        const val ACCESS = "access_token"
        const val REFRESH = "refresh_token"
    }
}
