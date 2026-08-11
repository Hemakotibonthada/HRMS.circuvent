import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider, useSession } from "@/lib/session";
import { SyncProvider } from "@/lib/sync";
import { BiometricGate } from "@/components/BiometricGate";
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
      <Stack.Screen name="settings" options={{ title: "Settings" }} />
      <Stack.Screen name="approvals" options={{ title: "Approvals" }} />
    </Stack>
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
              <AuthGate />
            </BiometricGate>
          </SyncProvider>
        </SessionProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
