/**
 * FILE INTEGRITY VALIDATION (spec section 12)
 * ---------------------------------------------------------------------------
 * Never trusts the Content-Type/MIME header sent by the client. Every file
 * is validated server-side against its magic bytes (file signature) before
 * being treated as a real image.
 */

export type SupportedImageFormat = "jpeg" | "png" | "webp" | "avif";

export interface FileValidationResult {
  valid: boolean;
  detectedFormat: SupportedImageFormat | null;
  errors: string[];
}

export interface FileValidationConfig {
  maxSizeBytes: number; // hard cap on compressed/upload size
  maxPixelCount: number; // width * height cap, guards against decompression bombs
  allowAvif: boolean;
}

export const DEFAULT_VALIDATION_CONFIG: FileValidationConfig = {
  maxSizeBytes: 20 * 1024 * 1024, // 20MB per page
  maxPixelCount: 60_000_000, // ~60 megapixels — generous for scans, blocks bombs
  allowAvif: false,
};

// Magic byte signatures. WebP needs both the RIFF header and the WEBP fourCC
// at offset 8 to avoid false-positives against other RIFF containers.
function detectFormatFromMagicBytes(buffer: Buffer): SupportedImageFormat | null {
  if (buffer.length < 12) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpeg";
  }

  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "png";
  }

  if (
    buffer[0] === 0x52 && // R
    buffer[1] === 0x49 && // I
    buffer[2] === 0x46 && // F
    buffer[3] === 0x46 && // F
    buffer[8] === 0x57 && // W
    buffer[9] === 0x45 && // E
    buffer[10] === 0x42 && // B
    buffer[11] === 0x50 // P
  ) {
    return "webp";
  }

  // AVIF: ISO BMFF container, ftyp box with 'avif'/'avis' brand at offset 4-11.
  if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp") {
    const brand = buffer.toString("ascii", 8, 12);
    if (brand === "avif" || brand === "avis") return "avif";
  }

  return null;
}

/** Rejects filenames that look like traversal attempts or contain unsafe characters. */
export function isMaliciousFilename(filename: string): boolean {
  if (filename.includes("..")) return true;
  if (filename.includes("/") || filename.includes("\\")) return true;
  if (filename.includes("\0")) return true;
  // Control characters
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(filename)) return true;
  if (filename.length > 255) return true;
  return false;
}

export interface ImageDimensions {
  width: number;
  height: number;
}

export function validateFile(
  filename: string,
  buffer: Buffer,
  dimensions: ImageDimensions | null,
  config: FileValidationConfig = DEFAULT_VALIDATION_CONFIG
): FileValidationResult {
  const errors: string[] = [];

  if (buffer.length === 0) {
    errors.push("Zero-byte file.");
  }

  if (buffer.length > config.maxSizeBytes) {
    errors.push(
      `File exceeds max size (${buffer.length} bytes > ${config.maxSizeBytes} bytes).`
    );
  }

  if (isMaliciousFilename(filename)) {
    errors.push("Filename contains unsafe or traversal-like characters.");
  }

  const detectedFormat = buffer.length > 0 ? detectFormatFromMagicBytes(buffer) : null;

  if (!detectedFormat) {
    errors.push("Unrecognized or unsupported file signature (magic bytes did not match any allowed format).");
  } else if (detectedFormat === "avif" && !config.allowAvif) {
    errors.push("AVIF is disabled by current configuration.");
  }

  if (dimensions) {
    if (dimensions.width <= 0 || dimensions.height <= 0) {
      errors.push("Invalid image dimensions (zero or negative).");
    } else if (dimensions.width * dimensions.height > config.maxPixelCount) {
      errors.push(
        `Image pixel count exceeds limit — possible decompression bomb (${dimensions.width}x${dimensions.height}).`
      );
    }
  }

  return {
    valid: errors.length === 0,
    detectedFormat,
    errors,
  };
}
