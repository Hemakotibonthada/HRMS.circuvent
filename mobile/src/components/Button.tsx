// ═══════════════════════════════════════════════════════════════
// BUTTON
// ═══════════════════════════════════════════════════════════════
// Everything here that looks like fussiness is a real failure mode:
//
//  - `hitSlop` to the platform minimum. A visually small button (an icon, a
//    "Cancel") is still a 48pt target. On the clock-in screen a mis-tap is
//    someone's attendance record.
//  - `accessibilityRole` and a label, always. A VoiceOver user hearing
//    "button" with no name has to activate it to find out what it does, and
//    on this screen that submits something.
//  - `accessibilityState.disabled` and `busy`, not just a colour change.
//    Opacity is invisible to a screen reader.
//  - Press feedback within 100ms. Below that the app feels broken and people
//    tap again, which is how a leave request gets submitted twice.
//  - A busy button stays laid out at the same size. Swapping the label for a
//    spinner resizes it, and the control moves out from under the finger.

import { useCallback, useRef } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TOUCH_TARGET } from "@/theme/tokens";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  busy?: boolean;
  /** Spoken instead of `label` when the visible text is not self-explanatory. */
  accessibilityLabel?: string;
  /** Spoken after the label: what will happen. */
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  fullWidth?: boolean;
}

/**
 * Ignores taps within 400ms of the last one.
 *
 * Not a nicety. `onPress` fires per tap, an impatient double-tap on a slow
 * network fires twice, and two of these screens submit money. Idempotency
 * keys make the server side safe, but the user should not see two rows appear
 * and then one vanish.
 */
function useDebouncedPress(onPress: () => void, disabled: boolean) {
  const lastPress = useRef(0);

  return useCallback(() => {
    if (disabled) return;
    const now = Date.now();
    if (now - lastPress.current < 400) return;
    lastPress.current = now;
    onPress();
  }, [onPress, disabled]);
}

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled = false,
  busy = false,
  accessibilityLabel,
  accessibilityHint,
  style,
  fullWidth = true,
}: ButtonProps) {
  const theme = useTheme();
  const inert = disabled || busy;
  const handlePress = useDebouncedPress(onPress, inert);

  const palette = {
    primary: { background: theme.colors.primary, text: theme.colors.onPrimary, border: "transparent" },
    secondary: {
      background: theme.colors.surfaceElevated,
      text: theme.colors.text,
      border: theme.colors.border,
    },
    ghost: { background: "transparent", text: theme.colors.primary, border: "transparent" },
    danger: { background: theme.colors.danger, text: "#FFFFFF", border: "transparent" },
  }[variant];

  return (
    <Pressable
      onPress={handlePress}
      disabled={inert}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      // Communicated to assistive technology as well as shown. A dimmed
      // button is not information a screen reader can convey.
      accessibilityState={{ disabled: inert, busy }}
      hitSlop={8}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: MIN_TOUCH_TARGET,
          paddingHorizontal: theme.spacing.xl,
          borderRadius: theme.radius.md,
          backgroundColor: palette.background,
          borderColor: palette.border,
          borderWidth: variant === "secondary" ? StyleSheet.hairlineWidth * 2 : 0,
          alignSelf: fullWidth ? "stretch" : "flex-start",
          // Immediate, visible feedback. Anything slower reads as a dropped tap.
          opacity: pressed ? 0.75 : inert ? 0.45 : 1,
        },
        style,
      ]}
    >
      {/* The label stays mounted while busy so the button does not resize and
          move out from under the finger; the spinner sits on top of it. */}
      <Text
        style={[
          styles.label,
          {
            color: palette.text,
            fontSize: theme.fontSize.callout,
            lineHeight: theme.lineHeight.callout,
            fontWeight: theme.fontWeight.semibold,
            opacity: busy ? 0 : 1,
          },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>

      {busy ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <View style={styles.spinner}>
            <ActivityIndicator color={palette.text} />
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  label: {
    textAlign: "center",
  },
  spinner: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
