process.env.JWT_SECRET = 'test-secret';
process.env.NEON_DATABASE_URL = 'postgres://dummy:dummy@dummy.neon.tech/dummy';
process.env.INTEGRATIONS_FETCH_TIMEOUT_MS = '50';

import jwt from 'jsonwebtoken';
import type { HandlerEvent } from '@netlify/functions';
import { handler, encrypt, decrypt, getPath, quarterKey, normaliseDomain } from '../../netlify/functions/integrations';

// ── Mock Neon: every tagged-template call is routed to mockSql(queryText, values) ──
const mockSql = jest.fn();
jest.mock('@neondatabase/serverless', () => ({
    neon: () => (strings: TemplateStringsArray, ...values: unknown[]) => mockSql(strings.join('?'), values),
}));

const WS_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

type Row = { provider: string; config: Record<string, unknown>; secret_enc: string | null };

type DbState = {
    ws?: { id: string; org_id: string } | null;
    user?: { org_id: string | null; role: string | null } | null;
    member?: string | null;
    rows?: Row[];
};

/** Drive the mocked neon client from a tiny in-memory state; INSERT ... ON CONFLICT upserts into rows. */
function useDb(state: DbState) {
    const rows: Row[] = state.rows ? state.rows.map(r => ({ ...r })) : [];
    mockSql.mockImplementation(async (q: string, values: unknown[]) => {
        const text = q.replace(/\s+/g, ' ').trim();
        if (text.startsWith('CREATE TABLE') || text.startsWith('CREATE INDEX')) return [];
        if (text.includes('FROM workspaces')) return state.ws === null ? [] : [state.ws || { id: WS_ID, org_id: ORG_ID }];
        if (text.includes('FROM users')) return state.user === null ? [] : [state.user || { org_id: ORG_ID, role: 'ORG_ADMIN' }];
        if (text.includes('FROM workspace_members')) return state.member ? [{ role: state.member }] : [];
        if (text.includes('FROM workspace_integrations')) return rows.map(r => ({ ...r }));
        if (text.startsWith('INSERT INTO workspace_integrations')) {
            const [, provider, configJson, secretEnc] = values as [string, string, string, string | null];
            const existing = rows.find(r => r.provider === provider);
            const config = JSON.parse(configJson);
            if (existing) {
                existing.config = config;
                if (secretEnc !== null) existing.secret_enc = secretEnc;
            } else {
                rows.push({ provider, config, secret_enc: secretEnc });
            }
            return [];
        }
        return [];
    });
    return { rows };
}

function token(payload: Record<string, unknown> = {}) {
    return jwt.sign({ id: USER_ID, role: 'MEMBER', org_id: ORG_ID, ...payload }, 'test-secret');
}

function req(method: string, subpath: string, opts: { body?: unknown; query?: Record<string, string>; auth?: string | null } = {}): HandlerEvent {
    const headers: Record<string, string> = {};
    if (opts.auth !== null) headers.authorization = `Bearer ${opts.auth ?? token()}`;
    return {
        httpMethod: method,
        path: `/api/integrations${subpath}`,
        headers,
        queryStringParameters: { wsId: WS_ID, ...(opts.query || {}) },
        body: opts.body === undefined ? null : JSON.stringify(opts.body),
    } as unknown as HandlerEvent;
}

async function call(event: HandlerEvent) {
    const res = (await handler(event, {} as any)) as { statusCode: number; body: string };
    return { status: res.statusCode, json: JSON.parse(res.body || '{}') };
}

const fetchMock = jest.fn();
beforeEach(() => {
    (global as any).fetch = fetchMock;
    fetchMock.mockReset();
    mockSql.mockReset();
});

function jsonResponse(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(body),
    } as unknown as Response;
}

const EMPTY_CONFIG = {
    jira: { configured: false, domain: '', email: '', projectKeys: [], boardIds: [], hasSecret: false },
    planview: { configured: false, flavour: 'generic', baseUrl: '', hasSecret: false },
    settings: {
        calibration: { '*': { pointsPerSprintPerFte: 10, sprintLengthDays: 14 } },
        mappings: { jira: {}, planview: {} },
    },
};

// ─────────────────────────────────────────────────────────────────────────────

describe('Integrations handler — auth & access', () => {
    it('returns 401 without a bearer token', async () => {
        useDb({});
        const { status, json } = await call(req('GET', '/config', { auth: null }));
        expect(status).toBe(401);
        expect(json.error).toBe('Unauthorized');
    });

    it('returns 401 with a token signed by another secret', async () => {
        useDb({});
        const bad = jwt.sign({ id: USER_ID }, 'wrong-secret');
        const { status } = await call(req('GET', '/config', { auth: bad }));
        expect(status).toBe(401);
    });

    it('returns 400 when wsId is missing', async () => {
        useDb({});
        const event = req('GET', '/config');
        (event as any).queryStringParameters = {};
        const { status } = await call(event);
        expect(status).toBe(400);
    });

    it('returns 403 for a user in another org', async () => {
        useDb({ user: { org_id: 'other-org', role: 'ORG_ADMIN' } });
        const { status } = await call(req('GET', '/config'));
        expect(status).toBe(403);
    });

    it('returns 403 on POST /config for a workspace member without write role', async () => {
        useDb({ user: { org_id: ORG_ID, role: 'MEMBER' }, member: 'USER' });
        const { status, json } = await call(req('POST', '/config', { body: { settings: {} } }));
        expect(status).toBe(403);
        expect(json.error).toMatch(/write access/);
    });

    it('allows POST /config for a PMO_ADMIN workspace member', async () => {
        useDb({ user: { org_id: ORG_ID, role: 'MEMBER' }, member: 'PMO_ADMIN' });
        const { status } = await call(req('POST', '/config', { body: { settings: { mappings: { jira: { ABC: 'p1' } } } } }));
        expect(status).toBe(200);
    });

    it('allows SUPERUSER without any org lookup', async () => {
        useDb({ user: null });
        const { status } = await call(req('GET', '/config', { auth: token({ role: 'SUPERUSER', org_id: undefined }) }));
        expect(status).toBe(200);
    });

    it('returns 404 for an unknown workspace', async () => {
        useDb({ ws: null });
        const { status } = await call(req('GET', '/config'));
        expect(status).toBe(404);
    });
});

describe('GET /config', () => {
    it('returns the empty shape when nothing is configured', async () => {
        useDb({});
        const { status, json } = await call(req('GET', '/config'));
        expect(status).toBe(200);
        expect(json).toEqual(EMPTY_CONFIG);
    });
});

describe('POST /config', () => {
    it('stores an encrypted Jira secret and never echoes it', async () => {
        const { rows } = useDb({});
        const SECRET = 'SUPER-SECRET-JIRA-TOKEN-9f8e7d';
        const { status, json } = await call(req('POST', '/config', {
            body: {
                jira: { domain: 'https://acme.atlassian.net/', email: 'pm@acme.com', apiToken: SECRET, projectKeys: ['abc', 'XYZ'], boardIds: [7] },
                settings: { calibration: { '*': { pointsPerSprintPerFte: 12, sprintLengthDays: 10 }, Payments: { pointsPerSprintPerFte: 20, sprintLengthDays: 14 } } },
            },
        }));
        expect(status).toBe(200);
        // response shape
        expect(json.jira).toEqual({
            configured: true, domain: 'acme.atlassian.net', email: 'pm@acme.com',
            projectKeys: ['ABC', 'XYZ'], boardIds: [7], hasSecret: true,
        });
        expect(json.settings.calibration).toEqual({
            '*': { pointsPerSprintPerFte: 12, sprintLengthDays: 10 },
            Payments: { pointsPerSprintPerFte: 20, sprintLengthDays: 14 },
        });
        expect(JSON.stringify(json)).not.toContain(SECRET);
        expect(json.jira.apiToken).toBeUndefined();

        // stored encrypted, not plaintext, decryptable
        const jiraRow = rows.find(r => r.provider === 'jira')!;
        expect(jiraRow.secret_enc).toBeTruthy();
        expect(jiraRow.secret_enc).not.toContain(SECRET);
        expect(jiraRow.secret_enc).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
        expect(decrypt(jiraRow.secret_enc!)).toBe(SECRET);
        expect(JSON.stringify(jiraRow.config)).not.toContain(SECRET);
    });

    it('keeps the existing secret when apiToken is omitted and merges config', async () => {
        const { rows } = useDb({
            rows: [{ provider: 'jira', config: { domain: 'acme.atlassian.net', email: 'pm@acme.com', projectKeys: ['ABC'], boardIds: [], storyPointsFieldId: 'customfield_10016' }, secret_enc: encrypt('old-token') }],
        });
        const { status, json } = await call(req('POST', '/config', { body: { jira: { domain: 'acme.atlassian.net', email: 'new@acme.com' } } }));
        expect(status).toBe(200);
        expect(json.jira.email).toBe('new@acme.com');
        expect(json.jira.projectKeys).toEqual(['ABC']);
        expect(json.jira.storyPointsFieldId).toBe('customfield_10016');
        expect(json.jira.hasSecret).toBe(true);
        expect(decrypt(rows.find(r => r.provider === 'jira')!.secret_enc!)).toBe('old-token');
    });

    it('rejects a bad domain, a non-https planview baseUrl and non-positive calibration', async () => {
        useDb({});
        let r = await call(req('POST', '/config', { body: { jira: { domain: 'not a host!', email: 'a@b.c', apiToken: 'x' } } }));
        expect(r.status).toBe(400);
        expect(r.json.error).toMatch(/domain/);

        r = await call(req('POST', '/config', { body: { planview: { flavour: 'generic', baseUrl: 'http://insecure.example.com', secret: 'x' } } }));
        expect(r.status).toBe(400);
        expect(r.json.error).toMatch(/https/);

        r = await call(req('POST', '/config', { body: { settings: { calibration: { '*': { pointsPerSprintPerFte: 0, sprintLengthDays: 14 } } } } }));
        expect(r.status).toBe(400);
        expect(r.json.error).toMatch(/positive/);
    });

    it('stores planview config with an encrypted secret and returns generic settings', async () => {
        const { rows } = useDb({});
        const { status, json } = await call(req('POST', '/config', {
            body: {
                planview: {
                    flavour: 'generic', baseUrl: 'https://pv.example.com/api/', secret: 'pv-api-key-123',
                    generic: { projectsPath: '/projects', assignmentsPath: '/assignments', authHeaderName: 'X-Api-Key', fieldMap: { externalId: 'ProjectId', name: 'Title' } },
                },
            },
        }));
        expect(status).toBe(200);
        expect(json.planview).toEqual({
            configured: true, flavour: 'generic', baseUrl: 'https://pv.example.com/api', hasSecret: true,
            generic: { projectsPath: '/projects', assignmentsPath: '/assignments', authHeaderName: 'X-Api-Key', fieldMap: { externalId: 'ProjectId', name: 'Title' } },
        });
        expect(JSON.stringify(json)).not.toContain('pv-api-key-123');
        expect(decrypt(rows.find(r => r.provider === 'planview')!.secret_enc!)).toBe('pv-api-key-123');
    });
});

describe('helpers', () => {
    it('encrypt/decrypt round trip with a fresh IV each time', () => {
        const a = encrypt('hello world');
        const b = encrypt('hello world');
        expect(a).not.toBe(b);
        expect(a.split(':')).toHaveLength(3);
        expect(decrypt(a)).toBe('hello world');
        expect(decrypt(b)).toBe('hello world');
    });

    it('decrypt rejects tampered ciphertext', () => {
        const enc = encrypt('secret');
        const [iv, tag, ct] = enc.split(':');
        const tampered = `${iv}:${tag}:${Buffer.from('zzzz').toString('base64')}${ct.slice(8)}`;
        expect(() => decrypt(tampered)).toThrow();
    });

    it('getPath resolves dotted paths', () => {
        expect(getPath({ a: { b: { c: 1 } } }, 'a.b.c')).toBe(1);
        expect(getPath({ a: { b: null } }, 'a.b.c')).toBeUndefined();
        expect(getPath({ a: 1 }, 'a.b')).toBeUndefined();
    });

    it('quarterKey formats YYYY-Qn', () => {
        expect(quarterKey('2026-01-05T00:00:00.000Z')).toBe('2026-Q1');
        expect(quarterKey('2026-04-13')).toBe('2026-Q2');
        expect(quarterKey('2026-12-31')).toBe('2026-Q4');
        expect(quarterKey('nope')).toBeNull();
        expect(quarterKey(null)).toBeNull();
    });

    it('normaliseDomain strips protocol/paths and rejects junk', () => {
        expect(normaliseDomain('https://Acme.atlassian.net/')).toBe('acme.atlassian.net');
        expect(normaliseDomain('acme.atlassian.net/rest/api')).toBe('acme.atlassian.net');
        expect(normaliseDomain('localhost')).toBeNull();
        expect(normaliseDomain('bad host')).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────

const SP = 'customfield_10016';
const SPRINT = 'customfield_10020';
const S1 = { id: 101, name: 'Sprint 1', state: 'closed', startDate: '2026-01-05T09:00:00.000Z', endDate: '2026-01-16T17:00:00.000Z', originBoardId: 7 };
const S2 = { id: 102, name: 'Sprint 2', state: 'active', startDate: '2026-04-13T09:00:00.000Z', endDate: '2026-04-24T17:00:00.000Z', originBoardId: 7 };
const ALICE = { accountId: 'acc-alice', displayName: 'Alice', emailAddress: 'alice@acme.com' };
const BOB = { accountId: 'acc-bob', displayName: 'Bob', emailAddress: 'bob@acme.com' };
const done = { name: 'Done', statusCategory: { key: 'done', name: 'Done' } };
const todo = { name: 'To Do', statusCategory: { key: 'new', name: 'To Do' } };
const inProg = { name: 'In Progress', statusCategory: { key: 'indeterminate', name: 'In Progress' } };
const ABC = { id: '1', key: 'ABC', name: 'Alpha Build' };
const XYZ = { id: '2', key: 'XYZ', name: 'Xylo' };

function issue(key: string, fields: Record<string, unknown>) {
    return { id: key, key, fields: { summary: key, issuetype: { name: 'Story' }, ...fields } };
}

const JIRA_ROWS: Row[] = [
    { provider: 'jira', config: { domain: 'acme.atlassian.net', email: 'pm@acme.com', projectKeys: ['ABC', 'XYZ'], boardIds: [7], storyPointsFieldId: SP, sprintFieldId: SPRINT }, secret_enc: encrypt('jira-token') },
    { provider: 'settings', config: { calibration: { '*': { pointsPerSprintPerFte: 10, sprintLengthDays: 14 }, Payments: { pointsPerSprintPerFte: 20, sprintLengthDays: 14 } }, mappings: { jira: {}, planview: {} } }, secret_enc: null },
];

describe('POST /jira/usage', () => {
    it('aggregates issues by assignee, project, sprint and quarter with FTE estimates', async () => {
        useDb({ rows: JIRA_ROWS });
        const issues = [
            issue('ABC-1', { status: done, assignee: ALICE, project: ABC, [SP]: 5, [SPRINT]: [S1], created: '2026-01-06T00:00:00.000Z', resolutiondate: '2026-01-15T00:00:00.000Z' }),
            issue('ABC-2', { status: todo, assignee: BOB, project: ABC, [SP]: 3, [SPRINT]: [S1], created: '2026-01-06T00:00:00.000Z', resolutiondate: null }),
            issue('XYZ-3', { status: done, assignee: ALICE, project: XYZ, [SP]: 8, [SPRINT]: [S1, S2], created: '2026-01-10T00:00:00.000Z', resolutiondate: '2026-04-20T00:00:00.000Z' }),
            issue('XYZ-4', { status: inProg, assignee: BOB, project: XYZ, [SP]: 2, [SPRINT]: [S2], created: '2026-04-14T00:00:00.000Z', resolutiondate: null }),
            issue('ABC-5', { status: done, assignee: null, project: ABC, [SP]: 4, [SPRINT]: null, created: '2026-02-01T00:00:00.000Z', resolutiondate: '2026-02-10T00:00:00.000Z' }),
        ];
        fetchMock.mockResolvedValueOnce(jsonResponse({ issues, isLast: true }));

        const { status, json } = await call(req('POST', '/jira/usage', { body: { from: '2026-01-01', to: '2026-06-30', tribeByProjectKey: { ABC: 'Payments' } } }));
        expect(status).toBe(200);

        // Request went to the current search endpoint with the expected JQL and fields
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://acme.atlassian.net/rest/api/3/search/jql');
        expect(init.method).toBe('POST');
        expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('pm@acme.com:jira-token').toString('base64')}`);
        const sent = JSON.parse(init.body);
        expect(sent.jql).toContain('project in ("ABC","XYZ")');
        expect(sent.jql).toContain('updated >= "2026-01-01"');
        expect(sent.jql).toContain('created <= "2026-06-30"');
        expect(sent.maxResults).toBe(100);
        expect(sent.fields).toEqual(expect.arrayContaining(['summary', 'status', 'assignee', 'project', 'issuetype', 'resolutiondate', 'created', SP, SPRINT]));

        expect(json.storyPointsFieldId).toBe(SP);
        expect(json.issueCount).toBe(5);
        expect(json.totalPoints).toBe(22);
        expect(json.donePoints).toBe(17);

        expect(json.byAssignee).toEqual([
            { accountId: 'acc-alice', displayName: 'Alice', email: 'alice@acme.com', points: 13, donePoints: 13, issues: 2 },
            { accountId: 'acc-bob', displayName: 'Bob', email: 'bob@acme.com', points: 5, donePoints: 0, issues: 2 },
            { accountId: 'unassigned', displayName: 'Unassigned', email: '', points: 4, donePoints: 4, issues: 1 },
        ]);

        expect(json.byProject).toEqual([
            { key: 'ABC', name: 'Alpha Build', tribe: 'Payments', points: 12, donePoints: 9, issues: 3 },
            { key: 'XYZ', name: 'Xylo', tribe: '*', points: 10, donePoints: 8, issues: 2 },
        ]);

        expect(json.bySprint).toEqual([
            { sprintId: 101, sprintName: 'Sprint 1', state: 'closed', startDate: S1.startDate, endDate: S1.endDate, points: 8, donePoints: 5, issues: 2, byAssignee: { 'acc-alice': 5, 'acc-bob': 3 } },
            { sprintId: 102, sprintName: 'Sprint 2', state: 'active', startDate: S2.startDate, endDate: S2.endDate, points: 10, donePoints: 8, issues: 2, byAssignee: { 'acc-alice': 8, 'acc-bob': 2 } },
        ]);

        // Quarter from sprint start date when sprinted, else resolutiondate (ABC-5 -> Feb -> Q1)
        expect(json.byQuarter).toEqual([
            { quarterKey: '2026-Q1', points: 12, donePoints: 9, issues: 3 },
            { quarterKey: '2026-Q2', points: 10, donePoints: 8, issues: 2 },
        ]);

        // FTE: ABC uses Payments calibration (20 pts), XYZ uses "*" (10 pts); sprintsInRange defaults to 6
        expect(json.fteEstimate.byProject).toEqual({ ABC: 0.1, XYZ: 0.17 });
        // S1: 5/20 + 3/20 = 0.4 ; S2: 8/10 + 2/10 = 1.0
        expect(json.fteEstimate.bySprint).toEqual({ '101': 0.4, '102': 1 });
    });

    it('pages through nextPageToken and filters by sprintIds', async () => {
        useDb({ rows: JIRA_ROWS });
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ issues: [issue('ABC-1', { status: done, assignee: ALICE, project: ABC, [SP]: 1, [SPRINT]: [S1], created: '2026-01-06' })], nextPageToken: 'p2', isLast: false }))
            .mockResolvedValueOnce(jsonResponse({ issues: [issue('ABC-2', { status: done, assignee: ALICE, project: ABC, [SP]: 2, [SPRINT]: [S1], created: '2026-01-06' })], isLast: true }));
        const { status, json } = await call(req('POST', '/jira/usage', { body: { sprintIds: [101] } }));
        expect(status).toBe(200);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(JSON.parse(fetchMock.mock.calls[1][1].body).nextPageToken).toBe('p2');
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).jql).toContain('sprint in (101)');
        expect(json.issueCount).toBe(2);
        expect(json.totalPoints).toBe(3);
    });

    it('returns 502 with Jira message on upstream failure', async () => {
        useDb({ rows: JIRA_ROWS });
        fetchMock.mockResolvedValueOnce(jsonResponse({ errorMessages: ['The value \'ZZZ\' does not exist for the field \'project\'.'] }, 400));
        const { status, json } = await call(req('POST', '/jira/usage', { body: { projectKeys: ['ZZZ'] } }));
        expect(status).toBe(502);
        expect(json.error).toContain('Jira 400');
        expect(json.error).toContain('does not exist');
        expect(json.upstreamStatus).toBe(400);
    });

    it('returns 504 when Jira does not respond in time', async () => {
        useDb({ rows: JIRA_ROWS });
        fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        }));
        const { status, json } = await call(req('POST', '/jira/usage', { body: {} }));
        expect(status).toBe(504);
        expect(json.error).toMatch(/did not respond/);
    });

    it('returns 400 when Jira is not configured', async () => {
        useDb({});
        const { status, json } = await call(req('POST', '/jira/usage', { body: {} }));
        expect(status).toBe(400);
        expect(json.error).toMatch(/not configured/);
    });
});

describe('POST /jira/test', () => {
    it('detects story-points and sprint fields and persists them', async () => {
        const { rows } = useDb({ rows: [{ ...JIRA_ROWS[0], config: { ...JIRA_ROWS[0].config, storyPointsFieldId: undefined, sprintFieldId: undefined } }] });
        fetchMock.mockImplementation(async (url: string) => {
            if (url.endsWith('/rest/api/3/myself')) return jsonResponse({ displayName: 'PM Person', accountId: 'acc-pm' });
            if (url.endsWith('/rest/api/3/field')) return jsonResponse([
                { id: 'summary', name: 'Summary' },
                { id: 'customfield_10020', name: 'Sprint' },
                { id: 'customfield_10028', name: 'Story point estimate' },
                { id: 'customfield_10016', name: 'Story Points' },
            ]);
            return jsonResponse({}, 404);
        });
        const { status, json } = await call(req('POST', '/jira/test'));
        expect(status).toBe(200);
        expect(json).toEqual({ ok: true, displayName: 'PM Person', accountId: 'acc-pm', storyPointsFieldId: 'customfield_10028', sprintFieldId: 'customfield_10020' });
        const cfg = rows.find(r => r.provider === 'jira')!.config;
        expect(cfg.storyPointsFieldId).toBe('customfield_10028');
        expect(cfg.sprintFieldId).toBe('customfield_10020');
    });
});

describe('GET /jira/sprints', () => {
    it('pages through board sprints with startAt/isLast', async () => {
        useDb({ rows: JIRA_ROWS });
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ values: [S1], isLast: false }))
            .mockResolvedValueOnce(jsonResponse({ values: [S2], isLast: true }));
        const { status, json } = await call(req('GET', '/jira/sprints', { query: { boardId: '7', state: 'active,closed' } }));
        expect(status).toBe(200);
        expect(fetchMock.mock.calls[0][0]).toBe('https://acme.atlassian.net/rest/agile/1.0/board/7/sprint?state=active%2Cclosed&startAt=0&maxResults=50');
        expect(fetchMock.mock.calls[1][0]).toContain('startAt=1');
        expect(json.sprints).toEqual([S1, S2]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Planview generic flavour', () => {
    const PV_ROWS: Row[] = [{
        provider: 'planview',
        config: {
            flavour: 'generic', baseUrl: 'https://pv.example.com/odata',
            generic: {
                projectsPath: '/Projects', assignmentsPath: '/Assignments', authHeaderName: 'X-Api-Key',
                fieldMap: { externalId: 'ProjectId', name: 'Title', startDate: 'Dates.Start', endDate: 'Dates.End', manager: 'Owner.Name', resourceName: 'Resource.FullName', resourceEmail: 'Resource.Email', percent: 'Allocation' },
            },
        },
        secret_enc: encrypt('pv-key'),
    }];

    it('maps projects via dotted fieldMap paths and sends the secret in the configured header', async () => {
        useDb({ rows: PV_ROWS });
        fetchMock.mockResolvedValueOnce(jsonResponse({
            value: [
                { ProjectId: 'P-1', Title: 'Alpha', Status: 'Active', Dates: { Start: '2026-01-01', End: '2026-03-31' }, Owner: { Name: 'Jane Doe' } },
                { ProjectId: 'P-2', Title: 'Beta', Status: 'Planned', Dates: { Start: '2026-04-01' }, Owner: null },
            ],
        }));
        const { status, json } = await call(req('GET', '/planview/projects'));
        expect(status).toBe(200);
        expect(fetchMock.mock.calls[0][0]).toBe('https://pv.example.com/odata/Projects');
        expect(fetchMock.mock.calls[0][1].headers['X-Api-Key']).toBe('pv-key');
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
        expect(json.projects).toEqual([
            { externalId: 'P-1', name: 'Alpha', status: 'Active', startDate: '2026-01-01', endDate: '2026-03-31', manager: 'Jane Doe' },
            { externalId: 'P-2', name: 'Beta', status: 'Planned', startDate: '2026-04-01', endDate: null, manager: null },
        ]);
    });

    it('maps assignments and appends projectId to the assignments path', async () => {
        useDb({ rows: PV_ROWS });
        fetchMock.mockResolvedValueOnce(jsonResponse({
            data: [{ id: 'A-1', Resource: { FullName: 'Sam Smith', Email: 'sam@acme.com' }, role: 'Engineer', StartDate: '2026-01-01', EndDate: '2026-02-01', Allocation: 50 }],
        }));
        const { status, json } = await call(req('GET', '/planview/assignments', { query: { projectId: 'P-1' } }));
        expect(status).toBe(200);
        expect(fetchMock.mock.calls[0][0]).toBe('https://pv.example.com/odata/Assignments?projectId=P-1');
        expect(json.assignments).toEqual([
            { externalId: 'A-1', projectExternalId: 'P-1', resourceName: 'Sam Smith', resourceEmail: 'sam@acme.com', role: 'Engineer', startDate: '2026-01-01', endDate: '2026-02-01', percent: 50 },
        ]);
    });

    it('uses Authorization: Bearer by default and surfaces upstream errors as 502', async () => {
        const rows = [{ ...PV_ROWS[0], config: { ...PV_ROWS[0].config, generic: { ...(PV_ROWS[0].config.generic as any), authHeaderName: undefined } } }];
        useDb({ rows });
        fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'invalid key' }, 401));
        const { status, json } = await call(req('GET', '/planview/projects'));
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer pv-key');
        expect(status).toBe(502);
        expect(json.error).toBe('Planview 401: invalid key');
        expect(json.upstreamStatus).toBe(401);
    });
});

describe('Planview adaptivework flavour', () => {
    const AW_ROWS: Row[] = [{
        provider: 'planview',
        config: { flavour: 'adaptivework', baseUrl: 'https://api.clarizen.com', username: 'pm@acme.com' },
        secret_enc: encrypt('pv-password'),
    }];

    it('logs in, sends the session header and pages the query', async () => {
        useDb({ rows: AW_ROWS });
        fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
            if (url.endsWith('/API2.0/services/authentication/login')) {
                expect(JSON.parse(String(init.body))).toEqual({ userName: 'pm@acme.com', password: 'pv-password' });
                return jsonResponse({ sessionId: 'sess-1' });
            }
            if (url.endsWith('/API2.0/services/data/query')) {
                expect((init.headers as Record<string, string>).Authorization).toBe('Session sess-1');
                const body = JSON.parse(String(init.body));
                expect(body.q).toBe('SELECT Name, StartDate, DueDate, State, ProjectManager FROM Project');
                if (body.paging.from === 0) {
                    return jsonResponse({ entities: [{ id: '/Project/1', Name: 'Alpha', StartDate: '2026-01-01', DueDate: '2026-03-01', State: { id: '/State/Active' }, ProjectManager: { id: '/User/9', Name: 'Jane' } }], paging: { from: 0, limit: 100, hasMore: true } });
                }
                return jsonResponse({ entities: [{ id: '/Project/2', Name: 'Beta', State: '/State/Draft' }], paging: { from: 1, limit: 100, hasMore: false } });
            }
            return jsonResponse({}, 404);
        });
        const { status, json } = await call(req('GET', '/planview/projects'));
        expect(status).toBe(200);
        expect(json.projects).toEqual([
            { externalId: '/Project/1', name: 'Alpha', status: 'Active', startDate: '2026-01-01', endDate: '2026-03-01', manager: 'Jane' },
            { externalId: '/Project/2', name: 'Beta', status: 'Draft', startDate: null, endDate: null, manager: null },
        ]);
    });

    it('normalises assignment units into percent or hours', async () => {
        useDb({ rows: AW_ROWS });
        fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
            if (url.endsWith('/authentication/login')) return jsonResponse({ sessionId: 'sess-1' });
            const body = JSON.parse(String(init.body));
            expect(body.q).toBe("SELECT WorkItem, Resource, StartDate, DueDate, Units, Role FROM RegularResourceLink WHERE WorkItem = '/Project/1'");
            return jsonResponse({
                entities: [
                    { id: '/RegularResourceLink/1', WorkItem: { id: '/Project/1' }, Resource: { id: '/User/1', Name: 'Sam' }, Units: 50, Role: { Name: 'Dev' }, StartDate: '2026-01-01', DueDate: '2026-02-01' },
                    { id: '/RegularResourceLink/2', WorkItem: { id: '/Project/1' }, Resource: { id: '/User/2', Name: 'Kim' }, Units: { value: 40, unit: 'Hours' }, Role: null },
                ],
                paging: { hasMore: false },
            });
        });
        const { status, json } = await call(req('GET', '/planview/assignments', { query: { projectId: '/Project/1' } }));
        expect(status).toBe(200);
        expect(json.assignments).toEqual([
            { externalId: '/RegularResourceLink/1', projectExternalId: '/Project/1', resourceName: 'Sam', resourceEmail: null, role: 'Dev', startDate: '2026-01-01', endDate: '2026-02-01', percent: 50 },
            { externalId: '/RegularResourceLink/2', projectExternalId: '/Project/1', resourceName: 'Kim', resourceEmail: null, role: null, startDate: null, endDate: null, percent: null, hours: 40 },
        ]);
    });
});

describe('Deprecated /api/jira shim', () => {
    it('returns 410 pointing at the new endpoint', async () => {
        const { handler: jiraHandler } = await import('../../netlify/functions/jira');
        const res = (await jiraHandler({ httpMethod: 'POST', path: '/api/jira', headers: {}, body: '{}' } as unknown as HandlerEvent, {} as any)) as any;
        expect(res.statusCode).toBe(410);
        expect(JSON.parse(res.body)).toEqual({ error: 'Moved to /api/integrations/jira/usage' });
    });
});
