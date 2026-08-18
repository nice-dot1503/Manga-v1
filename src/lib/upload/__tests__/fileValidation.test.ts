import { describe, it, expect } from "vitest";
import { validateFile, isMaliciousFilename, DEFAULT_VALIDATION_CONFIG } from "../fileValidation";

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const WEBP_MAGIC = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("WEBP"),
]);
const FAKE_TEXT_FILE = Buffer.from("<script>alert(1)</script>");

describe("validateFile — magic byte detection (never trusts client MIME)", () => {
  it("accepts a real JPEG by signature", () => {
    const result = validateFile("001.jpg", JPEG_MAGIC, { width: 800, height: 1200 });
    expect(result.valid).toBe(true);
    expect(result.detectedFormat).toBe("jpeg");
  });

  it("accepts a real PNG by signature", () => {
    const result = validateFile("001.png", PNG_MAGIC, { width: 800, height: 1200 });
    expect(result.valid).toBe(true);
    expect(result.detectedFormat).toBe("png");
  });

  it("accepts a real WebP by signature", () => {
    const result = validateFile("001.webp", WEBP_MAGIC, { width: 800, height: 1200 });
    expect(result.valid).toBe(true);
    expect(result.detectedFormat).toBe("webp");
  });

  it("rejects a file whose extension lies about its content", () => {
    // Renamed .html/.js content to look like a .jpg — must fail on magic bytes, not filename.
    const result = validateFile("totally-a-real.jpg", FAKE_TEXT_FILE, null);
    expect(result.valid).toBe(false);
    expect(result.detectedFormat).toBeNull();
    expect(result.errors.some((e) => e.includes("signature"))).toBe(true);
  });

  it("rejects zero-byte files", () => {
    const result = validateFile("empty.jpg", Buffer.alloc(0), null);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Zero-byte"))).toBe(true);
  });

  it("rejects oversized files", () => {
    const oversized = Buffer.concat([JPEG_MAGIC, Buffer.alloc(DEFAULT_VALIDATION_CONFIG.maxSizeBytes)]);
    const result = validateFile("huge.jpg", oversized, null);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("exceeds max size"))).toBe(true);
  });

  it("rejects a decompression-bomb-shaped image (huge pixel count, tiny file)", () => {
    const result = validateFile("bomb.png", PNG_MAGIC, { width: 50000, height: 50000 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("decompression bomb"))).toBe(true);
  });

  it("rejects invalid (zero/negative) dimensions", () => {
    const result = validateFile("bad-dims.jpg", JPEG_MAGIC, { width: 0, height: 100 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Invalid image dimensions"))).toBe(true);
  });
});

describe("isMaliciousFilename", () => {
  it("flags path traversal attempts", () => {
    expect(isMaliciousFilename("../../etc/passwd")).toBe(true);
    expect(isMaliciousFilename("..\\..\\windows\\system32")).toBe(true);
  });

  it("flags path separators", () => {
    expect(isMaliciousFilename("subdir/file.jpg")).toBe(true);
  });

  it("allows normal page filenames", () => {
    expect(isMaliciousFilename("page_001.jpg")).toBe(false);
    expect(isMaliciousFilename("chapter-10-page-005.webp")).toBe(false);
  });
});
