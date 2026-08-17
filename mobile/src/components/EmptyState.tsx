// ═══════════════════════════════════════════════════════════════
// EMPTY STATE
// ═══════════════════════════════════════════════════════════════
// Says what is not there, why, and what to do about it.
//
// The rule this exists to enforce: an empty state must never be rendered while
// the answer is still unknown. "You have not applied for any leave yet" shown
// during the first request is a statement about someone's record that the app
// has not checked, and the reader has no way to tell it apart from the truth.
// That is the same defect as an API returning `data: []` after authenticating
// instead of admitting it is not built — it reads as a fact rather than a gap.
//
// So callers pass `loading` through and get a skeleton instead. Making it one
// component means the choice cannot be forgotten at a call site.

import { type ReactNode } from "react";
import { View } from "react-native";
import { AppText } from "@/components/Typography";
import { useTheme } from "@/theme/ThemeProvider";

export interface EmptyStateProps {
  title: string;
  /** What to do next. An empty state without one leaves people stuck. */
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  const theme = useTheme();

  return (
    <View
      // One stop for a screen reader. Announced as three separate nodes, the
      // description arrives detached from the thing it explains.
      accessible
      accessibilityLabel={description ? `${title}. ${description}` : title}
      style={{
        paddingVertical: theme.spacing.xxl,
        paddingHorizontal: theme.spacing.md,
        alignItems: "center",
      }}
    >
      <AppText variant="callout" weight="semibold" align="center">
        {title}
      </AppText>

      {description ? (
        <AppText
          variant="footnote"
          tone="muted"
          align="center"
          style={{ marginTop: theme.spacing.xs, maxWidth: 320 }}
        >
          {description}
        </AppText>
      ) : null}

      {action ? <View style={{ marginTop: theme.spacing.lg }}>{action}</View> : null}
    </View>
  );
}
