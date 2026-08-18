import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAdminPassword, issueAdminToken, ADMIN_COOKIE } from "@/lib/auth/adminPasswordAuth";

const loginSchema = z.object({ password: z.string().min(1) });

// Simple in-memory rate limiting per IP — good enough for a single-admin
// panel; swap for Cloudflare rate limiting rules in front of this route in
// production (see spec section 17).
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "unknown";

  if (isRateLimited(ip)) {
    return NextResponse.json({ error: "Too many attempts. Try again in a minute." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Password is required." }, { status: 400 });
  }

  let valid: boolean;
  try {
    valid = await verifyAdminPassword(parsed.data.password);
  } catch (err) {
    // Misconfiguration (ADMIN_PASSWORD_HASH not set) — tell the operator,
    // not a random visitor, what's wrong; never leak this detail in a
    // production response body though.
    console.error(err);
    return NextResponse.json({ error: "Admin login is not configured on this server." }, { status: 500 });
  }

  if (!valid) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const token = issueAdminToken();
  const response = NextResponse.json({ success: true });
  response.cookies.set(ADMIN_COOKIE.name, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ADMIN_COOKIE.maxAgeSeconds,
  });
  return response;
}
