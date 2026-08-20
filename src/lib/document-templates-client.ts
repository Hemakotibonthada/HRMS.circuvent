// ═══════════════════════════════════════════════════════════════
// DOCUMENT TEMPLATES CLIENT
// ═══════════════════════════════════════════════════════════════
//
// Between the template list/editor screens and `/api/document-templates/*`.
//
// The mapping lives here, typed, for the same reason `letters-client.ts` does
// this for `/api/documents/*`: the alternative is each screen building its own
// `fetch` calls and its own idea of what a template or a version record looks
// like, and the two copies drifting the moment one of them changes a field
// name. The editor page and a future version-history panel both need the
// exact same "what does a template look like" — defined once, here.
//
// Validation and preview are NOT reimplemented here. `checkDraft` in
// letters-client.ts is a client-side convenience over rules the server also
// enforces; the same split applies to templates, except the rules
// (`validateTemplateEdit`, `previewTemplate`, `availableTokensFor`) live in
// `lib/document-templates/validation.ts` and are imported directly by the
// editor UI — pure functions with no DOM or fetch dependency, so there is
// nothing for this file to wrap. This file only ever talks to the network.

export type TemplateOrigin = "seed" | "custom";

export interface TemplateListItem {
  id: string;
  name: string;
  category: string;
  origin: TemplateOrigin;
  version: number;
  isActive: boolean;
  requiresSignature: boolean;
  updatedAt: string;
  /** Null means this is still exactly the shipped default — nobody has ever saved an edit. */
  updatedByEmail: string | null;
}

export interface TemplateDetail extends TemplateListItem {
  body: string;
  requiredTokens: string[];
  signatoryRoles: string[];
  createdAt: string;
}

export interface TemplateVersionRecord {
  version: number;
  name: string;
  category: string;
  body: string;
  requiredTokens: string[];
  requiresSignature: boolean;
  signatoryRoles: string[];
  changeNote: string | null;
  changedByEmail: string | null;
  /** Null only for the backfilled row that records what shipped — nobody "changed" the seed. */
  changedById: string | null;
  createdAt: string;
}

export interface TemplatePreview {
  renderedBody: string;
  /** Tokens the preview could only fill with a generic placeholder — worth a
   * visual flag distinct from a hard validation failure. */
  genericTokens: string[];
}

export interface TemplateEditValidation {
  valid: boolean;
  unknownTokens: string[];
  forbiddenTokens: string[];
  /** Names the specific bad token(s); present exactly when `valid` is false. */
  message?: string;
}

export interface PreviewResult {
  preview: TemplatePreview;
  validation: TemplateEditValidation;
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

export async function listTemplates(): Promise<TemplateListItem[]> {
  const response = await fetch("/api/document-templates", { credentials: "include" });
  if (!response.ok) throw new Error(await readError(response, "Could not load templates"));

  const body = (await response.json()) as { templates?: TemplateListItem[] };
  return body.templates ?? [];
}

export async function getTemplate(id: string): Promise<TemplateDetail> {
  const response = await fetch(`/api/document-templates/${id}`, { credentials: "include" });
  if (!response.ok) throw new Error(await readError(response, "Could not load the template"));
  return (await response.json()) as TemplateDetail;
}

export async function listVersions(id: string): Promise<TemplateVersionRecord[]> {
  const response = await fetch(`/api/document-templates/${id}/versions`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error(await readError(response, "Could not load version history"));

  const body = (await response.json()) as { versions?: TemplateVersionRecord[] };
  return body.versions ?? [];
}

/**
 * Renders a draft against sample data and validates it — without saving.
 *
 * Deliberately takes only the draft body: the server fetches the template's
 * own current row to compute both the preview and the validation, rather
 * than trusting a client-supplied "current body", so a stale tab cannot make
 * an invented token look self-referentially known (see the header comment on
 * `validateTemplateEdit` in validation.ts).
 */
export async function previewDraft(id: string, draftBody: string): Promise<PreviewResult> {
  const response = await fetch(`/api/document-templates/${id}/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ body: draftBody }),
  });
  if (!response.ok) throw new Error(await readError(response, "Could not preview the draft"));
  return (await response.json()) as PreviewResult;
}

/**
 * Saves an edit. The server re-validates independently of any client-side
 * check — see the module comment above — and refuses with a 422 naming the
 * bad token rather than saving a draft that would render blank on a real
 * document.
 */
export async function updateTemplate(
  id: string,
  input: { body: string; changeNote?: string }
): Promise<TemplateDetail> {
  const response = await fetch(`/api/document-templates/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await readError(response, "Could not save the template"));
  return (await response.json()) as TemplateDetail;
}

/**
 * Restores an earlier version as the live template — the way back from an
 * edit that turned out to be wrong. Not re-validated against today's token
 * rules; see the revert route's header comment.
 */
export async function revertTemplate(
  id: string,
  input: { toVersion: number; changeNote?: string }
): Promise<TemplateDetail> {
  const response = await fetch(`/api/document-templates/${id}/revert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await readError(response, "Could not revert the template"));
  return (await response.json()) as TemplateDetail;
}
