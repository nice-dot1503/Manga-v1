import { describe, it, expect, beforeEach, afterEach } from "vitest";
import argon2 from "argon2";
import { verifyAdminPassword, issueAdminToken, verifyAdminToken } from "../adminPasswordAuth";

const REAL_PASSWORD = "correct-horse-battery-staple";
let originalHash: string | undefined;
let originalSecret: string | undefined;

beforeEach(async () => {
  originalHash = process.env.ADMIN_PASSWORD_HASH;
  originalSecret = process.env.ADMIN_SESSION_SECRET;
  process.env.ADMIN_PASSWORD_HASH = await argon2.hash(REAL_PASSWORD, { type: argon2.argon2id });
  process.env.ADMIN_SESSION_SECRET = "a-sufficiently-long-random-test-secret-value";
}, 20000);

afterEach(() => {
  if (originalHash === undefined) delete process.env.ADMIN_PASSWORD_HASH;
  else process.env.ADMIN_PASSWORD_HASH = originalHash;
  if (originalSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
  else process.env.ADMIN_SESSION_SECRET = originalSecret;
});

describe("verifyAdminPassword", () => {
  it("accepts the correct password", async () => {
    expect(await verifyAdminPassword(REAL_PASSWORD)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    expect(await verifyAdminPassword("wrong-password")).toBe(false);
  });

  it("throws a clear configuration error when ADMIN_PASSWORD_HASH is unset", async () => {
    delete process.env.ADMIN_PASSWORD_HASH;
    await expect(verifyAdminPassword("anything")).rejects.toThrow(/ADMIN_PASSWORD_HASH is not configured/);
  });
}, 20000);

describe("admin session token", () => {
  it("issues a token that verifies successfully", () => {
    const token = issueAdminToken();
    expect(verifyAdminToken(token)).toBe(true);
  });

  it("rejects a tampered token", () => {
    const token = issueAdminToken();
    const [payload] = token.split(".");
    const tampered = `${payload}.deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdead`;
    expect(verifyAdminToken(tampered)).toBe(false);
  });

  it("rejects a token signed with a different secret", () => {
    const token = issueAdminToken();
    process.env.ADMIN_SESSION_SECRET = "a-totally-different-secret-value-here";
    expect(verifyAdminToken(token)).toBe(false);
  });

  it("rejects undefined/empty tokens", () => {
    expect(verifyAdminToken(undefined)).toBe(false);
    expect(verifyAdminToken(null)).toBe(false);
    expect(verifyAdminToken("")).toBe(false);
  });

  it("rejects a malformed token missing the signature part", () => {
    expect(verifyAdminToken("just-a-payload-no-dot")).toBe(false);
  });
});
