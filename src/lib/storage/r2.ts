import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * CLOUDFLARE R2 CLIENT (spec section 16)
 * ---------------------------------------------------------------------------
 * R2 is S3-compatible, so we use the standard AWS SDK v3 pointed at R2's
 * endpoint. Design per spec:
 *
 *   Browser -> Cloudflare -> secure image endpoint / Worker -> authorization -> R2
 *
 * This module is that "secure image endpoint" layer. The bucket itself
 * should NOT be public — every read goes through `getSignedReadUrl`, which
 * mints a short-lived, scoped URL. Nothing here ever exposes
 * R2_SECRET_ACCESS_KEY to a caller; it's read once from env at client
 * construction and never returned.
 */

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
}

function loadR2ConfigFromEnv(): R2Config {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;

  const missing = [
    ["R2_ACCOUNT_ID", accountId],
    ["R2_ACCESS_KEY_ID", accessKeyId],
    ["R2_SECRET_ACCESS_KEY", secretAccessKey],
    ["R2_BUCKET_NAME", bucketName],
  ].filter(([, v]) => !v);

  if (missing.length > 0) {
    throw new Error(
      `Missing required R2 environment variables: ${missing.map(([k]) => k).join(", ")}. See .env.example.`
    );
  }

  return {
    accountId: accountId!,
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
    bucketName: bucketName!,
  };
}

export class R2Client {
  private readonly s3: S3Client;
  private readonly bucketName: string;

  constructor(config?: R2Config) {
    const cfg = config ?? loadR2ConfigFromEnv();
    this.bucketName = cfg.bucketName;
    this.s3 = new S3Client({
      region: "auto",
      endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
    });
  }

  /** Uploads an object. Callers should pass an already-namespaced key, e.g. `manga/{mangaId}/chapter/{chapterId}/{pageNumber}.webp`. */
  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: body,
        ContentType: contentType,
        // Bucket-level ACL should already be private; this is defense-in-depth.
        ACL: undefined,
      })
    );
  }

  async deleteObject(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: key }));
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucketName, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Mints a short-lived signed URL for reading a private object. This is the
   * ONLY way page images should reach the browser — never make the bucket
   * public (spec section 16: "ห้ามเปิด bucket ให้ public โดยไม่จำเป็น").
   */
  async getSignedReadUrl(key: string, expiresInSeconds = 300): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucketName, Key: key });
    return getSignedUrl(this.s3, command, { expiresIn: expiresInSeconds });
  }

  /** Builds a namespaced object key for a manga page. Centralized here so the layout convention lives in exactly one place. */
  static buildPageKey(mangaId: string, chapterId: string, pageNumber: number, variant: "original" | "optimized" | "thumbnail"): string {
    const padded = String(pageNumber).padStart(4, "0");
    const suffix = variant === "original" ? "orig" : variant === "thumbnail" ? "thumb" : "web";
    return `manga/${mangaId}/chapters/${chapterId}/${padded}-${suffix}.webp`;
  }

  static buildCoverKey(mangaId: string): string {
    return `manga/${mangaId}/cover.webp`;
  }

  static buildAdCreativeKey(campaignId: string): string {
    return `ads/${campaignId}/creative.webp`;
  }
}

/** Lazily-constructed singleton for app code paths that just want "the" R2 client from env. Route handlers/tests can still construct their own R2Client(config) directly. */
let sharedClient: R2Client | null = null;
export function getR2Client(): R2Client {
  if (!sharedClient) sharedClient = new R2Client();
  return sharedClient;
}
