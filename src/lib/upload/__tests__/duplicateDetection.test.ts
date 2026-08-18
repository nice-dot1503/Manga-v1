import { describe, it, expect } from "vitest";
import {
  findExactDuplicates,
  findMissingPages,
  findDuplicatePageNumbers,
  computeDHashFromGrayscale,
  hammingDistanceHex,
  similarityScoreFromHamming,
  findVisualDuplicates,
  buildUploadPreviewReport,
  type UploadCandidate,
} from "../duplicateDetection";

function candidate(filename: string, pageNumber: number | null, content: string): UploadCandidate {
  const buffer = Buffer.from(content);
  return { filename, pageNumber, buffer, sizeBytes: buffer.length };
}

describe("findExactDuplicates (SHA-256)", () => {
  it("flags two files with identical byte content", () => {
    const candidates = [
      candidate("001.jpg", 1, "same-bytes"),
      candidate("057.jpg", 57, "same-bytes"),
      candidate("002.jpg", 2, "different-bytes"),
    ];
    const dupes = findExactDuplicates(candidates);
    expect(dupes).toHaveLength(1);
    expect(dupes[0]!.files.map((f) => f.filename).sort()).toEqual(["001.jpg", "057.jpg"]);
  });

  it("reports no duplicates when all files differ", () => {
    const candidates = [candidate("001.jpg", 1, "a"), candidate("002.jpg", 2, "b")];
    expect(findExactDuplicates(candidates)).toHaveLength(0);
  });
});

describe("findMissingPages", () => {
  it("detects a single missing page", () => {
    const report = findMissingPages([1, 2, 3, 5, 6]);
    expect(report.missingPages).toEqual([4]);
  });

  it("detects multiple missing pages", () => {
    const report = findMissingPages([1, 2, 4, 7, 8]);
    expect(report.missingPages).toEqual([3, 5, 6]);
  });

  it("reports no gaps for a contiguous sequence", () => {
    const report = findMissingPages([1, 2, 3, 4, 5]);
    expect(report.missingPages).toEqual([]);
  });
});

describe("findDuplicatePageNumbers", () => {
  it("flags two files claiming the same page number even with different hashes", () => {
    const dupes = findDuplicatePageNumbers([
      { filename: "001.jpg", pageNumber: 1 },
      { filename: "001.webp", pageNumber: 1 },
      { filename: "002.jpg", pageNumber: 2 },
    ]);
    expect(dupes).toHaveLength(1);
    expect(dupes[0]!.pageNumber).toBe(1);
    expect(dupes[0]!.filenames.sort()).toEqual(["001.jpg", "001.webp"]);
  });
});

describe("perceptual hash / visual duplicate detection", () => {
  it("computes a stable 16-char hex dHash from a 9x8 grayscale grid", () => {
    const grid = Array.from({ length: 72 }, (_, i) => (i * 3) % 256);
    const hash = computeDHashFromGrayscale(grid);
    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("identical grids produce zero hamming distance and 100% similarity", () => {
    const grid = Array.from({ length: 72 }, (_, i) => (i * 5) % 256);
    const hashA = computeDHashFromGrayscale(grid);
    const hashB = computeDHashFromGrayscale(grid);
    const distance = hammingDistanceHex(hashA, hashB);
    expect(distance).toBe(0);
    expect(similarityScoreFromHamming(distance)).toBe(100);
  });

  it("flags a resized/recompressed near-duplicate via high similarity score", () => {
    // Simulate "resized then re-saved": slight pixel value drift but same
    // overall gradient pattern, so the dHash bit pattern should mostly match.
    const original = Array.from({ length: 72 }, (_, i) => (i * 5) % 256);
    const recompressed = original.map((v) => Math.min(255, Math.max(0, v + 1))); // tiny noise

    const hashA = computeDHashFromGrayscale(original);
    const hashB = computeDHashFromGrayscale(recompressed);
    const matches = findVisualDuplicates([
      { filename: "001.jpg", dHash: hashA },
      { filename: "001_recompressed.jpg", dHash: hashB },
    ]);

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]!.similarity).toBeGreaterThanOrEqual(92);
  });

  it("does not flag genuinely different images", () => {
    const gridA = Array.from({ length: 72 }, () => 0);
    const gridB = Array.from({ length: 72 }, (_, i) => (i % 2 === 0 ? 255 : 0));
    const hashA = computeDHashFromGrayscale(gridA);
    const hashB = computeDHashFromGrayscale(gridB);
    const matches = findVisualDuplicates([
      { filename: "a.jpg", dHash: hashA },
      { filename: "b.jpg", dHash: hashB },
    ]);
    expect(matches).toHaveLength(0);
  });
});

describe("buildUploadPreviewReport", () => {
  it("marks a clean, fully-resolved upload as ready to publish", () => {
    const candidates = [
      candidate("001.jpg", 1, "a"),
      candidate("002.jpg", 2, "b"),
      candidate("003.jpg", 3, "c"),
    ];
    const report = buildUploadPreviewReport(candidates, []);
    expect(report.readyToPublish).toBe(true);
    expect(report.missingPages).toEqual([]);
  });

  it("blocks publish when pages are missing or duplicated", () => {
    const candidates = [
      candidate("001.jpg", 1, "a"),
      candidate("003.jpg", 3, "c"), // gap at 2
      candidate("003b.jpg", 3, "d"), // duplicate page number 3
    ];
    const report = buildUploadPreviewReport(candidates, []);
    expect(report.readyToPublish).toBe(false);
    expect(report.missingPages).toContain(2);
    expect(report.duplicatePageNumbers.length).toBeGreaterThan(0);
  });
});
