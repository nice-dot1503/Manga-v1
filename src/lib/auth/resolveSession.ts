import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { hashSessionToken } from "./session";
import type { AuthenticatedActor, SessionResolver } from "./requireRole";
import { ADMIN_COOKIE, verifyAdminToken } from "./adminPasswordAuth";

/**
 * Real session resolver: reads the raw token from the HttpOnly cookie,
 * hashes it, and looks up a non-expired Session row joined to its User.
 * This is the single source of truth `requireRole()` should be given in
 * every real route handler — never trust a role passed in the request body.
 */
export const resolveSessionFromDb: SessionResolver = async (request: NextRequest) => {
  const cookieName = process.env.SESSION_COOKIE_NAME ?? "mr_session";
  const rawToken = request.cookies.get(cookieName)?.value;
  if (!rawToken) return null;

  const tokenHash = hashSessionToken(rawToken);

  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, role: true, isBanned: true } } },
  });

  if (!session) return null;
  if (session.expiresAt < new Date()) return null;
  if (session.user.isBanned) return null;

  const actor: AuthenticatedActor = { userId: session.user.id, role: session.user.role };
  return actor;
};

/**
 * Resolves the simple single-password admin cookie (see
 * adminPasswordAuth.ts). No database row backs this session — it's a
 * signed, stateless token, verified purely by HMAC + expiry check.
 */
export const resolveAdminPasswordSession: SessionResolver = async (request: NextRequest) => {
  const token = request.cookies.get(ADMIN_COOKIE.name)?.value;
  if (!verifyAdminToken(token)) return null;
  // Synthetic actor — no User row exists for the shared admin password.
  // "admin-bootstrap" is a fixed, non-DB-backed id used only for audit-log
  // attribution; it must never be treated as a real userId elsewhere.
  return { userId: "admin-bootstrap", role: "ADMIN" };
};

/**
 * Tries the full user/session system first, then falls back to the simple
 * admin-password cookie. Pass this to `requireRole()` in route handlers so
 * either login method works transparently.
 */
export const resolveAnyAdminSession: SessionResolver = async (request: NextRequest) => {
  const dbActor = await resolveSessionFromDb(request);
  if (dbActor) return dbActor;
  return resolveAdminPasswordSession(request);
};
