import { useCallback, useState } from "react";
import { View } from "react-native";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { TextField } from "@/components/TextField";
import { AppText } from "@/components/Typography";
import { ApiError, OfflineError } from "@/lib/contracts";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * Sign in.
 *
 * The MFA field appears only after the server says it is needed, which it only
 * does once the password was already correct. Showing it upfront would ask
 * most people for something they do not have, and hiding it after a correct
 * password would strand everyone who does.
 */
export default function SignInScreen() {
  const theme = useTheme();
  const { signIn } = useSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<{ title: string; description?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    setError(null);

    if (!email.trim() || !password) {
      setError({ title: "Enter your email address and password" });
      return;
    }

    setBusy(true);
    try {
      await signIn(email.trim(), password, needsCode ? totpCode.trim() : undefined);
    } catch (caught) {
      if (caught instanceof OfflineError) {
        // Distinguished from a wrong password on purpose. "Incorrect password"
        // when the real problem is a dead connection sends people to the
        // password reset flow for no reason, and a reset needs the network too.
        setError({
          title: "No connection",
          description: "Check your signal and try again. Your password is not the problem.",
        });
      } else if (caught instanceof ApiError) {
        const body = caught.body as { mfaRequired?: boolean } | undefined;
        if (body?.mfaRequired) {
          setNeedsCode(true);
          setError(null);
        } else {
          setError({ title: "That did not work", description: caught.message });
        }
      } else {
        setError({ title: "Something went wrong", description: "Please try again." });
      }
    } finally {
      setBusy(false);
    }
  }, [email, password, totpCode, needsCode, signIn]);

  return (
    // `centred` rather than the usual top alignment: there is one thing to do
    // on this screen and it belongs under the thumb, not under the status bar.
    // `topInset` because this is the one screen rendered without a header, so
    // nothing else is claiming the space under the notch.
    <Screen keyboardAware centred topInset>
      <View style={{ marginBottom: theme.spacing.xxl }}>
        <AppText variant="title1" weight="bold" heading>
          Circuvent HR
        </AppText>
        <AppText variant="body" tone="muted" style={{ marginTop: theme.spacing.xs }}>
          Sign in with your work account
        </AppText>
      </View>

      {error ? (
        <Banner
          tone="error"
          title={error.title}
          description={error.description}
          style={{ marginBottom: theme.spacing.lg }}
        />
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
          // authenticator, rather than making people switch apps and memorise
          // six digits under a thirty-second timer.
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
    </Screen>
  );
}
