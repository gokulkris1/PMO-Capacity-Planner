import type { Handler, HandlerEvent } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const JWT_SECRET = process.env.JWT_SECRET as string;
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is missing');

const getDb = () => {
    const url = process.env.NEON_DATABASE_URL || process.env.NETLIFY_DATABASE_URL_UNPOOLED || process.env.NETLIFY_DATABASE_URL;
    if (!url) throw new Error('No DB URL');
    return neon(url);
};

function getCors(event: HandlerEvent) {
    const origin = event.headers.origin || process.env.URL || '*';
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'OPTIONS, POST',
        'Content-Type': 'application/json',
    };
}

function ok(event: HandlerEvent, body: unknown) {
    return { statusCode: 200, headers: getCors(event), body: JSON.stringify(body) };
}

function fail(event: HandlerEvent, msg: string, status = 400) {
    return { statusCode: status, headers: getCors(event), body: JSON.stringify({ error: msg }) };
}

class PublicUrlError extends Error {}

function isPrivateAddress(address: string): boolean {
    const normalizedAddress = address.toLowerCase();
    if (isIP(normalizedAddress) === 6) {
        if (normalizedAddress === '::' || normalizedAddress === '::1' ||
            normalizedAddress.startsWith('fc') || normalizedAddress.startsWith('fd') ||
            /^fe[89ab]/.test(normalizedAddress) || normalizedAddress.startsWith('ff') ||
            normalizedAddress.startsWith('2001:db8:')) return true;
        const mappedIpv4 = normalizedAddress.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
        return mappedIpv4 ? isPrivateAddress(mappedIpv4[1]) : false;
    }
    if (isIP(normalizedAddress) !== 4) return true;
    const [a, b] = normalizedAddress.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && [0, 2, 168].includes(b)) ||
        (a === 198 && [18, 19, 51].includes(b)) ||
        (a === 203 && b === 0) ||
        a >= 224;
}

async function safeJiraOrigin(rawDomain: string): Promise<string> {
    if (rawDomain.length > 2_048) throw new PublicUrlError('Jira domain is too long');
    let url: URL;
    try {
        const candidate = rawDomain.trim().match(/^https?:\/\//i) ? rawDomain.trim() : `https://${rawDomain.trim()}`;
        url = new URL(candidate);
    } catch {
        throw new PublicUrlError('A valid public HTTPS Jira domain is required');
    }
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
        throw new PublicUrlError('Only public HTTPS Jira domains are supported');
    }
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
        throw new PublicUrlError('Private network targets are not allowed');
    }
    let addresses: Array<{ address: string }>;
    try {
        addresses = await lookup(hostname, { all: true }) as Array<{ address: string }>;
    } catch {
        throw new PublicUrlError('The Jira domain could not be resolved');
    }
    if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
        throw new PublicUrlError('Private network targets are not allowed');
    }
    return url.origin;
}

export const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: getCors(event), body: '' };
    if (event.httpMethod !== 'POST') return fail(event, 'Method not allowed', 405);

    try {
        const authHeader = event.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) return fail(event, 'Unauthorized', 401);
        let userId: string;
        try {
            userId = (jwt.verify(authHeader.slice(7), JWT_SECRET) as { id: string }).id;
        } catch {
            return fail(event, 'Unauthorized', 401);
        }

        const sql = getDb();
        const [caller] = await sql`SELECT role, org_id FROM users WHERE id = ${userId}`;
        if (!caller || (!caller.org_id && caller.role !== 'SUPERUSER')) return fail(event, 'Unauthorized', 401);

        const { domain, email, token, projectKey, sprintId } = JSON.parse(event.body || '{}');

        if (!domain || !email || !token || !projectKey) {
            return fail(event, 'Missing required Jira credentials (domain, email, api token, project key)');
        }

        const baseUrl = await safeJiraOrigin(domain);

        // Standard JQL to fetch issues in a project
        let jql = `project = "${String(projectKey).replace(/"/g, '\\"')}" AND statusCategory != Done`;
        if (sprintId) {
            if (!Number.isInteger(Number(sprintId))) return fail(event, 'sprintId must be numeric');
            jql += ` AND sprint = ${sprintId}`;
        }

        // Call Jira REST API
        const jiraAuthorization = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        const response = await fetch(`${baseUrl}/rest/api/3/search?jql=${encodeURIComponent(jql)}&fields=customfield_10016,assignee,status`, {
            method: 'GET',
            signal: controller.signal,
            redirect: 'manual',
            headers: {
                'Authorization': jiraAuthorization,
                'Accept': 'application/json'
            }
        }).finally(() => clearTimeout(timeout));

        if (response.status >= 300 && response.status < 400) {
            return fail(event, 'Redirected Jira URLs are not supported', 400);
        }
        if (!response.ok) {
            return fail(event, `Jira API request failed (${response.status})`, 502);
        }

        const data = await response.json();

        // Calculate total story points (customfield_10016 is commonly Story Points in Jira Cloud)
        let totalPoints = 0;
        const assignees = new Map<string, number>();

        for (const issue of data.issues || []) {
            const points = issue.fields.customfield_10016 || 0;
            totalPoints += points;

            const assigneeName = issue.fields.assignee?.displayName || 'Unassigned';
            assignees.set(assigneeName, (assignees.get(assigneeName) || 0) + points);
        }

        // Assumption for PMO: 1 Story Point = ~1 Day of Dev Effort.
        // 20 points in a month = ~1 FTE.
        const estimatedFte = Math.round((totalPoints / 20) * 10) / 10;

        return ok(event, {
            projectKey,
            issueCount: data.total || 0,
            totalStoryPoints: totalPoints,
            estimatedFteRequired: estimatedFte,
            breakdownByAssignee: Object.fromEntries(assignees),
            insight: `Jira reports ${totalPoints} active story points for ${projectKey}. Assuming 20 points = 1 FTE/month, this requires ${estimatedFte} FTEs to burn down.`
        });

    } catch (err: any) {
        if (err instanceof PublicUrlError) return fail(event, err.message, 400);
        console.error('Jira Route Error:', err?.message);
        return fail(event, 'Internal server error processing Jira request', 500);
    }
};
