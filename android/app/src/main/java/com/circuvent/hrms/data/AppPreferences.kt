package com.circuvent.hrms.data

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * How the app should pick its colours.
 *
 * "Follow the device" is the default and is right for almost everyone. The
 * override exists because it is not right for everyone: a phone on a permanent
 * dark schedule is still used in daylight, and somebody who finds dark text on
 * light easier to read should not have to change their whole device to get it
 * in one app.
 */
enum class ThemeChoice(val id: String, val label: String) {
    SYSTEM("system", "Follow the device"),
    LIGHT("light", "Always light"),
    DARK("dark", "Always dark");

    companion object {
        fun from(id: String?): ThemeChoice = entries.firstOrNull { it.id == id } ?: SYSTEM
    }
}

/**
 * How dates should be written.
 *
 * The app talks to an Indian payroll system and shows dates from it constantly
 * — a leave range, a payslip month, a holiday. The ISO form the API returns is
 * unambiguous but reads as machine output; day-first is what people here write
 * by hand. Both are offered rather than one being chosen for everybody, because
 * a date like 03-04-2026 means two different days depending on who is reading
 * it, and guessing wrong on a leave request is worse than asking.
 */
enum class DateFormatChoice(val id: String, val label: String, val example: String) {
    DAY_FIRST("dayFirst", "31 Mar 2026", "Day first"),
    ISO("iso", "2026-03-31", "Year first"),
    MONTH_FIRST("monthFirst", "Mar 31, 2026", "Month first");

    companion object {
        fun from(id: String?): DateFormatChoice = entries.firstOrNull { it.id == id } ?: DAY_FIRST
    }
}

/**
 * Preferences about how the app looks, not about who is signed in.
 *
 * Deliberately plain [SharedPreferences] rather than the encrypted store the
 * tokens use. None of this is a secret — knowing somebody prefers dark mode
 * reveals nothing — and the theme is read during composition, where a Keystore
 * round trip on every read would be paid for nothing.
 *
 * Values are exposed as flows so a change repaints immediately. Reading them
 * once at startup would leave the setting screen showing the new choice while
 * the rest of the app kept the old one until it was restarted.
 */
class AppPreferences(context: Context) {

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences("circuvent.ui", Context.MODE_PRIVATE)

    private val _theme = MutableStateFlow(ThemeChoice.from(prefs.getString(KEY_THEME, null)))
    val theme: StateFlow<ThemeChoice> = _theme.asStateFlow()

    private val _dateFormat =
        MutableStateFlow(DateFormatChoice.from(prefs.getString(KEY_DATE_FORMAT, null)))
    val dateFormat: StateFlow<DateFormatChoice> = _dateFormat.asStateFlow()

    fun setTheme(choice: ThemeChoice) {
        prefs.edit().putString(KEY_THEME, choice.id).apply()
        _theme.value = choice
    }

    fun setDateFormat(choice: DateFormatChoice) {
        prefs.edit().putString(KEY_DATE_FORMAT, choice.id).apply()
        _dateFormat.value = choice
    }

    private companion object {
        const val KEY_THEME = "theme"
        const val KEY_DATE_FORMAT = "dateFormat"
    }
}
