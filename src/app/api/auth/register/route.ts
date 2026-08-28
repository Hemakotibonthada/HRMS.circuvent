// ═══════════════════════════════════════════════════════════════
// POST /api/auth/register
// ═══════════════════════════════════════════════════════════════
// Starts a sign-up by sending a code to the address, and creates nothing.
//
// This used to create the organisation, its owner, and every row a tenant
// needs, straight from the submitted form — before anybody had shown they
// could read mail at the address they typed. A stranger could stand up
// "Acme Ltd" against somebody else's work address, and the person who owned
// that address would find out only if the product later mailed them. The
// organisation name is what a candidate sees on an offer letter, so this was
// not only an account someone else had made: it was a company someone else
// could issue letters as.
//
// Now the form's contents are held as a pending registration and the tenant
// is provisioned by `POST /api/auth/register/verify`, once a code sent to the
// address comes back. The password is hashed here rather than at verify time,
// so a plaintext password is never stored between the two steps.
//
// The response never says whether the address already has an account. Sign-up
// is unauthenticated and answering that question turns it into a way to test
// whether a given person banks with you.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { authTokens, users } from "@/db/schema/identity";
import { hashPassword } from "@/lib/auth/password";
import {
  REGISTRATION_CODE_TTL_MINUTES,
  generateVerificationCode,
  hashVerificationCode,
  toPendingMetadata,
} from "@/lib/auth/pending-registration";
import { mailConfigured, sendMail, verifyEmailCodeEmail } from "@/lib/mailer";
import { checkRateLimit, clientIdentifier } from "@/lib/api-context";

const schema = z.object({
  name: z.string().trim().min(2, "Please enter your name").max(120),
  company: z.string().trim().min(2, "Please enter your company name").max(160),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  // Eight, not six: this password is the only thing protecting an entire
  // organisation's HR records.
  password: z.string().min(8, "Use at least 8 characters").max(200),
});

/**
 * The same answer whether or not the address is already taken, whether or not
 * mail could be sent.
 *
 * The form moves to the code step in every case. An attacker learns nothing;
 * somebody who really does already have an account finds no code arrives and
 * has a "Sign in" link in front of them.
 */
const SENT = {
  ok: true,
  verificationRequired: true,
  message: "Enter the 6-digit code we've sent to your email address.",
  expiresInMinutes: REGISTRATION_CODE_TTL_MINUTES,
};

export async function POST(request: NextRequest) {
  const limit = checkRateLimit(`register:${clientIdentifier(request)}`, 5, 60 * 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many sign-up attempts. Please try again later." },
      { status: 429 }
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }
  const { name, company, email, password } = parsed.data;

  // Refusing to send anything when mail is not configured, rather than
  // reporting success and stranding the person on a code screen no code can
  // ever reach. This is a deployment fault, so it says so.
  if (!mailConfigured()) {
    return NextResponse.json(
      {
        error:
          "Sign-up is unavailable because this deployment cannot send email. " +
          "Set SMTP_HOST, SMTP_USER and SMTP_PASS.",
      },
      { status: 503 }
    );
  }

  try {
    const existing = await db()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    // Stop here, but answer as though a code was sent. The address already
    // belongs to somebody and telling the caller so is the enumeration oracle
    // this endpoint must not be.
    if (existing.length) return NextResponse.json(SENT, { status: 202 });

    const code = generateVerificationCode();
    const tokenHash = hashVerificationCode(email, code);

    await db().transaction(async (tx) => {
      await tx.execute(`SET LOCAL app.superuser = 'on'`);

      // One live code per address. Without this, submitting the form twice
      // leaves two valid codes and the older one keeps working — so a code
      // read over somebody's shoulder stays usable after they have asked for
      // a fresh one.
      await tx
        .update(authTokens)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(authTokens.email, email),
            eq(authTokens.purpose, "email_verification"),
            isNull(authTokens.consumedAt)
          )
        );

      await tx.insert(authTokens).values({
        email,
        purpose: "email_verification",
        tokenHash,
        // No plaintext password here — only the hash, so a database dump of
        // pending sign-ups reveals no usable credential.
        metadata: toPendingMetadata({ name, company, passwordHash: await hashPassword(password) }),
        expiresAt: new Date(Date.now() + REGISTRATION_CODE_TTL_MINUTES * 60_000),
      });
    });

    const mail = verifyEmailCodeEmail(code, REGISTRATION_CODE_TTL_MINUTES, name);
    await sendMail({ to: email, subject: mail.subject, html: mail.html, text: mail.text });
  } catch (error) {
    console.error("Registration start failed:", error);
    return NextResponse.json(
      { error: "Could not start your sign-up. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json(SENT, { status: 202 });
}
