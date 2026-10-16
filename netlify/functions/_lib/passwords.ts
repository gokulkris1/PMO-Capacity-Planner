/**
 * Passwords (HS-13). Existing bcrypt hashes are verified as they are (any cost, $2a/$2b), never rewritten on login,
 * so every current user signs in exactly as before. New passwords need 10+ characters and are hashed at cost 12.
 */
import bcrypt from 'bcryptjs';
import { badRequest } from './errors';

export const MIN_PASSWORD = 10;
export const PASSWORD_MESSAGE = 'Use at least 10 characters.';
/** Cost 12 for new hashes; Jest (NODE_ENV=test) uses 4 to keep the suite fast. */
const NEW_HASH_COST = process.env.NODE_ENV === 'test' ? 4 : 12;

export function assertNewPassword(pw: unknown, field = 'password'): string {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD)
    throw badRequest(PASSWORD_MESSAGE, { [field]: PASSWORD_MESSAGE });
  if (pw.length > 200) throw badRequest('Use at most 200 characters.', { [field]: 'Use at most 200 characters.' });
  return pw;
}

export function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, NEW_HASH_COST);
}

let dummyHash: string | null = null;

/** Compares against the stored hash, or a fixed dummy hash when the user does not exist (same timing). */
export async function verifyPassword(pw: unknown, hash: string | null | undefined): Promise<boolean> {
  const candidate = typeof pw === 'string' ? pw : '';
  if (!hash) {
    if (!dummyHash) dummyHash = bcrypt.hashSync('timing-equaliser-not-a-password', 10);
    await bcrypt.compare(candidate, dummyHash);
    return false;
  }
  try {
    return await bcrypt.compare(candidate, hash);
  } catch {
    return false;
  }
}
