#!/usr/bin/env node
/**
 * Usage: node scripts/hash-admin-password.mjs "your-password-here"
 * Prints an Argon2id hash to paste into ADMIN_PASSWORD_HASH in your .env.
 * Never commit the plaintext password or paste it anywhere other than
 * generating this hash once.
 */
import argon2 from "argon2";

const password = process.argv[2];

if (!password) {
  console.error("Usage: node scripts/hash-admin-password.mjs \"your-password\"");
  process.exit(1);
}

if (password.length < 10) {
  console.error("Choose a password of at least 10 characters — this single password guards your whole admin panel.");
  process.exit(1);
}

const hash = await argon2.hash(password, {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
});

console.log("\nAdd this line to your .env / .env.local:\n");
console.log(`ADMIN_PASSWORD_HASH="${hash}"\n`);
