// ═══════════════════════════════════════════════════════════════
// DEVICE ATTENDANCE CLIENT — talking to the RFID/biometric control plane
// ═══════════════════════════════════════════════════════════════
// The company's physical terminals do not write to this database at all.
// They report to a separate, already-deployed control plane
// (api.circuvent.com) that owns sites, terminals, badges and the daily
// register. This file is the only thing in HRMS that speaks to it.
//
// Two environment variables, read lazily (inside each function, never at
// module load):
//   ATTENDANCE_DEVICE_URL    base URL, defaults to https://api.circuvent.com
//   ATTENDANCE_DEVICE_TOKEN  the shared bearer token
//
// Reading lazily matters here more than it usually would: this module is
// imported by a cron route and by API routes that must build and respond to
// requests even in an environment (a fresh checkout, a CI job, a preview
// deploy with the variable not yet set) where nobody has configured the
// integration yet. A top-level `process.env.ATTENDANCE_DEVICE_TOKEN` read —
// the pattern `directory-sdk.ts` uses — is evaluated the instant the module is
// imported, so a build step or an unrelated test that merely imports this file
// would inherit whatever (or however little) is in `process.env` at that
// moment. Reading inside each function means importing this module never
// does anything by itself, and a test can flip `process.env` between calls
// without needing `vi.resetModules()`.
//
// Every request times out at 5 seconds, matching `directory-sdk.ts` and
// `integrations/deliver.ts`. A sync that hangs on a slow terminal gateway must
// not hang the cron invocation or the HR admin's browser tab with it.
//
// Nothing here throws. A caller gets back a `DeviceResult`, which is a
// discriminated union rather than the `{ ok, status, body, error }` shape
// `directory-sdk.ts` uses — that shape collapses "not configured" and
// "unreachable" onto the same `status: 0`, which is fine for a client with one
// failure mode to report but not here: the device-sync orchestrator has to
// tell HR three different stories ("nobody has set this up",
// "the terminal network is down right now", "the control plane rejected the
// request") and each implies a different fix.

const DEFAULT_BASE_URL = "https://api.circuvent.com";
const TIMEOUT_MS = 5000;

/** Exactly the register row the control plane returns — see WebSite's control-plane.ts. */
export interface RegisterRow {
  personId: number;
  name: string;
  code: string;
  role: string;
  groupName: string | null;
  status: string;
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
  lateMinutes: number;
  earlyMinutes: number;
  punches: number;
  assumedOut: boolean;
  note: string;
  manual: boolean;
}

export interface DeviceRegisterResponse {
  day: string;
  timezone: string;
  people: RegisterRow[];
  totals: Record<string, number>;
}

/** Only the fields this app has any use for; the control plane's own type has more. */
export interface AttendanceSite {
  id: number;
  name: string;
  timezone: string;
}

export interface DeviceSitesResponse {
  sites: AttendanceSite[];
}

export type DeviceResult<T> =
  | { ok: true; data: T }
  /** Nobody has set ATTENDANCE_DEVICE_TOKEN for this deployment. Not an error — most orgs never will. */
  | { ok: false; reason: "not_configured"; detail: string }
  /** The request timed out or the network rejected it outright. Worth a retry later. */
  | { ok: false; reason: "unreachable"; detail: string }
  /** The control plane answered and said no (auth, validation, 5xx). Retrying unchanged will not help. */
  | { ok: false; reason: "rejected"; status: number; detail: string };

interface DeviceConfig {
  baseUrl: string;
  token: string;
}

function config(): DeviceConfig | null {
  const token = process.env.ATTENDANCE_DEVICE_TOKEN?.trim();
  if (!token) return null;
  const baseUrl = (process.env.ATTENDANCE_DEVICE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  return { baseUrl, token };
}

/** Whether this deployment is set up to talk to the device control plane at all. */
export function deviceConfigured(): boolean {
  return config() !== null;
}

/**
 * Strips the bearer token out of anything that might carry it into a stored
 * sync-error message or a server log. Done with the literal token rather than
 * a generic "Bearer ..." regex (as `directory-sdk.ts` does, not knowing its
 * token at the call site) because here the exact value is in scope, so the
 * redaction cannot miss a token that does not look like the pattern expects.
 */
function scrub(token: string, message: string): string {
  const safe = token ? message.split(token).join("[redacted]") : message;
  return safe.slice(0, 500);
}

async function request<T>(cfg: DeviceConfig, path: string): Promise<DeviceResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      cache: "no-store",
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      return {
        ok: false,
        reason: "rejected",
        status: res.status,
        detail: scrub(cfg.token, bodyText || `HTTP ${res.status}`),
      };
    }

    return { ok: true, data: (await res.json()) as T };
  } catch (error) {
    return {
      ok: false,
      reason: "unreachable",
      detail: scrub(cfg.token, error instanceof Error ? error.message : String(error)),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One site's register for one day: every person the terminal(s) at that site
 * saw (or expected to see), with their first-in, last-out and the status the
 * device itself computed.
 */
export async function fetchRegister(siteId: number, day: string): Promise<DeviceResult<DeviceRegisterResponse>> {
  const cfg = config();
  if (!cfg) {
    return {
      ok: false,
      reason: "not_configured",
      detail: "ATTENDANCE_DEVICE_TOKEN is not set, so this deployment cannot read the device register.",
    };
  }
  return request<DeviceRegisterResponse>(cfg, `/attendance/register?siteId=${siteId}&day=${day}`);
}

/** The sites this token can see. Used to validate a configured site id, not by the daily sync itself. */
export async function fetchSites(): Promise<DeviceResult<DeviceSitesResponse>> {
  const cfg = config();
  if (!cfg) {
    return {
      ok: false,
      reason: "not_configured",
      detail: "ATTENDANCE_DEVICE_TOKEN is not set, so this deployment cannot list device sites.",
    };
  }
  return request<DeviceSitesResponse>(cfg, "/attendance/sites");
}
