import { useCallback, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/Button";
import { TextField } from "@/components/TextField";
import { ApiError, OfflineError } from "@/lib/contracts";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * Sign in.
 *
 * The MFA field appears only after the server says it is needed, which it
 * only does once the password was already correct. Showing it upfront would
 * ask most people for something they do not have, and hiding it after a
 * correct password would strand everyone who does.
 */
export default function SignInScreen() {
  const theme = useTheme();
  const { signIn } = useSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    setError(null);

    if (!email.trim() || !password) {
      setError("Enter your email address and password");
      return;
    }

    setBusy(true);
    try {
      await signIn(email.trim(), password, needsCode ? totpCode.trim() : undefined);
    } catch (caught) {
      if (caught instanceof OfflineError) {
        // Distinguished from a wrong password on purpose. "Incorrect
        // password" when the real problem is a dead connection sends people
        // to the password reset flow for no reason.
        setError("No connection. Check your signal and try again.");
      } else if (caught instanceof ApiError) {
        const body = caught.body as { mfaRequired?: boolean } | undefined;
        if (body?.mfaRequired) {
          setNeedsCode(true);
          setError(null);
        } else {
          setError(caught.message);
        }
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }, [email, password, totpCode, needsCode, signIn]);

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: theme.colors.background }]}
      // Only the top and bottom insets. Applying horizontal insets here as
      // well double-counts the padding below on a notched device.
      edges={["top", "bottom"]}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        // Android resizes the window itself; adding padding on top of that
        // pushes the submit button off-screen, which is the classic
        // "cannot reach the login button" bug.
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.content, { padding: theme.spacing.xl }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={{ marginBottom: theme.spacing.xxl }}>
            <Text
              accessibilityRole="header"
              style={{
                color: theme.colors.text,
                fontSize: theme.fontSize.title1,
                lineHeight: theme.lineHeight.title1,
                fontWeight: theme.fontWeight.bold,
              }}
            >
              Circuvent HR
            </Text>
            <Text
              style={{
                color: theme.colors.textMuted,
                fontSize: theme.fontSize.body,
                lineHeight: theme.lineHeight.body,
                marginTop: theme.spacing.xs,
              }}
            >
              Sign in with your work account
            </Text>
          </View>

          {error ? (
            <View
              accessibilityRole="alert"
              style={{
                backgroundColor: theme.colors.dangerSubtle,
                borderRadius: theme.radius.md,
                padding: theme.spacing.md,
                marginBottom: theme.spacing.lg,
              }}
            >
              <Text
                style={{
                  color: theme.colors.danger,
                  fontSize: theme.fontSize.footnote,
                  lineHeight: theme.lineHeight.footnote,
                }}
              >
                {error}
              </Text>
            </View>
          ) : null}

          <TextField
            label="Work email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="username"
            returnKeyType="next"
            editable={!busy}
          />

          <TextField
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            returnKeyType={needsCode ? "next" : "go"}
            onSubmitEditing={needsCode ? undefined : submit}
            editable={!busy}
          />

          {needsCode ? (
            <TextField
              label="Authentication code"
              hint="The six-digit code from your authenticator app"
              value={totpCode}
              onChangeText={setTotpCode}
              keyboardType="number-pad"
              // Lets iOS and Android offer the code straight from the SMS or
              // authenticator, rather than making people switch apps and
              // memorise six digits under a thirty-second timer.
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              maxLength={6}
              returnKeyType="go"
              onSubmitEditing={submit}
              autoFocus
              editable={!busy}
            />
          ) : null}

          <Button
            label="Sign in"
            onPress={submit}
            busy={busy}
            accessibilityHint="Signs you in to Circuvent HR"
            style={{ marginTop: theme.spacing.sm }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  content: { flexGrow: 1, justifyContent: "center" },
});
