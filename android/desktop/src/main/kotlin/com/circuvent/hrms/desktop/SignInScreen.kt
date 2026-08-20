package com.circuvent.hrms.desktop

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.circuvent.hrms.shared.api.HrmsApi
import kotlinx.coroutines.launch

/**
 * Signing in.
 *
 * The server address is on this screen rather than buried in settings, because
 * the commonest failure on a managed workstation is being pointed at the wrong
 * one, and the symptom — "wrong email or password" against a server that has
 * never heard of you — is indistinguishable from a typo in the password.
 */
@Composable
fun SignInScreen(state: AppState) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var server by remember { mutableStateOf(state.baseUrl) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var showServer by remember { mutableStateOf(false) }

    val scope = rememberCoroutineScope()

    fun submit() {
        if (busy || email.isBlank() || password.isBlank()) return
        busy = true
        error = null
        scope.launch {
            if (server.trim().trimEnd('/') != state.baseUrl) state.useServer(server)
            when (val result = state.api.signIn(email.trim(), password)) {
                is HrmsApi.Result.Ok -> state.session = result.value
                is HrmsApi.Result.Failed -> error = result.message
                is HrmsApi.Result.Offline ->
                    error = "Could not reach ${state.baseUrl}. ${result.message}"
                HrmsApi.Result.Unauthorised -> error = "That email and password did not match."
            }
            busy = false
        }
    }

    Box(Modifier.fillMaxSize().background(Desk.colors.background), contentAlignment = Alignment.Center) {
        Column(Modifier.width(400.dp)) {
            Text(
                "Circuvent HR",
                color = Desk.colors.text,
                style = MaterialTheme.typography.headlineMedium,
            )
            Muted("Sign in with your work account", Modifier.padding(top = Desk.spacing.xs))

            Spacer(Modifier.height(Desk.spacing.xl))

            DeskCard {
                error?.let {
                    ErrorBanner(it)
                    Spacer(Modifier.height(Desk.spacing.md))
                }

                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    label = { Text("Work email") },
                    singleLine = true,
                    enabled = !busy,
                    modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                )

                Spacer(Modifier.height(Desk.spacing.md))

                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("Password") },
                    singleLine = true,
                    enabled = !busy,
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
                    keyboardActions = KeyboardActions(onGo = { submit() }),
                )

                Spacer(Modifier.height(Desk.spacing.lg))

                DeskButtonView(
                    label = if (busy) "Signing in…" else "Sign in",
                    onClick = ::submit,
                    enabled = !busy && email.isNotBlank() && password.isNotBlank(),
                    busy = busy,
                    modifier = Modifier.fillMaxWidth(),
                )

                Spacer(Modifier.height(Desk.spacing.md))

                Row(verticalAlignment = Alignment.CenterVertically) {
                    Muted(state.baseUrl.removePrefix("https://").removePrefix("http://"))
                    Spacer(Modifier.weight(1f))
                    DeskButtonView(
                        label = if (showServer) "Hide" else "Change server",
                        onClick = { showServer = !showServer },
                        variant = DeskButton.GHOST,
                    )
                }

                if (showServer) {
                    OutlinedTextField(
                        value = server,
                        onValueChange = { server = it },
                        label = { Text("Server address") },
                        singleLine = true,
                        enabled = !busy,
                        modifier = Modifier.fillMaxWidth().padding(top = Desk.spacing.sm),
                    )
                    Muted(
                        "Applied when you sign in.",
                        Modifier.padding(top = Desk.spacing.xs),
                    )
                }
            }

            Spacer(Modifier.height(Desk.spacing.md))

            // Said plainly rather than discovered. On a shared workstation this
            // is a deliberate choice, not an oversight.
            Muted("You will be asked to sign in each time the app starts. Nothing is kept on this machine.")
        }
    }
}
