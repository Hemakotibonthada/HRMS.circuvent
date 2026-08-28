package com.circuvent.hrms.feature

import android.util.Log
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.text.KeyboardOptions
import com.circuvent.hrms.R
import com.circuvent.hrms.core.design.Theme
import com.circuvent.hrms.core.ui.AppButton
import com.circuvent.hrms.core.ui.AppText
import com.circuvent.hrms.core.ui.Banner
import com.circuvent.hrms.core.ui.BannerTone
import com.circuvent.hrms.core.ui.TextTone
import com.circuvent.hrms.core.ui.screenPadding
import com.circuvent.hrms.data.net.ApiException
import com.circuvent.hrms.data.net.OfflineException
import androidx.compose.ui.platform.LocalContext
import com.circuvent.hrms.security.PasskeyManager
import kotlinx.coroutines.launch

/**
 * Sign in.
 *
 * The MFA field appears only after the server says it is needed, which it only
 * does once the password was already correct. Showing it upfront would ask most
 * people for something they do not have, and hiding it after a correct password
 * would strand everyone who does.
 */
@Composable
fun SignInScreen(viewModel: AppViewModel) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var totpCode by remember { mutableStateOf("") }
    var needsCode by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<Pair<String, String?>?>(null) }
    var busy by remember { mutableStateOf(false) }
    var passwordVisible by remember { mutableStateOf(false) }

    val scope = rememberCoroutineScope()
    val focusManager = LocalFocusManager.current
    val context = LocalContext.current
    val passkeys = remember(context) { PasskeyManager(context) }

    val missingFieldsTitle = stringResource(R.string.signin_missing_fields_title)
    val noConnectionTitle = stringResource(R.string.signin_no_connection_title)
    val noConnectionDescription = stringResource(R.string.signin_no_connection_description)
    val genericErrorTitle = stringResource(R.string.signin_generic_error_title)
    val unexpectedErrorTitle = stringResource(R.string.signin_unexpected_error_title)
    val unexpectedErrorDescription = stringResource(R.string.signin_unexpected_error_description)
    val passkeyUnexpectedResponseDescription = stringResource(R.string.signin_passkey_unexpected_response_description)
    val noPasskeyTitle = stringResource(R.string.signin_no_passkey_title)
    val noPasskeyDescription = stringResource(R.string.signin_no_passkey_description)
    val passkeyNoConnectionDescription = stringResource(R.string.signin_passkey_no_connection_description)
    val passkeyGenericErrorDescription = stringResource(R.string.signin_passkey_generic_error_description)

    fun submit() {
        if (email.isBlank() || password.isEmpty()) {
            error = missingFieldsTitle to null
            return
        }

        busy = true
        error = null
        scope.launch {
            try {
                viewModel.signIn(email.trim(), password, totpCode.takeIf { needsCode })
            } catch (e: OfflineException) {
                // Distinguished from a wrong password on purpose. "Incorrect
                // password" when the real problem is a dead connection sends
                // people to the reset flow for no reason — and a reset needs
                // the network too.
                error = noConnectionTitle to noConnectionDescription
            } catch (e: ApiException) {
                if (e.body?.contains("mfaRequired") == true) {
                    needsCode = true
                    error = null
                } else {
                    error = genericErrorTitle to e.message
                }
            } catch (e: Exception) {
                // Logged, not just shown. A generic catch that reports
                // "Something went wrong" and records nothing makes the one
                // failure nobody anticipated the one failure nobody can
                // diagnose — which is exactly what happened here: sign-in
                // returned 200 from the server and this branch swallowed the
                // reason why the app disagreed.
                Log.e("SignIn", "Sign-in failed after a successful request", e)
                error = unexpectedErrorTitle to unexpectedErrorDescription
            } finally {
                busy = false
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            // Without this the keyboard covers the sign-in button, and because
            // the column is centred the content does not move out from under
            // it either. Tapping where the button appears to be dismisses the
            // keyboard instead of signing in, and the second tap lands on a
            // button that has just moved — so the screen reads as ignoring
            // taps. Found on a 1080x2400 emulator, which is a large phone;
            // on anything smaller the button is further under the keyboard.
            .imePadding()
            .padding(screenPadding()),
        verticalArrangement = Arrangement.Center,
    ) {
        AppText(
            stringResource(R.string.signin_app_title),
            size = Theme.type.title1,
            lineHeight = Theme.type.title1Line,
            weight = FontWeight.Bold,
            heading = true,
        )
        AppText(
            stringResource(R.string.signin_subtitle),
            tone = TextTone.MUTED,
            modifier = Modifier.padding(top = Theme.spacing.xs, bottom = Theme.spacing.xxl),
        )

        error?.let { (title, description) ->
            Banner(
                tone = BannerTone.ERROR,
                title = title,
                description = description,
                modifier = Modifier.padding(bottom = Theme.spacing.lg),
            )
        }

        OutlinedTextField(
            value = email,
            onValueChange = { email = it },
            label = { Text(stringResource(R.string.signin_email_label)) },
            singleLine = true,
            enabled = !busy,
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Email,
                imeAction = ImeAction.Next,
            ),
            keyboardActions = KeyboardActions(
                onNext = { focusManager.moveFocus(FocusDirection.Down) },
            ),
            modifier = Modifier.fillMaxWidth(),
        )

        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text(stringResource(R.string.signin_password_label)) },
            singleLine = true,
            enabled = !busy,
            visualTransformation =
                if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
            trailingIcon = {
                // A password field with no way to check what was typed is why
                // people pick shorter passwords on phones. The toggle is
                // labelled for screen readers, and states what it will do
                // rather than what it currently shows.
                IconButton(onClick = { passwordVisible = !passwordVisible }) {
                    Icon(
                        imageVector = if (passwordVisible) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                        contentDescription =
                            if (passwordVisible) {
                                stringResource(R.string.signin_hide_password_content_description)
                            } else {
                                stringResource(R.string.signin_show_password_content_description)
                            },
                    )
                }
            },
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Password,
                imeAction = if (needsCode) ImeAction.Next else ImeAction.Go,
            ),
            // `imeAction` alone only relabels the key. Without this the "Go"
            // key does nothing at all, which — with the button under the
            // keyboard — left no way to sign in from this screen.
            keyboardActions = KeyboardActions(
                onGo = { submit() },
                onNext = { focusManager.moveFocus(FocusDirection.Down) },
            ),
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = Theme.spacing.md),
        )

        if (needsCode) {
            OutlinedTextField(
                value = totpCode,
                onValueChange = { totpCode = it.filter(Char::isDigit).take(6) },
                label = { Text(stringResource(R.string.signin_totp_label)) },
                supportingText = { Text(stringResource(R.string.signin_totp_hint)) },
                singleLine = true,
                enabled = !busy,
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.NumberPassword,
                    imeAction = ImeAction.Go,
                ),
                keyboardActions = KeyboardActions(onGo = { submit() }),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = Theme.spacing.md),
            )
        }

        AppButton(
            label = stringResource(R.string.signin_submit_action),
            onClick = ::submit,
            busy = busy,
            contentDescription = stringResource(R.string.signin_submit_content_description),
            modifier = Modifier.padding(top = Theme.spacing.lg),
        )

        // Passkey sign-in.
        //
        // Offered below the password rather than instead of it: somebody
        // signing in on a new phone has no passkey on it yet, and a screen that
        // only offers one strands them. Once a passkey exists this is the
        // shorter path — no password to phish, and nothing to type.
        AppButton(
            label = stringResource(R.string.signin_passkey_action),
            onClick = {
                busy = true
                error = null
                scope.launch {
                    try {
                        val options = viewModel.passkeyLoginOptions()
                        when (val outcome = passkeys.authenticate(options)) {
                            is PasskeyManager.Outcome.Success -> {
                                val assertion = passkeys.flattenAssertion(outcome.responseJson)
                                if (assertion == null) {
                                    error = genericErrorTitle to passkeyUnexpectedResponseDescription
                                } else {
                                    viewModel.signInWithPasskey(assertion)
                                }
                            }
                            // Dismissing the sheet is a decision, not a failure.
                            PasskeyManager.Outcome.Cancelled -> Unit
                            PasskeyManager.Outcome.NoneEnrolled -> {
                                error = noPasskeyTitle to noPasskeyDescription
                            }
                            is PasskeyManager.Outcome.Failed -> {
                                error = genericErrorTitle to outcome.message
                            }
                        }
                    } catch (e: OfflineException) {
                        error = noConnectionTitle to passkeyNoConnectionDescription
                    } catch (e: Exception) {
                        Log.e("SignIn", "Passkey sign-in failed", e)
                        error = genericErrorTitle to passkeyGenericErrorDescription
                    } finally {
                        busy = false
                    }
                }
            },
            busy = false,
            contentDescription = stringResource(R.string.signin_passkey_content_description),
            modifier = Modifier.padding(top = Theme.spacing.sm),
        )
    }
}

