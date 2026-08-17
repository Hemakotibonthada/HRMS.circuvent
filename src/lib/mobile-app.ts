// ═══════════════════════════════════════════════════════════════
// MOBILE APP — store links
// ═══════════════════════════════════════════════════════════════
// Deliberately not in `ecosystem.ts`. That file is duplicated verbatim in all
// six Circuvent apps and decision D7 keeps it that way; adding an HRMS-only
// concern to it would guarantee six copies that disagree within a release.
//
// The links are read from the environment and are absent by default. That is
// the important behaviour: **nothing renders until the app is actually
// published**. A "Get it on Google Play" button that 404s is worse than no
// button, because the person who taps it concludes the app was pulled.
//
// Set NEXT_PUBLIC_PLAY_STORE_URL once the listing is live. Until then every
// call site here renders nothing, which is the truth.

/** Android package name, fixed at first upload and unchangeable afterwards. */
export const ANDROID_PACKAGE = "com.circuvent.hrms";

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  // An http link to a store page will be blocked as mixed content and looks
  // like a phishing attempt. Refuse it rather than render it.
  if (!trimmed.startsWith("https://")) return undefined;
  return trimmed.replace(/\/+$/, "");
}

export const MOBILE_APP = {
  /** Play Store listing. Undefined until the app is published. */
  play: clean(process.env.NEXT_PUBLIC_PLAY_STORE_URL),
  /** App Store listing. Undefined; iOS is not submitted yet. */
  appStore: clean(process.env.NEXT_PUBLIC_APP_STORE_URL),
} as const;

/** True when there is at least one real store link to show. */
export function hasMobileApp(): boolean {
  return Boolean(MOBILE_APP.play || MOBILE_APP.appStore);
}
