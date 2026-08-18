import JSZip from "jszip";
import path from "node:path";
import { isMaliciousFilename } from "./fileValidation";

/**
 * ZIP UPLOAD HANDLER (spec section 13)
 * ---------------------------------------------------------------------------
 * Accepts a chapter as a single ZIP (e.g. chapter-100.zip). Guards against
 * Zip Slip (path traversal via ../ or absolute paths in archive entries),
 * enforces size/file-count limits, and returns only the validated in-memory
 * entries — it never writes to disk itself, so callers control where
 * temporary extraction happens (spec step: "แตกไฟล์ในพื้นที่ชั่วคราว").
 */

export interface ZipExtractionConfig {
  maxTotalUncompressedBytes: number;
  maxFileCount: number;
  maxSingleFileBytes: number;
}

export const DEFAULT_ZIP_CONFIG: ZipExtractionConfig = {
  maxTotalUncompressedBytes: 500 * 1024 * 1024, // 500MB per chapter
  maxFileCount: 1000,
  maxSingleFileBytes: 20 * 1024 * 1024, // matches DEFAULT_VALIDATION_CONFIG.maxSizeBytes
};

export interface ExtractedZipEntry {
  filename: string; // basename only — directory components are stripped/validated
  buffer: Buffer;
  sizeBytes: number;
}

export interface ZipExtractionResult {
  entries: ExtractedZipEntry[];
  rejectedEntries: { filename: string; reason: string }[];
  totalUncompressedBytes: number;
}

/**
 * Returns true if a raw zip-entry path would escape the intended extraction
 * directory once resolved — the core Zip Slip check.
 */
function isPathTraversal(entryPath: string): boolean {
  if (path.isAbsolute(entryPath)) return true;
  const normalized = path.normalize(entryPath);
  if (normalized.startsWith("..")) return true;
  if (normalized.includes(`..${path.sep}`)) return true;
  return false;
}

export async function extractZipSafely(
  zipBuffer: Buffer,
  config: ZipExtractionConfig = DEFAULT_ZIP_CONFIG
): Promise<ZipExtractionResult> {
  const zip = await JSZip.loadAsync(zipBuffer);
  const entries: ExtractedZipEntry[] = [];
  const rejected: { filename: string; reason: string }[] = [];
  let totalBytes = 0;

  const fileEntries = Object.values(zip.files).filter((f) => !f.dir);

  if (fileEntries.length > config.maxFileCount) {
    throw new Error(
      `ZIP contains ${fileEntries.length} files, exceeding the limit of ${config.maxFileCount}.`
    );
  }

  for (const entry of fileEntries) {
    const rawPath = entry.name;

    if (isPathTraversal(rawPath)) {
      rejected.push({ filename: rawPath, reason: "Path traversal (Zip Slip) attempt detected." });
      continue;
    }

    const basename = path.basename(rawPath);

    if (isMaliciousFilename(basename)) {
      rejected.push({ filename: rawPath, reason: "Unsafe filename." });
      continue;
    }

    // Skip common non-page junk that archivers add automatically.
    if (basename === ".DS_Store" || basename.startsWith("__MACOSX") || basename === "Thumbs.db") {
      continue;
    }

    const buffer = await entry.async("nodebuffer");

    if (buffer.length > config.maxSingleFileBytes) {
      rejected.push({
        filename: basename,
        reason: `File exceeds per-file size limit (${buffer.length} > ${config.maxSingleFileBytes} bytes).`,
      });
      continue;
    }

    totalBytes += buffer.length;
    if (totalBytes > config.maxTotalUncompressedBytes) {
      throw new Error(
        `Total uncompressed size exceeds limit of ${config.maxTotalUncompressedBytes} bytes — aborting extraction (possible zip bomb).`
      );
    }

    entries.push({ filename: basename, buffer, sizeBytes: buffer.length });
  }

  return { entries, rejectedEntries: rejected, totalUncompressedBytes: totalBytes };
}
