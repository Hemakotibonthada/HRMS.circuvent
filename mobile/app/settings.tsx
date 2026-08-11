import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/Button";
import { checkSupport, isEnabled, setEnabled, unlock, type BiometricSupport } from "@/lib/biometrics";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme/ThemeProvider";

const KIND_LABEL: Record<string, string> = {
  face: "Face ID",
  fingerprint: "Fingerprint",
  iris: "Iris",
  unknown: "Biometric unlock",
};

export default function SettingsScreen() {
  const theme = useTheme();
  const { user, signOut } = useSession();

  const [support, setSupport] = useState<BiometricSupport | null>(null);
  const [enabled, setEnabledState] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setSupport(await checkSupport());
      setEnabledState(await isEnabled());
    })();
  }, []);

  const toggle = useCallback(
    async (next: boolean) => {
      setNote(null);

      if (next) {
        // Proved once before the setting is stored. Turning the lock on
        // without checking it works leaves someone locked out on their next
        // launch by a setting they had no way to test.
        const result = await unlock("Confirm it is you");
        if (result !== "unlocked") {
          setNote("Biometric unlock was not turned on, because the check did not pass.");
          return;
        }
      }

      await setEnabled(next);
      setEnabledState(next);
    },
    []
  );

  const label = support?.available ? KIND_LABEL[support.kind] ?? "Biometric unlock" : "Biometric unlock";

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: theme.colors.background }]}
      edges={["bottom"]}
    >
      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg }}>
        {user ? (
          <View style={{ marginBottom: theme.spacing.xl }}>
            <Text
              style={{
                color: theme.colors.text,
                fontSize: theme.fontSize.title3,
                lineHeight: theme.lineHeight.title3,
                fontWeight: theme.fontWeight.semibold,
              }}
            >
              {user.firstName} {user.lastName}
            </Text>
            <Text
              style={{
                color: theme.colors.textMuted,
                fontSize: theme.fontSize.footnote,
                lineHeight: theme.lineHeight.footnote,
              }}
            >
              {user.email}
            </Text>
          </View>
        ) : null}

        <View style={styles.between}>
          <View style={styles.grow}>
            <Text
              style={{
                color: theme.colors.text,
                fontSize: theme.fontSize.body,
                lineHeight: theme.lineHeight.body,
              }}
            >
              {label}
            </Text>
            <Text
              style={{
                color: theme.colors.textMuted,
                fontSize: theme.fontSize.caption,
                lineHeight: theme.lineHeight.caption,
                marginTop: 2,
              }}
            >
              {support === null
                ? "Checking…"
                : support.available
                  ? "Locks the app when you come back to it after a minute away."
                  : support.reason === "not_enrolled"
                    ? "Set up a biometric in your device settings to use this."
                    : "This device does not support biometric unlock."}
            </Text>
          </View>

          <Switch
            value={enabled}
            onValueChange={(next) => void toggle(next)}
            disabled={!support?.available}
            accessibilityLabel={label}
            accessibilityHint="Locks the app when it has been in the background for a minute"
          />
        </View>

        {note ? (
          <Text
            accessibilityRole="alert"
            style={{
              color: theme.colors.danger,
              fontSize: theme.fontSize.footnote,
              lineHeight: theme.lineHeight.footnote,
              marginTop: theme.spacing.md,
            }}
          >
            {note}
          </Text>
        ) : null}

        <Button
          label="Sign out"
          variant="secondary"
          onPress={() => void signOut()}
          style={{ marginTop: theme.spacing.xxl }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  grow: { flex: 1, paddingRight: 16 },
});
