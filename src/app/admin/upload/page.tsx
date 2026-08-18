import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE, verifyAdminToken } from "@/lib/auth/adminPasswordAuth";
import { hashSessionToken } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import UploadClient from "./UploadClient";

async function isAuthenticated(): Promise<boolean> {
  const cookieStore = cookies();

  // Path 1: simple shared admin password cookie.
  const adminToken = cookieStore.get(ADMIN_COOKIE.name)?.value;
  if (verifyAdminToken(adminToken)) return true;

  // Path 2: full user/session system, for anyone who registered a real
  // account with EDITOR+ role.
  const sessionCookieName = process.env.SESSION_COOKIE_NAME ?? "mr_session";
  const rawToken = cookieStore.get(sessionCookieName)?.value;
  if (!rawToken) return false;

  const session = await prisma.session
    .findUnique({
      where: { tokenHash: hashSessionToken(rawToken) },
      include: { user: { select: { role: true, isBanned: true } } },
    })
    .catch(() => null);

  if (!session || session.expiresAt < new Date() || session.user.isBanned) return false;
  return session.user.role === "ADMIN" || session.user.role === "EDITOR";
}

export default async function AdminUploadPage() {
  if (!(await isAuthenticated())) {
    redirect("/admin/login");
  }

  return <UploadClient />;
}
