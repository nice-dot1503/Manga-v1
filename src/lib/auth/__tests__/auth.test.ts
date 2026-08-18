import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../password";
import { generateSessionToken, hashSessionToken, safeCompareHashes } from "../session";

describe("password hashing (Argon2id)", () => {
  it("hashes a password and verifies the correct plaintext against it", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).not.toContain("correct horse battery staple"); // never stores plaintext
    expect(await verifyPassword(hash, "correct horse battery staple")).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword(hash, "wrong password")).toBe(false);
  });

  it("produces a different hash each time (random salt) even for the same password", async () => {
    const hashA = await hashPassword("same-password-123");
    const hashB = await hashPassword("same-password-123");
    expect(hashA).not.toBe(hashB);
  });

  it("rejects passwords shorter than the minimum length before even hashing", async () => {
    await expect(hashPassword("short")).rejects.toThrow(/at least 8 characters/);
  });

  it("verifyPassword returns false (not throw) for a malformed stored hash", async () => {
    await expect(verifyPassword("not-a-real-argon2-hash", "anything")).resolves.toBe(false);
  });
}, 20000);

describe("session tokens", () => {
  it("generates high-entropy, URL-safe tokens", () => {
    const token = generateSessionToken();
    expect(token.length).toBeGreaterThan(30);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates distinct tokens on each call", () => {
    const tokens = new Set(Array.from({ length: 20 }, () => generateSessionToken()));
    expect(tokens.size).toBe(20);
  });

  it("hashes tokens deterministically so the same raw token always looks up the same session", () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });

  it("different tokens hash to different values", () => {
    const a = hashSessionToken(generateSessionToken());
    const b = hashSessionToken(generateSessionToken());
    expect(a).not.toBe(b);
  });

  it("safeCompareHashes correctly matches equal hashes and rejects different-length ones", () => {
    const hash = hashSessionToken("some-token");
    expect(safeCompareHashes(hash, hash)).toBe(true);
    expect(safeCompareHashes(hash, "ab")).toBe(false);
  });
});
