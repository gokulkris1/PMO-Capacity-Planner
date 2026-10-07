import type { Handler } from '@netlify/functions';

/**
 * Retired: this endpoint previously returned unscoped database records.
 * Production diagnostics must use authenticated, audit-logged tooling.
 */
export const handler: Handler = async () => ({
    statusCode: 410,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'This diagnostic endpoint is retired.' }),
});
