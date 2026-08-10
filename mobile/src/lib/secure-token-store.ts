// ═══════════════════════════════════════════════════════════════
// SECURE TOKEN STORE — expo-secure-store adapter
// ═══════════════════════════════════════════════════════════════
// Implements TokenStore from src/lib/mobile/api-client.ts against the
// platform keystore: Keychain on iOS, EncryptedSharedPreferences via the
// Android Keystore on Android. Not AsyncStorage — that is a plaintext file in
// the app sandbox, readable on a rooted or jailbroken device and, on Android,
// included in auto-backup to the user's cloud account by default. A refresh
// token is a login.
//
// Two behaviours are deliberate and easy to get wrong:
//
//   1. Reads never throw. A keystore read can fail for reasons that have
//      nothing to do with the token — the device is locked and the item is
//      protected, the keychain was invalidated by a passcode change, the
//      simulator's keychain is in a bad state. Every one of those surfaces as
//      "not signed in", which is recoverable, rather than as a crash on
//      launch, which is not.
//
//   2. Writes are all-or-nothing. Storing an access token and then failing to
//      store the refresh token leaves a session that works for fifteen
//      minutes and then logs the user out with no way back. If the pair
//      cannot be written together, neither is kept.

import * as SecureStore from "expo-secure-store";
import type { TokenStore } from "./contracts";

const ACCESS_KEY = "circuvent.hrms.access";
const REFRESH_KEY = "circuvent.hrms.refresh";

/**
 * Requires the device to have been unlocked at least once since boot.
 *
 * Not `WHEN_UNLOCKED`: a background sync or a push-triggered refresh runs with
 * the screen off, and the stricter policy would make those fail every time.
 * Not `ALWAYS` either — that survives having no passcode at all.
 */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

async function readKey(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key, OPTIONS);
  } catch {
    return null;
  }
}

export class SecureTokenStore implements TokenStore {
  async getAccessToken(): Promise<string | null> {
    return readKey(ACCESS_KEY);
  }

  async getRefreshToken(): Promise<string | null> {
    return readKey(REFRESH_KEY);
  }

  async setTokens(access: string, refresh: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(ACCESS_KEY, access, OPTIONS);
      await SecureStore.setItemAsync(REFRESH_KEY, refresh, OPTIONS);
    } catch (error) {
      // Roll back rather than leave a half-written pair. clear() swallows its
      // own errors, so this cannot mask the original failure.
      await this.clear();
      throw error;
    }
  }

  async clear(): Promise<void> {
    // Both attempted regardless of the first failing. Signing out must not
    // leave a live refresh token behind because deleting the access token
    // happened to throw.
    const results = await Promise.allSettled([
      SecureStore.deleteItemAsync(ACCESS_KEY, OPTIONS),
      SecureStore.deleteItemAsync(REFRESH_KEY, OPTIONS),
    ]);

    if (results.some((r) => r.status === "rejected")) {
      // Deliberately not rethrown. A failed delete must not prevent the app
      // from returning to the sign-in screen; the token expires on its own and
      // stranding the user in a session they asked to end is worse.
      console.warn("Could not fully clear stored tokens");
    }
  }
}
