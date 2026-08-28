// ═══════════════════════════════════════════════════════════════
// POST /api/groups/mail — one message to everyone in a group
// ═══════════════════════════════════════════════════════════════
// "Send mails to all the employees at once" is a group address, not a loop
// over the employee table. The list is resolved at the identity provider at
// the moment of sending, so somebody who joined this morning receives it and
// somebody who left last week does not — which a snapshot could not promise.
//
// Sent one message per recipient rather than one message with many
// recipients: an all-staff email whose To: header names every employee
// discloses the entire staff list to every recipient, and to every mail server
// on the way.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { describeIssues, toFieldIssues } from "@/lib/validation-response";
import { escapeHtml } from "@/lib/document-rules";
import { directoryConfigured, groupMembers } from "@/lib/directory-sdk";
import { mailConfigured, sendMail } from "@/lib/mailer";

const bodySchema = z.object({
  group: z.string().trim().email("Give the group's address, for example all@circuvent.com"),
  subject: z.string().trim().min(1, "A message needs a subject").max(200),
  body: z.string().trim().min(1, "A message needs a body").max(20_000),
});

/** A plain-text body rendered as paragraphs, with everything escaped. */
function toHtml(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((block) => `<p style="margin:0 0 14px;">${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");

  return (
    `<!doctype html><html><body style="font-family:-apple-system,'Segoe UI',Arial,sans-serif;` +
    `color:#1a1a1a;max-width:560px;margin:0 auto;padding:24px;line-height:1.55;">${paragraphs}</body></html>`
  );
}

export async function POST(request: NextRequest) {
  let ctx;
  try {
    // Mailing the whole company is not an ordinary edit.
    ctx = await requireApiContext(request, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  if (!directoryConfigured()) {
    return NextResponse.json(
      { error: "DIRECTORY_SERVICE_TOKEN is not set, so this deployment cannot resolve a group's members." },
      { status: 503 }
    );
  }
  if (!mailConfigured()) {
    return NextResponse.json(
      { error: "SMTP is not configured, so nothing would actually be sent. Set SMTP_HOST, SMTP_USER and SMTP_PASS." },
      { status: 503 }
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: describeIssues(toFieldIssues(parsed.error)), issues: toFieldIssues(parsed.error) },
      { status: 400 }
    );
  }

  const recipients = await groupMembers(parsed.data.group);
  if (recipients === null) {
    return NextResponse.json(
      { error: `${parsed.data.group} is not a group at the identity provider.` },
      { status: 404 }
    );
  }
  if (recipients.length === 0) {
    return NextResponse.json(
      { error: `${parsed.data.group} has no members, so there is nobody to send this to.` },
      { status: 400 }
    );
  }

  const html = toHtml(parsed.data.body);
  let sent = 0;
  const failed: string[] = [];

  for (const recipient of recipients) {
    // `sendMail` returns false rather than throwing, so one bad mailbox does
    // not stop the rest — and the failures come back named, because "sent to
    // 47 of 52" without saying which five is not something anybody can act on.
    const ok = await sendMail({
      to: recipient,
      subject: parsed.data.subject,
      html,
      text: parsed.data.body,
    });
    if (ok) sent++;
    else failed.push(recipient);
  }

  // Recorded because "who mailed the whole company, when, and did it arrive"
  // is asked afterwards, and `warn` rather than `info` because that is the
  // level this codebase's lint rules permit for something worth keeping.
  console.warn("[groups] Group message sent.", {
    orgId: ctx.orgId,
    group: parsed.data.group,
    recipients: recipients.length,
    sent,
    failed: failed.length,
  });

  return NextResponse.json({
    group: parsed.data.group,
    recipients: recipients.length,
    sent,
    failed,
  });
}
