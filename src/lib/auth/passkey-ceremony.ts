// ═══════════════════════════════════════════════════════════════
// PASSKEY CEREMONY — server side
// ═══════════════════════════════════════════════════════════════
//
// Holds the challenges between the two halves of a ceremony and performs the
// cryptographic verification. The decisions live in `webauthn.ts`, which is
// pure and tested; this is the part that touches Web Crypto and state.
//
// Challenges are kept in memory deliberately. They live for ninety seconds,
// are single-use, and are worthless once spent — persisting them would put a
// row in the database for every sign-in attempt, including the failed ones,
// and buy nothing. The cost is that a challenge issued by one instance cannot
// be completed by another, which matters only if the deployment is
// multi-instance without sticky routing; `PASSKEY_CHALLENGE_STORE=redis` is
// where that would be addressed, and there is no such deployment yet.

import { createHash, randomBytes } from "node:crypto";
import {
  challengeIsFresh,
  fromBase64Url,
  parseFlags,
  toBase64Url,
  verifyAuthenticatorData,
  verifyClientData,
  type Ceremony,
  type PendingChallenge,
  type RelyingParty,
  type Verdict,
} from "@/lib/auth/webauthn";

/** The relying party, from configuration rather than the request. */
export function relyingParty(): RelyingParty {
  const url = process.env.NEXT_PUBLIC_APP_URL ?? "https://hrms.circuvent.com";
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "hrms.circuvent.com";
    }
  })();

  // Taken from configuration and never from the Host header. A relying party
  // id derived from an attacker-controlled header lets a credential be minted
  // for one domain and used against another.
  const origins = [url, ...(process.env.PASSKEY_EXTRA_ORIGINS ?? "").split(",")]
    .map((o) => o.trim())
    .filter(Boolean);

  return { id: process.env.PASSKEY_RP_ID?.trim() || host, name: "Circuvent HRMS", origins };
}

const pending = new Map<string, PendingChallenge>();

export function issueChallenge(ceremony: Ceremony, userId?: string): string {
  // 32 bytes, which is the minimum the specification allows and enough that
  // guessing is not a strategy.
  const challenge = toBase64Url(new Uint8Array(randomBytes(32)));
  pending.set(challenge, { challenge, ceremony, issuedAt: Date.now(), userId });

  // Opportunistic sweep, so a process that runs for weeks does not accumulate
  // every challenge it ever issued.
  if (pending.size > 500) {
    const now = Date.now();
    for (const [key, value] of pending) {
      if (!challengeIsFresh(value, now)) pending.delete(key);
    }
  }

  return challenge;
}

/**
 * Takes a challenge, if it is valid, and removes it.
 *
 * Single use: returning it without deleting would let one captured ceremony be
 * replayed for as long as the window lasts.
 */
export function consumeChallenge(
  challenge: string,
  ceremony: Ceremony
): PendingChallenge | null {
  const found = pending.get(challenge);
  if (!found) return null;

  pending.delete(challenge);

  if (found.ceremony !== ceremony) return null;
  if (!challengeIsFresh(found, Date.now())) return null;

  return found;
}

export interface ParsedResponse {
  clientData: { type: string; challenge: string; origin: string; crossOrigin?: boolean };
  rpIdHash: string;
  flags: ReturnType<typeof parseFlags>;
  signCount: number;
  authenticatorData: Uint8Array;
  clientDataHash: Uint8Array;
}

/** Splits an authenticator's response into the parts the rules inspect. */
export function parseResponse(input: {
  clientDataJSON: string;
  authenticatorData: string;
}): ParsedResponse | null {
  try {
    const clientDataBytes = fromBase64Url(input.clientDataJSON);
    const clientData = JSON.parse(new TextDecoder().decode(clientDataBytes));

    const authData = fromBase64Url(input.authenticatorData);
    // rpIdHash(32) || flags(1) || signCount(4) || ...
    if (authData.length < 37) return null;

    const rpIdHash = toBase64Url(authData.slice(0, 32));
    const flags = parseFlags(authData[32]);
    const signCount =
      (authData[33] << 24) | (authData[34] << 16) | (authData[35] << 8) | authData[36];

    return {
      clientData,
      rpIdHash,
      flags,
      signCount: signCount >>> 0,
      authenticatorData: authData,
      clientDataHash: new Uint8Array(
        createHash("sha256").update(Buffer.from(clientDataBytes)).digest()
      ),
    };
  } catch {
    return null;
  }
}

/** The RP ID hash an authenticator should have signed, for our domain. */
export function expectedRpIdHash(rpId: string): string {
  return toBase64Url(new Uint8Array(createHash("sha256").update(rpId).digest()));
}

/**
 * Checks everything about a response except the signature.
 *
 * Signature verification needs the stored public key and is done by the caller,
 * which has it; everything here is common to both ceremonies.
 */
export function verifyResponse(
  parsed: ParsedResponse,
  expected: {
    ceremony: Ceremony;
    challenge: string;
    rp: RelyingParty;
    previousSignCount?: number;
  }
): Verdict {
  const client = verifyClientData(parsed.clientData, {
    ceremony: expected.ceremony,
    challenge: expected.challenge,
    rp: expected.rp,
  });
  if (!client.ok) return client;

  return verifyAuthenticatorData(
    { rpIdHash: parsed.rpIdHash, flags: parsed.flags, signCount: parsed.signCount },
    {
      rpIdHash: expectedRpIdHash(expected.rp.id),
      requireUserVerification: true,
      previousSignCount: expected.previousSignCount,
    }
  );
}

/**
 * Verifies an assertion signature against a stored COSE public key.
 *
 * Supports ES256 and RS256, which are the two every conforming authenticator
 * offers and the two `registrationOptions` asks for.
 */
export async function verifySignature(input: {
  publicKey: string;
  signature: string;
  authenticatorData: Uint8Array;
  clientDataHash: Uint8Array;
}): Promise<boolean> {
  try {
    // Copied into freshly allocated buffers before they reach Web Crypto.
    // `fromBase64Url` returns a Uint8Array whose backing store TypeScript
    // types as ArrayBufferLike, which may be shared — and `crypto.subtle`
    // refuses a SharedArrayBuffer view because another thread could mutate the
    // bytes mid-verification.
    const toBuffer = (bytes: Uint8Array): ArrayBuffer => {
      const copy = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(copy).set(bytes);
      return copy;
    };

    const keyBytes = toBuffer(fromBase64Url(input.publicKey));
    const signed = new Uint8Array(
      input.authenticatorData.length + input.clientDataHash.length
    );
    signed.set(input.authenticatorData, 0);
    signed.set(input.clientDataHash, input.authenticatorData.length);
    const signedBuffer = toBuffer(signed);
    const signatureBuffer = toBuffer(fromBase64Url(input.signature));

    // Stored in SPKI so it can be imported directly; the COSE-to-SPKI
    // conversion happens once at registration rather than on every sign-in.
    for (const algorithm of [
      { name: "ECDSA", namedCurve: "P-256" } as const,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const,
    ]) {
      try {
        const key = await crypto.subtle.importKey("spki", keyBytes, algorithm, false, [
          "verify",
        ]);

        const params =
          algorithm.name === "ECDSA"
            ? { name: "ECDSA", hash: "SHA-256" }
            : { name: "RSASSA-PKCS1-v1_5" };

        const ok = await crypto.subtle.verify(params, key, signatureBuffer, signedBuffer);
        if (ok) return true;
      } catch {
        // Wrong algorithm for this key; try the next.
      }
    }

    return false;
  } catch {
    return false;
  }
}
