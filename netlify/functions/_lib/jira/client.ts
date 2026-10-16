/** Jira Cloud REST calls with the workspace's credentials: host allow-list, no redirects, bounded time (HS-08). */
import { JIRA_HOST_RE, MAX_OUTBOUND_MS, UpstreamError, readJson, safeFetch, upstreamMessage } from '../net';
import { optionalEnv } from '../env';
import type { JiraField, JiraSprint } from './fields';
import { parseSprintValue } from './fields';

export interface JiraCreds {
  domain: string;
  email: string;
  apiToken: string;
}

export function fetchTimeout(): number {
  const n = Number(optionalEnv('INTEGRATIONS_FETCH_TIMEOUT_MS'));
  return n > 0 ? Math.min(n, MAX_OUTBOUND_MS) : MAX_OUTBOUND_MS;
}

export async function jiraFetch(
  c: JiraCreds,
  path: string,
  init: RequestInit = {},
  timeoutMs = fetchTimeout(),
): Promise<unknown> {
  if (!JIRA_HOST_RE.test(c.domain)) throw new UpstreamError('Jira', 400, 'Jira site is not an Atlassian Cloud address');
  const auth = Buffer.from(`${c.email}:${c.apiToken}`).toString('base64');
  const res = await safeFetch(
    `https://${c.domain}${path}`,
    {
      ...init,
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...((init.headers as Record<string, string> | undefined) ?? {}),
      },
    },
    { label: 'Jira', timeoutMs },
  );
  const { text, json } = await readJson(res);
  if (!res.ok) {
    const retry = Number(res.headers?.get?.('retry-after') ?? '');
    throw new UpstreamError(
      'Jira',
      res.status,
      upstreamMessage(json, text),
      Number.isFinite(retry) && retry > 0 ? retry : null,
    );
  }
  return json;
}

export async function jiraFields(c: JiraCreds): Promise<JiraField[]> {
  const fields = await jiraFetch(c, '/rest/api/3/field');
  return Array.isArray(fields) ? (fields as JiraField[]) : [];
}

export async function boardSprints(c: JiraCreds, boardId: number, state: string, maxPages = 10): Promise<JiraSprint[]> {
  const out: JiraSprint[] = [];
  let startAt = 0;
  for (let page = 0; page < maxPages; page++) {
    const data = (await jiraFetch(
      c,
      `/rest/agile/1.0/board/${boardId}/sprint?state=${encodeURIComponent(state)}&startAt=${startAt}&maxResults=50`,
    )) as { values?: unknown[]; isLast?: boolean } | null;
    const values = Array.isArray(data?.values) ? data.values : [];
    for (const v of values) {
      const s = parseSprintValue(v);
      if (s) out.push(s);
    }
    if (data?.isLast !== false || values.length === 0) break;
    startAt += values.length;
  }
  return out;
}

export interface SearchPage {
  issues: Array<{ key?: unknown; fields?: unknown }>;
  nextPageToken: string | null;
}

export async function searchPage(
  c: JiraCreds,
  jql: string,
  fields: string[],
  nextPageToken: string | null,
  timeoutMs?: number,
): Promise<SearchPage> {
  const data = (await jiraFetch(
    c,
    '/rest/api/3/search/jql',
    {
      method: 'POST',
      body: JSON.stringify({ jql, fields, maxResults: 100, ...(nextPageToken ? { nextPageToken } : {}) }),
    },
    timeoutMs,
  )) as { issues?: unknown[]; nextPageToken?: unknown; isLast?: unknown } | null;
  const issues = Array.isArray(data?.issues) ? (data.issues as SearchPage['issues']) : [];
  const token =
    typeof data?.nextPageToken === 'string' && data.nextPageToken && data.isLast !== true ? data.nextPageToken : null;
  return { issues, nextPageToken: token };
}
