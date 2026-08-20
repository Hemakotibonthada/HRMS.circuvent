// ═══════════════════════════════════════════════════════════════
// LETTERS CLIENT
// ═══════════════════════════════════════════════════════════════
//
// Between the letters screen and `/api/documents/*`.
//
// The screen it replaces did not call those endpoints at all. "Generate
// Letter" wrote a row into the generic document store recording that a letter
// had been generated — a template name, a recipient, a timestamp — and never
// rendered a letter. Nothing was produced, so nothing could be sent, and the
// history list lived in a client store that emptied on reload. Every part of
// it looked like it worked.
//
// The mapping lives here, tested, for the same reason `employee-client.ts`
// does: the last time a form talked to an API through ad-hoc object literals
// in a component, three field names disagreed and every submission failed
// validation with a message that named none of them.

import {
  compensationTokenFor,
  ruleFor,
  validateOffer,
  type EngagementType,
  type OfferProblem,
} from "@/lib/offer-rules";

export interface TemplateSummary {
  id: string;
  name: string;
  category: string;
  requiresSignature: boolean;
  signatoryRoles: string[];
  requiredTokens: string[];
}

export interface DocumentSummary {
  id: string;
  title: string;
  category: string;
  status: string;
  sentAt?: string;
  completedAt?: string;
  expiresAt?: string;
  /** R2 object key for the archived, signed PDF once stored — present only once `document-pdf-outbox.ts` has landed a copy. Not a URL a browser can fetch directly; download it through `downloadDocumentPdf`. */
  blobUrl?: string;
  signatures: { id: string; role: string; email: string; name?: string; signedAt?: string }[];
}

export interface DeliveryOutcome {
  email: string;
  role: string;
  sent: boolean;
  reason?: string;
}

export interface OfferDraft {
  engagementType: EngagementType;
  templateId: string;
  candidateName: string;
  candidateEmail: string;
  positionTitle: string;
  startDate: string;
  /** The single figure this engagement is paid in. */
  compensation: string;
  endDate?: string;
  managerName?: string;
  mentorName?: string;
  tradeName?: string;
  paymentSchedule?: string;
  weeklyHours?: string;
  workMode?: string;
  workingHours?: string;
  probationPeriod?: string;
  noticePeriod?: string;
  offerValidUntil?: string;
  /** Anything the chosen template needs that the form does not model. */
  extra?: Record<string, string>;
  /** HR's own address, so the counter-signature slot has somewhere to go. */
  hrEmail: string;
  hrName?: string;
  expiresInDays?: number;
}

/**
 * Turns a draft into the token set the template will be rendered against.
 *
 * The compensation figure is a single field on the form and lands under
 * whichever token the engagement is paid in — `stipend_amount` for an
 * internship, `professional_fees` for a contract. That is what stops an
 * internship offer being built with an `annual_ctc`: there is no path through
 * this function that produces one.
 */
export function tokensFor(draft: OfferDraft): Record<string, string> {
  const rule = ruleFor(draft.engagementType);

  const tokens: Record<string, string> = {
    full_name: draft.candidateName,
    candidate_email: draft.candidateEmail,
    position_title: draft.positionTitle,
    start_date: draft.startDate,
    [compensationTokenFor(draft.engagementType)]: draft.compensation,
    work_mode: draft.workMode ?? "on-site",
    working_hours: draft.workingHours ?? "standard business hours",
    notice_period: draft.noticePeriod ?? `${rule.defaultNoticeDays} days`,
    hr_contact_name: draft.hrName ?? "People Operations",
    hr_contact_email: draft.hrEmail,
  };

  if (draft.endDate) tokens.engagement_end_date = draft.endDate;
  if (draft.managerName) tokens.manager_name = draft.managerName;
  if (draft.mentorName) tokens.mentor_name = draft.mentorName;
  if (draft.tradeName) tokens.trade_name = draft.tradeName;
  if (draft.paymentSchedule) tokens.payment_schedule = draft.paymentSchedule;
  if (draft.weeklyHours) tokens.weekly_hours = draft.weeklyHours;
  if (draft.offerValidUntil) tokens.offer_valid_until = draft.offerValidUntil;

  // Probation belongs only to engagements that have one. Setting it from a
  // form default would put "3 months" on an internship, which the rules then
  // reject — correctly, but with an error the user cannot act on because the
  // field is not on their screen.
  if (rule.hasProbation && draft.probationPeriod) {
    tokens.probation_period = draft.probationPeriod;
  }

  const merged = { ...tokens, ...(draft.extra ?? {}) };

  // The forbidden list wins over everything, including `extra`.
  //
  // A user filling in a full-time offer and then switching the engagement to
  // internship keeps whatever they had already typed, and `extra` is merged
  // last — so a stale `basic_salary` would ride through into a letter that
  // must not contain one. Filtering here rather than trusting callers means
  // there is no route into this function that emits a token the engagement
  // forbids, which is the property the tests assert mechanically.
  for (const forbidden of rule.forbiddenTokens) {
    delete merged[forbidden];
  }

  return merged;
}

export interface DraftCheck {
  valid: boolean;
  problems: OfferProblem[];
}

/**
 * Checks a draft before anything is sent.
 *
 * The API validates too and must — a client check is a convenience, not a
 * control. The point of doing it here is that the server answers a bad offer
 * with one 422 string, while the form needs to know which fields to mark.
 */
export function checkDraft(draft: OfferDraft): DraftCheck {
  const problems: OfferProblem[] = [];

  if (!draft.templateId) {
    problems.push({ field: "templateId", message: "Choose a letter template" });
  }
  if (!draft.candidateName.trim()) {
    problems.push({ field: "candidateName", message: "The candidate needs a name" });
  }
  if (!isEmail(draft.candidateEmail)) {
    problems.push({ field: "candidateEmail", message: "A valid candidate email is needed" });
  }
  if (!isEmail(draft.hrEmail)) {
    problems.push({ field: "hrEmail", message: "A valid HR email is needed to counter-sign" });
  }
  if (!draft.positionTitle.trim()) {
    problems.push({ field: "positionTitle", message: "The position needs a title" });
  }

  const rules = validateOffer({
    engagementType: draft.engagementType,
    values: tokensFor(draft),
    startDate: draft.startDate,
    endDate: draft.endDate,
  });

  return {
    valid: problems.length === 0 && rules.valid,
    problems: [...problems, ...rules.problems],
  };
}

function isEmail(value: string | undefined): boolean {
  if (!value) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** The request body `/api/documents/generate` expects. */
export function generateRequestFor(draft: OfferDraft): {
  templateId: string;
  candidateId?: string;
  title: string;
  extraValues: Record<string, string>;
  recipients: Record<string, { email: string; name?: string }>;
  expiresInDays?: number;
} {
  return {
    templateId: draft.templateId,
    title: `${ruleFor(draft.engagementType).label} — ${draft.positionTitle}`,
    extraValues: tokensFor(draft),
    // The candidate signs first; HR counter-signs. `buildSlots` refuses a
    // signatory with no recipient, so both have to be present here even though
    // only one of them is typed into the form.
    recipients: {
      employee: { email: draft.candidateEmail.trim(), name: draft.candidateName.trim() },
      hr: { email: draft.hrEmail.trim(), name: draft.hrName?.trim() },
    },
    expiresInDays: draft.expiresInDays,
  };
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

export async function listTemplates(): Promise<TemplateSummary[]> {
  const response = await fetch("/api/documents/templates", { credentials: "include" });
  if (!response.ok) throw new Error(await readError(response, "Could not load templates"));

  const body = (await response.json()) as { templates?: TemplateSummary[] };
  return body.templates ?? [];
}

export async function listDocuments(status?: string): Promise<DocumentSummary[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  const response = await fetch(`/api/documents${query}`, { credentials: "include" });
  if (!response.ok) throw new Error(await readError(response, "Could not load documents"));

  const body = (await response.json()) as { documents?: DocumentSummary[] };
  return body.documents ?? [];
}

export async function generateOffer(draft: OfferDraft): Promise<DocumentSummary> {
  const check = checkDraft(draft);
  if (!check.valid) throw new Error(check.problems[0].message);

  const response = await fetch("/api/documents/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(generateRequestFor(draft)),
  });

  if (!response.ok) throw new Error(await readError(response, "Could not generate the letter"));
  return (await response.json()) as DocumentSummary;
}

export interface SendResult {
  document: DocumentSummary;
  delivery: DeliveryOutcome[];
  links: { email: string; role: string; url: string }[];
  mailConfigured: boolean;
}

export async function sendDocument(documentId: string): Promise<SendResult> {
  const response = await fetch(`/api/documents/${documentId}/send`, {
    method: "POST",
    credentials: "include",
  });

  if (!response.ok) throw new Error(await readError(response, "Could not send the letter"));
  return (await response.json()) as SendResult;
}

/**
 * Downloads a document's archived, signed PDF and saves it under the given name.
 *
 * Deliberately not a plain `<a href>`: the same URL answers with a JSON error
 * body — not a PDF — when the caller lacks permission, or when the document
 * exists but the storage outbox has not landed a copy yet, and a bare link
 * would just navigate the tab to that JSON with no way for the page to show
 * it as an error. Fetching it here lets a failed download report the same
 * way every other action on this screen does.
 */
export async function downloadDocumentPdf(documentId: string, suggestedTitle: string): Promise<void> {
  const response = await fetch(`/api/documents/${documentId}/pdf`, { credentials: "include" });
  if (!response.ok) throw new Error(await readError(response, "Could not download the PDF"));

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = `${suggestedTitle || "document"}.pdf`;
    link.click();
  } finally {
    // The object URL only needs to live long enough for the click above to be
    // handed to the browser's download machinery; holding onto it leaks
    // memory for the lifetime of the tab.
    URL.revokeObjectURL(url);
  }
}

/**
 * What to tell the user after a send.
 *
 * A send that issues the links but cannot email them is a partial success, and
 * saying "sent" is wrong in a way the user will only discover when a candidate
 * says they never got it. Saying "failed" is also wrong: the offer is issued
 * and the links exist.
 */
export function describeDelivery(result: SendResult): {
  tone: "success" | "warning";
  message: string;
} {
  const failed = result.delivery.filter((d) => !d.sent);

  if (failed.length === 0) {
    const n = result.delivery.length;
    return { tone: "success", message: `Sent to ${n} recipient${n === 1 ? "" : "s"}` };
  }

  if (!result.mailConfigured) {
    return {
      tone: "warning",
      message:
        "The letter is issued, but email is not configured — copy the signing links to send it",
    };
  }

  return {
    tone: "warning",
    message: `Issued, but ${failed.length} of ${result.delivery.length} emails did not go out`,
  };
}
