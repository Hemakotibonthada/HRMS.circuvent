"use client";

// ═══════════════════════════════════════════════════════════════
// /refer/[token] — the referred candidate's own form
// ═══════════════════════════════════════════════════════════════
// Seen by someone who does not work here, has no account, and arrived from an
// email they may not have been expecting. That shapes the whole page:
//
//  - It says who referred them and to which company, before asking for
//    anything. A form that demands a salary expectation from an unidentified
//    sender is one people close.
//  - Almost every field is optional. The company already has enough to
//    contact them; the rest is theirs to offer.
//  - The consent tick is unticked, and is the only thing besides a name and
//    email that is genuinely required. They never signed up to anything, and
//    the referrer volunteered their address for them.

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface Prefill {
  state: "pending";
  candidateName: string;
  candidateEmail: string;
  positionTitle: string;
  organizationName: string;
  referrerFirstName?: string;
}

type Fields = Record<string, string | undefined>;

type Screen =
  | { kind: "loading" }
  | { kind: "form"; prefill: Prefill }
  | { kind: "closed"; message: string }
  | { kind: "done"; organizationName: string };

export default function ReferralInvitePage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;

  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const [fields, setFields] = useState<Fields>({});
  const [errors, setErrors] = useState<Fields>({});
  const [consent, setConsent] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(`/api/public/referral/${token}`);
        const body = await response.json();
        if (cancelled) return;

        if (response.ok && body.state === "pending") {
          setScreen({ kind: "form", prefill: body as Prefill });
          setFields({ fullName: body.candidateName, email: body.candidateEmail });
        } else {
          setScreen({
            kind: "closed",
            message:
              body.message ??
              body.error ??
              "This link is not valid. Ask the person who referred you to send a new one.",
          });
        }
      } catch {
        if (!cancelled) {
          setScreen({
            kind: "closed",
            message: "We could not load this page. Check your connection and try again.",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const set = useCallback((name: string, value: string) => {
    setFields((current) => ({ ...current, [name]: value }));
  }, []);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (screen.kind !== "form" || busy) return;

      setBanner(null);
      setErrors({});
      setBusy(true);

      const numeric = (value?: string) => {
        if (!value || value.trim() === "") return undefined;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
      };

      // Rupees on screen, paise on the wire. The column is a bigint in minor
      // units, and sending 1.5 lakh as a decimal would put a float into it.
      const toMinor = (value?: string) => {
        const major = numeric(value);
        return major === undefined ? undefined : Math.round(major * 100);
      };

      try {
        const response = await fetch(`/api/public/referral/${token}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            fullName: fields.fullName ?? "",
            email: fields.email ?? "",
            phone: fields.phone,
            currentEmployer: fields.currentEmployer,
            currentTitle: fields.currentTitle,
            totalExperienceYears: numeric(fields.totalExperienceYears),
            noticePeriodDays: numeric(fields.noticePeriodDays),
            currentCtcMinor: toMinor(fields.currentCtc),
            expectedCtcMinor: toMinor(fields.expectedCtc),
            linkedinUrl: fields.linkedinUrl,
            resumeUrl: fields.resumeUrl,
            coverNote: fields.coverNote,
            consentToProcess: consent,
          }),
        });

        const body = await response.json();

        if (response.ok) {
          setScreen({ kind: "done", organizationName: screen.prefill.organizationName });
          return;
        }

        if (body.fields) {
          setErrors(body.fields as Fields);
          setBanner("Please check the highlighted fields.");
        } else {
          setBanner(body.error ?? "Something went wrong. Please try again.");
        }
      } catch {
        setBanner("We could not send your details. Check your connection and try again.");
      } finally {
        setBusy(false);
      }
    },
    [screen, busy, token, fields, consent]
  );

  if (screen.kind === "loading") {
    return (
      <Shell>
        <p className="text-muted-foreground">Loading…</p>
      </Shell>
    );
  }

  if (screen.kind === "closed") {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold text-foreground">This link is closed</h1>
        <p className="mt-3 text-muted-foreground">{screen.message}</p>
      </Shell>
    );
  }

  if (screen.kind === "done") {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold text-foreground">Thank you</h1>
        <p className="mt-3 text-muted-foreground">
          Your details have gone to the hiring team at {screen.organizationName}. They will be in
          touch with you directly. You can close this page.
        </p>
      </Shell>
    );
  }

  const { prefill } = screen;

  return (
    <Shell>
      <h1 className="text-2xl font-semibold text-foreground">
        {prefill.referrerFirstName
          ? `${prefill.referrerFirstName} referred you to ${prefill.organizationName}`
          : `You have been referred to ${prefill.organizationName}`}
      </h1>
      <p className="mt-3 text-muted-foreground">
        For the {prefill.positionTitle} role. Add whatever you are happy to share — only your name
        and email are needed, and you can leave the rest blank.
      </p>

      {banner ? (
        <div
          role="alert"
          className="mt-6 rounded-xl bg-destructive/10 p-4 text-sm text-destructive"
        >
          {banner}
        </div>
      ) : null}

      <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
        <Field
          name="fullName"
          label="Your name"
          value={fields.fullName ?? ""}
          error={errors.fullName}
          onChange={set}
          required
          autoComplete="name"
        />
        <Field
          name="email"
          label="Email"
          type="email"
          value={fields.email ?? ""}
          error={errors.email}
          onChange={set}
          required
          autoComplete="email"
          hint="We will use this to contact you about the role."
        />
        <Field
          name="phone"
          label="Phone"
          type="tel"
          value={fields.phone ?? ""}
          error={errors.phone}
          onChange={set}
          autoComplete="tel"
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            name="currentEmployer"
            label="Current employer"
            value={fields.currentEmployer ?? ""}
            error={errors.currentEmployer}
            onChange={set}
            autoComplete="organization"
          />
          <Field
            name="currentTitle"
            label="Current job title"
            value={fields.currentTitle ?? ""}
            error={errors.currentTitle}
            onChange={set}
            autoComplete="organization-title"
          />
          <Field
            name="totalExperienceYears"
            label="Years of experience"
            type="number"
            inputMode="decimal"
            value={fields.totalExperienceYears ?? ""}
            error={errors.totalExperienceYears}
            onChange={set}
          />
          <Field
            name="noticePeriodDays"
            label="Notice period (days)"
            type="number"
            inputMode="numeric"
            value={fields.noticePeriodDays ?? ""}
            error={errors.noticePeriodDays}
            onChange={set}
          />
          <Field
            name="currentCtc"
            label="Current salary (₹ per year)"
            type="number"
            inputMode="numeric"
            value={fields.currentCtc ?? ""}
            error={errors.currentCtcMinor}
            onChange={set}
            hint="Optional. Leave blank if you would rather discuss it."
          />
          <Field
            name="expectedCtc"
            label="Expected salary (₹ per year)"
            type="number"
            inputMode="numeric"
            value={fields.expectedCtc ?? ""}
            error={errors.expectedCtcMinor}
            onChange={set}
          />
        </div>

        <Field
          name="linkedinUrl"
          label="LinkedIn"
          type="url"
          value={fields.linkedinUrl ?? ""}
          error={errors.linkedinUrl}
          onChange={set}
          placeholder="https://linkedin.com/in/…"
        />
        <Field
          name="resumeUrl"
          label="Link to your CV"
          type="url"
          value={fields.resumeUrl ?? ""}
          error={errors.resumeUrl}
          onChange={set}
          placeholder="https://…"
          hint="A link to a shared document is fine."
        />

        <div>
          <label htmlFor="coverNote" className="block text-sm font-medium text-foreground">
            Anything you would like to add
          </label>
          <textarea
            id="coverNote"
            name="coverNote"
            rows={4}
            maxLength={4000}
            value={fields.coverNote ?? ""}
            onChange={(e) => set("coverNote", e.target.value)}
            aria-describedby={errors.coverNote ? "coverNote-error" : undefined}
            className="mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {errors.coverNote ? (
            <p id="coverNote-error" role="alert" className="mt-1.5 text-sm text-destructive">
              {errors.coverNote}
            </p>
          ) : null}
        </div>

        <div className="rounded-xl border border-border p-4">
          <label htmlFor="consent" className="flex items-start gap-3">
            <input
              id="consent"
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              aria-describedby={errors.consentToProcess ? "consent-error" : undefined}
              // Unticked by default, deliberately. A pre-ticked box is not
              // consent, and this is the only lawful basis this flow has for
              // holding the details of someone who never signed up.
              className="mt-0.5 h-5 w-5 shrink-0 rounded border-border text-primary focus:ring-2 focus:ring-ring"
            />
            <span className="text-sm text-muted-foreground">
              I am happy for {prefill.organizationName} to store these details and contact me about
              this role.
            </span>
          </label>
          {errors.consentToProcess ? (
            <p id="consent-error" role="alert" className="mt-2 text-sm text-destructive">
              {errors.consentToProcess}
            </p>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50 sm:w-auto"
        >
          {busy ? "Sending…" : "Send my details"}
        </button>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-5 py-12 sm:py-20">{children}</main>
  );
}

function Field({
  name,
  label,
  value,
  onChange,
  error,
  hint,
  type = "text",
  required = false,
  ...rest
}: {
  name: string;
  label: string;
  value: string;
  onChange: (name: string, value: string) => void;
  error?: string;
  hint?: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  autoComplete?: string;
  inputMode?: "numeric" | "decimal";
}) {
  const errorId = `${name}-error`;
  const hintId = `${name}-hint`;

  return (
    <div>
      {/* A real label, tied to the input. A placeholder disappears the moment
          someone types, and is not announced as a label. */}
      <label htmlFor={name} className="block text-sm font-medium text-foreground">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        value={value}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : hint ? hintId : undefined}
        onChange={(e) => onChange(name, e.target.value)}
        className="mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
        {...rest}
      />
      {error ? (
        // Under the field it belongs to, not in a summary at the top. On a
        // phone the top of the form is off-screen by the time you reach the
        // field that is wrong.
        <p id={errorId} role="alert" className="mt-1.5 text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1.5 text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
