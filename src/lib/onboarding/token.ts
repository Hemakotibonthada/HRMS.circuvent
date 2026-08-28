// Mirror of ATS.circuvent `lib/onboarding/token.ts` — same payload, same secret.
// Mail.circuvent verifies in `onboarding-claim.ts`; the two apps deploy separately.

import { createHmac, randomUUID } from "node:crypto";

export interface OnboardingClaim {
  employeeId: string | null;
  candidateId: string | null;
  employmentType: string | null;
  tokenId: string;
  displayName?: string | null;
  employeeCode?: string | null;
  designation?: string | null;
  department?: string | null;
}

interface TokenPayload extends OnboardingClaim {
  exp: number;
}

const DEFAULT_ONBOARDING_SECRET = "PZ6SRa1VBEt_ot2_6dTUdg9mTecBhehYxqBTYPLRKmqLVhkvI_CYP0cZuNq0hjpb";

function secret(): string {
  return process.env.ONBOARDING_TOKEN_SECRET?.trim() || DEFAULT_ONBOARDING_SECRET;
}

function clip(value: string | null | undefined, max = 96): string | null {
  const text = String(value ?? "").trim();
  return text.length === 0 ? null : text.slice(0, max);
}

export function onboardingTokensConfigured(): boolean {
  return secret().length > 0;
}

export function issueOnboardingToken(
  claim: Omit<OnboardingClaim, "tokenId"> & { tokenId?: string },
  ttlSeconds = 14 * 24 * 60 * 60
): { token: string; tokenId: string } | null {
  const key = secret();
  if (!key) return null;

  const tokenId = claim.tokenId ?? randomUUID();
  const payload: TokenPayload = {
    employeeId: claim.employeeId ?? null,
    candidateId: claim.candidateId ?? null,
    employmentType: claim.employmentType ?? null,
    tokenId,
    displayName: clip(claim.displayName),
    employeeCode: clip(claim.employeeCode, 32),
    designation: clip(claim.designation),
    department: clip(claim.department),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };

  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", key).update(body).digest("base64url");
  return { token: `${body}.${signature}`, tokenId };
}

export function mailboxClaimUrl(token: string, baseUrl?: string): string {
  const base = (baseUrl ?? process.env.MAIL_APP_URL ?? process.env.NEXT_PUBLIC_MAIL_URL ?? "https://mail.circuvent.com").replace(
    /\/+$/,
    ""
  );
  return `${base}/register?onboarding=${encodeURIComponent(token)}`;
}
