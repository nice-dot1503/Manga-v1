import { z } from "zod";

/**
 * Request/response schemas for the admin upload-preview flow.
 * Every admin API validates its input with these before touching any
 * business logic (spec section 20 — schema validation on every API).
 */

export const uploadPreviewRequestSchema = z.object({
  chapterId: z.string().cuid(),
  strictMode: z.boolean().default(true),
  // Files themselves arrive as multipart/form-data in the actual route
  // handler; this schema validates the accompanying JSON metadata only.
});

export const resolvePageConflictSchema = z.object({
  chapterId: z.string().cuid(),
  action: z.enum(["keep_first", "keep_second", "keep_both", "cancel"]),
  targetFilenames: z.array(z.string()).min(1).max(2),
});

export const publishChapterSchema = z.object({
  chapterId: z.string().cuid(),
  // Admin must explicitly confirm they've reviewed the preview report.
  confirmedReview: z.literal(true),
});

export type UploadPreviewRequest = z.infer<typeof uploadPreviewRequestSchema>;
export type ResolvePageConflictRequest = z.infer<typeof resolvePageConflictSchema>;
export type PublishChapterRequest = z.infer<typeof publishChapterSchema>;
