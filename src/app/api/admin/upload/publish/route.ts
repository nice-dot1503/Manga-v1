import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireRole } from "@/lib/auth/requireRole";
import { resolveAnyAdminSession } from "@/lib/auth/resolveSession";
import { prisma } from "@/lib/db";
import { parseFilenameBatch } from "@/lib/upload/filenameParser";
import { processUploadedImagesBatch } from "@/lib/upload/imageProcessing";
import { buildUploadPreviewReport, sha256Hex, type UploadCandidate } from "@/lib/upload/duplicateDetection";
import { getR2Client, R2Client } from "@/lib/storage/r2";

/**
 * POST /api/admin/upload/publish
 * ---------------------------------------------------------------------------
 * The only route that actually moves a chapter out of PENDING_REVIEW. Files
 * are re-sent here (same as the preview call) and re-validated server-side
 * — we never trust that whatever passed `preview` five minutes ago is still
 * accurate, and we never trust `confirmedReview` alone without re-running
 * the checks (spec section 37: no security feature that's UI-only).
 *
 * On any blocking issue (missing pages, duplicate page numbers, exact or
 * visual duplicates, invalid files), this returns 409 and writes nothing —
 * partial-publish is never allowed.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, "EDITOR", resolveAnyAdminSession);
  if ("response" in auth) return auth.response;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data." }, { status: 400 });
  }

  const chapterId = formData.get("chapterId");
  const confirmedReview = formData.get("confirmedReview");
  if (typeof chapterId !== "string" || chapterId.length === 0) {
    return NextResponse.json({ error: "chapterId is required." }, { status: 400 });
  }
  if (confirmedReview !== "true") {
    return NextResponse.json({ error: "Admin must explicitly confirm the preview review before publishing." }, { status: 400 });
  }

  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided." }, { status: 400 });
  }

  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    select: { id: true, mangaId: true, uploadStatus: true },
  });
  if (!chapter) {
    return NextResponse.json({ error: "Chapter not found." }, { status: 404 });
  }
  if (chapter.uploadStatus === "PUBLISHED") {
    return NextResponse.json({ error: "Chapter is already published. Unpublish it first to re-upload." }, { status: 409 });
  }

  // 1. Parse filenames -> page numbers (section 7).
  const filenameResults = parseFilenameBatch(files.map((f) => f.name));
  if (!filenameResults.allResolved) {
    return NextResponse.json(
      {
        error: "Some filenames could not be confidently parsed into page numbers.",
        needsAdminReview: filenameResults.needsAdminReview,
      },
      { status: 409 }
    );
  }

  // 2. Full validate + process (magic bytes, resize, WebP, thumbnail, hashes)
  //    via the sharp-backed pipeline — this is the authoritative check, not
  //    the lighter one in /preview.
  const buffers = await Promise.all(files.map(async (f) => ({ filename: f.name, buffer: Buffer.from(await f.arrayBuffer()) })));
  const processed = await processUploadedImagesBatch(buffers);

  if (processed.failed.length > 0) {
    return NextResponse.json({ error: "Some files failed validation.", failed: processed.failed }, { status: 409 });
  }

  // 3. Re-run the full duplicate/gap detection against the REAL processed
  //    hashes before writing anything — never trust the client-side
  //    "I already checked" implied by confirmedReview alone.
  const pageNumberByFilename = new Map(filenameResults.parsed.map((p) => [p.filename, p.pageNumber]));
  const candidates: UploadCandidate[] = processed.succeeded.map(({ filename, result }) => ({
    filename,
    pageNumber: pageNumberByFilename.get(filename) ?? null,
    buffer: result.optimized, // hash the bytes we're actually storing
    sizeBytes: result.sizeBytes,
  }));
  const dHashes = processed.succeeded.map(({ filename, result }) => ({ filename, dHash: result.dHash }));
  const report = buildUploadPreviewReport(candidates, dHashes);

  if (!report.readyToPublish) {
    return NextResponse.json({ error: "Upload has unresolved issues — cannot publish.", preview: report }, { status: 409 });
  }

  // 4. Upload to R2, then write DB rows in a single transaction so a
  //    mid-upload crash never leaves an inconsistent Chapter/Page state.
  const r2 = getR2Client();
  const uploaded: { pageNumber: number; storagePath: string; thumbnailPath: string }[] = [];

  try {
    for (const { filename, result } of processed.succeeded) {
      const pageNumber = pageNumberByFilename.get(filename);
      if (pageNumber === null || pageNumber === undefined) continue; // unreachable given allResolved check above

      const storagePath = R2Client.buildPageKey(chapter.mangaId, chapter.id, pageNumber, "optimized");
      const thumbnailPath = R2Client.buildPageKey(chapter.mangaId, chapter.id, pageNumber, "thumbnail");

      await r2.putObject(storagePath, result.optimized, "image/webp");
      await r2.putObject(thumbnailPath, result.thumbnail, "image/webp");

      uploaded.push({ pageNumber, storagePath, thumbnailPath });
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Clear any previous partial attempt for this chapter before writing
      // the confirmed set, so republishing after fixing issues doesn't
      // leave stale Page rows behind.
      await tx.page.deleteMany({ where: { chapterId: chapter.id } });

      for (const { filename, result } of processed.succeeded) {
        const pageNumber = pageNumberByFilename.get(filename)!;
        const paths = uploaded.find((u) => u.pageNumber === pageNumber)!;

        await tx.page.create({
          data: {
            chapterId: chapter.id,
            pageNumber,
            originalFilename: filename,
            storagePath: paths.storagePath,
            thumbnailPath: paths.thumbnailPath,
            width: result.width,
            height: result.height,
            sizeBytes: result.sizeBytes,
            mimeType: "image/webp",
            hash: {
              create: {
                sha256: sha256Hex(result.optimized),
                perceptualHash: result.dHash,
              },
            },
          },
        });
      }

      await tx.chapter.update({
        where: { id: chapter.id },
        data: { uploadStatus: "PUBLISHED", publishedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          actorId: auth.actor.userId === "admin-bootstrap" ? null : auth.actor.userId,
          action: "chapter.publish",
          targetType: "Chapter",
          targetId: chapter.id,
          metadata: { pageCount: uploaded.length },
        },
      });
    });
  } catch (err) {
    console.error("Publish failed:", err);
    // Best-effort cleanup of anything already written to R2 for this attempt.
    await Promise.allSettled(uploaded.flatMap((u) => [r2.deleteObject(u.storagePath), r2.deleteObject(u.thumbnailPath)]));
    return NextResponse.json({ error: "Publish failed. No changes were saved." }, { status: 500 });
  }

  return NextResponse.json({ success: true, chapterId: chapter.id, pageCount: uploaded.length });
}
