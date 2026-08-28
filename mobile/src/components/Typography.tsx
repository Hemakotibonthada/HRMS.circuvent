// ═══════════════════════════════════════════════════════════════
// TYPOGRAPHY
// ═══════════════════════════════════════════════════════════════
// Every screen was spelling out `{ color, fontSize, lineHeight, fontWeight }`
// at each text node — four values, from four different token objects, at
// roughly two hundred call sites. Two things went wrong with that, repeatedly:
//
//   * A size taken from one scale and a line height from another. React
//     Native's lineHeight is in points, so `fontSize.title2` with
//     `lineHeight.body` draws 24pt text on a 22pt line and the descenders
//     collide with the row beneath.
//   * Colour picked by eye. The palette audit found fifteen pairs below WCAG
//     AA, and the way a sixteenth appears is someone reaching for
//     `textMuted` on a `primary` background because it looked about right.
//
// Pairing them here means a size carries its line height, and a tone names a
// foreground the contract has already checked against the surface it is used on.
//
// It is also the one place that can fix the OS text-size defect. React Native
// scales `fontSize` for the user's setting and leaves `lineHeight` alone, so
// absolute line heights — which the theme has to use, because React Native's
// lineHeight is points and not a ratio — leave 30-point glyphs on a 22-point
// line at 200%. That clips, and it clips for the people who turned the setting
// up because they were struggling to read it already. Every screen inherits
// the fix by using this component; none of them has to know about it.

import { Text, useWindowDimensions, type StyleProp, type TextProps, type TextStyle } from "react-native";
import { scaledLineHeight } from "@/lib/type-scale";
import { useTheme } from "@/theme/ThemeProvider";

export type TextVariant =
  | "display"
  | "title1"
  | "title2"
  | "title3"
  | "callout"
  | "body"
  | "footnote"
  | "caption";

export type TextTone =
  | "default"
  | "muted"
  | "primary"
  | "onPrimary"
  | "success"
  | "warning"
  | "danger";

export type TextWeight = "regular" | "medium" | "semibold" | "bold";

export interface AppTextProps extends Omit<TextProps, "style"> {
  children: React.ReactNode;
  variant?: TextVariant;
  tone?: TextTone;
  weight?: TextWeight;
  /**
   * Fixed-width digits.
   *
   * For anything that sits in a column and is read down: times, durations,
   * money, leave balances. Proportional figures make the column jitter, and a
   * jittering column of pay is hard to scan and easy to misread.
   */
  tabular?: boolean;
  /** Announces the text as a heading, so a screen reader can jump between them. */
  heading?: boolean;
  align?: TextStyle["textAlign"];
  style?: StyleProp<TextStyle>;
}

export function AppText({
  children,
  variant = "body",
  tone = "default",
  weight = "regular",
  tabular = false,
  heading = false,
  align,
  style,
  ...rest
}: AppTextProps) {
  const theme = useTheme();
  // From useWindowDimensions rather than PixelRatio.getFontScale(): the hook
  // re-renders when the setting changes, and people do change it while an app
  // is open — that is what the iOS Control Centre text-size slider is for. A
  // one-shot read leaves the app at whatever the scale was on launch.
  const { fontScale } = useWindowDimensions();

  const colour: Record<TextTone, string> = {
    default: theme.colors.text,
    muted: theme.colors.textMuted,
    primary: theme.colors.primary,
    onPrimary: theme.colors.onPrimary,
    success: theme.colors.success,
    warning: theme.colors.warning,
    danger: theme.colors.danger,
  };

  return (
    <Text
      accessibilityRole={heading ? "header" : undefined}
      style={[
        {
          color: colour[tone],
          fontSize: theme.fontSize[variant],
          // Taken from the same key as the size, so the two cannot be mixed,
          // and scaled by the same multiplier the OS applies to the glyphs.
          lineHeight: scaledLineHeight(theme.lineHeight[variant], fontScale),
          fontWeight: theme.fontWeight[weight],
          textAlign: align,
        },
        tabular ? { fontVariant: ["tabular-nums"] as const } : null,
        style,
      ]}
      {...rest}
    >
      {children}
    </Text>
  );
}
