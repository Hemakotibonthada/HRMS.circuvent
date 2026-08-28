// ═══════════════════════════════════════════════════════════════
// WHERE A WEBHOOK IS ALLOWED TO POINT
// ═══════════════════════════════════════════════════════════════
// An administrator types a URL and this server posts to it. That is
// server-side request forgery by construction, and "only an admin can set it"
// is not the mitigation people assume: the request leaves from inside the
// deployment, so it reaches things the admin's own browser cannot — the cloud
// metadata endpoint that hands out instance credentials, an internal admin
// panel, a database's HTTP interface, another tenant's private service.
//
// Two properties make this worth doing carefully rather than with a regex.
//
// A hostname is not an address. `webhook.example.com` can have an A record
// pointing at 169.254.169.254, and no amount of string inspection will see it.
// So the name is resolved and every address it resolves to is checked.
//
// And the answer can change between the check and the request — classic DNS
// rebinding: the first lookup returns a public address, the second returns a
// private one. The defence is to connect to the address that was validated
// rather than to resolve the name again, which is what `pinnedAddress` is for.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface EndpointDecision {
  ok: boolean;
  /** Why it was refused, in words an administrator can act on. */
  reason?: string;
  /** The address that was checked. Connect to this, not to a fresh lookup. */
  pinnedAddress?: string;
}

/**
 * Ranges that must never be reached from a user-supplied URL.
 *
 * Link-local (169.254.0.0/16) is the one that matters most: on AWS, GCP and
 * Azure the metadata service lives at 169.254.169.254 and will hand out
 * credentials to anything that asks from inside the instance.
 */
function isBlockedIPv4(address: string): string | null {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return "not a valid address";
  const [a, b] = parts;

  if (a === 0) return "an unspecified address";
  if (a === 10) return "a private address (10.0.0.0/8)";
  if (a === 127) return "a loopback address";
  if (a === 169 && b === 254) {
    return "a link-local address — this is where cloud metadata services live";
  }
  if (a === 172 && b >= 16 && b <= 31) return "a private address (172.16.0.0/12)";
  if (a === 192 && b === 168) return "a private address (192.168.0.0/16)";
  if (a === 100 && b >= 64 && b <= 127) return "a carrier-grade NAT address";
  if (a === 192 && b === 0) return "a reserved address";
  if (a >= 224) return "a multicast or reserved address";
  return null;
}

function isBlockedIPv6(address: string): string | null {
  const value = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (value === "::" || value === "::0") return "an unspecified address";
  if (value === "::1") return "a loopback address";
  if (value.startsWith("fe80")) return "a link-local address";
  if (/^f[cd]/.test(value)) return "a unique-local address";
  // ::ffff:169.254.169.254 reaches IPv4 metadata through an IPv6 literal.
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIPv4(mapped[1]);
  return null;
}

/** Whether a literal address is one we refuse to connect to. */
export function blockedAddressReason(address: string): string | null {
  const bare = address.replace(/^\[|\]$/g, "");
  const version = isIP(bare);
  if (version === 4) return isBlockedIPv4(bare);
  if (version === 6) return isBlockedIPv6(bare);
  return "not a valid IP address";
}

/**
 * Checks a webhook URL, resolving its host.
 *
 * `resolve` is injectable so the rules can be tested without depending on
 * whatever the machine's DNS happens to answer today.
 */
export async function checkEndpoint(
  raw: string,
  resolve: (host: string) => Promise<string[]> = defaultResolve,
): Promise<EndpointDecision> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "That is not a valid URL." };
  }

  if (url.protocol !== "https:") {
    return {
      ok: false,
      reason:
        "The URL must start with https. A plain http webhook sends the payload, and the signing secret, in clear.",
    };
  }

  if (url.username || url.password) {
    return { ok: false, reason: "Remove the username and password from the URL." };
  }

  // A literal address skips DNS entirely, so check it directly.
  const bareHost = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(bareHost)) {
    const reason = blockedAddressReason(bareHost);
    return reason ? { ok: false, reason: `That address is ${reason}.` } : { ok: true, pinnedAddress: bareHost };
  }

  if (!url.hostname.includes(".")) {
    return {
      ok: false,
      reason: "That host has no domain, so it can only be something on the internal network.",
    };
  }

  let addresses: string[];
  try {
    addresses = await resolve(url.hostname);
  } catch {
    return { ok: false, reason: `${url.hostname} could not be resolved.` };
  }

  if (addresses.length === 0) {
    return { ok: false, reason: `${url.hostname} did not resolve to any address.` };
  }

  // Every answer has to be acceptable, not merely the first: a host that
  // returns one public and one private address would otherwise pass here and
  // then connect to the private one.
  for (const address of addresses) {
    const reason = blockedAddressReason(address);
    if (reason) {
      return { ok: false, reason: `${url.hostname} resolves to ${address}, which is ${reason}.` };
    }
  }

  return { ok: true, pinnedAddress: addresses[0] };
}

async function defaultResolve(host: string): Promise<string[]> {
  const results = await lookup(host, { all: true });
  return results.map((r) => r.address);
}
