import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashSessionToken } from "@/lib/auth/session";

export async function POST(request: NextRequest) {
  const cookieName = process.env.SESSION_COOKIE_NAME ?? "mr_session";
  const rawToken = request.cookies.get(cookieName)?.value;

  if (rawToken) {
    // Best-effort: revoke the session server-side even though the cookie is
    // about to be cleared, so a stolen-but-unused token can't be replayed.
    await prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(rawToken) } }).catch(() => {
      // Swallow — logout should still succeed for the client even if the DB
      // row was already gone.
    });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.delete(cookieName);
  return response;
}
