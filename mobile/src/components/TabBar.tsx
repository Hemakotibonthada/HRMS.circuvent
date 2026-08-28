// ═══════════════════════════════════════════════════════════════
// TAB BAR
// ═══════════════════════════════════════════════════════════════
// Bottom navigation over the five destinations in lib/navigation.ts.
//
// Before this, every destination in the app was reached from a column of
// buttons stacked down the home screen. That works for two. At five it means
// scrolling past the clock-in button — the one thing the app exists for — to
// reach a payslip, and there is no way to tell where you are.
//
// Hand-rolled rather than expo-router's `Tabs`, deliberately:
//
//   * Adopting `Tabs` means moving every screen into an `app/(tabs)/` group.
//     Restructuring the routes of an app that cannot be run and checked here
//     risks breaking navigation that currently works, to gain styling this
//     file does anyway.
//   * The pieces that actually matter — `role="tab"`, `selected` state, a
//     48pt target, a label that is always visible — are explicit here rather
//     than inherited from a navigator's defaults and hoped for.
//
// The rule for *where* the bar appears lives in lib/navigation.ts so it can be
// tested without a device. This file is the drawing.
//
// Switching uses `replace`, so the back stack does not grow one entry per tap.
// Tapping the tab you are already on does nothing at all, rather than pushing
// a second copy of the screen you are looking at.

import { Feather } from "@expo/vector-icons";
import { usePathname, useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { AppText } from "@/components/Typography";
import { activeSegment, isTabRoot, TAB_DESTINATIONS } from "@/lib/navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TOUCH_TARGET } from "@/theme/tokens";

type IconName = React.ComponentProps<typeof Feather>["name"];

export function TabBar() {
  const theme = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  if (!isTabRoot(pathname)) return null;

  const active = activeSegment(pathname);

  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: "row",
        backgroundColor: theme.colors.surfaceElevated,
        borderTopColor: theme.colors.border,
        borderTopWidth: StyleSheet.hairlineWidth * 2,
        paddingTop: theme.spacing.xs,
        // The home indicator's own space, plus a little. Content flush against
        // the indicator is content the OS gesture takes the tap for.
        paddingBottom: Math.max(insets.bottom, theme.spacing.sm),
      }}
    >
      {TAB_DESTINATIONS.map((destination) => {
        const selected = destination.segment === active;

        return (
          <Pressable
            key={destination.href}
            accessibilityRole="tab"
            accessibilityLabel={destination.label}
            // Spoken as "selected", not merely drawn in the accent colour.
            accessibilityState={{ selected }}
            onPress={() => {
              // Already here. Navigating would rebuild the screen under the
              // finger and lose the scroll position for no gain.
              if (selected) return;
              router.replace(destination.href);
            }}
            style={({ pressed }) => [
              styles.item,
              {
                minHeight: MIN_TOUCH_TARGET,
                paddingVertical: theme.spacing.xs,
                opacity: pressed ? 0.6 : 1,
              },
            ]}
          >
            <Feather
              name={destination.icon as IconName}
              size={22}
              color={selected ? theme.colors.primary : theme.colors.textMuted}
            />
            {/* The label is always visible, never only on the selected tab.
                An unlabelled icon is a guess, and the guess is made worst by
                the people who use the app least often. */}
            <AppText
              variant="caption"
              tone={selected ? "primary" : "muted"}
              weight={selected ? "semibold" : "regular"}
              numberOfLines={1}
              style={{ marginTop: 2 }}
            >
              {destination.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  item: { flex: 1, alignItems: "center", justifyContent: "center" },
});
