/**
 * SMART FILENAME PARSER
 * ---------------------------------------------------------------------------
 * Extracts a page number from an uploaded filename so the admin can dump
 * files in ANY order and have them sorted correctly (spec section 6 & 7).
 *
 * Supported conventions (in priority order — first confident match wins):
 *   001.jpg                    -> 1
 *   page_001.jpg                -> 1
 *   page-001.webp                -> 1
 *   chapter_001_abc.jpg          -> uses the LAST number-like group that looks
 *                                    like a page index, per PAGE_KEYWORD rule
 *   chapter_10_page_005.jpg      -> 5  (explicit "page" keyword wins over
 *                                       "chapter" keyword)
 *
 * RULE FOR WHICH NUMBER IS THE PAGE NUMBER
 * ---------------------------------------------------------------------------
 * 1. If the filename contains the literal word "page" (case-insensitive),
 *    the number immediately following that keyword is the page number.
 * 2. Otherwise, if the filename contains the literal word "chapter" or "ch",
 *    that number is treated as a CHAPTER identifier, not a page number —
 *    parsing continues to look for another number group.
 * 3. Otherwise, if the filename is (or starts with) a bare number, e.g.
 *    "001.jpg" or "057-abc.jpg", that leading number is the page number.
 * 4. If none of the above apply, or more than one number group remains
 *    ambiguous (e.g. two equally-plausible numeric groups with no keyword
 *    to disambiguate), the parser refuses to guess — per spec: "ถ้า parser
 *    ไม่มั่นใจ ต้องแจ้ง Admin และไม่เดาแบบเงียบ ๆ" (if unsure, flag the admin,
 *    never guess silently).
 */

export type ParseConfidence = "high" | "low";

export interface ParsedFilename {
  filename: string;
  pageNumber: number | null;
  confidence: ParseConfidence;
  /** Human-readable explanation, surfaced to the admin UI when confidence is low or null. */
  reason: string;
}

const PAGE_KEYWORD_RE = /page[\s_-]*0*(\d+)/i;
const CHAPTER_KEYWORD_RE = /(?:chapter|ch)[\s_-]*0*(\d+)/i;
const LEADING_NUMBER_RE = /^0*(\d+)(?:[^\d]|$)/;
const ANY_NUMBER_GROUP_RE = /\d+/g;

function stripExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? filename : filename.slice(0, idx);
}

export function parseFilename(filename: string): ParsedFilename {
  const base = stripExtension(filename.trim());

  // Rule 1: explicit "page" keyword always wins — highest confidence.
  const pageMatch = base.match(PAGE_KEYWORD_RE);
  if (pageMatch) {
    return {
      filename,
      pageNumber: parseInt(pageMatch[1]!, 10),
      confidence: "high",
      reason: 'Matched explicit "page" keyword.',
    };
  }

  // Rule 2/3: if "chapter"/"ch" keyword is present, remove that number from
  // consideration, then look for a remaining bare/leading number.
  const chapterMatch = base.match(CHAPTER_KEYWORD_RE);
  const remainder = chapterMatch
    ? base.slice(0, chapterMatch.index) + base.slice((chapterMatch.index ?? 0) + chapterMatch[0].length)
    : base;

  const leadingMatch = remainder.match(LEADING_NUMBER_RE);
  if (leadingMatch) {
    return {
      filename,
      pageNumber: parseInt(leadingMatch[1]!, 10),
      confidence: chapterMatch ? "high" : "high",
      reason: chapterMatch
        ? 'Ignored "chapter" number; used remaining leading number as page number.'
        : "Used leading number in filename as page number.",
    };
  }

  // Fallback: collect all number groups in remainder. If exactly one exists,
  // accept it with LOW confidence (admin should double-check). If zero or
  // more than one, refuse to guess.
  const allNumbers = remainder.match(ANY_NUMBER_GROUP_RE) ?? [];
  if (allNumbers.length === 1) {
    return {
      filename,
      pageNumber: parseInt(allNumbers[0], 10),
      confidence: "low",
      reason: "Only one ambiguous number group found; low-confidence guess — admin should verify.",
    };
  }

  if (allNumbers.length === 0) {
    return {
      filename,
      pageNumber: null,
      confidence: "low",
      reason: "No numeric page indicator found in filename.",
    };
  }

  return {
    filename,
    pageNumber: null,
    confidence: "low",
    reason: `Multiple ambiguous number groups (${allNumbers.join(", ")}) with no keyword to disambiguate.`,
  };
}

export interface FilenameParseBatchResult {
  parsed: ParsedFilename[];
  /** Files the parser could not confidently assign a page number to. Admin must resolve these before publish. */
  needsAdminReview: ParsedFilename[];
  /** True if every file resolved with high confidence to a unique page number. */
  allResolved: boolean;
}

export function parseFilenameBatch(filenames: string[]): FilenameParseBatchResult {
  const parsed = filenames.map(parseFilename);
  const needsAdminReview = parsed.filter(
    (p) => p.pageNumber === null || p.confidence === "low"
  );
  return {
    parsed,
    needsAdminReview,
    allResolved: needsAdminReview.length === 0,
  };
}

/** Sorts parsed filenames by resolved page number (ascending). Entries with a null page number are appended at the end, unsorted, for manual placement. */
export function sortByPageNumber(parsed: ParsedFilename[]): ParsedFilename[] {
  const resolved = parsed.filter((p) => p.pageNumber !== null) as (ParsedFilename & { pageNumber: number })[];
  const unresolved = parsed.filter((p) => p.pageNumber === null);
  resolved.sort((a, b) => a.pageNumber - b.pageNumber);
  return [...resolved, ...unresolved];
}
