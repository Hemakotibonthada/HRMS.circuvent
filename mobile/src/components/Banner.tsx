// ═══════════════════════════════════════════════════════════════
// BANNER
// ═══════════════════════════════════════════════════════════════
// The tinted message block that sits under an action and says what happened.
//
// The announcement behaviour is the reason this is a component rather than a
// styled View. Three rules, and each one was applied inconsistently when this
// was written out by hand:
//
//   * An error is `role="alert"` and assertive. It interrupts, because it is
//     telling someone that the thing they just did did not happen.
//   * Anything else is polite. A queued clock-in cutting across whatever the
//     screen reader was mid-way through saying is rude and no more useful.
//   * The tone is never carried by colour alone. Every banner takes a title
//     that says in words what the colour is hinting at, because roughly one
//     man in twelve cannot tell the success green from the warning amber.

import { type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { AppText, type TextTone } from "@/components/Typography";
import { useTheme } from "@/theme/ThemeProvider";

export type BannerTone = "info" | "success" | "warning" | "error";

export interface BannerProps {
  tone: BannerTone;
  /** Said first, in words. Not decoration — it is what makes the tone legible. */
  title: string;
  description?: string;
  /** Supplementary content: a list of reasons, a set of rows. */
  children?: ReactNode;
  /** A button or two, rendered last. Kept separate from `children` so that a
   *  list of reasons is not mistaken for something the reader can act on. */
  action?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function Banner({ tone, title, description, children, action, style }: BannerProps) {
  const theme = useTheme();

  const palette: Record<BannerTone, { background: string; foreground: TextTone }> = {
    info: { background: theme.colors.surface, foreground: "default" },
    success: { background: theme.colors.successSubtle, foreground: "success" },
    warning: { background: theme.colors.warningSubtle, foreground: "warning" },
    error: { background: theme.colors.dangerSubtle, foreground: "danger" },
  };

  const { background, foreground } = palette[tone];
  const urgent = tone === "error";

  return (
    <View
      accessibilityRole={urgent ? "alert" : undefined}
      // Assertive interrupts; polite waits its turn. A failed action is worth
      // interrupting for, a queued one is not.
      accessibilityLiveRegion={urgent ? "assertive" : "polite"}
      style={[
        {
          backgroundColor: background,
          borderRadius: theme.radius.md,
          padding: theme.spacing.md,
          // A left edge in the tone colour, so the banner still reads as
          // distinct on a device with colour filters turned on.
          borderLeftWidth: 3,
          borderLeftColor:
            tone === "info"
              ? theme.colors.border
              : tone === "success"
                ? theme.colors.success
                : tone === "warning"
                  ? theme.colors.warning
                  : theme.colors.danger,
        },
        style,
      ]}
    >
      <AppText variant="footnote" weight="semibold" tone={foreground}>
        {title}
      </AppText>

      {description ? (
        <AppText
          variant="footnote"
          tone={tone === "info" ? "muted" : foreground}
          style={{ marginTop: 2 }}
        >
          {description}
        </AppText>
      ) : null}

      {children ? <View style={{ marginTop: theme.spacing.sm }}>{children}</View> : null}

      {action ? <View style={{ marginTop: theme.spacing.sm }}>{action}</View> : null}
    </View>
  );
}
