import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Switch, View } from "react-native";
import { useRouter } from "expo-router";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Screen } from "@/components/Screen";
import { AppText } from "@/components/Typography";
import { checkSupport, isEnabled, setEnabled, unlock, type BiometricSupport } from "@/lib/biometrics";
import { useSession } from "@/lib/session";
import { useSync } from "@/lib/sync";
import { useTheme } from "@/theme/ThemeProvider";

const KIND_LABEL: Record<string, string> = {
  face: "Face ID",
  fingerprint: "Fingerprint",
  iris: "Iris",
  unknown: "Biometric unlock",
};

export default function SettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user, signOut } = useSession();
  const { pending } = useSync();

  const [support, setSupport] = useState<BiometricSupport | null>(null);
  const [enabled, setEnabledState] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setSupport(await checkSupport());
      setEnabledState(await isEnabled());
    })();
  }, []);

  const toggle = useCallback(async (next: boolean) => {
    setNote(null);

    if (next) {
      // Proved once before the setting is stored. Turning the lock on without
      // checking it works leaves someone locked out on their next launch by a
      // setting they had no way to test.
      const result = await unlock("Confirm it is you");
      if (result !== "unlocked") {
        setNote("Biometric unlock was not turned on, because the check did not pass.");
        return;
      }
    }

    await setEnabled(next);
    setEnabledState(next);
  }, []);

  const label = support?.available
    ? KIND_LABEL[support.kind] ?? "Biometric unlock"
    : "Biometric unlock";

  return (
    <Screen>
      {user ? (
        <Card>
          <AppText variant="title3" weight="semibold" heading>
            {user.firstName} {user.lastName}
          </AppText>
          <AppText variant="footnote" tone="muted">
            {user.email}
          </AppText>
        </Card>
      ) : null}

      <AppText
        variant="footnote"
        weight="semibold"
        tone="muted"
        heading
        style={{ marginTop: theme.spacing.xl, marginBottom: theme.spacing.sm }}
      >
        Security
      </AppText>

      <Card>
        <View style={styles.between}>
          <View style={styles.grow}>
            <AppText variant="body">{label}</AppText>
            <AppText variant="caption" tone="muted" style={{ marginTop: 2 }}>
              {support === null
                ? "Checking…"
                : support.available
                  ? "Locks the app when you come back to it after a minute away."
                  : support.reason === "not_enrolled"
                    ? "Set up a biometric in your device settings to use this."
                    : "This device does not support biometric unlock."}
            </AppText>
          </View>

          <Switch
            value={enabled}
            onValueChange={(next) => void toggle(next)}
            disabled={!support?.available}
            accessibilityLabel={label}
            accessibilityHint="Locks the app when it has been in the background for a minute"
          />
        </View>

        {/* Said here rather than only in the roadmap: someone turning this on
            should not believe it is doing more than it does. */}
        <AppText variant="caption" tone="muted" style={{ marginTop: theme.spacing.md }}>
          This unlocks a session you already have. It is not a way of signing
          in, and it proves nothing to the server.
        </AppText>
      </Card>

      {note ? (
        <Banner
          tone="error"
          title="Biometric unlock was not turned on"
          description={note}
          style={{ marginTop: theme.spacing.md }}
        />
      ) : null}

      <Button
        label="Two-step verification"
        variant="secondary"
        onPress={() => router.push("/two-factor")}
        accessibilityHint="Set up or turn off the code your authenticator app gives you"
        style={{ marginTop: theme.spacing.md }}
      />

      <Button
        label="Sign out"
        variant="secondary"
        onPress={() => void signOut()}
        accessibilityHint="Signs you out on this device"
        style={{ marginTop: theme.spacing.xxl }}
      />

      {pending.length > 0 ? (
        // Warned before the tap, not after. Signing out with unsent work is a
        // decision that should be made knowingly.
        <AppText
          variant="caption"
          tone="warning"
          align="center"
          style={{ marginTop: theme.spacing.sm }}
        >
          {pending.length === 1
            ? "1 action has not been sent yet."
            : `${pending.length} actions have not been sent yet.`}
        </AppText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  grow: { flex: 1, paddingRight: 16 },
});
