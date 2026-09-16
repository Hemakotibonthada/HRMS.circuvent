/**
 * Validate a short-lived My Space delegation through the fixed trusted issuer.
 * Request headers/body can never select the issuer URL, actor or tenant.
 */
export async function myspaceActor(token: string, audience: "mail" | "hrms"): Promise<string | null> {
  if (!token || token.length > 4096) return null;
  const url = new URL("/api/internal/directory/introspect", process.env.MYSPACE_URL || "https://myspace.circuvent.com");
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("HTTPS required");
  const response = await fetch(url, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "x-directory-audience": audience },
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("My Space verification unavailable");
  const data = await response.json();
  return data.active === true && data.audience === audience && data.scope === "directory:read" && typeof data.email === "string" && data.email.includes("@")
    ? data.email.trim().toLowerCase() : null;
}
