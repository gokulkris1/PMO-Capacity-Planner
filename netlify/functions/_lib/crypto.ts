/**
 * Hashing, random tokens and integration-secret encryption (HS-09, SEC-12).
 * New secrets: `v2:iv:tag:ct`, AES-256-GCM with INTEGRATIONS_ENC_KEY (32 bytes, base64).
 * Legacy secrets: `iv:tag:ct` with sha256(JWT_SECRET + ':integrations'); still decrypted, never written.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { serviceUnavailable } from './errors';
import { log } from './log';

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** URL-safe random token (default 32 bytes). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

function legacyKey(): Buffer {
  return createHash('sha256')
    .update(`${process.env.JWT_SECRET ?? ''}:integrations`)
    .digest();
}

function v2Key(): Buffer | null {
  const raw = process.env.INTEGRATIONS_ENC_KEY;
  if (!raw || !raw.trim()) return null;
  const key = Buffer.from(raw.trim(), 'base64');
  if (key.length !== 32) {
    log('error', { event: 'crypto.bad_key', message: 'INTEGRATIONS_ENC_KEY must be 32 bytes, base64' });
    return null;
  }
  return key;
}

export function hasEncryptionKey(): boolean {
  return v2Key() !== null;
}

/** HS-09#AC1/AC4: writes fail closed (503) without INTEGRATIONS_ENC_KEY. */
export function encryptSecret(plain: string): string {
  const key = v2Key();
  if (!key) {
    throw serviceUnavailable(
      'Saving credentials is not configured. Ask your administrator to set the integration encryption key.',
      'INTEGRATIONS_ENC_KEY missing or invalid',
    );
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v2:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(':');
  let key: Buffer;
  let ivB: string, tagB: string, ctB: string;
  if (parts.length === 4 && parts[0] === 'v2') {
    const k = v2Key();
    if (!k)
      throw serviceUnavailable('Stored credentials cannot be read.', 'INTEGRATIONS_ENC_KEY missing for v2 secret');
    key = k;
    [, ivB, tagB, ctB] = parts;
  } else if (parts.length === 3) {
    key = legacyKey();
    [ivB, tagB, ctB] = parts;
  } else {
    throw new Error('Malformed encrypted secret');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64')), decipher.final()]).toString('utf8');
}

export function isLegacySecret(payload: string | null | undefined): boolean {
  return !!payload && payload.split(':').length === 3;
}
