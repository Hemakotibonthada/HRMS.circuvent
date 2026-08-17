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

const ISSUER = (process.env.AUTH_ISSUER ?? "https://auth.circuvent.com").replace(
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
 */
export async function expandToPeople(addresses: string[]): Promise<string[]> {
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
