package com.circuvent.hrms.security

import android.content.Context
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.CreateCredentialCancellationException
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Passkeys on Android, through Credential Manager.
 *
 * Credential Manager is the only supported route to a platform authenticator
 * from Android 14 — the older FIDO2 APIs are deprecated and do not reach
 * passkeys stored in Google Password Manager, which is where a synced
 * credential actually lives.
 *
 * The whole exchange is JSON defined by the WebAuthn specification, so the
 * server speaks one protocol to this app, to the iOS app and to the browser.
 * Nothing here invents a shape: `requestJson` is the options the server sent,
 * passed through unmodified, and the response is handed back the same way.
 * That is what keeps three clients from drifting apart.
 */
class PasskeyManager(private val context: Context) {

    private val json = Json { ignoreUnknownKeys = true }
    private val manager by lazy { CredentialManager.create(context) }

    sealed interface Outcome {
        data class Success(val responseJson: String) : Outcome
        /** The user dismissed the sheet. Not an error; do not report one. */
        data object Cancelled : Outcome
        /** No passkey exists for this app on this device. */
        data object NoneEnrolled : Outcome
        data class Failed(val message: String) : Outcome
    }

    /**
     * Creates a passkey, given the registration options the server issued.
     *
     * The activity context matters: Credential Manager presents a system sheet
     * and needs an activity to host it. Passing an application context throws
     * at runtime rather than at compile time, which is why this takes the
     * context it is given rather than reaching for a global one.
     */
    suspend fun register(optionsJson: String): Outcome {
        return try {
            val response = manager.createCredential(
                context = context,
                request = CreatePublicKeyCredentialRequest(
                    requestJson = optionsJson,
                    // The server asks for none, and asking anyway would show an
                    // extra consent prompt for data nothing reads.
                    preferImmediatelyAvailableCredentials = false,
                ),
            )

            val created = response as? CreatePublicKeyCredentialResponse
                ?: return Outcome.Failed("Unexpected credential type")

            Outcome.Success(created.registrationResponseJson)
        } catch (_: CreateCredentialCancellationException) {
            Outcome.Cancelled
        } catch (e: CreateCredentialException) {
            Outcome.Failed(e.errorMessage?.toString() ?: "Could not create a passkey")
        }
    }

    /** Signs in with a passkey, given the authentication options. */
    suspend fun authenticate(optionsJson: String): Outcome {
        return try {
            val response = manager.getCredential(
                context = context,
                request = GetCredentialRequest(
                    listOf(GetPublicKeyCredentialOption(requestJson = optionsJson))
                ),
            )

            val credential = response.credential as? PublicKeyCredential
                ?: return Outcome.Failed("Unexpected credential type")

            Outcome.Success(credential.authenticationResponseJson)
        } catch (_: GetCredentialCancellationException) {
            Outcome.Cancelled
        } catch (_: NoCredentialException) {
            // Distinguished from a failure on purpose: "you have no passkey on
            // this device" is an invitation to enrol one, not an error.
            Outcome.NoneEnrolled
        } catch (e: GetCredentialException) {
            Outcome.Failed(e.errorMessage?.toString() ?: "Could not use a passkey")
        }
    }

    /**
     * Flattens a WebAuthn response into the fields the server's endpoint takes.
     *
     * The specification nests everything under `response`, and base64url-encodes
     * each field. The server could parse the whole envelope, but every client
     * would then have to agree on which envelope version it sends; sending the
     * four fields it actually reads keeps the contract small enough to check.
     */
    fun flattenRegistration(responseJson: String): Map<String, Any>? = runCatching {
        val root = json.parseToJsonElement(responseJson).jsonObject
        val inner = root["response"]?.jsonObject ?: return null

        mapOf(
            "credentialId" to root.string("id"),
            "clientDataJSON" to inner.string("clientDataJSON"),
            "authenticatorData" to inner.string("authenticatorData"),
            "publicKey" to inner.string("publicKey"),
            "transports" to (inner["transports"]?.toString() ?: "[]"),
        )
    }.getOrNull()

    fun flattenAssertion(responseJson: String): Map<String, String>? = runCatching {
        val root = json.parseToJsonElement(responseJson).jsonObject
        val inner = root["response"]?.jsonObject ?: return null

        mapOf(
            "credentialId" to root.string("id"),
            "clientDataJSON" to inner.string("clientDataJSON"),
            "authenticatorData" to inner.string("authenticatorData"),
            "signature" to inner.string("signature"),
        )
    }.getOrNull()

    private fun JsonObject.string(key: String): String =
        this[key]?.jsonPrimitive?.content.orEmpty()
}
