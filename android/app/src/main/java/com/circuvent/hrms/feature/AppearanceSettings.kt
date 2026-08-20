package com.circuvent.hrms.feature

import android.app.Activity
import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.RadioButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import com.circuvent.hrms.AppContainer
import androidx.compose.ui.res.stringResource
import com.circuvent.hrms.R
import com.circuvent.hrms.core.design.MinTouchTarget
import com.circuvent.hrms.core.i18n.Locales
import com.circuvent.hrms.core.design.Theme
import com.circuvent.hrms.core.ui.AppCard
import com.circuvent.hrms.core.ui.AppText
import com.circuvent.hrms.core.ui.TextTone
import com.circuvent.hrms.data.DateFormatChoice
import com.circuvent.hrms.data.ThemeChoice

/**
 * Appearance: how the app is coloured, and how it writes dates.
 *
 * Both take effect immediately and without a confirm button. Neither can
 * destroy anything, both are visible the moment they are chosen, and both are
 * trivially reversible — so a "Save" step would only be a way to get the
 * setting wrong by forgetting it.
 */
@Composable
fun AppearanceSettings(container: AppContainer) {
    val theme by container.preferences.theme.collectAsState()
    val dateFormat by container.preferences.dateFormat.collectAsState()

    AppCard {
        AppText(
            stringResource(R.string.settings_appearance),
            weight = FontWeight.SemiBold,
            heading = true,
        )
        Spacer(Modifier.height(Theme.spacing.sm))

        ChoiceGroup(
            label = stringResource(R.string.settings_theme),
            options = ThemeChoice.entries,
            selected = theme,
            optionLabel = { stringResource(it.label) },
            optionHint = { null },
            onSelect = container.preferences::setTheme,
        )

        Spacer(Modifier.height(Theme.spacing.lg))

        ChoiceGroup(
            label = stringResource(R.string.settings_dates),
            options = DateFormatChoice.entries,
            selected = dateFormat,
            optionLabel = { stringResource(it.label) },
            // The sample is the point. "Day first" is an instruction; "31 Mar
            // 2026" is the thing you will actually be reading on every leave
            // request, and 03-04-2026 means two different days depending on who
            // is looking at it.
            optionHint = { it.example },
            onSelect = container.preferences::setDateFormat,
        )

        LanguageSetting(container)
    }
}

/**
 * The language picker.
 *
 * Only appears once there is a second language to pick. A control offering one
 * option is a control that does nothing, and on a screen full of working
 * settings it reads as broken rather than as "not yet translated".
 *
 * The list comes from `locales_config.xml`, so a language cannot show up here
 * before somebody has actually translated it. Machine-translating this app was
 * considered and rejected: it is full of statutory terms — gratuity,
 * professional tax, perquisite, Chapter VI-A — where a plausible-sounding wrong
 * word tells an employee their legal entitlement incorrectly, and neither the
 * person reading it nor the person who shipped it would be able to tell.
 */
@Composable
private fun LanguageSetting(container: AppContainer) {
    val context = LocalContext.current
    val activity = context as? Activity
    val available = remember(context) { Locales.available(context) }
    if (available.size < 2) return

    val current by container.preferences.language.collectAsState()

    Spacer(Modifier.height(Theme.spacing.lg))

    val options = remember(available) { listOf<String?>(null) + available.map { it.toLanguageTag() } }

    ChoiceGroup(
        label = stringResource(R.string.settings_language),
        options = options,
        selected = current,
        optionLabel = { tag ->
            if (tag == null) {
                stringResource(R.string.settings_language_system)
            } else {
                Locales.label(java.util.Locale.forLanguageTag(tag))
            }
        },
        optionHint = { null },
        onSelect = { tag ->
            container.preferences.setLanguage(tag)
            Locales.apply(context, tag)
            // Below API 33 nothing has re-read the resources yet, because the
            // locale is applied by wrapping the base context — which only
            // happens when the activity is built. Recreating is what makes the
            // change visible rather than arriving at the next cold start.
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) activity?.recreate()
        },
    )
}

/**
 * A labelled set of radio options.
 *
 * `selectableGroup` matters here: without it a screen reader announces three
 * unrelated radios rather than "Theme, 1 of 3", and the person cannot tell what
 * they are choosing between.
 */
@Composable
private fun <T> ChoiceGroup(
    label: String,
    options: List<T>,
    selected: T,
    optionLabel: @Composable (T) -> String,
    optionHint: (T) -> String?,
    onSelect: (T) -> Unit,
) {
    Column(Modifier.fillMaxWidth()) {
        AppText(
            label,
            size = Theme.type.footnote,
            lineHeight = Theme.type.footnoteLine,
            weight = FontWeight.SemiBold,
            tone = TextTone.MUTED,
        )
        Spacer(Modifier.height(Theme.spacing.xs))

        Column(Modifier.selectableGroup()) {
            options.forEach { option ->
                val isSelected = option == selected
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = MinTouchTarget)
                        .clip(RoundedCornerShape(Theme.radius.sm))
                        .selectable(
                            selected = isSelected,
                            role = Role.RadioButton,
                            onClick = { onSelect(option) },
                        )
                        .padding(vertical = Theme.spacing.xs),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(
                        selected = isSelected,
                        // The row carries the click and the semantics; a
                        // separately clickable control inside it would be a
                        // second stop announcing the same thing.
                        onClick = null,
                    )
                    Spacer(Modifier.width(Theme.spacing.sm))
                    Column {
                        AppText(optionLabel(option))
                        optionHint(option)?.let {
                            AppText(
                                it,
                                size = Theme.type.caption,
                                lineHeight = Theme.type.captionLine,
                                tone = TextTone.MUTED,
                            )
                        }
                    }
                }
            }
        }
    }
}
