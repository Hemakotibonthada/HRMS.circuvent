// ═══════════════════════════════════════════════════════════════
// STATUS PILL
// ═══════════════════════════════════════════════════════════════
// A status, as a word, on a tinted background.
//
// The word is not optional and there is no icon-only form. "Approved" and
// "Rejected" are the pair people confuse, they were being distinguished by
// green against red, and red-green is the common colour vision deficiency —
// so the two states that matter most were the two least distinguishable. The
// colour is a second channel here, never the only one.
//
// The tint is `*Subtle` against the `*` foreground because those are the pairs
// the contrast contract in mobile/src/theme/tokens.test.ts actually checks.
// Inventing a new pairing here would put a colour on screen that nothing
// measures.

import { View, type StyleProp, type ViewStyle } from "react-native";
import { AppText, type TextTone } from "@/components/Typography";
import { useTheme } from "@/theme/ThemeProvider";

export type PillTone = "success" | "warning" | "danger" | "neutral" | "info";

export interface StatusPillProps {
  label: string;
  tone?: PillTone;
  style?: StyleProp<ViewStyle>;
}

export function StatusPill({ label, tone = "neutral", style }: StatusPillProps) {
  const theme = useTheme();

  const palette: Record<PillTone, { background: string; foreground: TextTone }> = {
    success: { background: theme.colors.successSubtle, foreground: "success" },
    warning: { background: theme.colors.warningSubtle, foreground: "warning" },
    danger: { background: theme.colors.dangerSubtle, foreground: "danger" },
    info: { background: theme.colors.primarySubtle, foreground: "primary" },
    neutral: { background: theme.colors.surface, foreground: "muted" },
  };

  const { background, foreground } = palette[tone];

  return (
    <View
      style={[
        {
          backgroundColor: background,
          borderRadius: theme.radius.pill,
          paddingHorizontal: theme.spacing.sm,
          paddingVertical: 3,
          alignSelf: "flex-start",
        },
        style,
      ]}
    >
      {/* Not shrunk below the caption size. A status people squint at is one
          they guess at, and the guess is made from the colour. */}
      <AppText variant="caption" weight="semibold" tone={foreground}>
        {label}
      </AppText>
    </View>
  );
}
