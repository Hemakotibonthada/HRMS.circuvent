package com.circuvent.hrms.shared.api

import kotlinx.cinterop.ExperimentalForeignApi
import platform.CoreFoundation.kCFBooleanTrue
import platform.Foundation.NSData
import platform.Foundation.NSString
import platform.Foundation.NSUTF8StringEncoding
import platform.Foundation.create
import platform.Foundation.dataUsingEncoding
import platform.Security.*
import kotlinx.cinterop.CValuesRef
import kotlinx.cinterop.alloc
import kotlinx.cinterop.memScoped
import kotlinx.cinterop.ptr
import kotlinx.cinterop.value

/**
 * iOS: the Keychain.
 *
 * `UserDefaults` is the iOS equivalent of the mistake `SharedPreferences`
 * would be on Android — it is a plist in the app container, included in
 * unencrypted iTunes backups, and readable from a jailbroken device.
 *
 * `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` is the accessibility that
 * matters here: the token is unavailable until the user has unlocked the phone
 * at least once since boot, and `ThisDeviceOnly` keeps it out of a backup that
 * could be restored onto somebody else's handset.
 */
@OptIn(ExperimentalForeignApi::class)
actual class TokenStore {

    actual fun accessToken(): String? = read(ACCESS)

    actual fun refreshToken(): String? = read(REFRESH)

    actual suspend fun save(accessToken: String, refreshToken: String?) {
        write(ACCESS, accessToken)
        // Only when a new one was issued; a refresh that returns only an
        // access token must not erase the credential for the next refresh.
        if (refreshToken != null) write(REFRESH, refreshToken)
    }

    actual suspend fun clear() {
        delete(ACCESS)
        delete(REFRESH)
    }

    private fun query(account: String): MutableMap<Any?, Any?> = mutableMapOf(
        kSecClass to kSecClassGenericPassword,
        kSecAttrService to SERVICE,
        kSecAttrAccount to account,
    )

    private fun read(account: String): String? = memScoped {
        val request = query(account).apply {
            put(kSecReturnData, kCFBooleanTrue)
            put(kSecMatchLimit, kSecMatchLimitOne)
        }

        val result = alloc<platform.CoreFoundation.CFTypeRefVar>()
        val status = SecItemCopyMatching(
            request as platform.CoreFoundation.CFDictionaryRef,
            result.ptr as CValuesRef<platform.CoreFoundation.CFTypeRefVar>
        )

        if (status != errSecSuccess) return@memScoped null

        val data = result.value as? NSData ?: return@memScoped null
        NSString.create(data, NSUTF8StringEncoding) as String?
    }

    private fun write(account: String, value: String) {
        // Delete first. SecItemAdd fails with errSecDuplicateItem rather than
        // replacing, and an update path that silently no-ops leaves the old
        // token in place after a re-login.
        delete(account)

        val data = (value as NSString).dataUsingEncoding(NSUTF8StringEncoding) ?: return
        val request = query(account).apply {
            put(kSecValueData, data)
            put(kSecAttrAccessible, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly)
        }

        SecItemAdd(request as platform.CoreFoundation.CFDictionaryRef, null)
    }

    private fun delete(account: String) {
        SecItemDelete(query(account) as platform.CoreFoundation.CFDictionaryRef)
    }

    private companion object {
        const val SERVICE = "com.circuvent.hrms.session"
        const val ACCESS = "access_token"
        const val REFRESH = "refresh_token"
    }
}
