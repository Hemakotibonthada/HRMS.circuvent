import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider, useSession } from "@/lib/session";
import { SyncProvider } from "@/lib/sync";
import { BiometricGate } from "@/components/BiometricGate";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { TabBar } from "@/components/TabBar";
import { ThemeProvider, useTheme } from "@/theme/ThemeProvider";

/**
 * Sends the user to the right place once the session is known.
 *
 * Deliberately runs inside an effect rather than rendering one tree or the
 * other. Expo Router needs the navigator mounted before it will accept a
 * navigation, and redirecting during render produces the "attempted to
 * navigate before mounting" warning followed by a redirect that silently does
 * not happen.
 */
function AuthGate() {
  const { status } = useSession();
  const segments = useSegments();
  const router = useRouter();
  const theme = useTheme();

  useEffect(() => {
    // `loading` is a real state: the keystore has not been read yet. Acting on
    // it would bounce the user to sign-in on every cold start.
    if (status === "loading") return;

    const onAuthScreen = segments[0] === "sign-in";

    if (status === "signed_out" && !onAuthScreen) {
      router.replace("/sign-in");
    } else if (status === "signed_in" && onAuthScreen) {
      router.replace("/");
    }
  }, [status, segments, router]);

  if (status === "loading") {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.colors.background,
        }}
      >
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  return (
    // The tab bar is a sibling of the navigator rather than a screen inside
    // it, so it stays put while screens change underneath. It renders nothing
    // on sign-in and on pushed detail screens, which is decided in one place
    // — TabBar.isTabRoot — rather than by each screen remembering to say so.
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.colors.background },
          headerTintColor: theme.colors.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: theme.colors.background },
        }}
      >
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="index" options={{ title: "Today" }} />
        <Stack.Screen name="leave/index" options={{ title: "Leave" }} />
        <Stack.Screen name="leave/apply" options={{ title: "Apply for leave" }} />
        <Stack.Screen name="leave/[id]" options={{ title: "Leave request" }} />
        <Stack.Screen name="shifts" options={{ title: "Shifts" }} />
        <Stack.Screen name="attendance" options={{ title: "Attendance" }} />
        <Stack.Screen name="profile" options={{ title: "Profile" }} />
        <Stack.Screen name="helpdesk/index" options={{ title: "Helpdesk" }} />
        <Stack.Screen name="helpdesk/new" options={{ title: "Raise a ticket" }} />
        <Stack.Screen name="helpdesk/[id]" options={{ title: "Ticket" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
        <Stack.Screen name="two-factor" options={{ title: "Two-step verification" }} />
        <Stack.Screen name="expenses/index" options={{ title: "Expenses" }} />
        <Stack.Screen name="expenses/new" options={{ title: "Claim an expense" }} />
        <Stack.Screen name="expenses/[id]" options={{ title: "Claim" }} />
        <Stack.Screen name="approvals" options={{ title: "Approvals" }} />
        <Stack.Screen name="payslips/index" options={{ title: "Payslips" }} />
        <Stack.Screen name="payslips/[id]" options={{ title: "Payslip" }} />
      </Stack>

      {status === "signed_in" ? <TabBar /> : null}
    </View>
  );
}

/**
 * The boundary, placed where it can offer a way out.
 *
 * Inside SessionProvider so that "sign out" is available — a crash caused by
 * something in the session itself (a profile the app cannot render, a role it
 * does not know) is unrecoverable by retrying, and signing out is the only
 * escape that does not involve deleting the app.
 */
function GuardedApp() {
  const { signOut } = useSession();

  return (
    <ErrorBoundary onReset={() => void signOut()}>
      <AuthGate />
    </ErrorBoundary>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        {/* `auto` so the status bar text flips with the OS theme. Hard-coding
            it makes the clock invisible in one of the two modes. */}
        <StatusBar style="auto" />
        <SessionProvider>
          <SyncProvider>
            <BiometricGate>
              <GuardedApp />
            </BiometricGate>
          </SyncProvider>
        </SessionProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
