import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, StyleSheet, Text, View, type AppStateStatus } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/Button";
import { isEnabled, unlock, type UnlockResult } from "@/lib/biometrics";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * Covers the app when it returns to the foreground, if the user turned the
 * lock on.
 *
 * Locks after a grace period rather than on every backgrounding. Switching to
 * the camera to photograph a receipt, or to the authenticator for a code, sends
 * the app to the background for two seconds; demanding a face scan on the way
 * back makes the lock feel like an obstacle and is the reason people turn it
 * off, which leaves them less protected than a lock with a sensible grace
 * period.
 */
const GRACE_MS = 60_000;

export function BiometricGate({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const { status } = useSession();

  const [locked, setLocked] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const backgroundedAt = useRef<number | null>(null);
  const prompting = useRef(false);

  const attempt = useCallback(async () => {
    // Two prompts stacked on top of each other is a platform-level mess on
    // Android, and the second one usually resolves as a cancel.
    if (prompting.current) return;
    prompting.current = true;

    try {
      const result: UnlockResult = await unlock();
      if (result === "unlocked" || result === "unavailable") {
        // "unavailable" means the biometric was removed or unenrolled since
        // the setting was turned on. Holding someone out of their own app
        // because their phone changed would be punishing them for it; the
        // session token still gates everything that matters.
        setLocked(false);
        setMessage(null);
      } else if (result === "cancelled") {
        setMessage("Unlock to continue.");
      } else {
        setMessage("That did not match. Try again.");
      }
    } finally {
      prompting.current = false;
    }
  }, []);

  useEffect(() => {
    if (status !== "signed_in") {
      setLocked(false);
      return;
    }

    const subscription = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "background" || next === "inactive") {
        // Recorded on the way out, not on the way in: by the time the app is
        // active again the OS no longer says how long it was away.
        backgroundedAt.current ??= Date.now();
        return;
      }

      if (next !== "active") return;

      const away = backgroundedAt.current;
      backgroundedAt.current = null;
      if (away === null || Date.now() - away < GRACE_MS) return;

      void (async () => {
        if (!(await isEnabled())) return;
        setLocked(true);
        await attempt();
      })();
    });

    return () => subscription.remove();
  }, [status, attempt]);

  if (!locked) return <>{children}</>;

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: theme.colors.background }]}>
      <View style={styles.centre}>
        <Text
          accessibilityRole="header"
          style={{
            color: theme.colors.text,
            fontSize: theme.fontSize.title2,
            lineHeight: theme.lineHeight.title2,
            fontWeight: theme.fontWeight.bold,
            textAlign: "center",
          }}
        >
          Circuvent HR is locked
        </Text>

        {message ? (
          <Text
            accessibilityLiveRegion="polite"
            style={{
              color: theme.colors.textMuted,
              fontSize: theme.fontSize.body,
              lineHeight: theme.lineHeight.body,
              textAlign: "center",
              marginTop: theme.spacing.sm,
            }}
          >
            {message}
          </Text>
        ) : null}

        <Button
          label="Unlock"
          onPress={() => void attempt()}
          fullWidth={false}
          style={{ marginTop: theme.spacing.xl }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
});
