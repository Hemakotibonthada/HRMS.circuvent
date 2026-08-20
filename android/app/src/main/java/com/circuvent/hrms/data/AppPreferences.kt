package com.circuvent.hrms.data

import android.content.Context
import android.content.SharedPreferences
import androidx.annotation.StringRes
import com.circuvent.hrms.R
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
 *
 * Labels are string resources rather than literals so they can be translated.
 * The resource id is carried here rather than the text, because an enum is
 * created once per process and a translated string has to be resolved against
 * whatever locale is in force when it is drawn.
 */
enum class ThemeChoice(val id: String, @StringRes val label: Int) {
    SYSTEM("system", R.string.settings_theme_system),
    LIGHT("light", R.string.settings_theme_light),
    DARK("dark", R.string.settings_theme_dark);

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
 *
 * [example] is deliberately not a resource. It is a rendered date, not a
 * sentence, and its job is to show the shape the reader will actually see.
 */
enum class DateFormatChoice(
    val id: String,
    @StringRes val label: Int,
    val example: String,
) {
    DAY_FIRST("dayFirst", R.string.settings_dates_day_first, "31 Mar 2026"),
    ISO("iso", R.string.settings_dates_year_first, "2026-03-31"),
    MONTH_FIRST("monthFirst", R.string.settings_dates_month_first, "Mar 31, 2026");

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

    /**
     * The chosen language, or null to follow the device.
     *
     * A BCP 47 tag rather than an enum. The set of languages is declared in
     * `locales_config.xml` and grows when a translator delivers one; an enum
     * here would be a second list to keep in step, and the two would drift.
     */
    private val _language = MutableStateFlow(prefs.getString(KEY_LANGUAGE, null))
    val language: StateFlow<String?> = _language.asStateFlow()

    /**
     * Read outside composition, from `attachBaseContext`, which runs before
     * anything can collect a flow.
     */
    val languageTag: String? get() = _language.value

    fun setLanguage(tag: String?) {
        prefs.edit().apply { if (tag == null) remove(KEY_LANGUAGE) else putString(KEY_LANGUAGE, tag) }.apply()
        _language.value = tag
    }

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
        const val KEY_LANGUAGE = "language"
    }
}
