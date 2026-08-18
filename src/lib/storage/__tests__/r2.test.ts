import { describe, it, expect } from "vitest";
import { R2Client } from "../r2";

describe("R2Client static key builders", () => {
  it("builds a namespaced, zero-padded page key", () => {
    const key = R2Client.buildPageKey("manga_123", "chapter_456", 7, "optimized");
    expect(key).toBe("manga/manga_123/chapters/chapter_456/0007-web.webp");
  });

  it("builds distinct keys for original/optimized/thumbnail variants", () => {
    const original = R2Client.buildPageKey("m1", "c1", 1, "original");
    const optimized = R2Client.buildPageKey("m1", "c1", 1, "optimized");
    const thumb = R2Client.buildPageKey("m1", "c1", 1, "thumbnail");
    expect(new Set([original, optimized, thumb]).size).toBe(3);
  });

  it("pads page numbers so lexicographic and numeric sort agree", () => {
    const keys = [1, 10, 2, 100].map((n) => R2Client.buildPageKey("m", "c", n, "optimized"));
    const sorted = [...keys].sort();
    expect(sorted).toEqual([
      R2Client.buildPageKey("m", "c", 1, "optimized"),
      R2Client.buildPageKey("m", "c", 2, "optimized"),
      R2Client.buildPageKey("m", "c", 10, "optimized"),
      R2Client.buildPageKey("m", "c", 100, "optimized"),
    ]);
  });

  it("builds cover and ad creative keys", () => {
    expect(R2Client.buildCoverKey("manga_1")).toBe("manga/manga_1/cover.webp");
    expect(R2Client.buildAdCreativeKey("camp_1")).toBe("ads/camp_1/creative.webp");
  });
});

describe("R2Client construction — fails closed without credentials", () => {
  it("throws a clear error when env vars are missing, rather than silently using undefined credentials", () => {
    const savedEnv = { ...process.env };
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    delete process.env.R2_BUCKET_NAME;

    expect(() => new R2Client()).toThrow(/Missing required R2 environment variables/);

    process.env = savedEnv;
  });

  it("constructs successfully when explicit config is passed (no env dependency)", () => {
    expect(
      () =>
        new R2Client({
          accountId: "acc",
          accessKeyId: "key",
          secretAccessKey: "secret",
          bucketName: "bucket",
        })
    ).not.toThrow();
  });
});
