package com.circuvent.hrms.feature

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.text.KeyboardOptions
import com.circuvent.hrms.core.design.Theme
import com.circuvent.hrms.core.ui.AppButton
import com.circuvent.hrms.core.ui.AppText
import com.circuvent.hrms.core.ui.Banner
import com.circuvent.hrms.core.ui.BannerTone
import com.circuvent.hrms.core.ui.TextTone
import com.circuvent.hrms.core.ui.screenPadding
import com.circuvent.hrms.data.net.ApiException
import com.circuvent.hrms.data.net.OfflineException
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

    val scope = rememberCoroutineScope()

    fun submit() {
        if (email.isBlank() || password.isEmpty()) {
            error = "Enter your email address and password" to null
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
                error = "No connection" to
                    "Check your signal and try again. Your password is not the problem."
            } catch (e: ApiException) {
                if (e.body?.contains("mfaRequired") == true) {
                    needsCode = true
                    error = null
                } else {
                    error = "That did not work" to e.message
                }
            } catch (e: Exception) {
                error = "Something went wrong" to "Please try again."
            } finally {
                busy = false
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(screenPadding()),
        verticalArrangement = Arrangement.Center,
    ) {
        AppText(
            "Circuvent HR",
            size = Theme.type.title1,
            lineHeight = Theme.type.title1Line,
            weight = FontWeight.Bold,
            heading = true,
        )
        AppText(
            "Sign in with your work account",
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
            label = { Text("Work email") },
            singleLine = true,
            enabled = !busy,
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Email,
                imeAction = ImeAction.Next,
            ),
            modifier = Modifier.fillMaxWidth(),
        )

        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("Password") },
            singleLine = true,
            enabled = !busy,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Password,
                imeAction = if (needsCode) ImeAction.Next else ImeAction.Go,
            ),
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = Theme.spacing.md),
        )

        if (needsCode) {
            OutlinedTextField(
                value = totpCode,
                onValueChange = { totpCode = it.filter(Char::isDigit).take(6) },
                label = { Text("Authentication code") },
                supportingText = { Text("The six-digit code from your authenticator app") },
                singleLine = true,
                enabled = !busy,
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.NumberPassword,
                    imeAction = ImeAction.Go,
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = Theme.spacing.md),
            )
        }

        AppButton(
            label = "Sign in",
            onClick = ::submit,
            busy = busy,
            contentDescription = "Sign in to Circuvent HR",
            modifier = Modifier.padding(top = Theme.spacing.lg),
        )
    }
}

