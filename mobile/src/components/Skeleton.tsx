// ═══════════════════════════════════════════════════════════════
// SKELETON
// ═══════════════════════════════════════════════════════════════
// What a list shows while it does not yet know what it contains.
//
// It exists so that no screen has to choose between two lies: an empty state,
// which asserts there is nothing, and a bare spinner, which says nothing about
// what is coming. A skeleton says "rows, shortly" and reserves their height,
// so the content does not jump when it lands.
//
// Reduced motion is honoured, and the default before the setting has been read
// is *no* animation. The check is asynchronous, so there is a frame or two
// where the answer is unknown; starting the pulse and stopping it is worse for
// exactly the person the setting protects than starting still and beginning to
// move.

import { useEffect, useState } from "react";
import { AccessibilityInfo, Animated, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";

/** Tracks the OS reduce-motion setting, including changes while running. */
function useReducedMotion(): boolean {
  // Starts true — still — until proven otherwise. See the note above.
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (!cancelled) setReduced(enabled);
      })
      // A device that cannot answer is treated as wanting less motion. The
      // cost of being wrong in that direction is a static placeholder.
      .catch(() => {
        if (!cancelled) setReduced(true);
      });

    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled) => {
      if (!cancelled) setReduced(enabled);
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduced;
}

export interface SkeletonProps {
  height?: number;
  width?: number | `${number}%`;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

export function Skeleton({ height = 16, width = "100%", radius, style }: SkeletonProps) {
  const theme = useTheme();
  const reduced = useReducedMotion();

  // Lazy state, not `useRef(...).current`. Reading a ref during render is a
  // side effect: React may discard a render pass under concurrent features or
  // run it twice in StrictMode, so the value can belong to a pass that never
  // commits. `useState` with an initialiser function creates the value exactly
  // once and is never read as a ref. The web app fixed the same shape in
  // useIntersectionObserver and useInterval.
  const [pulse] = useState(() => new Animated.Value(0.6));

  useEffect(() => {
    if (reduced) {
      // Held at a fixed, legible opacity rather than wherever the animation
      // happened to stop.
      pulse.setValue(0.6);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.45,
          duration: 700,
          useNativeDriver: true,
        }),
      ])
    );

    loop.start();
    // Stopped on unmount. A loop left running holds the JS thread awake and
    // keeps re-rendering a screen nobody is looking at.
    return () => loop.stop();
  }, [reduced, pulse]);

  return (
    <Animated.View
      // Hidden from assistive technology entirely. A screen reader announcing
      // a row of placeholders reads as content that is there.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          height,
          width,
          borderRadius: radius ?? theme.radius.sm,
          backgroundColor: theme.colors.border,
          opacity: pulse,
        },
        style,
      ]}
    />
  );
}

export interface SkeletonListProps {
  /** How many placeholder rows. Match the usual page size, not the maximum. */
  rows?: number;
  rowHeight?: number;
}

/**
 * A page of placeholder rows, shaped like the cards they stand in for.
 *
 * Announced once, politely, as "Loading". Without it a screen reader user gets
 * silence and no way to tell a slow network from a finished, empty screen.
 */
export function SkeletonList({ rows = 4, rowHeight = 64 }: SkeletonListProps) {
  const theme = useTheme();

  return (
    <View accessibilityLiveRegion="polite" accessibilityLabel="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton
          key={index}
          height={rowHeight}
          radius={theme.radius.md}
          style={{ marginBottom: theme.spacing.sm }}
        />
      ))}
    </View>
  );
}
