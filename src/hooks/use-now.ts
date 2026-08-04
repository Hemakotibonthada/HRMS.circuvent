"use client";

import { useEffect, useState } from "react";

// ═══════════════════════════════════════════════════════════════
// HYDRATION-SAFE CLOCK
// ═══════════════════════════════════════════════════════════════
// Calling Date.now() during render is a hydration bug: the server renders at
// one instant and the client re-renders at another, so React finds markup that
// does not match and discards it. On pages that compute "expiring within 30
// days" or "joined 3 days ago" that produced silently different output on
// first paint.
//
// It is also impure — the same props render differently on every pass — which
// defeats React Compiler memoisation entirely.
//
// These hooks return a stable value during server render and the first client
// pass, then update once mounted. The first paint therefore matches, and the
// real time appears immediately afterwards.

/**
 * The current time, fixed until the component mounts.
 *
 * `initial` seeds server render and first hydration. Passing a fixed date
 * keeps the two identical; omitting it falls back to render time, which is
 * only safe for values that never reach the markup.
 *
 * @param refreshMs Re-read the clock on an interval. Omit for one-shot use;
 *                  a needless timer on ninety-two dashboard modules is a real
 *                  cost.
 */
export function useNow(refreshMs?: number): Date | null {
  const [now, setNow] = useState<Date | null>(null);

  // Reading the clock on mount is the point of this hook. The value cannot be
  // computed during render without reintroducing the hydration mismatch it
  // exists to fix, and it cannot be a useState initialiser because that also
  // runs during server render. One extra render on mount is the intended cost.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setNow(new Date());
    if (!refreshMs) return;

    const timer = setInterval(() => setNow(new Date()), refreshMs);
    return () => clearInterval(timer);
  }, [refreshMs]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return now;
}

/**
 * Milliseconds since the epoch, or null before mount.
 *
 * Callers should treat null as "not known yet" and render a neutral state
 * rather than substituting Date.now(), which reintroduces the mismatch.
 */
export function useNowMs(refreshMs?: number): number | null {
  const now = useNow(refreshMs);
  return now ? now.getTime() : null;
}

/**
 * Today's date as YYYY-MM-DD in the given timezone, or null before mount.
 *
 * Timezone-aware because "today" differs by up to a day between the server's
 * UTC and a user in Asia/Kolkata, which is exactly the class of bug that makes
 * an attendance page show the wrong day.
 */
export function useToday(timeZone = "Asia/Kolkata"): string | null {
  const now = useNow();
  if (!now) return null;
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
}
