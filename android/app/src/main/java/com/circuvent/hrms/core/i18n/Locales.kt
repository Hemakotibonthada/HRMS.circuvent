package com.circuvent.hrms.core.i18n

import android.content.Context
import android.content.res.Configuration
import android.os.Build
import android.os.LocaleList
import androidx.annotation.XmlRes
import com.circuvent.hrms.R
import org.xmlpull.v1.XmlPullParser
import java.util.Locale

/**
 * The languages the app is available in, and how one gets applied.
 *
 * The list is read from `res/xml/locales_config.xml` rather than written out
 * again here. One declaration means a language cannot appear in the picker
 * before its translation exists, and a half-translated app that silently falls
 * back to English is worse than an app that only offers English — the reader
 * cannot tell whether it is broken or simply untranslated.
 *
 * Applying a locale takes two paths because the app supports API 26 and the
 * per-app language API arrived in 33. Neither path needs AppCompat: pulling in
 * an AppCompat theme for a pure-Compose app would restyle every view to gain
 * one call.
 */
object Locales {

    /**
     * Reads the declared locales.
     *
     * Parsed from the same XML the manifest points at. `android.app.LocaleConfig`
     * would do this in one line but only from API 33, and keeping two copies of
     * the list is what this is trying to avoid.
     */
    fun available(context: Context, @XmlRes res: Int = R.xml.locales_config): List<Locale> {
        val tags = mutableListOf<String>()

        context.resources.getXml(res).use { parser ->
            var event = parser.eventType
            while (event != XmlPullParser.END_DOCUMENT) {
                if (event == XmlPullParser.START_TAG && parser.name == "locale") {
                    parser.getAttributeValue(ANDROID_NS, "name")?.let(tags::add)
                }
                event = parser.next()
            }
        }

        // English is the language the strings are written in, so it survives
        // even if somebody empties the file.
        if (tags.isEmpty()) tags += "en"
        return tags.map(Locale::forLanguageTag)
    }

    /**
     * Applies a language, or clears the override when [tag] is null.
     *
     * On API 33 and above this is the framework's per-app language: it survives
     * restarts, shows up in Android's own app-info screen, and needs no manual
     * recreation.
     *
     * Below that there is no such mechanism and the caller must recreate the
     * activity afterwards. That is said here rather than done here because this
     * object has no activity to recreate.
     */
    fun apply(context: Context, tag: String?) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val manager = context.getSystemService(android.app.LocaleManager::class.java)
            manager?.applicationLocales =
                if (tag.isNullOrBlank()) {
                    LocaleList.getEmptyLocaleList()
                } else {
                    LocaleList.forLanguageTags(tag)
                }
        }
    }

    /**
     * Wraps a context in the chosen language, for API levels below 33.
     *
     * Called from `attachBaseContext`, the only point early enough for
     * resources to resolve in the right language for the whole activity. Doing
     * it later leaves the first frame in the previous one.
     */
    fun wrap(base: Context, tag: String?): Context {
        if (tag.isNullOrBlank() || Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) return base

        val locale = Locale.forLanguageTag(tag)
        Locale.setDefault(locale)

        val config = Configuration(base.resources.configuration)
        config.setLocale(locale)
        config.setLayoutDirection(locale)
        return base.createConfigurationContext(config)
    }

    /**
     * The endonym, plus the English name when they differ.
     *
     * Somebody looking for their own language scans for the word they would
     * write it in, not the English one — a picker listing only "Telugu" is
     * hardest to use for exactly the person who needs it most. The English name
     * stays alongside so an administrator setting up a colleague's phone can
     * find it too.
     */
    fun label(locale: Locale): String {
        val own = locale.getDisplayLanguage(locale).replaceFirstChar { it.uppercase(locale) }
        val english = locale.getDisplayLanguage(Locale.ENGLISH)
        return if (own.equals(english, ignoreCase = true)) own else "$own · $english"
    }

    private const val ANDROID_NS = "http://schemas.android.com/apk/res/android"
}
