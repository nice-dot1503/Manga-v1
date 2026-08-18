/**
 * CLOUDFLARE TURNSTILE VERIFICATION (spec section 21)
 * ---------------------------------------------------------------------------
 * The client-side widget token means nothing on its own — it MUST be
 * verified server-side against Cloudflare's siteverify endpoint before the
 * action it's guarding (register, password reset, suspicious login, etc.)
 * is allowed to proceed.
 */

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface TurnstileVerificationResult {
  success: boolean;
  errorCodes: string[];
}

export async function verifyTurnstileToken(
  token: string,
  remoteIp?: string
): Promise<TurnstileVerificationResult> {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("TURNSTILE_SECRET_KEY is not configured — cannot verify Turnstile tokens.");
  }

  const body = new URLSearchParams({ secret: secretKey, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);

  const res = await fetch(TURNSTILE_VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = (await res.json()) as { success: boolean; "error-codes"?: string[] };
  return { success: data.success === true, errorCodes: data["error-codes"] ?? [] };
}
