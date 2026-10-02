import type { Handler, HandlerEvent } from '@netlify/functions';

/**
 * DEPRECATED — this endpoint accepted Jira credentials in the request body
 * (which the old UI kept in localStorage). It has been replaced by
 * /api/integrations/jira/usage, which uses workspace-scoped, encrypted
 * credentials managed via /api/integrations/config.
 *
 * It intentionally returns 410 Gone so nothing can silently keep using it.
 */

const CORS = {
    'Access-Control-Allow-Origin': process.env.URL || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'OPTIONS, POST',
    'Content-Type': 'application/json',
};

export const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
    return {
        statusCode: 410,
        headers: CORS,
        body: JSON.stringify({ error: 'Moved to /api/integrations/jira/usage' }),
    };
};
