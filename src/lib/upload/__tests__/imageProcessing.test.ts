import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { processUploadedImage, processUploadedImagesBatch, ImageProcessingError } from "../imageProcessing";
import { findVisualDuplicates } from "../duplicateDetection";

/** Builds a synthetic JPEG/PNG with a simple gradient so it has real, hashable structure (not a flat color). */
async function buildGradientImage(
  width: number,
  height: number,
  format: "jpeg" | "png" = "png"
): Promise<Buffer> {
  const channels = 3;
  const raw = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels;
      raw[idx] = Math.floor((x / width) * 255); // R gradient left->right
      raw[idx + 1] = Math.floor((y / height) * 255); // G gradient top->bottom
      raw[idx + 2] = 128;
    }
  }
  const img = sharp(raw, { raw: { width, height, channels } });
  return format === "jpeg" ? img.jpeg().toBuffer() : img.png().toBuffer();
}

describe("processUploadedImage", () => {
  it("processes a valid PNG: validates, optimizes to WebP, generates thumbnail, computes hashes", async () => {
    const buffer = await buildGradientImage(1000, 1400, "png");
    const result = await processUploadedImage("001.png", buffer);

    expect(result.validation.valid).toBe(true);
    expect(result.optimized.length).toBeGreaterThan(0);
    expect(result.thumbnail.length).toBeGreaterThan(0);
    expect(result.thumbnail.length).toBeLessThan(result.optimized.length);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.dHash).toMatch(/^[0-9a-f]{16}$/);
    expect(result.original).toBeNull(); // keepOriginal defaults to false
  });

  it("downsizes images larger than maxDimension", async () => {
    const buffer = await buildGradientImage(4000, 3000, "jpeg");
    const result = await processUploadedImage("big.jpg", buffer, {
      maxDimension: 800,
      thumbnailDimension: 200,
      webpQuality: 80,
      keepOriginal: false,
      validation: { maxSizeBytes: 50 * 1024 * 1024, maxPixelCount: 100_000_000, allowAvif: false },
    });
    expect(result.width).toBeLessThanOrEqual(800);
    expect(result.height).toBeLessThanOrEqual(800);
  });

  it("rejects a corrupted/non-image buffer with a clear error, does not throw an opaque exception", async () => {
    const garbage = Buffer.from("this is not an image, just text pretending to be one");
    await expect(processUploadedImage("fake.jpg", garbage)).rejects.toThrow(ImageProcessingError);
  });

  it("retains the original buffer only when keepOriginal is true", async () => {
    const buffer = await buildGradientImage(500, 700, "png");
    const result = await processUploadedImage("001.png", buffer, {
      maxDimension: 2400,
      thumbnailDimension: 320,
      webpQuality: 82,
      keepOriginal: true,
      validation: { maxSizeBytes: 50 * 1024 * 1024, maxPixelCount: 100_000_000, allowAvif: false },
    });
    expect(result.original).not.toBeNull();
    expect(result.original?.equals(buffer)).toBe(true);
  });
});

describe("perceptual hash integration — real resize/recompress scenario", () => {
  it("flags a genuinely resized+recompressed copy of the same page as a visual duplicate", async () => {
    const original = await buildGradientImage(1200, 1600, "png");
    const originalResult = await processUploadedImage("057.jpg", original);

    // Simulate an admin re-uploading the same page after it was resized and
    // re-saved as JPEG elsewhere — different bytes, different SHA-256, same
    // visual content.
    const resized = await sharp(original).resize(600, 800).jpeg({ quality: 85 }).toBuffer();
    const resizedResult = await processUploadedImage("057_resaved.jpg", resized);

    expect(originalResult.sha256).not.toBe(resizedResult.sha256); // exact hash differs, as expected

    const matches = findVisualDuplicates([
      { filename: "057.jpg", dHash: originalResult.dHash },
      { filename: "057_resaved.jpg", dHash: resizedResult.dHash },
    ]);

    expect(matches.length).toBe(1);
    expect(matches[0]!.similarity).toBeGreaterThanOrEqual(90);
  });

  it("does not flag two genuinely different page images as visual duplicates", async () => {
    const pageA = await buildGradientImage(800, 1200, "png");
    // Different gradient orientation/content -> should hash very differently.
    const rawB = Buffer.alloc(800 * 1200 * 3);
    for (let y = 0; y < 1200; y++) {
      for (let x = 0; x < 800; x++) {
        const idx = (y * 800 + x) * 3;
        rawB[idx] = (x % 2 === 0 ? 255 : 0);
        rawB[idx + 1] = (y % 2 === 0 ? 255 : 0);
        rawB[idx + 2] = 0;
      }
    }
    const pageB = await sharp(rawB, { raw: { width: 800, height: 1200, channels: 3 } }).png().toBuffer();

    const resultA = await processUploadedImage("001.png", pageA);
    const resultB = await processUploadedImage("002.png", pageB);

    const matches = findVisualDuplicates([
      { filename: "001.png", dHash: resultA.dHash },
      { filename: "002.png", dHash: resultB.dHash },
    ]);
    expect(matches).toHaveLength(0);
  });
});

describe("processUploadedImagesBatch", () => {
  it("separates successes from failures instead of aborting the whole batch", async () => {
    const goodImage = await buildGradientImage(600, 800, "png");
    const badImage = Buffer.from("not an image");

    const result = await processUploadedImagesBatch([
      { filename: "001.png", buffer: goodImage },
      { filename: "002.png", buffer: badImage },
    ]);

    expect(result.succeeded).toHaveLength(1);
    expect(result.succeeded[0]!.filename).toBe("001.png");
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.filename).toBe("002.png");
  });
});
