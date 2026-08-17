package com.circuvent.hrms.data.auth

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Where the session lives.
 *
 * Backed by the Android Keystore through EncryptedSharedPreferences, so the
 * tokens are encrypted at rest with a key the app cannot export and another
 * app cannot read. Plain SharedPreferences would put a live session in a file
 * that is readable on a rooted device and included in any backup that slipped
 * through.
 *
 * `allowBackup` is false and the data-extraction rules exclude everything, so
 * a restore onto a different handset cannot hand somebody an active session.
 * Three separate mechanisms say the same thing because they are honoured by
 * different Android versions.
 */
class TokenStore(context: Context) {

    private val prefs: SharedPreferences by lazy {
        val key = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()

        EncryptedSharedPreferences.create(
            context,
            FILE,
            key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    var accessToken: String?
        get() = prefs.getString(ACCESS, null)
        set(value) = prefs.edit().apply {
            if (value == null) remove(ACCESS) else putString(ACCESS, value)
        }.apply()

    var refreshToken: String?
        get() = prefs.getString(REFRESH, null)
        set(value) = prefs.edit().apply {
            if (value == null) remove(REFRESH) else putString(REFRESH, value)
        }.apply()

    /** Whether biometric unlock has been turned on for this device. */
    var biometricEnabled: Boolean
        get() = prefs.getBoolean(BIOMETRIC, false)
        set(value) = prefs.edit().putBoolean(BIOMETRIC, value).apply()

    fun save(access: String, refresh: String?) {
        prefs.edit()
            .putString(ACCESS, access)
            .apply { if (refresh != null) putString(REFRESH, refresh) }
            .apply()
    }

    /**
     * Clears the session but keeps the device preferences.
     *
     * Biometric unlock survives a sign-out on purpose: it is a property of the
     * handset, not of the person, and making somebody re-enable it every time
     * they sign out teaches them to leave it off.
     */
    fun clearSession() {
        prefs.edit().remove(ACCESS).remove(REFRESH).apply()
    }

    private companion object {
        const val FILE = "circuvent_session"
        const val ACCESS = "access_token"
        const val REFRESH = "refresh_token"
        const val BIOMETRIC = "biometric_enabled"
    }
}
