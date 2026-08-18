import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/requireRole";
import { resolveAnyAdminSession } from "@/lib/auth/resolveSession";

const createMangaSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(5000).optional(),
});

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-") // supports Thai + other unicode letters, not just [a-z0-9]
    .replace(/^-+|-+$/g, "");
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base || "manga"}-${suffix}`;
}

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, "EDITOR", resolveAnyAdminSession);
  if ("response" in auth) return auth.response;

  const mangaList = await prisma.manga.findMany({
    orderBy: { updatedAt: "desc" },
    select: { id: true, slug: true, title: true, status: true, isPublished: true, _count: { select: { chapters: true } } },
    take: 100,
  });

  return NextResponse.json({ manga: mangaList });
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, "EDITOR", resolveAnyAdminSession);
  if ("response" in auth) return auth.response;

  const body = await request.json().catch(() => null);
  const parsed = createMangaSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input.", details: parsed.error.flatten() }, { status: 400 });
  }

  const manga = await prisma.manga.create({
    data: {
      title: parsed.data.title,
      description: parsed.data.description,
      slug: slugify(parsed.data.title),
      status: "DRAFT",
    },
    select: { id: true, slug: true, title: true },
  });

  return NextResponse.json({ manga }, { status: 201 });
}
