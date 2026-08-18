import argon2 from "argon2";

/**
 * PASSWORD HASHING (spec section 21)
 * ---------------------------------------------------------------------------
 * Argon2id, per spec. Never store plaintext, never use a fast general-purpose
 * hash (MD5/SHA-family) for passwords.
 */

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // ~19 MiB, OWASP-recommended baseline for argon2id
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plaintext: string): Promise<string> {
  if (plaintext.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
  return argon2.hash(plaintext, ARGON2_OPTIONS);
}

/** Returns true/false; never throws on a wrong password (only on malformed hash input). */
export async function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    return false;
  }
}
