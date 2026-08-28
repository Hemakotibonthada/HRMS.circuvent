"use client";

// ═══════════════════════════════════════════════════════════════
// INTERNS CLIENT
// ═══════════════════════════════════════════════════════════════
// Between the interns page and `/api/interns/*`.
//
// This is a thin wrapper on purpose. The two things worth getting wrong here
// are not the fetch calls: they are "how many days are left" and "what does
// this reminder milestone mean", and those already live in
// `intern-lifecycle.ts` precisely so the page and the reminder sweep cannot
// drift apart on either one. This module does not recompute either — it
// fetches records and lets the caller pass `internshipEndDate` straight into
// `daysUntil`/`describeDaysRemaining` from that file. Duplicating either
// calculation here would recreate the exact split-brain risk that file's own
// header comment exists to rule out.
//
// Document downloads are the same story: `downloadDocumentPdf` in
// `letters-client.ts` already fetches `/api/documents/[id]/pdf` and turns a
// permission or storage failure into a thrown error instead of navigating the
// tab to a raw JSON body. Interns' issued documents go through the same
// route, so this file re-uses that function rather than opening a second,
// untested path to the same endpoint.

export interface InternDocumentRecord {
  id: string;
  title: string;
  category: string;
  status: string;
  sentAt?: string;
  completedAt?: string;
  expiresAt?: string;
  /** R2 object key once stored — see `letters-client.ts`'s `DocumentSummary.blobUrl` for why this is not a browser-fetchable URL. */
  blobUrl?: string;
  signedCount: number;
  totalSignatories: number;
}

export interface InternRecord {
  id: string;
  employeeCode: string;
  fullName: string;
  email: string;
  designation: string;
  departmentName?: string;
  reportingToName?: string;
  status: string;
  /** The employee's `joinDate` — already the internship start date; see `src/db/schema/hrms.ts`. */
  joinDate: string;
  internshipEndDate?: string;
  exitDate?: string;
  /** Set once this person has since converted to permanent; kept so a stale reference never reads as "no history". */
  previousEmployeeCode?: string;
  codeChangedAt?: string;
  /** Issued via the existing document pipeline — see `intern-documents.ts`. Empty, not missing, when nothing has been generated yet. */
  documents: InternDocumentRecord[];
}

export interface InternsPage {
  items: InternRecord[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/** The server's message, or a fallback. Never a bare "something went wrong". */
async function messageFrom(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return body.error || fallback;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });

  if (!response.ok) {
    throw new Error(await messageFrom(response, `Request failed (${response.status})`));
  }
  return (await response.json()) as T;
}

export async function listInterns(
  opts: { search?: string; page?: number; pageSize?: number } = {}
): Promise<InternsPage> {
  const params = new URLSearchParams();
  if (opts.search) params.set("search", opts.search);
  if (opts.page) params.set("page", String(opts.page));
  if (opts.pageSize) params.set("pageSize", String(opts.pageSize));
  const qs = params.toString();
  return call<InternsPage>(`/api/interns${qs ? `?${qs}` : ""}`);
}

export type InternMutationResult = Omit<InternRecord, "documents">;

/**
 * Sets or clears the expected end date. `null` clears it — for the rare case
 * an internship was extended indefinitely and the reminder sweep should stop
 * counting down against a date that no longer applies.
 */
export async function setInternshipEndDate(
  id: string,
  internshipEndDate: string | null
): Promise<InternMutationResult> {
  return call<InternMutationResult>(`/api/interns/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ internshipEndDate }),
  });
}

/**
 * Converts an intern to a permanent employee on a new `CV-` code.
 *
 * Safe to call again on the same id if the first response was lost to a
 * network error: `NeonEmployeeRepository.convertToPermanent` locks the row and
 * returns the already-converted record instead of drawing a second code, so a
 * retried click cannot double-issue one.
 */
export async function convertToPermanent(id: string): Promise<InternMutationResult> {
  return call<InternMutationResult>(`/api/interns/${id}/convert`, { method: "POST" });
}
