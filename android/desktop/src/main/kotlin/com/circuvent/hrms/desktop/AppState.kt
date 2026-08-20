package com.circuvent.hrms.desktop

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.circuvent.hrms.shared.api.HrmsApi
import com.circuvent.hrms.shared.api.TokenStore
import com.circuvent.hrms.shared.model.Session
import java.util.prefs.Preferences

/**
 * Where the desktop client points, and who is signed in.
 *
 * ─── On the server address ───
 *
 * Configurable, unlike the phone, and stored per user. A workstation is a
 * managed machine that may sit behind a different hostname to a phone on
 * mobile data, and an installed .msi cannot be rebuilt to change a constant.
 * The default is production; the field exists so a developer can point at a
 * local server without a private build.
 *
 * ─── On staying signed in ───
 *
 * Deliberately not persisted. The shared `TokenStore` on the JVM is memory
 * only, and that stays true here: a refresh token written to disk on a shared
 * Windows workstation is a credential any other profile with file access can
 * take. Signing in each launch is the cost, and on a machine several people use
 * it is the right cost. Windows Credential Manager would fix it properly, and
 * that is the next step rather than a plaintext file in the meantime.
 */
object Settings {
    private val prefs: Preferences = Preferences.userRoot().node("com/circuvent/hrms/desktop")

    private const val KEY_BASE_URL = "baseUrl"
    const val DEFAULT_BASE_URL = "https://hrms.circuvent.com"

    var baseUrl: String
        get() = prefs.get(KEY_BASE_URL, DEFAULT_BASE_URL)
        set(value) {
            prefs.put(KEY_BASE_URL, value.trim().trimEnd('/'))
        }
}

/** Every place the window can be. */
enum class Screen(val title: String) {
    HOME("Today"),
    LEAVE("Leave"),
    ATTENDANCE("Attendance"),
    WORK_AWAY("Work away"),
    CORRECTIONS("Correct a day"),
    TEAM("Who is in"),
    INBOX("Approvals"),
    SWAPS("Shift swaps"),
    DIRECTORY("Directory"),
    PRAISE("Praise"),
    WALL("Company wall"),
    MY_DETAILS("My details"),
    GOALS("Goals"),
    LEARNING("Learning"),
    PAYSLIPS("Payslips"),
    EXPENSES("Expenses"),
    LOANS("Loans and advances"),
    TAX("Tax"),
    BENEFITS("Benefits"),
    ASSETS("Assets"),
    HELPDESK("Helpdesk"),
    HOLIDAYS("Holidays"),
    ANNOUNCEMENTS("Announcements"),
    DOCUMENTS("Documents"),
    SETTINGS("Settings"),
}

class AppState {
    var baseUrl by mutableStateOf(Settings.baseUrl)
        private set

    var api by mutableStateOf(HrmsApi(baseUrl, TokenStore()))
        private set

    var session by mutableStateOf<Session?>(null)
    var screen by mutableStateOf(Screen.HOME)

    fun useServer(url: String) {
        val cleaned = url.trim().trimEnd('/')
        Settings.baseUrl = cleaned
        baseUrl = cleaned
        // A new client, because the base URL is fixed at construction and a
        // half-changed one would send some calls to each server.
        api = HrmsApi(cleaned, TokenStore())
        session = null
    }

    suspend fun signOut() {
        api.signOut()
        session = null
        screen = Screen.HOME
    }
}

/** What a load is doing, so a screen can say so rather than showing nothing. */
sealed interface Load<out T> {
    data object Loading : Load<Nothing>
    data class Ready<T>(val value: T) : Load<T>
    data class Failed(val message: String) : Load<Nothing>
}

/** Turns an API result into something a screen can render without a `when` per call. */
fun <T> HrmsApi.Result<T>.toLoad(): Load<T> = when (this) {
    is HrmsApi.Result.Ok -> Load.Ready(value)
    is HrmsApi.Result.Failed -> Load.Failed(message)
    is HrmsApi.Result.Offline -> Load.Failed("No connection to the server. $message")
    HrmsApi.Result.Unauthorised -> Load.Failed("Your session has expired. Sign in again.")
}
