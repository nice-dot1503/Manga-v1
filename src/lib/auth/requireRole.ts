import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * SERVER-SIDE ROLE ENFORCEMENT
 * ---------------------------------------------------------------------------
 * Spec section 20: "Admin API ต้องตรวจ role ฝั่ง server ทุกครั้ง / อย่าเชื่อ
 * role จาก frontend" — every admin/editor route MUST call this and use its
 * result; a role claim sent by the client (header, body, query string) is
 * NEVER trusted on its own.
 *
 * This resolves the session from an HttpOnly cookie, looks the session up
 * server-side (DB-backed, not a trust-the-JWT-blindly pattern), and returns
 * the authenticated user's role from the database — the only source of
 * truth for authorization decisions.
 */

export type AppRole = "ADMIN" | "EDITOR" | "MODERATOR" | "USER";

export interface AuthenticatedActor {
  userId: string;
  role: AppRole;
}

// Swap this for your real session-lookup (e.g. Prisma query against Session
// + User, keyed by a hashed session-token cookie value). Kept as an
// injectable dependency so route handlers — and tests — don't need a live DB.
export type SessionResolver = (request: NextRequest) => Promise<AuthenticatedActor | null>;

const roleRank: Record<AppRole, number> = {
  USER: 0,
  MODERATOR: 1,
  EDITOR: 2,
  ADMIN: 3,
};

export interface RequireRoleResult {
  actor: AuthenticatedActor;
}

/**
 * Resolves the session and asserts the actor's role meets `minimumRole`.
 * Returns either the authenticated actor, or a ready-to-return 401/403
 * NextResponse — callers should check `"response" in result`.
 */
export async function requireRole(
  request: NextRequest,
  minimumRole: AppRole,
  resolveSession: SessionResolver
): Promise<RequireRoleResult | { response: NextResponse }> {
  const actor = await resolveSession(request);

  if (!actor) {
    return {
      response: NextResponse.json({ error: "Authentication required." }, { status: 401 }),
    };
  }

  if (roleRank[actor.role] < roleRank[minimumRole]) {
    return {
      response: NextResponse.json({ error: "Insufficient permissions." }, { status: 403 }),
    };
  }

  return { actor };
}
