/**
 * Fixed-window rate limiting in Postgres (HS-05#AC3-4). One upsert per check; 429 with Retry-After when exceeded.
 */
import { randomInt } from 'node:crypto';
import type { Queryable } from './db';
import { rateLimited } from './errors';

export interface LimitRule {
  key: string;
  max: number;
  windowSec: number;
}

/** Counts one hit against each rule and throws 429 if any rule is exceeded. */
export async function rateLimit(q: Queryable, rules: LimitRule[], message?: string): Promise<void> {
  for (const rule of rules) {
    if (!rule.key) continue;
    const now = Date.now();
    const windowMs = rule.windowSec * 1000;
    const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
    const rows = await q.query<{ count: number }>(
      `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, $2, 1)
       ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
       RETURNING count`,
      [rule.key, windowStart.toISOString()],
    );
    const count = Number(rows[0]?.count ?? 0);
    if (count > rule.max) {
      const retryAfter = Math.ceil((windowStart.getTime() + windowMs - now) / 1000);
      const minutes = Math.max(1, Math.ceil(retryAfter / 60));
      throw rateLimited(message ?? `Too many attempts. Try again in ${minutes} minutes.`, retryAfter);
    }
  }
  // Opportunistic clean-up of old windows (cheap, bounded).
  if (randomInt(0, 50) === 0) {
    await q.query(`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`).catch(() => undefined);
  }
}

export const FIFTEEN_MIN = 15 * 60;
