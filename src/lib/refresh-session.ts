/**
 * One refresh at a time, for the whole tab.
 *
 * Collapses concurrent `/api/auth/refresh` calls so rotation races do not sign
 * the browser out moments after a successful sign-in.
 */

let inFlight: Promise<boolean> | null = null;

export function refreshSession(): Promise<boolean> {
  if (inFlight) return inFlight;

  inFlight = fetch("/api/auth/refresh", {
    method: "POST",
    credentials: "include",
  })
    .then(async (res) => {
      if (res.ok) return true;
      if (res.status === 401) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (body.error === "Already renewed") return true;
      }
      return false;
    })
    .catch(() => false)
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}
