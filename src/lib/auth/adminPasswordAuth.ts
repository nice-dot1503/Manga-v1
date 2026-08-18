import { createHmac, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";

/**
 * SIMPLE ADMIN-PASSWORD AUTH
 * ---------------------------------------------------------------------------
 * For a solo operator, running a full multi-user account system just to
 * upload chapters is overkill. This gives a single shared admin password
 * (hashed with Argon2id, never stored in plaintext) that unlocks a signed,
 * stateless session cookie — no database row needed for the session itself.
 *
 * This session, once verified, is treated as an ADMIN-role actor by the
 * existing `requireRole()` gate (see resolveSession.ts's combined resolver),
 * so every admin API route written against that gate works unchanged.
 *
 * Set ADMIN_PASSWORD_HASH in your environment — generate it with:
 *   node scripts/hash-admin-password.mjs "your-password-here"
 */

const ADMIN_COOKIE_NAME = "mr_admin_session";
const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 12; // 12 hours

function getSessionSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "ADMIN_SESSION_SECRET is not set (or too short). Set a random 32+ char value in your environment."
    );
  }
  return secret;
}

export async function verifyAdminPassword(candidate: string): Promise<boolean> {
  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (!hash) {
    throw new Error(
      "ADMIN_PASSWORD_HASH is not configured. Run: node scripts/hash-admin-password.mjs \"your-password\""
    );
  }
  try {
    return await argon2.verify(hash, candidate);
  } catch {
    return false;
  }
}

interface AdminTokenPayload {
  exp: number; // unix seconds
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Builds a signed, stateless admin session token: `{base64url(json)}.{hmac}`. */
export function issueAdminToken(): string {
  const secret = getSessionSecret();
  const payload: AdminTokenPayload = { exp: Math.floor(Date.now() / 1000) + ADMIN_SESSION_MAX_AGE_SECONDS };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(payloadB64, secret);
  return `${payloadB64}.${signature}`;
}

/** Verifies signature + expiry. Returns true only if both check out. */
export function verifyAdminToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const secret = (() => {
    try {
      return getSessionSecret();
    } catch {
      return null;
    }
  })();
  if (!secret) return false;

  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) return false;

  const expectedSignature = sign(payloadB64, secret);
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return false;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as AdminTokenPayload;
    return typeof payload.exp === "number" && payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export const ADMIN_COOKIE = {
  name: ADMIN_COOKIE_NAME,
  maxAgeSeconds: ADMIN_SESSION_MAX_AGE_SECONDS,
};
