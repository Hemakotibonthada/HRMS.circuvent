// ═══════════════════════════════════════════════════════════════
// DOCUMENT PDF RENDERING
// ═══════════════════════════════════════════════════════════════
//
// Turns a signed envelope's frozen `renderedBody` (HTML, produced once at
// generation time by `/api/documents/generate`) into the durable artifact
// that actually gets stored: a paginated A4 PDF a person can download, print
// or forward, with the signature evidence embedded in it rather than living
// only in a database row nobody outside this product can read.
//
// There is no headless browser here on purpose. Puppeteer needs a Chromium
// binary that Vercel's serverless functions do not ship with, and pulling one
// in would trade a five-minute cold start for a feature that runs once per
// signed document. `renderedBody` is also not arbitrary web content — it is
// this codebase's own template output (`seed-letter-templates.mjs`, and
// whatever future templates follow its shape): a handful of block elements
// (`div`, `p`, `h1`, `table`, `ul`/`li`) wrapping plain text, never scripts or
// externally loaded assets. Reading that structure with a small tag-scanner
// and laying the text out by hand with `pdf-lib` is therefore both sufficient
// and an order of magnitude simpler than embedding a browser to do it.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  PageSizes,
  rgb,
  type Color,
  type PDFImage,
} from "pdf-lib";
import { defaultLogoUrl, extractCompanyLogoUrl } from "@/lib/document-templates/branding";

// ─── Public shapes ──────────────────────────────────────────

/** One person's mark on the envelope, as far as the PDF needs to know. */
export interface DocumentPdfSignatory {
  /** Display name; callers fall back to the signatory's email when a person signed without one on file. */
  name: string;
  role: string;
  signedAt: Date;
  /** The data URI the signing page and `/api/sign/[id]` already exchange (`data:image/png;base64,...`). Absent when the signatory typed their name instead of drawing. */
  signatureImageDataUrl?: string | null;
}

export interface RenderDocumentPdfParams {
  title: string;
  /** The tenant's own name (`loadOrgIdentity`), not this product's — this is their letterhead. */
  companyName: string;
  /** `generatedDocuments.renderedBody`: a full HTML document, not a fragment. */
  bodyHtmlOrText: string;
  /**
   * Shown once in the signature block so a printed or forwarded copy can be
   * tied back to its envelope without a database lookup. Callers pass the
   * document's own id — stable, already unique per tenant, and not derived
   * from anything a person typed.
   */
  signingReference: string;
  /**
   * Every signatory who actually signed. A template can require more than one
   * signature (`signatoryRoles: ["employee", "hr"]` is the common case in
   * this catalog), so this is a list rather than a single signature; a
   * countersignature that got silently dropped from the archived PDF would
   * be exactly the kind of gap this feature exists to close.
   */
  signatories: DocumentPdfSignatory[];
}

/**
 * Renders one A4, multi-page PDF for a document: the body text, wrapped and
 * paginated, under a running header on every page, followed by a signature
 * block for whoever actually signed. Never throws for "the content was long"
 * — pagination has no upper bound — only for inputs that are structurally
 * unusable (handled defensively below rather than surfaced as a class of
 * error, since a rendering job should not fail an otherwise-valid signature).
 */
export async function renderDocumentPdf(params: RenderDocumentPdfParams): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const bodyFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  // Resolved once per document, same as the HTML rendering: `generate()`
  // already decided whether this document carries the tenant's own logo or
  // the deployment default (or neither) and baked that decision into
  // `renderedBody` as a real `<img class="company-logo">` or nothing at all.
  // Re-deriving that same choice here rather than asking `org-identity`
  // again keeps the PDF showing exactly what the signatory saw on screen,
  // not whatever the organisation's logo happens to be by the time someone
  // downloads the archive.
  const logo = await loadCompanyLogo(pdfDoc, params.bodyHtmlOrText);

  const ops: FlowOp[] = [
    ...blocksToOps(htmlToBlocks(params.bodyHtmlOrText), bodyFont, boldFont),
    ...(await signatureOps(params, pdfDoc, bodyFont, boldFont)),
  ];

  const pages = paginate(ops, CONTENT_HEIGHT);
  const totalPages = pages.length;

  pages.forEach((pageOps, index) => {
    const page = pdfDoc.addPage(PageSizes.A4);
    drawHeader(page, params.companyName, params.title, bodyFont, boldFont, logo);
    drawFooter(page, params.signingReference, index + 1, totalPages, bodyFont);
    drawOps(page, pageOps);
  });

  // An envelope with a body so short pagination produced nothing (should not
  // happen in practice — every template has at least a title — but an empty
  // `pages` array must still yield a real, openable single-page PDF rather
  // than one with no pages at all).
  if (totalPages === 0) {
    const page = pdfDoc.addPage(PageSizes.A4);
    drawHeader(page, params.companyName, params.title, bodyFont, boldFont, logo);
    drawFooter(page, params.signingReference, 1, 1, bodyFont);
  }

  return pdfDoc.save();
}

// ─── Company logo ───────────────────────────────────────────

// Drawn top-right, bottom-aligned with the rule beneath the two-line header
// text so it reads as part of the same masthead rather than a stray image.
const LOGO_SIZE = 26;
const LOGO_GAP = 12;

/**
 * Loads and embeds the logo `applyCompanyLogo()` baked into this document's
 * `renderedBody`, or returns null for a tenant that carries none — the exact
 * same two outcomes as the HTML rendering, never a broken image. Absent from
 * the markup entirely (no tenant logo, no deployment default configured, or
 * a template that predates this feature) is not an error and is not logged;
 * it is simply nothing to draw.
 *
 * A failure to obtain the bytes for a URL that *is* present — a network
 * error, a 404, a file that is not actually a PNG — is caught here rather
 * than left to `pdf-lib` or an outer caller, because a signed document that
 * fails to produce its durable PDF over a masthead image would be a strictly
 * worse outcome than one whose letterhead falls back to typography, and this
 * module's whole reason for existing is to keep that PDF generating.
 */
async function loadCompanyLogo(pdfDoc: PDFDocument, html: string): Promise<PDFImage | null> {
  const logoUrl = extractCompanyLogoUrl(html);
  if (!logoUrl) return null;
  try {
    return await pdfDoc.embedPng(await readLogoBytes(logoUrl));
  } catch (error) {
    console.warn("[render-pdf] Could not load the company logo; rendering the letterhead without it.", error);
    return null;
  }
}

/**
 * Circuvent's own out-of-the-box mark — the one every tenant that has not
 * configured a logo of its own carries — is read straight off this
 * deployment's disk rather than fetched over HTTPS: it is this server's own
 * bundled `public/logo-mark-128.png` (the same file `NEXT_PUBLIC_CAREERS_URL`
 * serves at that path), so a network round trip would only ask this process
 * to fetch from itself, and every environment that calls this function —
 * this test suite and `render-sample-letters.mjs` included — must produce a
 * PDF with the default mark whether or not outbound network access happens
 * to be available. A tenant's own externally hosted logo, or an operator's
 * `MAIL_LOGO_URL` override, is not a file this deployment ships, so there is
 * no local copy to reach for; the only way to get those bytes is to fetch
 * the URL, and a failure there has no safe local fallback.
 */
async function readLogoBytes(logoUrl: string): Promise<Uint8Array> {
  if (!process.env.MAIL_LOGO_URL?.trim() && logoUrl === defaultLogoUrl()) {
    return new Uint8Array(await readFile(join(process.cwd(), "public", "logo-mark-128.png")));
  }
  const response = await fetch(logoUrl);
  if (!response.ok) throw new Error(`Logo fetch responded with HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

// ─── Page geometry ──────────────────────────────────────────

const [PAGE_WIDTH, PAGE_HEIGHT] = PageSizes.A4;
const MARGIN_X = 54;
// Reserves room for the two-line header (company + title) and the rule
// beneath it, so body text never starts above where the header ends.
const HEADER_RESERVED = 66;
// Reserves room for the footer's reference + page-number line.
const FOOTER_RESERVED = 42;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
const CONTENT_TOP_Y = PAGE_HEIGHT - HEADER_RESERVED;
const CONTENT_BOTTOM_Y = FOOTER_RESERVED;
const CONTENT_HEIGHT = CONTENT_TOP_Y - CONTENT_BOTTOM_Y;

const INK: Color = rgb(0.13, 0.13, 0.16);
const MUTED: Color = rgb(0.45, 0.45, 0.49);
const RULE: Color = rgb(0.82, 0.82, 0.85);

const BODY_SIZE = 10.5;
const SUBHEADING_SIZE = 12.5;
const HEADING_SIZE = 16.5;
const LINE_HEIGHT_FACTOR = 1.42;

const GAP_BEFORE_TEXT = 8;
const GAP_BEFORE_SUBHEADING = 18;
const GAP_BEFORE_HEADING = 22;

function drawHeader(page: PDFPage, companyName: string, title: string, font: PDFFont, boldFont: PDFFont, logo: PDFImage | null): void {
  const top = PAGE_HEIGHT - 32;
  // The logo sits to the right, so the company name and title must not run
  // under it — reserve its width only when there is one to draw; a document
  // with no logo keeps the exact same layout this file has always produced.
  const textMaxWidth = logo ? CONTENT_WIDTH - LOGO_SIZE - LOGO_GAP : CONTENT_WIDTH;
  page.drawText(truncateToWidth(companyName, boldFont, 12, textMaxWidth), {
    x: MARGIN_X,
    y: top,
    size: 12,
    font: boldFont,
    color: INK,
  });
  page.drawText(truncateToWidth(title, font, 9, textMaxWidth), {
    x: MARGIN_X,
    y: top - 14,
    size: 9,
    font,
    color: MUTED,
  });
  page.drawLine({
    start: { x: MARGIN_X, y: top - 22 },
    end: { x: PAGE_WIDTH - MARGIN_X, y: top - 22 },
    thickness: 0.75,
    color: RULE,
  });
  if (logo) {
    page.drawImage(logo, {
      x: PAGE_WIDTH - MARGIN_X - LOGO_SIZE,
      y: top - 22,
      width: LOGO_SIZE,
      height: LOGO_SIZE,
    });
  }
}

function drawFooter(page: PDFPage, signingReference: string, pageNumber: number, totalPages: number, font: PDFFont): void {
  const y = 26;
  page.drawLine({
    start: { x: MARGIN_X, y: y + 14 },
    end: { x: PAGE_WIDTH - MARGIN_X, y: y + 14 },
    thickness: 0.75,
    color: RULE,
  });
  page.drawText(`Ref: ${signingReference}`, { x: MARGIN_X, y, size: 8, font, color: MUTED });
  const label = `Page ${pageNumber} of ${totalPages}`;
  const labelWidth = font.widthOfTextAtSize(label, 8);
  page.drawText(label, { x: PAGE_WIDTH - MARGIN_X - labelWidth, y, size: 8, font, color: MUTED });
}

/** Cuts a header line short with an ellipsis rather than overrunning the margin — headers get one line, never wrapping. */
function truncateToWidth(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  const ellipsis = "…";
  let end = text.length;
  while (end > 0 && font.widthOfTextAtSize(text.slice(0, end) + ellipsis, size) > maxWidth) end -= 1;
  return text.slice(0, end) + ellipsis;
}

// ─── HTML → structured blocks ───────────────────────────────

type BlockKind = "text" | "subheading" | "heading";

interface HtmlBlock {
  /** May contain internal `\n` from `<br/>` — those are real line breaks, not wrapping candidates. */
  text: string;
  kind: BlockKind;
}

// Tags that end a run of accumulated text and start a fresh one. `th`/`td`
// are deliberately absent: a data row (`<tr><th>Label</th><td>Value</td></tr>`,
// this catalog's compensation/structure tables) should read as one line —
// "Label: Value" — not three, so only the enclosing `tr` is a boundary.
const BLOCK_TAGS = new Set([
  "html", "body", "header", "footer", "section", "article", "blockquote",
  "div", "p", "li", "ul", "ol", "table", "thead", "tbody", "tfoot", "tr",
  "h1", "h2", "h3", "h4", "h5", "h6",
]);
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

// `seed-letter-templates.mjs`'s `shell()` marks a section title as
// `<p class="section-title">`, not `<h2>` — the only CSS class this reader
// knows about, and only because it is this catalog's one real convention for
// "this line introduces the next section," which a plain paragraph-by-
// paragraph reading would otherwise flatten into body text.
const SECTION_TITLE_CLASS = /\bclass\s*=\s*["'][^"']*\bsection-title\b[^"']*["']/i;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: "\u00A0",
  mdash: "\u2014", ndash: "\u2013", hellip: "\u2026",
  lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201C", rdquo: "\u201D",
  copy: "\u00A9", reg: "\u00AE", trade: "\u2122",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body[0] === "#") {
      const isHex = body[1] === "x" || body[1] === "X";
      const codePoint = isHex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    // An entity this table does not recognise is left exactly as written
    // rather than deleted — a stray "&foo;" surviving into the PDF is a
    // cosmetic annoyance; silently eating unrecognised text is not.
    return NAMED_ENTITIES[body] ?? match;
  });
}

/**
 * Reads `renderedBody` — a complete HTML document, head/style and all, not a
 * fragment — into an ordered list of text blocks.
 *
 * This is a tag-scanner, not a parser: it never builds a DOM or a tree, only
 * tracks "what block am I inside" while walking the string once. That is
 * enough for this catalog's shape (nested `div` wrappers carrying no text of
 * their own, `h1`/`p`/`table`/`ul` carrying all of it) without pulling in an
 * HTML engine to answer a question this text ever only asks once.
 */
export function htmlToBlocks(html: string): HtmlBlock[] {
  const withoutNonContent = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");

  const blocks: HtmlBlock[] = [];
  let current = "";
  let kind: BlockKind = "text";

  const flush = () => {
    const text = current
      .split("\n")
      .map((line) => line.trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (text) blocks.push({ text, kind });
    current = "";
  };

  const tagPattern = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(withoutNonContent)) !== null) {
    const textBefore = withoutNonContent.slice(lastIndex, match.index);
    if (textBefore) current += decodeEntities(textBefore).replace(/\s+/g, " ");
    lastIndex = tagPattern.lastIndex;

    const [raw, tagRaw, attrs] = match;
    const tag = tagRaw.toLowerCase();
    const isClosing = raw.startsWith("</");

    if (tag === "br") {
      current += "\n";
      continue;
    }
    if (tag === "th" && isClosing) {
      current += ": ";
      continue;
    }
    if (tag === "td" && isClosing) {
      current += "  ";
      continue;
    }
    if (!BLOCK_TAGS.has(tag)) continue; // span, strong, a, ... — inline, no layout meaning here

    flush();
    if (!isClosing && HEADING_TAGS.has(tag)) {
      kind = "heading";
    } else if (!isClosing && (tag === "p" || tag === "div") && SECTION_TITLE_CLASS.test(attrs)) {
      kind = "subheading";
    } else {
      kind = "text";
    }
    if (!isClosing && tag === "li") current = "\u2022 ";
  }

  const tail = withoutNonContent.slice(lastIndex);
  if (tail) current += decodeEntities(tail).replace(/\s+/g, " ");
  flush();

  return blocks;
}

// ─── Word wrap ──────────────────────────────────────────────

/** Wraps `text` to `maxWidth` at word boundaries, falling back to a character break for a single word wider than the page — a long URL or hash must still end up somewhere rather than overflow the margin or loop forever waiting for room that never comes. */
function wrapWords(text: string, measure: (s: string) => number, maxWidth: number): string[] {
  const words = text.split(" ").filter((w) => w.length > 0);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const withWord = line ? `${line} ${word}` : word;
    if (measure(withWord) <= maxWidth) {
      line = withWord;
      continue;
    }
    if (line) {
      lines.push(line);
      line = "";
    }
    if (measure(word) <= maxWidth) {
      line = word;
    } else {
      lines.push(...hardBreak(word, measure, maxWidth));
    }
  }
  if (line) lines.push(line);
  return lines;
}

function hardBreak(word: string, measure: (s: string) => number, maxWidth: number): string[] {
  const pieces: string[] = [];
  let chunk = "";
  for (const ch of word) {
    const candidate = chunk + ch;
    if (chunk && measure(candidate) > maxWidth) {
      pieces.push(chunk);
      chunk = ch;
    } else {
      chunk = candidate;
    }
  }
  if (chunk) pieces.push(chunk);
  return pieces;
}

// ─── Flow ops (the unit pagination works in) ────────────────

interface LineOp {
  type: "line";
  text: string;
  font: PDFFont;
  size: number;
  color: Color;
  height: number;
  gapBefore: number;
}
interface ImageFlowOp {
  type: "image";
  image: PDFImage;
  width: number;
  height: number;
  gapBefore: number;
}
type FlowOp = LineOp | ImageFlowOp;

function opHeight(op: FlowOp): number {
  return op.gapBefore + op.height;
}

function blocksToOps(blocks: HtmlBlock[], bodyFont: PDFFont, boldFont: PDFFont): LineOp[] {
  const ops: LineOp[] = [];
  for (const block of blocks) {
    const font = block.kind === "text" ? bodyFont : boldFont;
    const size = block.kind === "heading" ? HEADING_SIZE : block.kind === "subheading" ? SUBHEADING_SIZE : BODY_SIZE;
    const gapBefore = block.kind === "heading" ? GAP_BEFORE_HEADING : block.kind === "subheading" ? GAP_BEFORE_SUBHEADING : GAP_BEFORE_TEXT;
    const lineHeight = size * LINE_HEIGHT_FACTOR;
    const color = block.kind === "text" ? INK : rgb(0.08, 0.08, 0.1);

    let firstLine = true;
    // `\n` inside a block's own text came only from an explicit `<br/>` (or
    // the "Label: "/"Value  " joins for a table row) — each survives as its
    // own line, wrapped independently; word-wrap must not be allowed to
    // rejoin lines the source deliberately broke.
    for (const paragraphLine of block.text.split("\n")) {
      const wrapped = wrapWords(paragraphLine, (s) => font.widthOfTextAtSize(s, size), CONTENT_WIDTH);
      for (const text of wrapped) {
        ops.push({ type: "line", text, font, size, color, height: lineHeight, gapBefore: firstLine ? gapBefore : 0 });
        firstLine = false;
      }
    }
  }
  return ops;
}

const SIGNATURE_IMAGE_MAX_WIDTH = 160;
const SIGNATURE_IMAGE_MAX_HEIGHT = 60;

async function signatureOps(
  params: RenderDocumentPdfParams,
  pdfDoc: PDFDocument,
  bodyFont: PDFFont,
  boldFont: PDFFont
): Promise<FlowOp[]> {
  const signed = params.signatories.filter((s) => Boolean(s.signedAt));
  if (signed.length === 0) return []; // nothing genuine to report — no placeholder printed in its place

  const ops: FlowOp[] = [
    { type: "line", text: "Signatures", font: boldFont, size: SUBHEADING_SIZE, color: INK, height: SUBHEADING_SIZE * LINE_HEIGHT_FACTOR, gapBefore: GAP_BEFORE_SUBHEADING + 6 },
    { type: "line", text: `Signing reference: ${params.signingReference}`, font: bodyFont, size: 9, color: MUTED, height: 9 * LINE_HEIGHT_FACTOR, gapBefore: 2 },
  ];

  for (const signatory of signed) {
    const label = signatory.name.trim() || "Signatory";
    ops.push({
      type: "line",
      text: `${label} — ${signatory.role}`,
      font: boldFont,
      size: 11,
      color: INK,
      height: 11 * LINE_HEIGHT_FACTOR,
      gapBefore: 18,
    });
    ops.push({
      type: "line",
      text: `Signed electronically on ${formatTimestamp(signatory.signedAt)}`,
      font: bodyFont,
      size: 9,
      color: MUTED,
      height: 9 * LINE_HEIGHT_FACTOR,
      gapBefore: 2,
    });

    const image = await embedSignatureImage(signatory.signatureImageDataUrl, pdfDoc);
    if (image) {
      const { width, height } = fitImageBox(image.width, image.height, SIGNATURE_IMAGE_MAX_WIDTH, SIGNATURE_IMAGE_MAX_HEIGHT);
      ops.push({ type: "image", image, width, height, gapBefore: 6 });
    }
  }

  return ops;
}

/** Embeds a signatory's drawn/typed PNG, or returns null so the caller falls back to the text-only line already in place above it — a malformed image must never take down the rest of the PDF. */
async function embedSignatureImage(dataUrl: string | null | undefined, pdfDoc: PDFDocument): Promise<PDFImage | null> {
  if (!dataUrl) return null;
  try {
    return await pdfDoc.embedPng(dataUrl);
  } catch (error) {
    console.warn("[render-pdf] Could not embed a signature image; falling back to text only.", error);
    return null;
  }
}

function fitImageBox(naturalWidth: number, naturalHeight: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight, 1);
  return { width: naturalWidth * scale, height: naturalHeight * scale };
}

/** `2025-03-12 10:42 UTC` — unambiguous and independent of the server's or reader's locale, which matters for a timestamp offered as evidence. */
function formatTimestamp(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

// ─── Pagination ─────────────────────────────────────────────

function paginate(ops: FlowOp[], contentHeight: number): FlowOp[][] {
  const pages: FlowOp[][] = [];
  let page: FlowOp[] = [];
  let used = 0;

  for (const op of ops) {
    const isFirstOnPage = page.length === 0;
    const candidate: FlowOp = isFirstOnPage ? { ...op, gapBefore: 0 } : op;
    const need = opHeight(candidate);

    if (!isFirstOnPage && used + need > contentHeight) {
      pages.push(page);
      page = [{ ...op, gapBefore: 0 }];
      used = opHeight(page[0]);
      continue;
    }

    page.push(candidate);
    used += need;
  }
  if (page.length > 0) pages.push(page);
  return pages;
}

function drawOps(page: PDFPage, ops: FlowOp[]): void {
  let y = CONTENT_TOP_Y;
  for (const op of ops) {
    y -= op.gapBefore;
    if (op.type === "line") {
      if (op.text) page.drawText(op.text, { x: MARGIN_X, y: y - op.size, size: op.size, font: op.font, color: op.color });
      y -= op.height;
    } else {
      y -= op.height;
      page.drawImage(op.image, { x: MARGIN_X, y, width: op.width, height: op.height });
    }
  }
}
