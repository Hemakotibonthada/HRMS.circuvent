"use client";

// ═══════════════════════════════════════════════════════════════
// /sign/[id] — the signatory's own page
// ═══════════════════════════════════════════════════════════════
// The mirror of /refer/[token]: reached from an emailed link by someone with
// no account, except here the stakes are higher — this is the one place in
// the app where a click is a legally significant act. That shapes it:
//
//  - The token travels exactly as `/api/sign/[id]` expects it: read once
//    from the query string, then carried unchanged into every request body.
//    Nothing here re-derives it, trims it, or treats it as anything other
//    than an opaque credential — weakening that check is the one mistake
//    this page cannot afford to make.
//  - `canSign`/`reason` come from the server on every load and gate the
//    form outright. The reasons (already signed, expired, voided, waiting on
//    someone else...) are server prose, shown verbatim — this page does not
//    maintain its own copy of that judgment, because the server re-checks it
//    again on submit regardless of what the UI decided to show.
//  - A signature pad needs a pointer, and not everyone signing this has one.
//    "Type instead" is not a lesser fallback bolted on for compliance — it
//    renders an equally real image (see `drawTypedSignatureAtWidth` below)
//    and is reachable with a keyboard alone.
//  - `signatureImageUrl` is optional in the API schema on purpose: a signed
//    envelope with no image is still a signed envelope. If the drawn or
//    typed image cannot be shrunk under the request's 2000-character budget
//    (see `shrinkSignatureToFit`), or the browser's canvas support fails
//    outright, this submits the sign action without one rather than
//    blocking someone from completing a time-sensitive act over a rendering
//    detail. A small notice says so; nothing pretends the image made it
//    when it did not.

import {
  forwardRef,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useParams, useSearchParams } from "next/navigation";
import { shrinkSignatureToFit, SignatureTooComplexError } from "@/lib/documents/signature-image";

interface SigningDocumentView {
  id: string;
  title: string;
  category: string;
  status: string;
  renderedBody: string | null;
  expiresAt: string | null;
}

interface SigningSignatory {
  id: string;
  email: string;
  role: string;
  name?: string;
}

type Screen =
  | { kind: "loading" }
  | { kind: "blocked"; message: string }
  | {
      kind: "ready";
      document: SigningDocumentView;
      signatory: SigningSignatory;
      canSign: boolean;
      reason?: string;
    }
  | { kind: "signed"; status: string }
  | { kind: "declined" };

// Reasons that mean *this signatory's own slot* is already resolved, where
// offering "decline" again is either impossible (the token that action would
// need is already burned server-side) or simply makes no sense. Every other
// `!canSign` reason — waiting on someone else, the document not yet sent,
// and so on — still surfaces a decline option, because `decline()` itself
// only ever checks whether *this* signatory has already signed; the server
// remains the authority on whether an attempt actually succeeds.
const DECLINE_UNAVAILABLE_REASONS = new Set([
  "You have already signed this document",
  "This document was declined",
]);

export default function SignDocumentPage() {
  return (
    <Suspense
      fallback={
        <Shell>
          <p className="text-muted-foreground">Loading…</p>
        </Shell>
      }
    >
      <SignDocumentPageInner />
    </Suspense>
  );
}

function SignDocumentPageInner() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const documentId = params?.id;
  const token = searchParams.get("token") ?? "";

  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const [confirmName, setConfirmName] = useState("");
  const [consent, setConsent] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [imageNotice, setImageNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [decliningMode, setDecliningMode] = useState(false);
  const [declineReason, setDeclineReason] = useState("");

  const padRef = useRef<SignaturePadHandle | null>(null);

  useEffect(() => {
    if (!documentId) return;

    if (!/^[0-9a-f]{64}$/.test(token)) {
      setScreen({
        kind: "blocked",
        message: "This link is missing a valid signing token. Ask the sender for a new link.",
      });
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(`/api/sign/${documentId}?token=${encodeURIComponent(token)}`);
        const body = await response.json();
        if (cancelled) return;

        if (!response.ok) {
          setScreen({ kind: "blocked", message: body.error ?? "This signing link is not valid." });
          return;
        }

        setScreen({
          kind: "ready",
          document: body.document,
          signatory: body.signatory,
          canSign: Boolean(body.canSign),
          reason: body.reason,
        });
      } catch {
        if (!cancelled) {
          setScreen({
            kind: "blocked",
            message: "We could not load this document. Check your connection and try again.",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [documentId, token]);

  const handleSign = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (screen.kind !== "ready" || busy) return;

      const pad = padRef.current;
      const errors: Record<string, string> = {};
      if (!pad || pad.isEmpty()) {
        errors.signature = "Please draw or type your signature above.";
      }
      if (!confirmName.trim()) {
        errors.confirmName = "Please type your name to confirm.";
      }
      if (!consent) {
        errors.consent = "Please confirm you agree to sign this document electronically.";
      }

      if (!pad || Object.keys(errors).length > 0) {
        setFieldErrors(errors);
        return;
      }

      setFieldErrors({});
      setBanner(null);
      setImageNotice(null);
      setBusy(true);

      // Capturing the image is best-effort: a shrink failure or a canvas
      // that will not cooperate should not cost someone their signature, so
      // any failure here falls back to submitting without an image rather
      // than refusing to proceed. `signatureImageUrl` being optional at
      // `/api/sign/[id]` is exactly what makes that fallback valid.
      let signatureImageUrl: string | undefined;
      try {
        signatureImageUrl = (await pad.getDataUrl()) ?? undefined;
      } catch (error) {
        const detail =
          error instanceof SignatureTooComplexError
            ? "it was too detailed to attach"
            : "of a browser limitation";
        console.error("Could not capture signature image:", error);
        setImageNotice(
          `Your signature image could not be attached (${detail}). Your typed name and consent below are recorded as your signature instead.`
        );
      }

      try {
        const response = await fetch(`/api/sign/${screen.document.id}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "sign", token, signatureImageUrl }),
        });
        const body = await response.json();

        if (!response.ok) {
          setBanner(body.error ?? "Something went wrong. Please try again.");
          return;
        }

        setScreen({ kind: "signed", status: body.status ?? "completed" });
      } catch {
        setBanner("We could not submit your signature. Check your connection and try again.");
      } finally {
        setBusy(false);
      }
    },
    [screen, busy, confirmName, consent, token]
  );

  const handleDecline = useCallback(async () => {
    if (screen.kind !== "ready" || busy) return;

    const trimmed = declineReason.trim();
    if (trimmed.length < 3) {
      setFieldErrors({ decline: "Please say why you are declining (at least 3 characters)." });
      return;
    }

    setFieldErrors({});
    setBanner(null);
    setBusy(true);

    try {
      const response = await fetch(`/api/sign/${screen.document.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "decline", token, reason: trimmed }),
      });
      const body = await response.json();

      if (!response.ok) {
        setBanner(body.error ?? "Something went wrong. Please try again.");
        return;
      }

      setScreen({ kind: "declined" });
    } catch {
      setBanner("We could not submit your response. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }, [screen, busy, declineReason, token]);

  if (screen.kind === "loading") {
    return (
      <Shell>
        <p className="text-muted-foreground">Loading…</p>
      </Shell>
    );
  }

  if (screen.kind === "blocked") {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold text-foreground">This link is not valid</h1>
        <p className="mt-3 text-muted-foreground">{screen.message}</p>
      </Shell>
    );
  }

  if (screen.kind === "signed") {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold text-foreground">Thank you for signing</h1>
        <p className="mt-3 text-muted-foreground">
          {screen.status === "completed"
            ? "Every signatory has now signed. This document is complete, and the organisation will be in touch."
            : "Your signature has been recorded. This document is not yet complete — other signatories still need to sign."}
        </p>
        <p className="mt-6 text-sm text-muted-foreground">You can close this page.</p>
      </Shell>
    );
  }

  if (screen.kind === "declined") {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold text-foreground">You have declined to sign</h1>
        <p className="mt-3 text-muted-foreground">
          Your response has been recorded and the sender has been notified. If this was a mistake,
          contact whoever sent you this link — a declined document cannot be reopened from here.
        </p>
      </Shell>
    );
  }

  const { document: doc, signatory, canSign, reason } = screen;
  const showDeclineOption = canSign || !reason || !DECLINE_UNAVAILABLE_REASONS.has(reason);

  return (
    <Shell wide>
      <h1 className="text-2xl font-semibold text-foreground">{doc.title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {doc.category} · Signing as {signatory.name ?? signatory.email} ({signatory.role})
      </p>
      {doc.expiresAt ? (
        <p className="mt-1 text-sm text-muted-foreground">
          This link expires on {formatDate(doc.expiresAt)}.
        </p>
      ) : null}

      {banner ? (
        <div role="alert" className="mt-6 rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
          {banner}
        </div>
      ) : null}

      {!canSign && reason ? (
        <div
          role="status"
          className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-400"
        >
          {reason}
        </div>
      ) : null}

      <div className="mt-6">
        <p className="mb-2 text-sm font-medium text-foreground">Document</p>
        {doc.renderedBody ? (
          // A full HTML document, not a fragment — an inert (empty
          // `sandbox`) iframe is the only way to display it without either
          // breaking on the nested <html>/<head> tags a plain div would
          // choke on, or letting the template's own markup run script,
          // navigate, or reach outside the frame it is shown in.
          <iframe
            key={doc.id}
            title={`${doc.title} — document to sign`}
            sandbox=""
            srcDoc={doc.renderedBody}
            className="h-[55vh] w-full rounded-xl border border-border bg-white"
          />
        ) : (
          <p className="rounded-xl border border-border bg-muted p-4 text-sm text-muted-foreground">
            This document has no content to display.
          </p>
        )}
      </div>

      {canSign ? (
        <form onSubmit={handleSign} className="mt-8 space-y-6" noValidate>
          <div>
            <p className="mb-2 block text-sm font-medium text-foreground">
              Your signature <span className="text-destructive">*</span>
            </p>
            <SignaturePad ref={padRef} disabled={busy} />
            {fieldErrors.signature ? (
              <p role="alert" className="mt-1.5 text-sm text-destructive">
                {fieldErrors.signature}
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor="confirmName" className="block text-sm font-medium text-foreground">
              Type your full name to confirm <span className="text-destructive">*</span>
            </label>
            <input
              id="confirmName"
              type="text"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              aria-invalid={fieldErrors.confirmName ? true : undefined}
              aria-describedby={fieldErrors.confirmName ? "confirmName-error" : "confirmName-hint"}
              className="mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder={signatory.name ?? "Your full name"}
            />
            {fieldErrors.confirmName ? (
              <p id="confirmName-error" role="alert" className="mt-1.5 text-sm text-destructive">
                {fieldErrors.confirmName}
              </p>
            ) : (
              <p id="confirmName-hint" className="mt-1.5 text-sm text-muted-foreground">
                This confirms your identity on this page; it is separate from the signature image
                above.
              </p>
            )}
          </div>

          {imageNotice ? (
            <p role="status" className="text-sm text-muted-foreground">
              {imageNotice}
            </p>
          ) : null}

          <div className="rounded-xl border border-border p-4">
            <label htmlFor="consent" className="flex items-start gap-3">
              <input
                id="consent"
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                aria-describedby={fieldErrors.consent ? "consent-error" : undefined}
                // Unticked by default: a pre-ticked box is not consent, and
                // this is the one thing on the page that stands in for a wet
                // signature's intent, not just its shape.
                className="mt-0.5 h-5 w-5 shrink-0 rounded border-border text-primary focus:ring-2 focus:ring-ring"
              />
              <span className="text-sm text-muted-foreground">
                I have read this document and agree to sign it electronically. I understand this
                has the same effect as a handwritten signature.
              </span>
            </label>
            {fieldErrors.consent ? (
              <p id="consent-error" role="alert" className="mt-2 text-sm text-destructive">
                {fieldErrors.consent}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={busy}
              className="rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50"
            >
              {busy ? "Signing…" : "Sign document"}
            </button>
            {showDeclineOption && !decliningMode ? (
              <button
                type="button"
                onClick={() => setDecliningMode(true)}
                disabled={busy}
                className="rounded-xl border border-border px-5 py-3 font-semibold text-foreground hover:bg-muted disabled:opacity-50"
              >
                Decline to sign instead
              </button>
            ) : null}
          </div>
        </form>
      ) : showDeclineOption && !decliningMode ? (
        <div className="mt-8">
          <button
            type="button"
            onClick={() => setDecliningMode(true)}
            disabled={busy}
            className="rounded-xl border border-border px-5 py-3 font-semibold text-foreground hover:bg-muted disabled:opacity-50"
          >
            Decline to sign instead
          </button>
        </div>
      ) : null}

      {decliningMode ? (
        <div className="mt-8 rounded-xl border border-border p-4">
          <label htmlFor="declineReason" className="block text-sm font-medium text-foreground">
            Why are you declining? <span className="text-destructive">*</span>
          </label>
          <textarea
            id="declineReason"
            rows={3}
            minLength={3}
            maxLength={500}
            value={declineReason}
            onChange={(e) => setDeclineReason(e.target.value)}
            aria-describedby={fieldErrors.decline ? "decline-error" : undefined}
            className="mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="mt-1 text-xs text-muted-foreground">{declineReason.trim().length}/500</p>
          {fieldErrors.decline ? (
            <p id="decline-error" role="alert" className="mt-1.5 text-sm text-destructive">
              {fieldErrors.decline}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleDecline}
              disabled={busy}
              className="rounded-xl bg-destructive px-5 py-2.5 font-semibold text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Submitting…" : "Confirm decline"}
            </button>
            <button
              type="button"
              onClick={() => setDecliningMode(false)}
              disabled={busy}
              className="rounded-xl px-5 py-2.5 font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              Never mind
            </button>
          </div>
        </div>
      ) : null}
    </Shell>
  );
}

// ─── Signature pad ─────────────────────────────────────────────
// Two independent ways to arrive at the same thing: a PNG data URI under
// `/api/sign/[id]`'s 2000-character budget. Drawing samples the pad's own
// backing bitmap; typing renders the name onto an offscreen canvas in a
// script-style font. Both then go through the identical `shrinkSignatureToFit`
// ladder — the pad does not have two shrinking policies, just two ways of
// producing the first frame that gets shrunk.

interface SignaturePadHandle {
  isEmpty: () => boolean;
  getDataUrl: () => Promise<string | null>;
}

const SignaturePad = forwardRef<SignaturePadHandle, { disabled?: boolean }>(function SignaturePad(
  { disabled },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const drawingRef = useRef(false);
  const hasDrawnRef = useRef(false);
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const [typedSignature, setTypedSignature] = useState("");
  const instructionsId = useId();

  // Sized once per mount of the canvas element (it unmounts when switching
  // to "type" mode, so this reruns fresh whenever someone switches back).
  // `devicePixelRatio`-aware so strokes are crisp on a retina screen instead
  // of the blurry line you get drawing 1:1 into an undersized backing
  // buffer.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || mode !== "draw") return;

    const ratio = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;
    sizeRef.current = { width: cssWidth, height: cssHeight };
    canvas.width = Math.round(cssWidth * ratio);
    canvas.height = Math.round(cssHeight * ratio);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111827";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cssWidth, cssHeight);
    hasDrawnRef.current = false;
  }, [mode]);

  const getPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    const point = getPoint(event);
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    event.preventDefault();
    const point = getPoint(event);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    hasDrawnRef.current = true;
  };

  const endStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const canvas = canvasRef.current;
    if (canvas?.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  };

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, sizeRef.current.width, sizeRef.current.height);
    hasDrawnRef.current = false;
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      isEmpty: () => (mode === "draw" ? !hasDrawnRef.current : typedSignature.trim().length === 0),
      getDataUrl: async () => {
        if (mode === "type") {
          const name = typedSignature.trim();
          if (!name) return null;
          return shrinkSignatureToFit((width) => drawTypedSignatureAtWidth(name, width));
        }
        const canvas = canvasRef.current;
        if (!canvas || !hasDrawnRef.current) return null;
        return shrinkSignatureToFit((width) => resampleCanvasToDataUrl(canvas, width));
      },
    }),
    [mode, typedSignature]
  );

  return (
    <div>
      <div role="group" aria-label="Signature method" className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode("draw")}
          disabled={disabled}
          aria-pressed={mode === "draw"}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
            mode === "draw" ? "bg-primary text-primary-foreground" : "border border-border text-foreground hover:bg-muted"
          }`}
        >
          Draw
        </button>
        <button
          type="button"
          onClick={() => setMode("type")}
          disabled={disabled}
          aria-pressed={mode === "type"}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
            mode === "type" ? "bg-primary text-primary-foreground" : "border border-border text-foreground hover:bg-muted"
          }`}
        >
          Type instead
        </button>
      </div>

      {/* Read by assistive tech regardless of which mode is showing — the
          canvas has a visual "Clear" button next to it, but no on-screen
          text says a keyboard user does not need it at all. */}
      <p id={instructionsId} className="sr-only">
        Draw your signature with a mouse, stylus or finger. If you cannot use a pointing device,
        choose &quot;Type instead&quot; and type your name to sign with a keyboard.
      </p>

      {mode === "draw" ? (
        <div className="mt-3">
          <canvas
            ref={canvasRef}
            role="img"
            aria-label="Signature drawing area"
            aria-describedby={instructionsId}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endStroke}
            onPointerLeave={endStroke}
            onPointerCancel={endStroke}
            style={{ touchAction: "none" }}
            className="h-40 w-full rounded-xl border border-border bg-white"
          />
          <button
            type="button"
            onClick={clear}
            disabled={disabled}
            className="mt-2 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      ) : (
        <div className="mt-3">
          <label htmlFor="typed-signature" className="block text-sm font-medium text-foreground">
            Type your name to sign
          </label>
          <input
            id="typed-signature"
            type="text"
            value={typedSignature}
            onChange={(e) => setTypedSignature(e.target.value)}
            disabled={disabled}
            aria-describedby={instructionsId}
            placeholder="e.g. Jordan Smith"
            className="mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {typedSignature.trim() ? (
            <p
              aria-hidden="true"
              className="mt-3 rounded-xl border border-dashed border-border bg-white px-4 py-6 text-center text-3xl text-black"
              style={{ fontFamily: '"Segoe Script", "Brush Script MT", cursive' }}
            >
              {typedSignature}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
});
SignaturePad.displayName = "SignaturePad";

/** Resamples the pad's own backing bitmap down to `targetWidth`, holding its aspect ratio — used by `shrinkSignatureToFit` to walk the candidate widths until the exported PNG fits the sign route's budget. */
function resampleCanvasToDataUrl(source: HTMLCanvasElement, targetWidth: number): string {
  const aspect = source.height / source.width;
  const target = window.document.createElement("canvas");
  target.width = targetWidth;
  target.height = Math.max(1, Math.round(targetWidth * aspect));

  const ctx = target.getContext("2d");
  if (!ctx) throw new Error("This browser does not support canvas rendering.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, target.width, target.height);
  return target.toDataURL("image/png");
}

/** Renders a typed name as a signature-shaped PNG at `width` — the "type instead" path's equivalent of a drawn stroke, fed through the same shrink ladder as the canvas. */
function drawTypedSignatureAtWidth(name: string, width: number): string {
  const height = Math.max(1, Math.round(width * 0.42));
  const canvas = window.document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser does not support canvas rendering.");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#111827";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";

  // Shrinks the font until the name fits inside the canvas — a fixed size
  // would clip a long name at the edges instead of scaling to it.
  let fontSize = Math.round(height * 0.55);
  const minFontSize = 10;
  ctx.font = `italic ${fontSize}px "Segoe Script", "Brush Script MT", cursive`;
  while (ctx.measureText(name).width > width * 0.9 && fontSize > minFontSize) {
    fontSize -= 2;
    ctx.font = `italic ${fontSize}px "Segoe Script", "Brush Script MT", cursive`;
  }

  ctx.fillText(name, width / 2, height / 2);
  return canvas.toDataURL("image/png");
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <main
      className={`mx-auto min-h-screen w-full px-5 py-12 sm:py-20 ${wide ? "max-w-3xl" : "max-w-2xl"}`}
    >
      {children}
    </main>
  );
}
