/** Circuvent Accounts (OIDC issuer) — used for profile avatars and directory links. */
export function accountPortalUrl(): string {
  return (
    process.env.NEXT_PUBLIC_AUTH_URL ??
    process.env.AUTH_ISSUER ??
    "https://myaccount.circuvent.com"
  ).replace(/\/+$/, "");
}
