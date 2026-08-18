import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

/**
 * SESSION TOKENS (spec section 21)
 * ---------------------------------------------------------------------------
 * The RAW token goes in the HttpOnly cookie sent to the browser. Only the
 * SHA-256 HASH of that token is ever stored in the database (`Session.tokenHash`).
 * This means a leaked database dump does not hand out valid session tokens —
 * same principle as password hashing, applied to sessions.
 */

const SESSION_TOKEN_BYTES = 32; // 256 bits of entropy

export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

export function hashSessionToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/** Constant-time comparison of two hex hash strings, to avoid timing side-channels. */
export function safeCompareHashes(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface SessionCookieOptions {
  httpOnly: true;
  secure: boolean; // false only in local http dev
  sameSite: "lax";
  path: "/";
  maxAge: number;
}

export function buildSessionCookieOptions(isProduction: boolean): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  };
}
