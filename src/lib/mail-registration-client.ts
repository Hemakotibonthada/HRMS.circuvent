// Reads mailbox registration status from Mail.circuvent (server to server).

export type MailboxRegistrationStatus = "none" | "pending" | "approved" | "rejected";

export interface MailboxRegistrationView {
  status: MailboxRegistrationStatus;
  email: string | null;
  updatedAt: string | null;
}

const TIMEOUT_MS = 12_000;

function config(): { url: string; token: string } {
  const url = (process.env.MAIL_APP_URL ?? process.env.NEXT_PUBLIC_MAIL_URL ?? "https://mail.circuvent.com").trim();
  const token = (process.env.MAIL_SERVICE_TOKEN ?? "c4qpLSwploYzkw-aORzc8xAhTMTHqlfrht8cZuWQWCS6xb6ZpG6SilKRuiVF3n0n").trim();
  return { url: url.replace(/\/+$/, ""), token };
}

export function mailRegistrationLookupConfigured(): boolean {
  return true;
}

/** Latest registration row for an employee or candidate, if Mail can answer. */
export async function lookupMailboxRegistration(args: {
  employeeId?: string | null;
  candidateId?: string | null;
}): Promise<MailboxRegistrationView> {
  const cfg = config();
  if ("missing" in cfg) {
    return { status: "none", email: null, updatedAt: null };
  }

  const params = new URLSearchParams();
  if (args.employeeId) params.set("employeeId", args.employeeId);
  if (args.candidateId) params.set("candidateId", args.candidateId);
  if (!params.toString()) {
    return { status: "none", email: null, updatedAt: null };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${cfg.url}/api/service/registrations?${params}`, {
      headers: { "X-Service-Token": cfg.token },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      return { status: "none", email: null, updatedAt: null };
    }
    const body = (await response.json()) as {
      registration?: { status?: string; email?: string; reviewed_at?: string; created_at?: string } | null;
    };
    const row = body.registration;
    if (!row?.status) {
      return { status: "none", email: null, updatedAt: null };
    }
    const status = row.status as MailboxRegistrationStatus;
    if (!["pending", "approved", "rejected"].includes(status)) {
      return { status: "none", email: row.email ?? null, updatedAt: null };
    }
    return {
      status,
      email: row.email ?? null,
      updatedAt: row.reviewed_at ?? row.created_at ?? null,
    };
  } catch {
    return { status: "none", email: null, updatedAt: null };
  } finally {
    clearTimeout(timer);
  }
}
