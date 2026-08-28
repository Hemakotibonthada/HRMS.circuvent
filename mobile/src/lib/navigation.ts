// ═══════════════════════════════════════════════════════════════
// NAVIGATION — where the tab bar appears, and which tab is current
// ═══════════════════════════════════════════════════════════════
// Pure, so the rule can be tested without React Native. It was inside the tab
// bar component, where the only way to check "does the bar hide itself on
// /leave/apply" was to run the app on a device — which nobody has done.
//
// The rule it encodes: the bar belongs on the five roots and nowhere else. A
// tab bar that stays visible on a pushed detail screen offers a sideways move
// out of a half-finished form, and one that appears on the sign-in screen
// offers navigation to somebody who has none.

export type TabHref = "/" | "/leave" | "/shifts" | "/payslips" | "/profile";

export interface TabDestination {
  href: TabHref;
  label: string;
  /** Feather icon name. Kept as a string so this file needs no icon import. */
  icon: string;
  /** First path segment that means this tab is current. "" is the root. */
  segment: string;
}

/**
 * Five, which is the ceiling in the mobile quality bar.
 *
 * A sixth is narrower than a thumb on a small phone, and the label under it
 * stops fitting — at which point the icons go label-less and become a guess.
 * Anything further down the list belongs behind Profile.
 */
export const TAB_DESTINATIONS: readonly TabDestination[] = [
  { href: "/", label: "Today", icon: "clock", segment: "" },
  { href: "/leave", label: "Leave", icon: "calendar", segment: "leave" },
  { href: "/shifts", label: "Shifts", icon: "repeat", segment: "shifts" },
  { href: "/payslips", label: "Pay", icon: "file-text", segment: "payslips" },
  { href: "/profile", label: "Profile", icon: "user", segment: "profile" },
];

const ROOT_SEGMENTS = new Set(TAB_DESTINATIONS.map((destination) => destination.segment));

/** The path split into its segments, with empty parts dropped. */
function segmentsOf(pathname: string): string[] {
  return pathname.split("/").filter(Boolean);
}

/**
 * Whether the tab bar belongs on this path.
 *
 * True only for the five roots. `/leave` yes, `/leave/apply` no — the second
 * is a form, and a bar under it is an invitation to leave without submitting.
 */
export function isTabRoot(pathname: string): boolean {
  const segments = segmentsOf(pathname);
  if (segments.length === 0) return true;
  if (segments.length > 1) return false;
  return ROOT_SEGMENTS.has(segments[0] ?? "");
}

/**
 * The segment that should be shown as selected.
 *
 * Returns the root segment even on a pushed child, so `/leave/apply` keeps the
 * Leave tab marked — the bar is not rendered there today, but a highlight that
 * silently moved to the wrong tab if it ever were is a worse bug than a
 * missing one.
 */
export function activeSegment(pathname: string): string {
  const first = segmentsOf(pathname)[0] ?? "";
  return ROOT_SEGMENTS.has(first) ? first : "";
}

/** The destination matching a path, if it is a tab root. */
export function destinationFor(pathname: string): TabDestination | undefined {
  if (!isTabRoot(pathname)) return undefined;
  const segment = activeSegment(pathname);
  return TAB_DESTINATIONS.find((destination) => destination.segment === segment);
}
