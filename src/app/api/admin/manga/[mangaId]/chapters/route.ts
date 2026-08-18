import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/requireRole";
import { resolveAnyAdminSession } from "@/lib/auth/resolveSession";

const createChapterSchema = z.object({
  chapterNumber: z.number().positive(),
  title: z.string().max(255).optional(),
  strictMode: z.boolean().default(true),
});

export async function POST(request: NextRequest, { params }: { params: { mangaId: string } }) {
  const auth = await requireRole(request, "EDITOR", resolveAnyAdminSession);
  if ("response" in auth) return auth.response;

  const body = await request.json().catch(() => null);
  const parsed = createChapterSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input.", details: parsed.error.flatten() }, { status: 400 });
  }

  const manga = await prisma.manga.findUnique({ where: { id: params.mangaId }, select: { id: true } });
  if (!manga) {
    return NextResponse.json({ error: "Manga not found." }, { status: 404 });
  }

  // Idempotent: re-uploading to the same chapter number resumes the same
  // draft chapter rather than creating a duplicate.
  const chapter = await prisma.chapter.upsert({
    where: { mangaId_chapterNumber: { mangaId: params.mangaId, chapterNumber: parsed.data.chapterNumber } },
    update: {},
    create: {
      mangaId: params.mangaId,
      chapterNumber: parsed.data.chapterNumber,
      title: parsed.data.title,
      strictMode: parsed.data.strictMode,
      uploadedById: auth.actor.userId === "admin-bootstrap" ? null : auth.actor.userId,
    },
    select: { id: true, chapterNumber: true, uploadStatus: true },
  });

  return NextResponse.json({ chapter }, { status: 201 });
}
