import { NextResponse } from "next/server";
import { ADMIN_COOKIE } from "@/lib/auth/adminPasswordAuth";

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete(ADMIN_COOKIE.name);
  return response;
}
