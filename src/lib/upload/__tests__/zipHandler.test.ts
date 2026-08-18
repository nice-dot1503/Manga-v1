import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { extractZipSafely, DEFAULT_ZIP_CONFIG } from "../zipHandler";

async function buildZip(entries: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.file(name, content);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

/**
 * JSZip's own `file()`/`generateAsync` API resolves "../" segments away when
 * *writing* a zip, so a zip-slip attack can't actually be represented by
 * round-tripping through JSZip's high-level API — real malicious zips are
 * crafted by attacker tooling that writes raw ZIP local-file-header entries
 * without that sanitization. This helper builds a minimal STORE-method
 * (uncompressed) ZIP by hand so the test exercises `extractZipSafely`
 * against a genuinely traversal-laden entry name, the way a real malicious
 * archive would look on disk.
 */
function buildRawZip(rawEntries: { name: string; content: string }[]): Buffer {
  const localEntries: Buffer[] = [];
  const centralEntries: Buffer[] = [];
  let offset = 0;

  for (const { name, content } of rawEntries) {
    const nameBuf = Buffer.from(name, "utf8");
    const dataBuf = Buffer.from(content, "utf8");
    const crc = zlibCrc32(dataBuf);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8); // method = STORE
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(dataBuf.length, 18);
    localHeader.writeUInt32LE(dataBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const localEntry = Buffer.concat([localHeader, nameBuf, dataBuf]);
    localEntries.push(localEntry);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(dataBuf.length, 20);
    centralHeader.writeUInt32LE(dataBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    const centralEntry = Buffer.concat([centralHeader, nameBuf]);
    centralEntries.push(centralEntry);

    offset += localEntry.length;
  }

  const localSection = Buffer.concat(localEntries);
  const centralSection = Buffer.concat(centralEntries);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(rawEntries.length, 8);
  eocd.writeUInt16LE(rawEntries.length, 10);
  eocd.writeUInt32LE(centralSection.length, 12);
  eocd.writeUInt32LE(localSection.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localSection, centralSection, eocd]);
}

// Minimal CRC32 implementation (no external dep needed for this test helper).
function zlibCrc32(buf: Buffer): number {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

describe("extractZipSafely", () => {
  it("extracts normal chapter pages", async () => {
    const zipBuffer = await buildZip({
      "001.jpg": "page-one-bytes",
      "002.jpg": "page-two-bytes",
      "003.jpg": "page-three-bytes",
    });
    const result = await extractZipSafely(zipBuffer);
    expect(result.entries).toHaveLength(3);
    expect(result.entries.map((e) => e.filename).sort()).toEqual(["001.jpg", "002.jpg", "003.jpg"]);
    expect(result.rejectedEntries).toHaveLength(0);
  });

  it("rejects absolute-path Zip Slip entries", async () => {
    // Built with a raw hand-crafted ZIP (see buildRawZip). JSZip's own
    // write path resolves "../" segments away when *you* build the archive
    // through its API, but a raw archive crafted by attacker tooling can
    // still carry an absolute path in the entry name, and JSZip preserves
    // that on load — this is exactly what extractZipSafely must catch.
    const zipBuffer = buildRawZip([
      { name: "001.jpg", content: "legit" },
      { name: "/etc/passwd", content: "malicious payload" },
    ]);
    const result = await extractZipSafely(zipBuffer);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.filename).toBe("001.jpg");
    expect(result.rejectedEntries).toHaveLength(1);
    expect(result.rejectedEntries[0]!.reason).toContain("traversal");
  });

  it("neutralizes relative '../' segments (defense-in-depth, on top of JSZip's own normalization)", async () => {
    // When entries are built through JSZip's own file()/generateAsync API,
    // JSZip itself resolves "../../etc/passwd" down to a safe relative path
    // ("etc/passwd") before extractZipSafely ever sees it. We assert that
    // outcome here so this safety property is pinned by a test, not just
    // assumed.
    const zipBuffer = await buildZip({
      "001.jpg": "legit",
      "../../etc/passwd": "gets normalized by JSZip itself",
    });
    const result = await extractZipSafely(zipBuffer);
    const filenames = result.entries.map((e) => e.filename);
    expect(filenames).toContain("001.jpg");
    // Whatever JSZip normalized the traversal entry to, our own basename()
    // extraction must never contain ".." or a path separator.
    for (const f of filenames) {
      expect(f.includes("..")).toBe(false);
      expect(f.includes("/")).toBe(false);
    }
  });

  it("skips macOS/Windows junk metadata files silently", async () => {
    const zipBuffer = await buildZip({
      "001.jpg": "legit",
      ".DS_Store": "junk",
      "Thumbs.db": "junk",
    });
    const result = await extractZipSafely(zipBuffer);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.filename).toBe("001.jpg");
  });

  it("rejects a single file exceeding the per-file size limit", async () => {
    const zipBuffer = await buildZip({
      "huge.jpg": Buffer.alloc(DEFAULT_ZIP_CONFIG.maxSingleFileBytes + 1),
    });
    const result = await extractZipSafely(zipBuffer);
    expect(result.entries).toHaveLength(0);
    expect(result.rejectedEntries).toHaveLength(1);
    expect(result.rejectedEntries[0]!.reason).toContain("per-file size limit");
  });

  it("throws when file count exceeds the configured limit", async () => {
    const entries: Record<string, string> = {};
    for (let i = 0; i < 5; i++) entries[`${i}.jpg`] = "x";
    const zipBuffer = await buildZip(entries);
    await expect(
      extractZipSafely(zipBuffer, { ...DEFAULT_ZIP_CONFIG, maxFileCount: 3 })
    ).rejects.toThrow(/exceeding the limit/);
  });
});
