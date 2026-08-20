// ═══════════════════════════════════════════════════════════════
// OUTBOUND MAIL
// ═══════════════════════════════════════════════════════════════
// Sends through the Circuvent mail server, the same one the rest of the suite
// uses. There is no third-party sending service: a password reset is the one
// message a user cannot do without, and routing it through an external provider
// is how the storefront ended up silently dropping every verification code.

import nodemailer, { type Transporter } from "nodemailer";
import { expandToPeople } from "@/lib/directory-sdk";

let transporter: Transporter | null = null;

function getTransport(): Transporter | null {
  if (transporter) return transporter;

  // Trimmed because a trailing newline pasted into a dashboard value is
  // invisible but fatal: it makes the host unresolvable, and stops SMTP_SECURE
  // matching "true", quietly disabling TLS.
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  if (!host || !user || !pass) return null;

  transporter = nodemailer.createTransport({
    host,
    port: Number(String(process.env.SMTP_PORT || 587).trim()),
    secure: String(process.env.SMTP_SECURE).trim() === "true",
    auth: { user, pass },
    // These messages carry credentials-in-effect; never fall back to plaintext.
    requireTLS: true,
  });
  return transporter;
}

export function mailConfigured(): boolean {
  return getTransport() !== null;
}

/**
 * Sends one message.
 *
 * Returns false rather than throwing, so a caller that must not disclose
 * whether an address exists can carry on regardless — but the failure is
 * always logged, because a reset email that silently vanishes is
 * indistinguishable from one the user simply has not received yet.
 */
export async function sendMail(options: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<boolean> {
  const t = getTransport();
  if (!t) {
    console.error(
      `[mail] SMTP is not configured; "${options.subject}" to ${options.to} was not sent. ` +
        `Set SMTP_HOST, SMTP_USER and SMTP_PASS.`
    );
    return false;
  }

  // A group address is a real address to everything upstream of here, and it
  // is also a real mailbox on the server, so mail sent to it would be filed
  // there and nobody in the group would ever see it. Expanded at the last
  // moment rather than when the recipient was chosen, so a person added to the
  // group since then still receives this message.
  const recipients = await expandToPeople(
    options.to.split(",").map((a) => a.trim()).filter(Boolean)
  );
  const to = recipients.length > 0 ? recipients.join(", ") : options.to;

  try {
    await t.sendMail({
      from: process.env.EMAIL_FROM?.trim() || `Circuvent HRMS <${process.env.SMTP_USER?.trim()}>`,
      to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
    return true;
  } catch (e) {
    console.error(`[mail] Failed to send "${options.subject}" to ${to}:`, e);
    return false;
  }
}

/**
 * The code that proves somebody controls the address they signed up with.
 *
 * A code rather than a link, deliberately: the person is sitting in front of
 * the registration form waiting, and a link would either open a second tab
 * that has lost the form state or require the whole flow to be resumable from
 * a cold start. A six-digit code they can type back into the page they are
 * already on keeps the sign-up in one place.
 */
export function verifyEmailCodeEmail(
  code: string,
  ttlMinutes: number,
  displayName?: string
): { subject: string; html: string; text: string } {
  const who = displayName?.trim() ? displayName.trim() : "there";
  return {
    subject: `${code} is your Circuvent verification code`,
    text:
      `Hi ${who},\n\nYour verification code is ${code}. It expires in ${ttlMinutes} ` +
      `minutes.\n\nIf you didn't try to create a Circuvent account, you can ignore ` +
      `this email — nothing has been created.`,
    html: `
      <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:520px;margin:0 auto">
        <div style="background:linear-gradient(135deg,#7c3aed,#a855f7);padding:24px;border-radius:12px 12px 0 0">
          <h1 style="color:#fff;margin:0;font-size:20px">Confirm your email</h1>
        </div>
        <div style="background:#f8fafc;padding:28px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px">
          <p style="font-size:14px;color:#0c1222;margin:0 0 18px">Hi ${who}, enter this code to finish creating your account.</p>
          <p style="margin:0 0 18px;font-size:32px;font-weight:700;letter-spacing:8px;color:#7c3aed;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${code}</p>
          <p style="font-size:12px;color:#64748b;margin:0 0 6px">This code expires in ${ttlMinutes} minutes.</p>
          <p style="font-size:12px;color:#94a3b8;margin:0">If you didn't try to create an account, ignore this email — nothing has been created.</p>
        </div>
      </div>`,
  };
}

/** Password reset email. */
export function resetPasswordEmail(link: string, displayName?: string): { subject: string; html: string; text: string } {
  const who = displayName?.trim() ? displayName.trim() : "there";
  return {
    subject: "Reset your Circuvent HRMS password",
    text:
      `Hi ${who},\n\nUse this link to set a new password. It expires in 60 minutes ` +
      `and can be used once.\n\n${link}\n\nIf you didn't ask for this, you can ignore ` +
      `this email — your password will not change.`,
    html: `
      <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:520px;margin:0 auto">
        <div style="background:linear-gradient(135deg,#7c3aed,#a855f7);padding:24px;border-radius:12px 12px 0 0">
          <h1 style="color:#fff;margin:0;font-size:20px">Reset your password</h1>
        </div>
        <div style="background:#f8fafc;padding:28px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px">
          <p style="font-size:14px;color:#0c1222;margin:0 0 18px">Hi ${who}, use the button below to set a new password.</p>
          <p style="margin:0 0 18px">
            <a href="${link}" style="display:inline-block;padding:11px 20px;background:#7c3aed;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Set a new password</a>
          </p>
          <p style="font-size:12px;color:#64748b;margin:0 0 6px">This link expires in 60 minutes and can be used once.</p>
          <p style="font-size:12px;color:#94a3b8;margin:0">If you didn't ask for this, ignore this email — your password won't change.</p>
        </div>
      </div>`,
  };
}