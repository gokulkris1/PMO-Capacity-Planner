import type { Handler, HandlerEvent } from '@netlify/functions';

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
        const { domain, email, token, projectKey, sprintId } = JSON.parse(event.body || '{}');

        if (!domain || !email || !token || !projectKey) {
            return fail(event, 'Missing required Jira credentials (domain, email, api token, project key)');
        }

        // Clean domain formatting
        const baseUrl = `https://${domain.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;

        // Standard JQL to fetch issues in a project
        let jql = `project = "${projectKey}" AND statusCategory != Done`;
        if (sprintId) {
            jql += ` AND sprint = ${sprintId}`;
        }

        // Call Jira REST API
        const authHeader = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
        const response = await fetch(`${baseUrl}/rest/api/3/search?jql=${encodeURIComponent(jql)}&fields=customfield_10016,assignee,status`, {
            method: 'GET',
            headers: {
                'Authorization': authHeader,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            const err = await response.text();
            return fail(event, `Jira API Error (${response.status}): ${err}`, 502);
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
        console.error('Jira Route Error:', err);
        return fail(event, 'Internal server error processing Jira request', 500);
    }
};
