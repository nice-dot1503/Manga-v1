import { createHash } from "node:crypto";

/**
 * DUPLICATE / GAP DETECTION
 * ---------------------------------------------------------------------------
 * Covers spec sections 8 (exact duplicate), 9 (visual duplicate),
 * 10 (missing pages), 11 (duplicate page numbers).
 *
 * IMPORTANT: nothing in this module deletes files automatically. Every
 * function only *reports* findings; the admin makes the final call
 * (Keep first / Keep second / Keep both / Cancel), per spec.
 */

// ---------------------------------------------------------------------------
// 8. EXACT DUPLICATE — SHA-256
// ---------------------------------------------------------------------------

export function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export interface UploadCandidate {
  filename: string;
  pageNumber: number | null;
  buffer: Buffer;
  sizeBytes: number;
}

export interface ExactDuplicateGroup {
  sha256: string;
  files: { filename: string; pageNumber: number | null; sizeBytes: number }[];
}

/** Groups candidates that are byte-for-byte identical (same SHA-256). */
export function findExactDuplicates(candidates: UploadCandidate[]): ExactDuplicateGroup[] {
  const bySha256 = new Map<string, UploadCandidate[]>();

  for (const c of candidates) {
    const hash = sha256Hex(c.buffer);
    const group = bySha256.get(hash) ?? [];
    group.push(c);
    bySha256.set(hash, group);
  }

  const duplicates: ExactDuplicateGroup[] = [];
  for (const [hash, files] of bySha256.entries()) {
    if (files.length > 1) {
      duplicates.push({
        sha256: hash,
        files: files.map((f) => ({
          filename: f.filename,
          pageNumber: f.pageNumber,
          sizeBytes: f.sizeBytes,
        })),
      });
    }
  }
  return duplicates;
}

// ---------------------------------------------------------------------------
// 9. VISUAL DUPLICATE — perceptual hash (dHash) + similarity score
// ---------------------------------------------------------------------------
// This module intentionally does NOT depend on `sharp` directly so it stays
// unit-testable without native bindings. Callers pass in a decoded grayscale
// pixel grid (see `computeDHashFromGrayscale`); the actual image-decoding
// step (via sharp, see imageProcessing.ts) is a thin adapter around this.

/**
 * Computes a 64-bit difference hash (dHash) from a 9x8 grayscale pixel grid.
 * Grid must be row-major, length 72 (9 * 8), values 0-255.
 * Returns the hash as a 16-character hex string.
 */
export function computeDHashFromGrayscale(grid: number[]): string {
  if (grid.length !== 72) {
    throw new Error(`computeDHashFromGrayscale expects a 9x8 (72-value) grid, got ${grid.length}`);
  }

  const bits: number[] = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      // In-bounds by construction: row < 8, col < 8, grid.length === 72 (9x8),
      // so `row * 9 + col + 1` maxes out at 7*9+7+1 = 71, the last valid index.
      const left = grid[row * 9 + col]!;
      const right = grid[row * 9 + col + 1]!;
      bits.push(left < right ? 1 : 0);
    }
  }

  let hex = "";
  for (let i = 0; i < 64; i += 4) {
    // In-bounds: bits.length is always exactly 64 (8 rows * 8 cols).
    const nibble = (bits[i]! << 3) | (bits[i + 1]! << 2) | (bits[i + 2]! << 1) | bits[i + 3]!;
    hex += nibble.toString(16);
  }
  return hex;
}

/** Hamming distance between two equal-length hex hash strings, in bits. */
export function hammingDistanceHex(a: string, b: string): number {
  if (a.length !== b.length) throw new Error("Hash length mismatch");
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    // In-bounds: loop bound is a.length, and we've asserted a.length === b.length.
    let xor = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (xor) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

/** Converts a 64-bit dHash hamming distance into a 0-100 similarity score. */
export function similarityScoreFromHamming(distance: number, totalBits = 64): number {
  return Math.round(((totalBits - distance) / totalBits) * 1000) / 10;
}

export interface VisualDuplicateMatch {
  filenameA: string;
  filenameB: string;
  similarity: number; // 0-100, e.g. 98.7
}

/** Default threshold: pairs at or above this similarity are flagged for admin review. */
export const VISUAL_SIMILARITY_THRESHOLD = 92;

export function findVisualDuplicates(
  hashes: { filename: string; dHash: string }[],
  threshold: number = VISUAL_SIMILARITY_THRESHOLD
): VisualDuplicateMatch[] {
  const matches: VisualDuplicateMatch[] = [];
  for (let i = 0; i < hashes.length; i++) {
    for (let j = i + 1; j < hashes.length; j++) {
      // In-bounds: i, j both derived from hashes.length loop bounds.
      const hi = hashes[i]!;
      const hj = hashes[j]!;
      const distance = hammingDistanceHex(hi.dHash, hj.dHash);
      const similarity = similarityScoreFromHamming(distance);
      if (similarity >= threshold) {
        matches.push({ filenameA: hi.filename, filenameB: hj.filename, similarity });
      }
    }
  }
  return matches.sort((a, b) => b.similarity - a.similarity);
}

// ---------------------------------------------------------------------------
// 10. MISSING PAGE DETECTION
// ---------------------------------------------------------------------------

export interface MissingPageReport {
  missingPages: number[];
  minPage: number | null;
  maxPage: number | null;
}

/** Given the set of resolved page numbers, reports any gaps in the 1..max range. */
export function findMissingPages(pageNumbers: number[]): MissingPageReport {
  const unique = Array.from(new Set(pageNumbers)).sort((a, b) => a - b);
  if (unique.length === 0) return { missingPages: [], minPage: null, maxPage: null };

  // Non-null: guarded by the length check above.
  const min = unique[0]!;
  const max = unique[unique.length - 1]!;
  const present = new Set(unique);
  const missing: number[] = [];
  for (let p = min; p <= max; p++) {
    if (!present.has(p)) missing.push(p);
  }
  return { missingPages: missing, minPage: min, maxPage: max };
}

// ---------------------------------------------------------------------------
// 11. DUPLICATE PAGE NUMBER (different files claiming the same page index)
// ---------------------------------------------------------------------------

export interface DuplicatePageNumberGroup {
  pageNumber: number;
  filenames: string[];
}

export function findDuplicatePageNumbers(
  candidates: { filename: string; pageNumber: number | null }[]
): DuplicatePageNumberGroup[] {
  const byPage = new Map<number, string[]>();
  for (const c of candidates) {
    if (c.pageNumber === null) continue;
    const list = byPage.get(c.pageNumber) ?? [];
    list.push(c.filename);
    byPage.set(c.pageNumber, list);
  }

  const duplicates: DuplicatePageNumberGroup[] = [];
  for (const [pageNumber, filenames] of byPage.entries()) {
    if (filenames.length > 1) duplicates.push({ pageNumber, filenames });
  }
  return duplicates.sort((a, b) => a.pageNumber - b.pageNumber);
}

// ---------------------------------------------------------------------------
// AGGREGATE: full upload-preview report (spec section 14)
// ---------------------------------------------------------------------------

export interface UploadPreviewReport {
  totalFiles: number;
  resolvedPageCount: number;
  missingPages: number[];
  duplicatePageNumbers: DuplicatePageNumberGroup[];
  exactDuplicates: ExactDuplicateGroup[];
  visualDuplicates: VisualDuplicateMatch[];
  totalSizeBytes: number;
  /** True only when there are zero blocking issues left for the admin to resolve. */
  readyToPublish: boolean;
}

export function buildUploadPreviewReport(
  candidates: UploadCandidate[],
  dHashes: { filename: string; dHash: string }[]
): UploadPreviewReport {
  const resolved = candidates.filter((c) => c.pageNumber !== null).map((c) => c.pageNumber as number);
  const missing = findMissingPages(resolved);
  const dupPages = findDuplicatePageNumbers(candidates);
  const exactDupes = findExactDuplicates(candidates);
  const visualDupes = findVisualDuplicates(dHashes);
  const totalSize = candidates.reduce((sum, c) => sum + c.sizeBytes, 0);

  const readyToPublish =
    missing.missingPages.length === 0 &&
    dupPages.length === 0 &&
    exactDupes.length === 0 &&
    visualDupes.length === 0 &&
    resolved.length === candidates.length; // every file resolved to a page number

  return {
    totalFiles: candidates.length,
    resolvedPageCount: resolved.length,
    missingPages: missing.missingPages,
    duplicatePageNumbers: dupPages,
    exactDuplicates: exactDupes,
    visualDuplicates: visualDupes,
    totalSizeBytes: totalSize,
    readyToPublish,
  };
}
