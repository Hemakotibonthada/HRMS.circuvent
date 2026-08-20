// ═══════════════════════════════════════════════════════════════
// SIGNATURE IMAGE — SHRINK TO FIT
// ═══════════════════════════════════════════════════════════════
//
// `/api/sign/[id]` accepts `signatureImageUrl` as `z.string().url().max(2000)`
// — a drawn signature has to travel as a URL-shaped string, and 2000
// characters is roughly 1.4KB of actual PNG once the
// `data:image/png;base64,` prefix and base64's 4-for-3 blow-up are
// accounted for. A signature pad drawn at a size comfortable for a mouse or
// a thumb produces a PNG well over that on the first try, almost always —
// so submitting whatever `canvas.toDataURL()` happens to return and hoping
// it fits is not an option; the request would just fail validation.
//
// The shrink loop here does not touch a canvas itself. Canvas only exists in
// a browser and it draws pixels — it has no opinion on policy. The caller
// (`sign/[id]/page.tsx`) supplies `renderAtWidth`, a function that redraws
// the signature at a given width and returns its data URI; this module only
// tries decreasing widths until one fits, or reports that none did. That
// split is what makes "does the shrink loop pick the right width and stop at
// the first fit" testable at all without a real `<canvas>` element, which
// jsdom does not implement.

/** Thrown when even the smallest candidate width still produces a data URI over budget — a signature drawn with enough detail (or enough noise) that this scheme cannot bring it under the sign route's length limit. */
export class SignatureTooComplexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignatureTooComplexError";
  }
}

/** Matches `signSchema.signatureImageUrl` in `src/app/api/sign/[id]/route.ts` exactly — change one, change the other. */
export const SIGNATURE_DATA_URL_MAX_LENGTH = 2000;

/**
 * Widths to try, largest first. A signature pad is drawn wide and short (a
 * name, not a portrait), so scaling the width down and holding the aspect
 * ratio is enough on its own to shrink the PNG — there is no separate
 * "quality" knob to turn on a 2D canvas context the way there would be for
 * JPEG, and PNG is what `/api/sign/[id]`'s embedding step (`render-pdf.ts`)
 * expects.
 */
export const SIGNATURE_CANDIDATE_WIDTHS = [480, 360, 280, 220, 160, 120, 90];

export interface ShrinkSignatureToFitOptions {
  maxDataUrlLength?: number;
  candidateWidths?: number[];
}

/**
 * Tries `renderAtWidth` at each candidate width, largest first, and returns
 * the first data URI that fits inside `maxDataUrlLength`.
 *
 * Largest-first, not a binary search for the smallest width that works: a
 * signature rendered at 480px is legible in a way one shrunk all the way to
 * 90px to satisfy some hypothetical smaller budget is not, so this stops
 * the moment it finds a width that fits rather than continuing to search
 * for a theoretically smaller one.
 */
export async function shrinkSignatureToFit(
  renderAtWidth: (width: number) => Promise<string> | string,
  options: ShrinkSignatureToFitOptions = {}
): Promise<string> {
  const maxLength = options.maxDataUrlLength ?? SIGNATURE_DATA_URL_MAX_LENGTH;
  const widths = options.candidateWidths ?? SIGNATURE_CANDIDATE_WIDTHS;

  let smallestSeen = Infinity;
  for (const width of widths) {
    const dataUrl = await renderAtWidth(width);
    smallestSeen = Math.min(smallestSeen, dataUrl.length);
    if (dataUrl.length <= maxLength) return dataUrl;
  }

  throw new SignatureTooComplexError(
    `Could not shrink the signature under ${maxLength} characters (smallest attempt was ${smallestSeen}).`
  );
}
