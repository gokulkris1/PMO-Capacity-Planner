#!/usr/bin/env node
/**
 * HS-16#AC3 / CA-6 / SEC-28: did production ever sign tokens with a historical hard-coded fallback secret?
 *   JWT_SECRET=<production value> node scripts/check_jwt_fallback.mjs
 * Compares SHA-256 hashes only and prints "match: <which>" or "no match". It never prints the secret.
 * The fallback strings themselves are not stored here, only their hashes (removed in commit 957fa69).
 */
import { createHash, timingSafeEqual } from 'node:crypto';

const FALLBACK_HASHES = {
  'fallback #1 (super_secret_… dev-only key)': '554baefa472246bad207c0e2aedf35e53bae3e13222d8c9c460958f916cfb966',
  'fallback #2 (dev_secret_… change-in-prod key)': '91934cba5f8c84ffae666a96a7c5eed03bcb9795f9d59306bee3603436494a98',
};

const secret = process.env.JWT_SECRET;
if (!secret) {
  console.error('Set JWT_SECRET in the environment (it is never printed).');
  process.exit(2);
}
const digest = createHash('sha256').update(secret).digest();
const match = Object.entries(FALLBACK_HASHES).find(([, hex]) => timingSafeEqual(digest, Buffer.from(hex, 'hex')));
console.log(match ? `match: ${match[0]}` : 'no match');
process.exit(match ? 1 : 0);
