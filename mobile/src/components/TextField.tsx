// ═══════════════════════════════════════════════════════════════
// TEXT FIELD
// ═══════════════════════════════════════════════════════════════
// A visible label, always — never a placeholder standing in for one. A
// placeholder disappears the moment someone types, so anyone who is
// interrupted mid-form comes back to a filled box with no idea what it holds.
// It also fails to be announced as a label by screen readers, and it usually
// lands at placeholder-grey contrast, which is where the "gray on gray"
// accessibility failures come from.
//
// Errors sit under the field they belong to, not in a summary at the top of
// the form. On a phone the top of the form is off-screen by the time you
// reach the field that is wrong.

import { forwardRef, useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TOUCH_TARGET } from "@/theme/tokens";

export interface TextFieldProps extends Omit<TextInputProps, "style"> {
  label: string;
  /** Shown under the field. Replaced by `error` when there is one. */
  hint?: string;
  error?: string;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, hint, error, onFocus, onBlur, ...inputProps },
  ref
) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);

  const borderColor = error
    ? theme.colors.danger
    : focused
      ? theme.colors.focus
      : theme.colors.border;

  return (
    <View style={{ marginBottom: theme.spacing.lg }}>
      <Text
        style={{
          color: theme.colors.text,
          fontSize: theme.fontSize.footnote,
          lineHeight: theme.lineHeight.footnote,
          fontWeight: theme.fontWeight.medium,
          marginBottom: theme.spacing.xs,
        }}
      >
        {label}
      </Text>

      <TextInput
        ref={ref}
        // Announced to screen readers. Without it the field is just "text
        // field", and the visible label above is a separate, unlinked node.
        accessibilityLabel={label}
        accessibilityHint={error ?? hint}
        placeholderTextColor={theme.colors.textMuted}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[
          styles.input,
          {
            minHeight: MIN_TOUCH_TARGET,
            paddingHorizontal: theme.spacing.md,
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.surfaceElevated,
            color: theme.colors.text,
            fontSize: theme.fontSize.body,
            borderColor,
            // The focus ring is thicker, not just a different colour. Colour
            // alone is not a sufficient indicator, and a hairline focus state
            // is invisible outdoors.
            borderWidth: focused || error ? 2 : StyleSheet.hairlineWidth * 2,
          },
        ]}
        {...inputProps}
      />

      {error ? (
        <Text
          // `alert` so the message is announced when it appears rather than
          // only when the user happens to swipe onto it.
          accessibilityRole="alert"
          style={{
            color: theme.colors.danger,
            fontSize: theme.fontSize.footnote,
            lineHeight: theme.lineHeight.footnote,
            marginTop: theme.spacing.xs,
          }}
        >
          {error}
        </Text>
      ) : hint ? (
        <Text
          style={{
            color: theme.colors.textMuted,
            fontSize: theme.fontSize.footnote,
            lineHeight: theme.lineHeight.footnote,
            marginTop: theme.spacing.xs,
          }}
        >
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  input: {
    width: "100%",
  },
});
