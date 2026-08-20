package com.circuvent.hrms.desktop

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.WindowPosition
import androidx.compose.ui.window.application
import androidx.compose.ui.window.rememberWindowState

/**
 * Circuvent HR for Windows.
 *
 * The third client on one application. `:shared` is compiled here for the JVM,
 * so the rules that decide what a day of leave costs, whether a request
 * overlaps one already filed and how an expired session is recovered are the
 * same code the Android app runs — not a second implementation that can drift
 * from the first while both look right.
 *
 * Opens at 1280x800, the smallest common laptop screen this is expected to run
 * on, and is resizable below that: the layout is columns and tables rather than
 * fixed positions, so a narrow window loses width from columns rather than
 * clipping content out of view.
 */
fun main() = application {
    val windowState = rememberWindowState(
        width = 1280.dp,
        height = 800.dp,
        position = WindowPosition(Alignment.Center),
    )

    Window(
        onCloseRequest = ::exitApplication,
        state = windowState,
        title = "Circuvent HR",
    ) {
        val state = remember { AppState() }

        DeskTheme {
            Box(Modifier.fillMaxSize().background(Desk.colors.background)) {
                if (state.session == null) SignInScreen(state) else Shell(state)
            }
        }
    }
}
