// ═══════════════════════════════════════════════════════════════
// POST /api/auth/register
// ═══════════════════════════════════════════════════════════════
// Creates an organisation and its first user, then signs them in.
//
// This used to happen in the browser: the register page called Firebase Auth
// and then wrote the organisation, user and subscription documents itself. That
// put tenant creation in the hands of the client, which could choose its own
// organisation id and role, and it left a Firebase user with no matching
// records whenever any of the follow-up writes failed. Here the whole thing is
// one transaction on the server, and the caller chooses nothing but their name.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { organizations, userRoles, users } from "@/db/schema/identity";
import { employees, leavePolicies } from "@/db/schema/hrms";
import { documentTemplates, referralPolicies } from "@/db/schema/talent";
import { DEFAULT_LEAVE_POLICIES } from "@/lib/leave-provisioning";
import { DEFAULT_REFERRAL_POLICIES } from "@/lib/referral-rules";
import { TEMPLATE_CATALOG } from "@/lib/document-templates/catalog";
import { extractTokens } from "@/lib/document-rules";
import { hashPassword } from "@/lib/auth/password";
import { signIn } from "@/lib/auth/session";
import {
  ACCESS_COOKIE,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_COOKIE,
  accessCookieOptions,
  refreshCookieOptions,
} from "@/lib/auth/tokens";
import { checkRateLimit, clientIdentifier } from "@/lib/api-context";

const schema = z.object({
  name: z.string().trim().min(2, "Please enter your name").max(120),
  company: z.string().trim().min(2, "Please enter your company name").max(160),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  // Eight, not six: this password is the only thing protecting an entire
  // organisation's HR records.
  password: z.string().min(8, "Use at least 8 characters").max(200),
});

/** URL-safe organisation slug, uniquified on collision. */
function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "org"
  );
}

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

  try {
    const existing = await db()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existing.length) {
      return NextResponse.json(
        { error: "An account with this email already exists. Please sign in." },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(password);

    await db().transaction(async (tx) => {
      // Superuser scope: there is no tenant yet, so RLS has nothing to scope to.
      await tx.execute(`SET LOCAL app.superuser = 'on'`);

      let slug = slugify(company);
      const clash = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.slug, slug))
        .limit(1);
      if (clash.length) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

      const [org] = await tx
        .insert(organizations)
        .values({ name: company, slug })
        .returning({ id: organizations.id });

      const [user] = await tx
        .insert(users)
        .values({
          orgId: org.id,
          email,
          displayName: name,
          passwordHash,
          status: "active",
          emailVerifiedAt: new Date(),
        })
        .returning({ id: users.id });

      await tx
        .update(organizations)
        .set({ ownerId: user.id })
        .where(eq(organizations.id, org.id));

      // The first user owns every app in the suite; they have nobody to grant
      // them access.
      for (const app of ["hrms", "cv365", "ats", "mail", "office"] as const) {
        await tx.insert(userRoles).values({
          userId: user.id,
          orgId: org.id,
          app,
          role: "owner",
        });
      }

      // Everything a tenant needs before its first working day.
      //
      // A newly registered organisation used to get nothing but a row in
      // `organizations`. It had no leave policies, so the first employee it
      // hired could not apply for leave; and no document templates, so the
      // letters screen had nothing to offer and its "New offer" button stayed
      // disabled. Both read as broken features rather than as an unrun setup
      // step, and the setup step existed only as a script somebody had to know
      // to run — `db:seed:templates` — which itself could not run, because it
      // never loaded the environment file.
      //
      // Seeding here, in the same transaction as the organisation, means a
      // tenant that exists is a tenant that works.
      await tx.insert(leavePolicies).values(
        DEFAULT_LEAVE_POLICIES.map((policy) => ({
          orgId: org.id,
          leaveType: policy.leaveType as never,
          label: policy.label,
          annualQuotaDays: String(policy.annualQuotaDays),
          carryForwardLimitDays: String(policy.carryForwardLimitDays ?? 0),
          isProRata: policy.isProRata,
        }))
      );

      await tx.insert(documentTemplates).values(        TEMPLATE_CATALOG.map((template) => ({
          orgId: org.id,
          name: template.name,
          category: template.category,
          body: template.body,
          requiredTokens: extractTokens(template.body),
          requiresSignature: template.requiresSignature,
          signatoryRoles: template.signatoryRoles,
        }))
      );

      // Referral bonuses. Without a policy the referral module has no amount
      // to work from: referrals can be submitted and none can ever be paid,
      // which is how a complete, tested feature ships doing nothing.
      await tx.insert(referralPolicies).values(
        DEFAULT_REFERRAL_POLICIES.map((policy) => ({
          orgId: org.id,
          name: policy.name,
          seniority: policy.seniority,
          bonusAmountMinor: policy.bonusAmountMinor,
          qualifyingPeriodDays: policy.qualifyingPeriodDays,
          instalments: policy.instalments,
        }))
      );

      // The founder is also an employee.
      //
      // Registration created a user and no employee row, and every
      // employee-facing feature keys on one: clocking in, leave, payslips and
      // attendance all resolve the caller to an employee. So the person who
      // signed the company up could administer it and could not use it —
      // "Clock in" answered 404, which the mobile app rendered as an ordinary
      // "Not clocked in" card, and the web rendered as an empty state.
      //
      // `id` is set to the user's id as well as `userId`, because the routes
      // pass `ctx.userId` straight through as an employee id. Fixing that
      // properly means resolving user → employee at every call site; until
      // then the two ids agreeing for this row is what makes those routes work
      // rather than silently return nothing.
      const [firstName, ...rest] = name.trim().split(/\s+/);
      await tx.insert(employees).values({
        id: user.id,
        orgId: org.id,
        userId: user.id,
        employeeCode: "EMP-0001",
        firstName: firstName || name.trim(),
        lastName: rest.join(" ") || "-",
        workEmail: email,
        designation: "Owner",
        joinDate: new Date().toISOString().slice(0, 10),
        status: "active",
      });
    });
  } catch (error) {
    console.error("Registration failed:", error);
    return NextResponse.json(
      { error: "Could not create your account. Please try again." },
      { status: 500 }
    );
  }

  // Signing in through the normal path rather than minting a session inline, so
  // a new account gets exactly the same session, audit trail and lockout
  // behaviour as any other.
  const result = await signIn({
    email,
    password,
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
    userAgent: request.headers.get("user-agent") ?? undefined,
  });

  if (!result.ok) {
    // The account exists; only the automatic sign-in failed.
    return NextResponse.json(
      { created: true, signedIn: false, message: "Account created. Please sign in." },
      { status: 201 }
    );
  }

  const wantsTokens =
    (raw as { client?: unknown })?.client === "native" ||
    request.headers.get("x-circuvent-client") === "native";

  const response = NextResponse.json(
    {
      created: true,
      signedIn: true,
      user: result.user,
      ...(wantsTokens
        ? {
            tokens: {
              accessToken: result.accessToken,
              refreshToken: result.refreshToken,
              expiresIn: ACCESS_TOKEN_TTL_SECONDS,
            },
          }
        : {}),
    },
    { status: 201 }
  );
  response.cookies.set(ACCESS_COOKIE, result.accessToken, accessCookieOptions());
  response.cookies.set(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions());
  return response;
}
