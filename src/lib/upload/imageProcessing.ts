import sharp from "sharp";
import { computeDHashFromGrayscale, sha256Hex } from "./duplicateDetection";
import { validateFile, type FileValidationResult, DEFAULT_VALIDATION_CONFIG, type FileValidationConfig } from "./fileValidation";

/**
 * IMAGE PROCESSING (spec section 15)
 * ---------------------------------------------------------------------------
 * The `sharp`-dependent adapter layer. Kept separate from
 * duplicateDetection.ts / fileValidation.ts so that module stays pure and
 * unit-testable without native bindings; this file is the thin, integration
 * boundary that actually decodes bytes.
 *
 * Pipeline per spec: validate -> strip metadata -> optimize -> resize ->
 * generate WebP -> generate thumbnail -> compute hashes.
 */

export interface ProcessImageConfig {
  /** Max long-edge dimension for the main reading image. */
  maxDimension: number;
  /** Thumbnail long-edge dimension, used in admin preview grids and cards. */
  thumbnailDimension: number;
  /** WebP quality, 1-100. */
  webpQuality: number;
  /** Whether to keep the original, unprocessed bytes in R2 alongside the optimized version. */
  keepOriginal: boolean;
  validation: FileValidationConfig;
}

export const DEFAULT_PROCESS_CONFIG: ProcessImageConfig = {
  maxDimension: 2400,
  thumbnailDimension: 320,
  webpQuality: 82,
  keepOriginal: false,
  validation: DEFAULT_VALIDATION_CONFIG,
};

export interface ProcessedImage {
  optimized: Buffer; // WebP, metadata-stripped, resized
  thumbnail: Buffer; // WebP, small
  original: Buffer | null; // only populated if config.keepOriginal
  width: number;
  height: number;
  sizeBytes: number;
  sha256: string; // of the ORIGINAL uploaded bytes (for exact-duplicate detection against source files)
  dHash: string; // perceptual hash, computed from decoded pixels of the ORIGINAL
  validation: FileValidationResult;
}

export class ImageProcessingError extends Error {
  constructor(message: string, public readonly validation: FileValidationResult) {
    super(message);
    this.name = "ImageProcessingError";
  }
}

/**
 * Decodes an image to an 8x8-difference grid (9x8 grayscale samples) and
 * computes its dHash via the pure function in duplicateDetection.ts. This is
 * the ONLY place actual pixel decoding happens for perceptual hashing.
 */
async function computeRealDHash(buffer: Buffer): Promise<string> {
  // dHash needs a 9x8 grid: 9 columns so we can diff each pixel against its
  // right-hand neighbor, producing 8 diff-bits per row across 8 rows = 64 bits.
  const { data } = await sharp(buffer)
    .grayscale()
    .resize(9, 8, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const grid = Array.from(data); // 72 grayscale byte values, row-major
  return computeDHashFromGrayscale(grid);
}

/**
 * Full processing pipeline for one uploaded page image.
 * Throws ImageProcessingError if the file fails validation — callers should
 * catch this and surface `error.validation.errors` to the admin, per spec
 * section 12 ("ห้ามลบอัตโนมัติ" applies here too: we never silently drop a
 * bad file, we reject it loudly with a reason).
 */
export async function processUploadedImage(
  filename: string,
  buffer: Buffer,
  config: ProcessImageConfig = DEFAULT_PROCESS_CONFIG
): Promise<ProcessedImage> {
  const metadata = await sharp(buffer)
    .metadata()
    .catch(() => null);

  const dimensions =
    metadata?.width && metadata?.height ? { width: metadata.width, height: metadata.height } : null;

  const validation = validateFile(filename, buffer, dimensions, config.validation);
  if (!validation.valid) {
    throw new ImageProcessingError(`Validation failed for "${filename}": ${validation.errors.join("; ")}`, validation);
  }

  // Strip metadata (EXIF/ICC/etc — section 15: "strip unnecessary metadata")
  // by default; sharp does this automatically unless .withMetadata() is
  // called, so simply NOT calling it is the strip step.
  const optimized = await sharp(buffer)
    .rotate() // apply EXIF orientation before stripping it, then discard EXIF
    .resize({ width: config.maxDimension, height: config.maxDimension, fit: "inside", withoutEnlargement: true })
    .webp({ quality: config.webpQuality })
    .toBuffer();

  const thumbnail = await sharp(buffer)
    .rotate()
    .resize({
      width: config.thumbnailDimension,
      height: config.thumbnailDimension,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 70 })
    .toBuffer();

  const optimizedMeta = await sharp(optimized).metadata();

  const [sha, dHash] = await Promise.all([
    Promise.resolve(sha256Hex(buffer)),
    computeRealDHash(buffer),
  ]);

  return {
    optimized,
    thumbnail,
    original: config.keepOriginal ? buffer : null,
    width: optimizedMeta.width ?? dimensions?.width ?? 0,
    height: optimizedMeta.height ?? dimensions?.height ?? 0,
    sizeBytes: optimized.length,
    sha256: sha,
    dHash,
    validation,
  };
}

/** Batch helper: processes many candidate pages, separating successes from rejects rather than throwing on first failure. */
export interface BatchProcessResult {
  succeeded: { filename: string; result: ProcessedImage }[];
  failed: { filename: string; errors: string[] }[];
}

export async function processUploadedImagesBatch(
  files: { filename: string; buffer: Buffer }[],
  config: ProcessImageConfig = DEFAULT_PROCESS_CONFIG
): Promise<BatchProcessResult> {
  const succeeded: BatchProcessResult["succeeded"] = [];
  const failed: BatchProcessResult["failed"] = [];

  for (const file of files) {
    try {
      const result = await processUploadedImage(file.filename, file.buffer, config);
      succeeded.push({ filename: file.filename, result });
    } catch (err) {
      if (err instanceof ImageProcessingError) {
        failed.push({ filename: file.filename, errors: err.validation.errors });
      } else {
        failed.push({ filename: file.filename, errors: [err instanceof Error ? err.message : String(err)] });
      }
    }
  }

  return { succeeded, failed };
}
