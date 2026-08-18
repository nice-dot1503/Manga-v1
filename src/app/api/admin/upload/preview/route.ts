import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/requireRole";
import { resolveAnyAdminSession } from "@/lib/auth/resolveSession";
import { parseFilenameBatch } from "@/lib/upload/filenameParser";
import { validateFile, DEFAULT_VALIDATION_CONFIG } from "@/lib/upload/fileValidation";
import { buildUploadPreviewReport, type UploadCandidate } from "@/lib/upload/duplicateDetection";
import sharp from "sharp";
import { computeDHashFromGrayscale } from "@/lib/upload/duplicateDetection";

/**
 * POST /api/admin/upload/preview
 * ---------------------------------------------------------------------------
 * Orchestrates spec sections 6-14 for a batch of page images (not the ZIP
 * path — see /api/admin/upload/zip for that variant, which extracts via
 * zipHandler.ts first and then calls the same pipeline below).
 *
 * This endpoint NEVER writes to R2 or the database. It only returns a
 * preview report; publishing is a separate, explicit admin action
 * (POST /api/admin/upload/publish) gated on `confirmedReview: true`.
 */

async function computeDHash(buffer: Buffer): Promise<string | null> {
  try {
    const { data } = await sharp(buffer).grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
    return computeDHashFromGrayscale(Array.from(data));
  } catch {
    return null; // handled as a validation failure elsewhere; don't crash the whole batch
  }
}

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
  if (typeof chapterId !== "string" || chapterId.length === 0) {
    return NextResponse.json({ error: "chapterId is required." }, { status: 400 });
  }

  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided." }, { status: 400 });
  }

  // 1. Parse page numbers from filenames (section 7).
  const filenameResults = parseFilenameBatch(files.map((f) => f.name));

  // 2. Validate every file server-side: magic bytes, size, malicious names
  //    (section 12). We never trust `file.type` from the browser.
  const candidates: UploadCandidate[] = [];
  const invalidFiles: { filename: string; errors: string[] }[] = [];
  const dHashes: { filename: string; dHash: string }[] = [];

  for (let i = 0; i < files.length; i++) {
    // In-bounds: i is derived from files.length, and filenameResults.parsed
    // was built via files.map(...), so both arrays share the same length.
    const file = files[i]!;
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = filenameResults.parsed[i]!;

    const validation = validateFile(file.name, buffer, null, DEFAULT_VALIDATION_CONFIG);
    if (!validation.valid) {
      invalidFiles.push({ filename: file.name, errors: validation.errors });
      continue;
    }

    candidates.push({
      filename: file.name,
      pageNumber: parsed.pageNumber,
      buffer,
      sizeBytes: buffer.length,
    });

    const dHash = await computeDHash(buffer);
    if (dHash) dHashes.push({ filename: file.name, dHash });
  }

  // 3. Build the full preview report: missing pages, duplicate page numbers,
  //    exact (SHA-256) duplicates, and visual (perceptual-hash) duplicates.
  const report = buildUploadPreviewReport(candidates, dHashes);

  return NextResponse.json({
    chapterId,
    filenameParsing: {
      needsAdminReview: filenameResults.needsAdminReview,
      allResolved: filenameResults.allResolved,
    },
    invalidFiles,
    preview: report,
  });
}
