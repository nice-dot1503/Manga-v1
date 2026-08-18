import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registerSchema } from "@/lib/auth/schemas";
import { hashPassword } from "@/lib/auth/password";
import { verifyTurnstileToken } from "@/lib/auth/turnstile";
import { generateSessionToken, hashSessionToken, buildSessionCookieOptions, SESSION_COOKIE_MAX_AGE_SECONDS } from "@/lib/auth/session";

/** Narrow, dependency-light check for Prisma's unique-constraint violation code, so we don't need `Prisma.PrismaClientKnownRequestError`'s full type surface just to branch on `.code`. */
function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

/**
 * POST /api/auth/register
 * Turnstile-gated per spec section 21. Never echoes back whether an email
 * vs. a username collided in a way that leaks which one exists to an
 * enumeration attacker beyond what's strictly necessary for UX.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input.", details: parsed.error.flatten() }, { status: 400 });
  }

  const { email, username, password, turnstileToken } = parsed.data;

  const turnstile = await verifyTurnstileToken(
    turnstileToken,
    request.headers.get("cf-connecting-ip") ?? undefined
  );
  if (!turnstile.success) {
    return NextResponse.json({ error: "CAPTCHA verification failed." }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);

  try {
    const user = await prisma.user.create({
      data: { email, username, passwordHash, role: "USER" },
      select: { id: true, email: true, username: true, role: true },
    });

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

    const response = NextResponse.json({ user }, { status: 201 });
    response.cookies.set(
      process.env.SESSION_COOKIE_NAME ?? "mr_session",
      rawToken,
      buildSessionCookieOptions(process.env.NODE_ENV === "production")
    );
    return response;
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      // Unique constraint (email or username) — deliberately generic message.
      return NextResponse.json({ error: "Email or username is already in use." }, { status: 409 });
    }
    // Never leak stack traces / DB error internals to the client (section 34).
    return NextResponse.json({ error: "Registration failed." }, { status: 500 });
  }
}
