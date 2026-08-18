import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { loginSchema } from "@/lib/auth/schemas";
import { verifyPassword } from "@/lib/auth/password";
import { generateSessionToken, hashSessionToken, buildSessionCookieOptions, SESSION_COOKIE_MAX_AGE_SECONDS } from "@/lib/auth/session";

/**
 * POST /api/auth/login
 * ---------------------------------------------------------------------------
 * Deliberately returns the SAME generic error for "no such email" and
 * "wrong password" to avoid user enumeration. Always runs verifyPassword
 * against a real (or dummy) hash so response timing doesn't leak whether
 * the email exists — a lightweight defense against timing-based enumeration.
 */

// Precomputed dummy hash so the "user not found" branch still pays the
// argon2 cost, keeping response time close to the "user found, wrong
// password" branch.
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQxMjM0NTY3OA$XZ8+9y2sK1p3v7B0GhY0kA0000000000000000000";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input." }, { status: 400 });
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });

  const passwordOk = await verifyPassword(user?.passwordHash ?? DUMMY_HASH, password);

  if (!user || !passwordOk) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  if (user.isBanned) {
    return NextResponse.json({ error: "This account has been suspended." }, { status: 403 });
  }

  const rawToken = generateSessionToken();
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashSessionToken(rawToken),
      expiresAt: new Date(Date.now() + SESSION_COOKIE_MAX_AGE_SECONDS * 1000),
      ipAddress: request.headers.get("cf-connecting-ip"),
      userAgent: request.headers.get("user-agent"),
    },
  });

  const response = NextResponse.json({
    user: { id: user.id, email: user.email, username: user.username, role: user.role },
  });
  response.cookies.set(
    process.env.SESSION_COOKIE_NAME ?? "mr_session",
    rawToken,
    buildSessionCookieOptions(process.env.NODE_ENV === "production")
  );
  return response;
}
