package com.circuvent.hrms.security

import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * BIOMETRIC UNLOCK
 *
 * This gates an *existing* session. It is not a sign-in method, and the
 * settings screen says so in as many words.
 *
 * A local biometric proves the holder is the enrolled person and proves nothing
 * to the server, which has never seen the face. The credential that
 * authenticates is still the refresh token in the keystore. Treating a local
 * biometric as authentication makes the phone the authority, and bypassing the
 * prompt on a rooted device is a solved problem.
 *
 * `BIOMETRIC_WEAK` is deliberately not accepted. Weak covers face unlock that
 * can be defeated by a photograph on some hardware, and the thing behind this
 * lock is somebody's salary.
 */
object Biometrics {

    private const val ALLOWED = BiometricManager.Authenticators.BIOMETRIC_STRONG

    sealed interface Support {
        val label: String

        data class Available(override val label: String) : Support

        /** The hardware is there but nothing is enrolled. */
        data object NotEnrolled : Support {
            override val label: String get() = "Biometric unlock"
        }

        data object Unavailable : Support {
            override val label: String get() = "Biometric unlock"
        }
    }

    enum class Result { UNLOCKED, FAILED, CANCELLED, UNAVAILABLE }

    fun support(context: Context): Support =
        when (BiometricManager.from(context).canAuthenticate(ALLOWED)) {
            BiometricManager.BIOMETRIC_SUCCESS -> Support.Available("Biometric unlock")
            BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> Support.NotEnrolled
            else -> Support.Unavailable
        }

    /**
     * Shows the prompt and waits for it.
     *
     * There is no device-PIN fallback. The point of this lock is that the phone
     * being unlocked is not, on its own, enough to open a payslip — and a
     * device-credential fallback makes it exactly that.
     */
    suspend fun prompt(activity: FragmentActivity, title: String): Result =
        suspendCancellableCoroutine { continuation ->
            val executor = ContextCompat.getMainExecutor(activity)

            val prompt = BiometricPrompt(
                activity,
                executor,
                object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                        if (continuation.isActive) continuation.resume(Result.UNLOCKED)
                    }

                    override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                        if (!continuation.isActive) return
                        val outcome = when (errorCode) {
                            BiometricPrompt.ERROR_USER_CANCELED,
                            BiometricPrompt.ERROR_NEGATIVE_BUTTON,
                            BiometricPrompt.ERROR_CANCELED,
                            -> Result.CANCELLED

                            BiometricPrompt.ERROR_NO_BIOMETRICS,
                            BiometricPrompt.ERROR_HW_NOT_PRESENT,
                            BiometricPrompt.ERROR_HW_UNAVAILABLE,
                            -> Result.UNAVAILABLE

                            else -> Result.FAILED
                        }
                        continuation.resume(outcome)
                    }

                    override fun onAuthenticationFailed() {
                        // Not resumed. A single non-match is not the end of the
                        // attempt — the prompt stays up and lets the person try
                        // again, which is what people expect of every other app
                        // on the device.
                    }
                },
            )

            val info = BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .setSubtitle("Circuvent HR is locked")
                .setNegativeButtonText("Cancel")
                .setAllowedAuthenticators(ALLOWED)
                .setConfirmationRequired(false)
                .build()

            continuation.invokeOnCancellation { prompt.cancelAuthentication() }
            prompt.authenticate(info)
        }
}
