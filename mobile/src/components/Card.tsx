// ═══════════════════════════════════════════════════════════════
// CARD
// ═══════════════════════════════════════════════════════════════
// The elevated surface that every screen was declaring inline, down to the
// same `StyleSheet.hairlineWidth * 2` border. That doubling is deliberate and
// worth keeping in one place: a hairline border on a high-density screen is
// sub-pixel, and the palette audit found the light border already sitting at
// 1.27:1 against the page. Halving its apparent width would have taken it
// below visible entirely.
//
// The pressable form is a separate prop rather than a separate component
// because a card that becomes tappable must also become a button to assistive
// technology, must take the platform's minimum target height, and must say
// what it does. Leaving that to each call site is how 37 mouse-only controls
// reached the web app.

import { type ReactNode } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TOUCH_TARGET } from "@/theme/tokens";

export interface CardProps {
  children: ReactNode;
  /** Makes the card a button. Requires an accessibility label. */
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Draws attention without colour alone — a thicker, tinted edge. */
  highlighted?: boolean;
  /** Recedes the surface, for secondary groupings. */
  muted?: boolean;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Card({
  children,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  highlighted = false,
  muted = false,
  padded = true,
  style,
}: CardProps) {
  const theme = useTheme();

  const surface: ViewStyle = {
    backgroundColor: muted ? theme.colors.surface : theme.colors.surfaceElevated,
    borderColor: highlighted ? theme.colors.primary : theme.colors.border,
    borderWidth: highlighted ? 2 : StyleSheet.hairlineWidth * 2,
    borderRadius: theme.radius.md,
    padding: padded ? theme.spacing.md : 0,
    ...(muted ? {} : theme.elevation.card),
  };

  if (!onPress) {
    // A label without a press handler still matters: the shift and attendance
    // rows are read-only cards that carry a grouped label so a screen reader
    // announces "Late shift, 22:00 to 06:00, 8h, finishes the next day" as one
    // thing. Dropping the label here — which an earlier version of this file
    // did — scatters it back into six unrelated stops.
    return (
      <View
        accessible={accessibilityLabel !== undefined}
        accessibilityLabel={accessibilityLabel}
        style={[surface, style]}
      >
        {children}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      hitSlop={4}
      style={({ pressed }) => [
        surface,
        // The whole row is the target, so it must be at least as tall as a
        // finger even when its content is one short line.
        { minHeight: MIN_TOUCH_TARGET, justifyContent: "center" },
        pressed ? { opacity: 0.75 } : null,
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}
