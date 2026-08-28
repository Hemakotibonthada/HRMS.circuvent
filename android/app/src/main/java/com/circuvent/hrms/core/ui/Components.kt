package com.circuvent.hrms.core.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import com.circuvent.hrms.core.design.AccentTone
import com.circuvent.hrms.core.design.MinTouchTarget
import com.circuvent.hrms.core.design.Theme

// ═══════════════════════════════════════════════════════════════
// THE UI KIT
// ═══════════════════════════════════════════════════════════════
// Material 3's own components are deliberately not used for anything that
// carries colour. Their scheme is a different vocabulary — primaryContainer,
// surfaceTint, onSurfaceVariant — and mapping an audited palette onto it loses
// the audit: the pairs the contrast contract measures stop being the pairs the
// components draw.
//
// What is here instead is small, and each piece exists because the same
// mistake was made repeatedly without it.

enum class TextTone { DEFAULT, MUTED, PRIMARY, ON_PRIMARY, ON_HERO, SUCCESS, WARNING, DANGER }

@Composable
private fun TextTone.color(): Color = when (this) {
    TextTone.DEFAULT -> Theme.colors.text
    TextTone.MUTED -> Theme.colors.textMuted
    TextTone.PRIMARY -> Theme.colors.primary
    TextTone.ON_PRIMARY -> Theme.colors.onPrimary
    TextTone.ON_HERO -> Theme.colors.onHero
    TextTone.SUCCESS -> Theme.colors.success
    TextTone.WARNING -> Theme.colors.warning
    TextTone.DANGER -> Theme.colors.danger
}

/**
 * Text, with its size and line height taken from the same pair.
 *
 * Both are in `sp`, so both follow the reader's own text-size setting. That
 * pairing is the whole difference from the app this replaces: React Native
 * scales the font and leaves an absolute line height alone, so at 200% every
 * screen drew large glyphs on a small line and clipped — for exactly the
 * people who had turned the setting up because they were already struggling.
 */
@Composable
fun AppText(
    text: String,
    modifier: Modifier = Modifier,
    size: TextUnit = Theme.type.body,
    lineHeight: TextUnit = Theme.type.bodyLine,
    tone: TextTone = TextTone.DEFAULT,
    weight: FontWeight = FontWeight.Normal,
    align: TextAlign? = null,
    maxLines: Int = Int.MAX_VALUE,
    heading: Boolean = false,
    color: Color? = null,
) {
    Text(
        text = text,
        modifier = if (heading) modifier.semantics { this.heading() } else modifier,
        color = color ?: tone.color(),
        maxLines = maxLines,
        overflow = if (maxLines == Int.MAX_VALUE) TextOverflow.Clip else TextOverflow.Ellipsis,
        style = TextStyle(
            fontSize = size,
            lineHeight = lineHeight,
            fontWeight = weight,
            // Unspecified rather than null: this Compose version models "no
            // opinion" as a sentinel, and passing null would centre nothing.
            textAlign = align ?: TextAlign.Unspecified,
        ),
    )
}

/** A heading, at the title3 step. */
@Composable
fun SectionHeading(text: String, modifier: Modifier = Modifier) {
    AppText(
        text = text,
        modifier = modifier,
        size = Theme.type.title3,
        lineHeight = Theme.type.title3Line,
        weight = FontWeight.SemiBold,
        heading = true,
    )
}

/**
 * [ButtonVariant.ON_HERO] is for a button sitting on the gradient of a
 * [HeroCard]. The primary variant is the same violet as the gradient under it
 * and disappears; this one inverts, so the control that matters most on the
 * screen is also the highest-contrast thing on it.
 */
enum class ButtonVariant { PRIMARY, SECONDARY, GHOST, DANGER, ON_HERO }

/**
 * A button.
 *
 * Everything here that looks like fussiness is a real failure mode:
 *
 *  * A 48dp minimum height, always. On the clock-in screen a mis-tap is
 *    somebody's attendance record.
 *  * The disabled and busy states are put into the semantics tree, not carried
 *    by opacity alone — a dimmed button is not information a screen reader can
 *    convey.
 *  * The label stays laid out while the spinner shows, so the control does not
 *    resize and move out from under the finger mid-tap.
 */
@Composable
fun AppButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: ButtonVariant = ButtonVariant.PRIMARY,
    enabled: Boolean = true,
    busy: Boolean = false,
    fullWidth: Boolean = true,
    contentDescription: String? = null,
) {
    val colors = Theme.colors
    val inert = !enabled || busy

    val background = when (variant) {
        ButtonVariant.PRIMARY -> colors.primary
        ButtonVariant.SECONDARY -> colors.surfaceElevated
        ButtonVariant.GHOST -> Color.Transparent
        ButtonVariant.DANGER -> colors.danger
        ButtonVariant.ON_HERO -> Color.White
    }
    val foreground = when (variant) {
        ButtonVariant.PRIMARY -> colors.onPrimary
        ButtonVariant.SECONDARY -> colors.text
        ButtonVariant.GHOST -> colors.primary
        ButtonVariant.DANGER -> Color.White
        // Against white, the darker end of the gradient — not `primary`, which
        // is lightened in dark mode for legibility on a dark page and would be
        // washed out here.
        ButtonVariant.ON_HERO -> colors.heroEnd
    }

    val shape = RoundedCornerShape(Theme.radius.md)

    // The disabled look comes from dimmed colours, not from wrapping the button
    // in a `Modifier.alpha` graphics layer.
    //
    // That layer, nested inside the one `AppCard` creates for its shadow, could
    // fail to compose: an *enabled* primary button inside a card painted as bare
    // card surface, so "Send for approval" was a live, tappable control that no
    // one could see. Dimming the colours needs no layer, keeps the ripple at
    // full strength, and lets the label be dimmed independently of the fill.
    val dim = 0.45f
    val fill = if (inert) background.copy(alpha = background.alpha * dim) else background
    val ink = if (inert) foreground.copy(alpha = foreground.alpha * dim) else foreground
    val edge = colors.border.let { if (inert) it.copy(alpha = it.alpha * dim) else it }

    Box(
        modifier = modifier
            .then(if (fullWidth) Modifier.fillMaxWidth() else Modifier)
            .defaultMinSize(minHeight = MinTouchTarget)
            .clip(shape)
            .background(fill)
            .then(
                if (variant == ButtonVariant.SECONDARY) {
                    Modifier.border(BorderStroke(1.dp, edge), shape)
                } else {
                    Modifier
                }
            )
            .clickable(enabled = !inert, role = Role.Button, onClick = onClick)
            .semantics {
                if (contentDescription != null) this.contentDescription = contentDescription
                if (inert) disabled()
            }
            .padding(horizontal = Theme.spacing.xl, vertical = Theme.spacing.md),
        contentAlignment = Alignment.Center,
    ) {
        AppText(
            text = label,
            size = Theme.type.callout,
            lineHeight = Theme.type.calloutLine,
            weight = FontWeight.SemiBold,
            align = TextAlign.Center,
            maxLines = 1,
            color = ink,
            // Kept in the layout while busy so the button does not resize, but
            // taken out of the semantics tree so it is not read twice.
            modifier = if (busy) Modifier.alpha(0f) else Modifier,
        )

        if (busy) {
            CircularProgressIndicator(
                modifier = Modifier.size(20.dp),
                color = ink,
                strokeWidth = 2.dp,
            )
        }
    }
}

/**
 * The elevated surface every screen would otherwise declare by hand.
 *
 * Separated from the page by lift and by surface colour, not by an outline. It
 * used to carry a 1dp border in a mid-grey, inherited from a palette audit that
 * found the *input* outline invisible at 1.27:1 — a correct fix for a control
 * whose edge is its affordance, and the wrong one applied to every grouping
 * surface, which left the app looking like a wireframe of itself.
 *
 * The hairline that remains is `borderSubtle`, and it is there for the case
 * shadows cannot cover: a white card on a white background, where a reader with
 * a dimmed screen or a cheap panel would otherwise see no edge at all.
 *
 * `contentDescription` merges the children into one stop. A shift row read as
 * six separate nodes loses which number is the start and which the duration.
 */
@Composable
fun AppCard(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    contentDescription: String? = null,
    highlighted: Boolean = false,
    muted: Boolean = false,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = Theme.colors
    val shape = RoundedCornerShape(Theme.radius.md)

    var box = modifier
        .fillMaxWidth()
        .shadow(
            elevation = if (highlighted) Theme.elevation.raised else Theme.elevation.card,
            shape = shape,
            // Tinted rather than neutral black. A grey shadow on a lavender
            // page reads as dirt; the same shadow carrying a little of the
            // brand hue reads as depth.
            ambientColor = colors.shadow,
            spotColor = colors.shadow,
        )
        .clip(shape)
        .background(if (muted) colors.surface else colors.surfaceElevated)
        .border(
            BorderStroke(
                if (highlighted) 2.dp else 1.dp,
                if (highlighted) colors.primary else colors.borderSubtle,
            ),
            shape,
        )

    if (onClick != null) {
        box = box
            .defaultMinSize(minHeight = MinTouchTarget)
            .clickable(role = Role.Button, onClick = onClick)
    }

    if (contentDescription != null) {
        box = box.semantics(mergeDescendants = true) {
            this.contentDescription = contentDescription
        }
    }

    Column(modifier = box.padding(Theme.spacing.lg), content = content)
}

enum class BannerTone { INFO, SUCCESS, WARNING, ERROR }

/**
 * The tinted message block that says what happened.
 *
 * The title is required and is never decoration: it is what makes the tone
 * legible to somebody who cannot tell the success green from the warning
 * amber, which is roughly one man in twelve. An error is announced assertively
 * because it is telling somebody that the thing they just did did not happen;
 * anything else is polite, because a queued clock-in cutting across whatever
 * the screen reader was mid-way through saying is rude and no more useful.
 */
@Composable
fun Banner(
    tone: BannerTone,
    title: String,
    modifier: Modifier = Modifier,
    description: String? = null,
    action: (@Composable () -> Unit)? = null,
) {
    val colors = Theme.colors
    val background = when (tone) {
        BannerTone.INFO -> colors.surface
        BannerTone.SUCCESS -> colors.successSubtle
        BannerTone.WARNING -> colors.warningSubtle
        BannerTone.ERROR -> colors.dangerSubtle
    }
    val edge = when (tone) {
        BannerTone.INFO -> colors.border
        BannerTone.SUCCESS -> colors.success
        BannerTone.WARNING -> colors.warning
        BannerTone.ERROR -> colors.danger
    }
    val textTone = when (tone) {
        BannerTone.INFO -> TextTone.DEFAULT
        BannerTone.SUCCESS -> TextTone.SUCCESS
        BannerTone.WARNING -> TextTone.WARNING
        BannerTone.ERROR -> TextTone.DANGER
    }

    Row(
        modifier = modifier
            .fillMaxWidth()
            // IntrinsicSize.Min so the coloured edge is exactly as tall as the
            // text beside it, whatever the reader's text size does to it.
            .height(IntrinsicSize.Min)
            .clip(RoundedCornerShape(Theme.radius.md))
            .background(background)
            .semantics {
                liveRegion =
                    if (tone == BannerTone.ERROR) LiveRegionMode.Assertive else LiveRegionMode.Polite
            },
    ) {
        Box(
            Modifier
                .width(3.dp)
                .fillMaxHeight()
                .background(edge)
        )
        Column(Modifier.padding(Theme.spacing.md)) {
            AppText(
                title,
                size = Theme.type.footnote,
                lineHeight = Theme.type.footnoteLine,
                weight = FontWeight.SemiBold,
                tone = textTone,
            )
            if (description != null) {
                AppText(
                    description,
                    size = Theme.type.footnote,
                    lineHeight = Theme.type.footnoteLine,
                    tone = if (tone == BannerTone.INFO) TextTone.MUTED else textTone,
                )
            }
            if (action != null) {
                Box(Modifier.padding(top = Theme.spacing.sm)) { action() }
            }
        }
    }
}

enum class PillTone { SUCCESS, WARNING, DANGER, NEUTRAL, INFO }

/**
 * A status, as a word, on a tinted background.
 *
 * The word is not optional and there is no icon-only form. "Approved" and
 * "Rejected" are the pair people confuse, they were being distinguished by
 * green against red, and red-green is the common colour vision deficiency — so
 * the two states that matter most were the two least distinguishable. The
 * colour is a second channel here, never the only one.
 */
@Composable
fun StatusPill(label: String, tone: PillTone = PillTone.NEUTRAL, modifier: Modifier = Modifier) {
    val colors = Theme.colors
    val background = when (tone) {
        PillTone.SUCCESS -> colors.successSubtle
        PillTone.WARNING -> colors.warningSubtle
        PillTone.DANGER -> colors.dangerSubtle
        PillTone.INFO -> colors.primarySubtle
        PillTone.NEUTRAL -> colors.surface
    }
    val foreground = when (tone) {
        PillTone.SUCCESS -> TextTone.SUCCESS
        PillTone.WARNING -> TextTone.WARNING
        PillTone.DANGER -> TextTone.DANGER
        PillTone.INFO -> TextTone.PRIMARY
        PillTone.NEUTRAL -> TextTone.MUTED
    }

    Box(
        modifier = modifier
            .clip(RoundedCornerShape(Theme.radius.pill))
            .background(background)
            .padding(horizontal = Theme.spacing.sm, vertical = 3.dp),
    ) {
        // Never shrunk below the caption step. A status people squint at is one
        // they guess at, and the guess is made from the colour.
        AppText(
            label,
            size = Theme.type.caption,
            lineHeight = Theme.type.captionLine,
            weight = FontWeight.SemiBold,
            tone = foreground,
        )
    }
}

/**
 * Says what is not there, why, and what to do about it.
 *
 * The rule this enforces at every call site: an empty state must never be
 * shown while the answer is still unknown. "You have not applied for any leave
 * yet" during the first request is a statement about somebody's record that
 * the app has not checked, and the reader cannot tell it from the truth.
 */
@Composable
fun EmptyState(
    title: String,
    modifier: Modifier = Modifier,
    description: String? = null,
    /**
     * A glyph for the void.
     *
     * An empty screen was two lines of text stranded in a full page of nothing,
     * which reads as a failure to load rather than as "there is nothing here
     * yet". The disc gives the eye somewhere to land and matches the badges used
     * everywhere else, so an empty screen looks like part of the same product.
     *
     * Defaulted rather than required: every empty state gains one without
     * twenty-eight call sites having to agree on it, and a screen with a better
     * idea can still pass its own.
     */
    glyph: Glyph = Glyph.Vector(Icons.Outlined.Inbox),
    tone: AccentTone = AccentTone.Violet,
    action: (@Composable () -> Unit)? = null,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = Theme.spacing.xxl, horizontal = Theme.spacing.md)
            .semantics(mergeDescendants = true) {},
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.xs),
    ) {
        // Decorative: the title says the same thing, and a screen reader
        // announcing "inbox tray" before it is noise.
        AccentBadge(glyph = glyph, tone = tone, diameter = 64.dp)
        Spacer(Modifier.height(Theme.spacing.sm))
        AppText(
            title,
            size = Theme.type.callout,
            lineHeight = Theme.type.calloutLine,
            weight = FontWeight.SemiBold,
            align = TextAlign.Center,
        )
        if (description != null) {
            AppText(
                description,
                size = Theme.type.footnote,
                lineHeight = Theme.type.footnoteLine,
                tone = TextTone.MUTED,
                align = TextAlign.Center,
            )
        }
        if (action != null) {
            Box(Modifier.padding(top = Theme.spacing.md)) { action() }
        }
    }
}

/**
 * A switch that belongs to this product.
 *
 * Material's own unchecked style draws a ring in `outline` and a thumb the same
 * weight. This palette's `border` is deliberately high-contrast — it exists so
 * the edge of a text input is visible, which is the one place an edge carries
 * meaning — and a control ringed in it reads as disabled rather than as off.
 * People were looking at a switch they could perfectly well tap and concluding
 * the form was locked.
 *
 * Off is therefore quiet: a pale track with a muted thumb, still meeting the
 * 3:1 the thumb needs to be findable. On is unambiguous — the brand colour,
 * filled, with a white thumb.
 */
@Composable
fun AppSwitch(
    checked: Boolean,
    onCheckedChange: ((Boolean) -> Unit)?,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    Switch(
        checked = checked,
        onCheckedChange = onCheckedChange,
        enabled = enabled,
        modifier = modifier,
        colors = SwitchDefaults.colors(
            checkedThumbColor = Theme.colors.onPrimary,
            checkedTrackColor = Theme.colors.primary,
            checkedBorderColor = Theme.colors.primary,
            uncheckedThumbColor = Theme.colors.textMuted,
            uncheckedTrackColor = Theme.colors.borderSubtle,
            uncheckedBorderColor = Theme.colors.borderSubtle,
        ),
    )
}

/**
 * What a list shows while it does not yet know what it holds.
 *
 * Static, not shimmering. The system's "remove animations" setting exists for
 * people who are harmed by movement, and a shimmer is exactly the sort of
 * decoration that gets left running through it. A reserved block of the right
 * height says "rows, shortly" and stops the content jumping when it lands,
 * which is the whole job.
 */
@Composable
fun SkeletonRows(
    count: Int = 4,
    rowHeight: Dp = 64.dp,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            // Hidden from assistive technology, and announced once as
            // "Loading". A screen reader reading a row of placeholders reports
            // content that is not there; silence reports a finished, empty
            // screen.
            .clearAndSetSemantics { contentDescription = "Loading" },
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.sm),
    ) {
        repeat(count) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(rowHeight)
                    .clip(RoundedCornerShape(Theme.radius.md))
                    .background(Theme.colors.borderSubtle)
            )
        }
    }
}

/** Screen padding, defined once so no screen invents its own. */
@Composable
fun screenPadding(bottomExtra: Dp = 0.dp): PaddingValues =
    PaddingValues(
        start = Theme.spacing.lg,
        end = Theme.spacing.lg,
        top = Theme.spacing.lg,
        bottom = Theme.spacing.lg + bottomExtra,
    )
