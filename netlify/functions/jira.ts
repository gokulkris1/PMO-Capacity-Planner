import type { Handler, HandlerEvent } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';
import { fetchPinnedPublicHttps, PublicHttpsError, resolvePinnedPublicHttpsUrl } from './publicHttps';

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

        const jiraTarget = await resolvePinnedPublicHttpsUrl(domain, 'Jira domain');

        // Standard JQL to fetch issues in a project
        let jql = `project = "${String(projectKey).replace(/"/g, '\\"')}" AND statusCategory != Done`;
        if (sprintId) {
            if (!Number.isInteger(Number(sprintId))) return fail(event, 'sprintId must be numeric');
            jql += ` AND sprint = ${sprintId}`;
        }

        // Call Jira REST API
        const jiraAuthorization = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
        const response = await fetchPinnedPublicHttps(
            jiraTarget,
            `/rest/api/3/search?jql=${encodeURIComponent(jql)}&fields=customfield_10016,assignee,status`,
            {
                timeoutMs: 10_000,
                maxBytes: 1_000_000,
                headers: {
                    'Authorization': jiraAuthorization,
                    'Accept': 'application/json',
                },
            },
        );

        if (response.status >= 300 && response.status < 400) {
            return fail(event, 'Redirected Jira URLs are not supported', 400);
        }
        if (response.status < 200 || response.status >= 300) {
            return fail(event, `Jira API request failed (${response.status})`, 502);
        }

        let data: any;
        try {
            data = JSON.parse(response.body.toString('utf8'));
        } catch {
            return fail(event, 'Jira API returned invalid JSON', 502);
        }

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
        if (err instanceof PublicHttpsError) return fail(event, err.message, err.statusCode);
        console.error('Jira Route Error:', err?.message);
        return fail(event, 'Internal server error processing Jira request', 500);
    }
};
