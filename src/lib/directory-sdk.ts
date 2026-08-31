/**
 * The Circuvent directory, as seen by an application.
 *
 * People and groups both live in the identity provider, and both are asked for
 * at the moment they are needed rather than copied here. A roster that is
 * synced is a roster that is wrong: somebody approved into a group a minute
 * ago should receive the next message, appear in the next picker and be on the
 * next project without anything being regenerated.
 *
 * Copy this file into any app that needs the directory. It depends on nothing
 * but `fetch`, and it fails soft: an unreachable identity provider yields an
 * empty directory rather than an error page, because a mail client that cannot
 * draw an avatar is still a mail client.
 */

const ISSUER = (process.env.AUTH_ISSUER ?? "https://myaccount.circuvent.com").replace(
  /\/+$/,
  ""
);
const SERVICE_TOKEN = process.env.DIRECTORY_SERVICE_TOKEN ?? "";
const TIMEOUT_MS = 5000;

export interface DirectoryUser {
  email: string;
  name: string;
  avatarUrl: string | null;
  jobTitle?: string | null;
}

export interface DirectoryGroup {
  id: string;
  email: string;
  name: string;
  description: string;
  /** Flattened, so a caller never has to walk nested groups itself. */
  memberEmails: string[];
  memberCount: number;
  visibility: string;
  joinPolicy: string;
}

function headers(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(SERVICE_TOKEN
      ? {
          Authorization: `Bearer ${SERVICE_TOKEN}`,
          "X-Service-Token": SERVICE_TOKEN,
        }
      : {}),
  };
}

async function get<T>(path: string, fallback: T): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${ISSUER}${path}`, {
      headers: headers(),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

/** Whether this deployment is configured to read the directory at all. */
export function directoryConfigured(): boolean {
  return Boolean(SERVICE_TOKEN);
}

export async function listDirectoryGroups(search = ""): Promise<DirectoryGroup[]> {
  const body = await get<{ groups?: DirectoryGroup[] }>(
    `/api/directory/groups?limit=500${search ? `&q=${encodeURIComponent(search)}` : ""}`,
    {}
  );
  return body.groups ?? [];
}

export async function listDirectoryUsers(search = ""): Promise<DirectoryUser[]> {
  const body = await get<{ users?: DirectoryUser[] }>(
    `/api/directory/users?limit=1000${search ? `&q=${encodeURIComponent(search)}` : ""}`,
    {}
  );
  return body.users ?? [];
}

/**
 * The members of a group, by its address.
 *
 * Returns null when the address is not a group, which is the signal to treat
 * it as an ordinary person.
 */
export async function groupMembers(address: string): Promise<string[] | null> {
  const body = await get<{
    isGroup?: boolean;
    recipients?: { email: string }[];
  }>(`/api/groups/resolve?address=${encodeURIComponent(address)}`, {});
  if (!body.isGroup) return null;
  return (body.recipients ?? []).map((r) => r.email.toLowerCase());
}

/**
 * Replaces any group addresses in a list with their members.
 *
 * The everyday operation for the rest of the suite: a project, a meeting or a
 * channel is given a mix of people and groups and needs the people.
 */export async function expandToPeople(addresses: string[]): Promise<string[]> {
  const unique = Array.from(
    new Set(addresses.map((a) => a.trim().toLowerCase()).filter(Boolean))
  );
  if (unique.length === 0) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${ISSUER}/api/groups/resolve`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ addresses: unique }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return unique;

    const body = (await res.json()) as {
      results?: {
        address: string;
        isGroup: boolean;
        recipients: { email: string }[];
      }[];
    };
    const byAddress = new Map(
      (body.results ?? []).map((r) => [r.address.toLowerCase(), r])
    );

    const out: string[] = [];
    for (const address of unique) {
      const hit = byAddress.get(address);
      if (hit?.isGroup) out.push(...hit.recipients.map((r) => r.email.toLowerCase()));
      else out.push(address);
    }
    return Array.from(new Set(out));
  } catch {
    // Leaving the addresses as typed is the safe failure: a real mailbox is
    // delivered to correctly, and a group bounces visibly rather than being
    // silently dropped.
    return unique;
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────
// Writing to the directory
// ─────────────────────────────────────────────────────────────
//
// Everything above reads and fails soft: an unreachable identity provider
// yields an empty directory, because a mail client that cannot draw an avatar
// is still a mail client. A write cannot be treated that way. "The new hire
// was not added to All Employees" looks identical to success if it is
// swallowed, and the symptom arrives days later as somebody who cannot sign
// in to Mail and is not on the all-staff list.
//
// So these report failure honestly, and the caller — `directory-group-outbox.ts`
// — holds a durable retry rather than pretending it worked.

export interface DirectoryWriteResult {
  ok: boolean;
  /** True when the member was already there; still a success, but not a change. */
  alreadyMember?: boolean;
  error?: string;
}

/** Redacts the service token out of anything that might carry it into a log or a stored error. */
function scrubToken(message: string): string {
  return message
    .replace(/X-Service-Token[^\s,)]*/gi, "X-Service-Token [redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .slice(0, 500);
}

async function post<T>(path: string, body: unknown): Promise<{ ok: boolean; status: number; body: T | null; error?: string }> {
  if (!SERVICE_TOKEN) {
    return {
      ok: false,
      status: 0,
      body: null,
      error: "DIRECTORY_SERVICE_TOKEN is not set, so this deployment cannot write to the directory.",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${ISSUER}${path}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });

    const parsed = (await res.json().catch(() => null)) as T | null;
    if (!res.ok) {
      const detail =
        parsed && typeof parsed === "object" && "error" in parsed
          ? String((parsed as { error: unknown }).error)
          : `HTTP ${res.status}`;
      return { ok: false, status: res.status, body: parsed, error: scrubToken(detail) };
    }
    return { ok: true, status: res.status, body: parsed };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: null,
      error: scrubToken(error instanceof Error ? error.message : String(error)),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Adds one person to one group, by the group's address.
 *
 * Idempotent at the identity provider: adding somebody already in the group
 * reports success with `alreadyMember`, so a retried outbox row settles rather
 * than failing forever on the attempt that actually worked.
 */
export async function addGroupMember(
  groupAddress: string,
  memberEmail: string
): Promise<DirectoryWriteResult> {
  const result = await post<{ added?: boolean; alreadyMember?: boolean; error?: string }>(
    "/api/groups/members",
    { group: groupAddress.trim().toLowerCase(), email: memberEmail.trim().toLowerCase() }
  );

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, alreadyMember: result.body?.alreadyMember === true };
}

/** Removes one person from one group. Used on offboarding. */
export async function removeGroupMember(
  groupAddress: string,
  memberEmail: string
): Promise<DirectoryWriteResult> {
  const result = await post<{ removed?: boolean; error?: string }>("/api/groups/members/remove", {
    group: groupAddress.trim().toLowerCase(),
    email: memberEmail.trim().toLowerCase(),
  });

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}

export interface CreateGroupInput {
  email: string;
  name: string;
  description?: string;
  visibility?: "public" | "private";
  joinPolicy?: "open" | "request" | "closed";
}

/**
 * Creates a group at the identity provider, or reports the one already there.
 *
 * Called when an organisation is provisioned and by the groups screen. Not
 * called from onboarding: a hire that quietly invented a group because one was
 * missing would spread a typo across the company rather than surface it.
 */
export async function createDirectoryGroup(input: CreateGroupInput): Promise<DirectoryWriteResult> {
  const result = await post<{ id?: string; existed?: boolean; error?: string }>("/api/groups", {
    email: input.email.trim().toLowerCase(),
    name: input.name.trim(),
    description: input.description?.trim() ?? "",
    visibility: input.visibility ?? "private",
    joinPolicy: input.joinPolicy ?? "closed",
  });

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, alreadyMember: result.body?.existed === true };
}
