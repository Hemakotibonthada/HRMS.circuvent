// ═══════════════════════════════════════════════════════════════
// SCREEN
// ═══════════════════════════════════════════════════════════════
// The frame every screen was rebuilding by hand: safe area, scroll view,
// pull-to-refresh, consistent padding, and room at the bottom for the tab bar.
//
// Copied ten times it drifted ten ways — one screen padded at `lg`, another at
// `md`, two forgot `edges={["bottom"]}` and put content under the home
// indicator. That is not a tidiness complaint: content under the indicator is
// content that cannot be tapped.
//
// `scrollable={false}` exists for screens that own their own list. A FlatList
// inside a ScrollView renders every row at once, which is the difference
// between a directory that opens and one that freezes.

import { type ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/theme/ThemeProvider";

export interface ScreenProps {
  children: ReactNode;
  /** Wires up pull-to-refresh. Omit it and no refresh control is rendered. */
  onRefresh?: () => void;
  refreshing?: boolean;
  scrollable?: boolean;
  /** Set when the screen sits behind the tab bar and needs clearance. */
  tabBarInset?: boolean;
  /** For forms: lifts content clear of the keyboard. */
  keyboardAware?: boolean;
  /**
   * Centres the content vertically.
   *
   * For a screen with one job — sign-in — where the fields belong under the
   * thumb rather than under the status bar.
   */
  centred?: boolean;
  /**
   * Claims the top inset too.
   *
   * Only for screens rendered without a header. On every other screen the
   * header owns that space, and taking it here as well leaves a band of empty
   * background above the title.
   */
  topInset?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}

/** Height of the tab bar, so scrolling content can clear it. */
export const TAB_BAR_CLEARANCE = 72;

export function Screen({
  children,
  onRefresh,
  refreshing = false,
  scrollable = true,
  tabBarInset = false,
  keyboardAware = false,
  centred = false,
  topInset = false,
  contentStyle,
}: ScreenProps) {
  const theme = useTheme();

  const padding = {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.lg + (tabBarInset ? TAB_BAR_CLEARANCE : 0),
  };

  // `flexGrow`, not `flex`. With `flex: 1` a content taller than the screen —
  // which is what happens at a large OS text size — stops scrolling, and the
  // submit button becomes unreachable.
  const centring = centred ? styles.centred : null;

  const body = scrollable ? (
    <ScrollView
      contentContainerStyle={[padding, centring, contentStyle]}
      // Lets someone dismiss the keyboard by scrolling rather than hunting for
      // a Done button that iOS does not always provide.
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.fill, padding, centring, contentStyle]}>{children}</View>
  );

  return (
    <SafeAreaView
      style={[styles.fill, { backgroundColor: theme.colors.background }]}
      // The header owns the top inset on every screen that has one, and
      // claiming it here as well leaves a band of background above the title.
      edges={topInset ? ["top", "bottom"] : ["bottom"]}
    >
      {keyboardAware ? (
        <KeyboardAvoidingView
          style={styles.fill}
          // iOS moves the whole view; Android already resizes it, and padding
          // there produces a double shift that hides the field being typed in.
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centred: { flexGrow: 1, justifyContent: "center" },
});
