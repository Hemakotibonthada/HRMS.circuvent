"use client";

import { useEffect, useState } from "react";

/**
 * Explains why a single sign-on attempt did not finish.
 *
 * Without this the callback's failure path bounces silently back to the sign-in
 * screen, which looks identical to nothing having happened -- so someone whose
 * access was refused would simply press the button again.
 *
 * The reason is read from `window.location` rather than `useSearchParams` so
 * this renders without forcing the page into a Suspense boundary.
 */
const MESSAGES: Record<string, string> = {
  not_configured: "Single sign-on is not set up for this site yet.",
  missing_code: "That sign-in attempt did not complete. Please try again.",
  state_mismatch:
    "That sign-in link has expired or was opened in a different browser. Please try again.",
  nonce_mismatch: "That sign-in attempt could not be verified. Please try again.",
  exchange_failed: "We could not finish signing you in. Please try again.",
  access_denied: "You do not have access to this app. Ask your administrator to grant it.",
  account_suspended: "This account has been suspended.",
  account_disabled: "This account has been disabled. Contact your administrator.",
  account_inactive: "This account is not active yet.",
  account_locked: "Too many failed attempts. Try again shortly.",
  no_hrms_account:
    "There is no employee record for this address. Ask HR to add you before signing in.",
  mfa_required:
    "This account uses an authenticator app. Sign in with your password and code below.",
  password_reset_required: "You need to set a new password before continuing.",
};

export function SsoError() {
  const [message, setMessage] = useState<string | null>(null);

  // A query parameter that must be read *and consumed* — shown once, then
  // cleared so a refresh does not resurrect a stale failure. That rules out
  // useSyncExternalStore, which is the usual answer to "read a browser value
  // during render": its snapshot has to stay stable, and clearing the URL
  // changes it. It also cannot be derived during render, because the server
  // has no `window` and would render nothing, giving a hydration mismatch on
  // the client.
  //
  // Same shape as useNotificationPermission in src/hooks/use-advanced.ts, and
  // disabled the same way: narrowly, and with the reason written down.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("sso_error");
    if (!reason) return;
    setMessage(MESSAGES[reason] ?? "We could not finish signing you in. Please try again.");

    // Cleared after the read, so the message survives but a reload does not
    // show it again.
    const url = new URL(window.location.href);
    url.searchParams.delete("sso_error");
    window.history.replaceState({}, "", url.toString());
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!message) return null;

  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      {message}
    </div>
  );
}
