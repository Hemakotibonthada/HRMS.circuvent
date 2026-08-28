// ═══════════════════════════════════════════════════════════════
// SESSION
// ═══════════════════════════════════════════════════════════════
// Owns the one question every screen asks: is there a signed-in user, and who
// is it. Three states, not two — `loading` is a real state, because on cold
// start the answer is genuinely unknown until the keystore has been read and
// the token checked against the server.
//
// Collapsing `loading` into "signed out" is the bug that shows the sign-in
// screen for a moment on every launch and then replaces it with the home
// screen. Collapsing it into "signed in" shows an empty home screen to someone
// who is not.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Constants from "expo-constants";
import { ApiError, MobileApiClient, OfflineError } from "@/lib/contracts";
import { SecureTokenStore } from "@/lib/secure-token-store";

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  employeeId?: string;
  organizationId: string;
  avatarUrl?: string;
}

type Status = "loading" | "signed_in" | "signed_out";

interface SessionValue {
  status: Status;
  user: SessionUser | null;
  api: MobileApiClient;
  signIn(email: string, password: string, totpCode?: string): Promise<void>;
  signOut(): Promise<void>;
  /** Re-reads the profile; used after an edit and on returning to foreground. */
  refreshUser(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

function resolveBaseUrl(): string {
  // Two sources, checked in this order. The build-time variable wins because
  // it is what EAS sets per profile — preview builds point at staging,
  // production at production — and app.json is one file shared by both.
  //
  // `process.env.EXPO_PUBLIC_*` is substituted into the bundle at build time
  // by Expo, so this is a literal by the time it runs; it cannot be read
  // dynamically and there is no `process.env` on a device to read it from.
  //
  // The env var was named in the error message below long before anything
  // read it, so anyone who followed the instruction set it and still got the
  // same error.
  const fromEnv = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return fromEnv.trim();

  const configured = Constants.expoConfig?.extra?.apiBaseUrl;
  if (typeof configured === "string" && configured.length > 0) return configured;

  // No silent fallback to a development host. A build that points at the wrong
  // API is worse than one that refuses to start, because it looks like it
  // works — right up until someone's clock-in goes to a machine that is not
  // there, or worse, to a staging database.
  throw new Error(
    "apiBaseUrl is not configured. Set expo.extra.apiBaseUrl in app.json or EXPO_PUBLIC_API_BASE_URL."
  );
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<SessionUser | null>(null);

  // Built once, in a lazy initialiser, and never rebuilt.
  //
  // This was a `useMemo` guarded by an `isMounted` ref, which was wrong twice
  // over. A memo is a cache: React is free to discard and recompute it, and a
  // second MobileApiClient would carry its own in-flight refresh — two clients
  // racing to rotate the same refresh token is exactly what the server treats
  // as a replay, and it revokes the whole session family. `useState` with an
  // initialiser is the construct that actually promises "once".
  //
  // The ref is gone rather than moved. It guarded `setState` after unmount,
  // and React 18 removed that warning because the call was always a harmless
  // no-op; the guard defended against nothing while reading a ref during
  // render, which is a genuine side effect. Ordering *within* the mounted
  // lifetime is still handled, by the `cancelled` flag scoped to its effect.
  const [api] = useState(
    () =>
      new MobileApiClient({
        baseUrl: resolveBaseUrl(),
        tokens: new SecureTokenStore(),
        onSignedOut: () => {
          setUser(null);
          setStatus("signed_out");
        },
      })
  );

  const loadUser = useCallback(async () => {
    const profile = await api.get<{ user: SessionUser }>("/api/auth/me");
    setUser(profile.user);
    setStatus("signed_in");
  }, [api]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await loadUser();
      } catch (error) {
        if (cancelled) return;

        // Offline with a stored token is not signed out. Forcing a password
        // on a train with no signal, when the token is still valid, is the
        // difference between an app that works on a commute and one that
        // does not — and clock-in is exactly the thing people do on arrival,
        // in a basement car park.
        if (error instanceof OfflineError) {
          const stored = await new SecureTokenStore().getAccessToken();
          if (!cancelled) {
            setStatus(stored ? "signed_in" : "signed_out");
          }
          return;
        }

        setStatus("signed_out");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadUser]);

  const signIn = useCallback(
    async (email: string, password: string, totpCode?: string) => {
      await api.signIn(email, password, totpCode);
      await loadUser();
    },
    [api, loadUser]
  );

  const signOut = useCallback(async () => {
    await api.signOut();
    setUser(null);
    setStatus("signed_out");
  }, [api]);

  const refreshUser = useCallback(async () => {
    try {
      await loadUser();
    } catch (error) {
      // A failed refresh of the profile must not sign anyone out; the session
      // is still valid and the old profile is still broadly correct.
      if (error instanceof ApiError && error.status === 401) return;
    }
  }, [loadUser]);

  const value = useMemo(
    () => ({ status, user, api, signIn, signOut, refreshUser }),
    [status, user, api, signIn, signOut, refreshUser]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside a SessionProvider");
  return session;
}
