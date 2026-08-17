import { useCallback, useEffect, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Screen } from "@/components/Screen";
import { StatusPill } from "@/components/StatusPill";
import { TextField } from "@/components/TextField";
import { AppText } from "@/components/Typography";
import { ApiError, OfflineError } from "@/lib/contracts";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme/ThemeProvider";

interface Status {
  enabled: boolean;
  pending: boolean;
  enabledAt: string | null;
}

/**
 * Two-step verification.
 *
 * The phone is usually the authenticator, which makes a QR code the wrong
 * primitive here — you cannot scan your own screen. So the enrolment step is a
 * deep link instead: `otpauth://` is the scheme every authenticator app
 * registers, so opening it hands the secret straight over with nothing to
 * type. The key is shown underneath for the case where no app claims the
 * scheme, and because a link that silently does nothing is worse than a string
 * you can copy.
 */
export default function TwoFactorScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { api } = useSession();

  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; description?: string } | null>(null);

  const [uri, setUri] = useState<string | null>(null);
  const [manualKey, setManualKey] = useState<string | null>(null);
  const [code, setCode] = useState("");

  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  const [password, setPassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [confirmingDisable, setConfirmingDisable] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await api.get<Status>("/api/auth/mfa"));
      setError(null);
    } catch (caught) {
      if (caught instanceof OfflineError) {
        setError({
          title: "You are offline",
          description: "Two-step verification can only be changed with a connection.",
        });
      } else {
        setError({ title: "Your security settings could not be loaded" });
      }
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const fail = (caught: unknown, fallback: string) => {
    if (caught instanceof ApiError) setError({ title: fallback, description: caught.message });
    else if (caught instanceof OfflineError) setError({ title: "You are offline" });
    else setError({ title: fallback });
  };

  const begin = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await api.post<{ uri: string; manualEntryKey: string }>(
        "/api/auth/mfa",
        {}
      );
      setUri(response.uri);
      setManualKey(response.manualEntryKey);
      setCode("");
      await load();
    } catch (caught) {
      fail(caught, "Enrolment could not be started");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await api.post<{ backupCodes: string[] }>("/api/auth/mfa/confirm", {
        code: code.trim(),
      });
      setBackupCodes(response.backupCodes);
      setUri(null);
      setManualKey(null);
      setCode("");
      await load();
    } catch (caught) {
      setCode("");
      fail(caught, "That code was not accepted");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.delete("/api/auth/mfa", { password, code: disableCode.trim() });
      setPassword("");
      setDisableCode("");
      setConfirmingDisable(false);
      setBackupCodes(null);
      await load();
    } catch (caught) {
      fail(caught, "Two-step verification could not be turned off");
    } finally {
      setBusy(false);
    }
  };

  const openAuthenticator = async () => {
    if (!uri) return;
    try {
      const supported = await Linking.canOpenURL(uri);
      if (!supported) {
        setError({
          title: "No authenticator app found",
          description: "Install one, then enter the key below by hand.",
        });
        return;
      }
      await Linking.openURL(uri);
    } catch {
      setError({
        title: "That app could not be opened",
        description: "Enter the key below by hand instead.",
      });
    }
  };

  const pill = loading
    ? null
    : status?.enabled
      ? { label: "On", tone: "success" as const }
      : status?.pending
        ? { label: "Not finished", tone: "warning" as const }
        : { label: "Off", tone: "neutral" as const };

  return (
    <Screen scrollable keyboardAware>
      <Card>
        <View style={styles.between}>
          <AppText variant="title3" weight="semibold" heading style={styles.grow}>
            Two-step verification
          </AppText>
          {pill ? <StatusPill label={pill.label} tone={pill.tone} /> : null}
        </View>
        <AppText variant="footnote" tone="muted" style={{ marginTop: theme.spacing.sm }}>
          A code from your authenticator app, on top of your password. It protects your salary,
          bank and identity details if your password is ever leaked.
        </AppText>
      </Card>

      {error ? (
        <Banner
          tone="error"
          title={error.title}
          description={error.description}
          style={{ marginTop: theme.spacing.md }}
        />
      ) : null}

      {/* ── Recovery codes, shown once ── */}
      {backupCodes ? (
        <Card style={{ marginTop: theme.spacing.md }}>
          <AppText variant="body" weight="semibold" heading>
            Save these recovery codes
          </AppText>
          <AppText variant="caption" tone="muted" style={{ marginTop: theme.spacing.xs }}>
            Each one signs you in once if you lose your phone. They are stored hashed, so this is
            the only time they can be shown.
          </AppText>
          <View style={{ marginTop: theme.spacing.md }}>
            {backupCodes.map((backupCode) => (
              // Selectable rather than a copy button: long-press is the
              // gesture people already use, and it avoids a clipboard
              // dependency for one screen.
              <AppText key={backupCode} variant="body" selectable style={styles.mono}>
                {backupCode}
              </AppText>
            ))}
          </View>
          <Button
            label="I have saved them"
            variant="ghost"
            onPress={() => setBackupCodes(null)}
            style={{ marginTop: theme.spacing.md }}
          />
        </Card>
      ) : null}

      {/* ── Enrolment in progress ── */}
      {uri && manualKey ? (
        <Card style={{ marginTop: theme.spacing.md }}>
          <AppText variant="body" weight="semibold" heading>
            1. Add it to your authenticator
          </AppText>
          <Button
            label="Open my authenticator app"
            onPress={() => void openAuthenticator()}
            accessibilityHint="Hands the new key to an authenticator app on this device"
            style={{ marginTop: theme.spacing.md }}
          />
          <AppText variant="caption" tone="muted" style={{ marginTop: theme.spacing.md }}>
            Or enter this key by hand — long-press to copy it:
          </AppText>
          <AppText variant="body" selectable style={styles.mono}>
            {manualKey}
          </AppText>

          <AppText
            variant="body"
            weight="semibold"
            heading
            style={{ marginTop: theme.spacing.xl }}
          >
            2. Enter the six-digit code it shows
          </AppText>
          <TextField
            label="Authenticator code"
            value={code}
            onChangeText={(next) => setCode(next.replace(/\D/g, "").slice(0, 6))}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            placeholder="123456"
          />
          <AppText variant="caption" tone="muted">
            Nothing changes about how you sign in until this code is accepted.
          </AppText>
          <Button
            label="Turn on"
            busy={busy}
            disabled={code.trim().length === 0}
            onPress={() => void confirm()}
            style={{ marginTop: theme.spacing.md }}
          />
        </Card>
      ) : null}

      {/* ── Off, or abandoned ── */}
      {!uri && !loading && !status?.enabled ? (
        <Card style={{ marginTop: theme.spacing.md }}>
          {status?.pending ? (
            <AppText variant="footnote" tone="muted" style={{ marginBottom: theme.spacing.md }}>
              You started this but never finished, so it is not protecting your account yet.
            </AppText>
          ) : null}
          <Button
            label={status?.pending ? "Start again" : "Set up two-step verification"}
            busy={busy}
            onPress={() => void begin()}
          />
        </Card>
      ) : null}

      {/* ── On ── */}
      {!uri && status?.enabled ? (
        <Card style={{ marginTop: theme.spacing.md }}>
          {confirmingDisable ? (
            <>
              <AppText variant="footnote" tone="muted">
                Confirm with your password and a current code. Both are required — otherwise anyone
                holding your unlocked phone could switch this off.
              </AppText>
              <TextField
                label="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                textContentType="password"
              />
              <TextField
                label="Authenticator code"
                value={disableCode}
                onChangeText={(next) => setDisableCode(next.replace(/\D/g, "").slice(0, 6))}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                placeholder="123456"
              />
              <Button
                label="Turn off"
                variant="danger"
                busy={busy}
                disabled={!password || disableCode.trim().length === 0}
                onPress={() => void disable()}
              />
              <Button
                label="Cancel"
                variant="ghost"
                onPress={() => {
                  setConfirmingDisable(false);
                  setPassword("");
                  setDisableCode("");
                }}
                style={{ marginTop: theme.spacing.sm }}
              />
            </>
          ) : (
            <Button
              label="Turn off two-step verification"
              variant="secondary"
              onPress={() => setConfirmingDisable(true)}
            />
          )}
        </Card>
      ) : null}

      <Button
        label="Back to settings"
        variant="ghost"
        onPress={() => router.back()}
        style={{ marginTop: theme.spacing.xl }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: "row", alignItems: "center", gap: 12 },
  grow: { flex: 1 },
  // `monospace` resolves on Android; iOS falls back to the system face, which
  // is acceptable for a key that is grouped in fours anyway.
  mono: { fontVariant: ["tabular-nums"], letterSpacing: 1 },
});
