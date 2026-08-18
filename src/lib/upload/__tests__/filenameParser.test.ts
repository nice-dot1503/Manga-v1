import { describe, it, expect } from "vitest";
import { parseFilename, parseFilenameBatch, sortByPageNumber } from "../filenameParser";

describe("parseFilename", () => {
  it("parses bare numbered files", () => {
    expect(parseFilename("001.jpg").pageNumber).toBe(1);
    expect(parseFilename("057.jpg").pageNumber).toBe(57);
    expect(parseFilename("100.jpg").pageNumber).toBe(100);
  });

  it("parses page_XXX convention", () => {
    expect(parseFilename("page_001.jpg").pageNumber).toBe(1);
    expect(parseFilename("page_002.jpg").pageNumber).toBe(2);
  });

  it("parses page-XXX convention with different extension", () => {
    expect(parseFilename("page-001.webp").pageNumber).toBe(1);
    expect(parseFilename("page-002.webp").pageNumber).toBe(2);
  });

  it("resolves chapter_XXX_page_YYY by preferring the page keyword", () => {
    expect(parseFilename("chapter_10_page_005.jpg").pageNumber).toBe(5);
  });

  it("ignores chapter number and finds remaining bare number", () => {
    const result = parseFilename("chapter_001_abc.jpg");
    // "chapter_001" is stripped as the chapter identifier; "abc" has no digits,
    // so parser should fail to find a page number and flag for review.
    expect(result.pageNumber).toBeNull();
  });

  it("flags fully ambiguous filenames rather than guessing silently", () => {
    const result = parseFilename("scan_2024_v2.jpg");
    expect(result.pageNumber).toBeNull();
    expect(result.confidence).toBe("low");
  });

  it("high confidence match does not require admin review in batch mode", () => {
    const batch = parseFilenameBatch(["001.jpg", "002.jpg", "page_003.jpg"]);
    expect(batch.allResolved).toBe(true);
    expect(batch.needsAdminReview).toHaveLength(0);
  });

  it("flags ambiguous files for admin review in batch mode", () => {
    const batch = parseFilenameBatch(["001.jpg", "final_v2.jpg"]);
    expect(batch.allResolved).toBe(false);
    expect(batch.needsAdminReview).toHaveLength(1);
    expect(batch.needsAdminReview[0]!.filename).toBe("final_v2.jpg");
  });

  it("sorts out-of-order uploads into correct page order", () => {
    const files = ["057.jpg", "003.jpg", "021.jpg", "001.jpg", "100.jpg", "005.jpg", "002.jpg"];
    const parsed = files.map(parseFilename);
    const sorted = sortByPageNumber(parsed);
    expect(sorted.map((p) => p.filename)).toEqual([
      "001.jpg",
      "002.jpg",
      "003.jpg",
      "005.jpg",
      "021.jpg",
      "057.jpg",
      "100.jpg",
    ]);
  });
});
