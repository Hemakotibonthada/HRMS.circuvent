import { SignJWT, jwtVerify } from "jose";

const HANDOFF_ISSUER = "circuvent-sso-handoff";
const HANDOFF_AUDIENCE = "circuvent-suite-delegation";

function secret(): Uint8Array {
  const value = process.env.AUTH_JWT_SECRET?.trim();
  if (!value || value.length < 32) {
    throw new Error("AUTH_JWT_SECRET must be set to at least 32 characters");
  }
  return new TextEncoder().encode(value);
}

export interface DelegationHandoff {
  accessToken: string;
  refreshToken: string;
  next: string;
}

export async function sealDelegationHandoff(payload: DelegationHandoff): Promise<string> {
  return new SignJWT({
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    next: payload.next,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(HANDOFF_ISSUER)
    .setAudience(HANDOFF_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("2m")
    .sign(secret());
}

export async function openDelegationHandoff(token: string): Promise<DelegationHandoff> {
  const { payload } = await jwtVerify(token, secret(), {
    issuer: HANDOFF_ISSUER,
    audience: HANDOFF_AUDIENCE,
    algorithms: ["HS256"],
  });
  const accessToken = payload.accessToken;
  const refreshToken = payload.refreshToken;
  const next = payload.next;
  if (
    typeof accessToken !== "string" ||
    typeof refreshToken !== "string" ||
    typeof next !== "string" ||
    !next.startsWith("/") ||
    next.startsWith("//")
  ) {
    throw new Error("Invalid delegation handoff");
  }
  return { accessToken, refreshToken, next };
}
