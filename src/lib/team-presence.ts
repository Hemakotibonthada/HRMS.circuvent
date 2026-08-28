/**
 * What to say about a colleague's day.
 *
 * Kept out of the route and pure, because these words appear next to somebody's
 * name on their manager's phone. "Late" in particular is an accusation, and it
 * should only ever be made from a recorded fact — never inferred because a
 * value was missing.
 */

export type Presence =
  /** Approved leave covers the day. */
  | "on_leave"
  /** A holiday or a non-working day for this person. */
  | "off"
  /** Clocked in, and the record says late. */
  | "late"
  /** Clocked in, and nothing says late. */
  | "in"
  /** Today, and no punch yet. Still could arrive. */
  | "not_in"
  /** A past day with no punch and no leave. */
  | "absent";

export interface AttendanceFact {
  status: string;
  clockInAt: Date | string | null;
  /** Column is NOT NULL DEFAULT 0, so absence of lateness and "not measured" look identical. */
  lateByMinutes: number;
}

export interface PresenceInput {
  onLeave: boolean;
  record: AttendanceFact | null;
  /** Whether the day being asked about is today. */
  isToday: boolean;
}

export function presenceOf({ onLeave, record, isToday }: PresenceInput): Presence {
  // Leave wins over everything. Somebody on approved leave who also has a
  // stray weekend punch is on leave, and listing them as "not in yet" invites
  // a manager to chase someone who told them a fortnight ago.
  if (onLeave) return "on_leave";

  if (record && (record.status === "holiday" || record.status === "weekend")) return "off";

  if (record?.clockInAt) {
    // Two independent signals, either sufficient. `late_by_minutes` is only
    // populated when a shift was assigned, so a punch against no shift has a 0
    // there and must not be called late on that basis.
    return record.status === "late" || record.lateByMinutes > 0 ? "late" : "in";
  }

  if (record && record.status === "on_leave") return "on_leave";

  return isToday ? "not_in" : "absent";
}

/** The buckets the team screen filters by. */
export type PresenceFilter = "all" | "not_in" | "late" | "in";

export function matchesFilter(presence: Presence, filter: PresenceFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "in":
      return presence === "in";
    case "late":
      return presence === "late";
    case "not_in":
      // Absent is the same question a day later — "this person is not here and
      // did not tell anyone" — so it belongs in the same bucket rather than
      // vanishing when the manager looks at yesterday.
      return presence === "not_in" || presence === "absent";
  }
}

export function countByFilter(all: Presence[]): Record<PresenceFilter, number> {
  return {
    all: all.length,
    not_in: all.filter((p) => matchesFilter(p, "not_in")).length,
    late: all.filter((p) => matchesFilter(p, "late")).length,
    in: all.filter((p) => matchesFilter(p, "in")).length,
  };
}
