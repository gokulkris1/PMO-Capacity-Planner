import type { Handler, HandlerEvent } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * /api/integrations/*  — Jira Cloud + Planview connectors.
 *
 * Secrets (Jira API token, Planview password / API key) are encrypted at rest with
 * AES-256-GCM (key = sha256(JWT_SECRET + ':integrations')) and are never returned
 * to the client. Every outbound HTTP call is bounded by an 8s timeout because the
 * Netlify Lambda has a hard 10s limit.
 */

const JWT_SECRET = process.env.JWT_SECRET as string;
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is missing');

// Overridable so the unit tests can exercise the timeout path quickly.
const FETCH_TIMEOUT_MS = Number(process.env.INTEGRATIONS_FETCH_TIMEOUT_MS) || 8000;
const MAX_PAGES = 10;

const CORS = {
    'Access-Control-Allow-Origin': process.env.URL || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
};

function ok(body: unknown, status = 200) { return { statusCode: status, headers: CORS, body: JSON.stringify(body) }; }
function fail(msg: string, status = 400, extra: Record<string, unknown> = {}) {
    return { statusCode: status, headers: CORS, body: JSON.stringify({ error: msg, ...extra }) };
}

const getDb = () => neon(
    process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
    process.env.NETLIFY_DATABASE_URL ||
    process.env.NEON_DATABASE_URL || ''
);
type Sql = ReturnType<typeof getDb>;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type JiraConfig = {
    domain: string;
    email: string;
    projectKeys: string[];
    boardIds: number[];
    storyPointsFieldId?: string;
    sprintFieldId?: string;
};

type PlanviewGeneric = {
    projectsPath: string;
    assignmentsPath: string;
    authHeaderName?: string;
    fieldMap: Record<string, string>;
};

type PlanviewConfig = {
    flavour: 'adaptivework' | 'generic';
    baseUrl: string;
    username?: string;
    generic?: PlanviewGeneric;
};

type Calibration = Record<string, { pointsPerSprintPerFte: number; sprintLengthDays: number }>;

type SettingsConfig = {
    calibration: Calibration;
    mappings: { jira: Record<string, string>; planview: Record<string, string> };
};

type Provider = 'jira' | 'planview' | 'settings';

type IntegrationRow = {
    provider: Provider;
    config: Record<string, unknown> | string | null;
    secret_enc: string | null;
};

type Stored = {
    jira?: { config: JiraConfig; secretEnc: string | null };
    planview?: { config: PlanviewConfig; secretEnc: string | null };
    settings?: { config: SettingsConfig };
};

type ConfigResponse = {
    jira: {
        configured: boolean;
        domain: string;
        email: string;
        projectKeys: string[];
        boardIds: number[];
        storyPointsFieldId?: string;
        hasSecret: boolean;
    };
    planview: {
        configured: boolean;
        flavour: 'adaptivework' | 'generic';
        baseUrl: string;
        username?: string;
        hasSecret: boolean;
        generic?: PlanviewGeneric;
    };
    settings: SettingsConfig;
};

type Access = { canRead: boolean; canWrite: boolean };

type NormalisedProject = {
    externalId: string;
    name: string;
    status: string | null;
    startDate: string | null;
    endDate: string | null;
    manager: string | null;
};

type NormalisedAssignment = {
    externalId: string;
    projectExternalId: string;
    resourceName: string;
    resourceEmail: string | null;
    role: string | null;
    startDate: string | null;
    endDate: string | null;
    percent: number | null;
    hours?: number | null;
};

const DEFAULT_CALIBRATION: Calibration = { '*': { pointsPerSprintPerFte: 10, sprintLengthDays: 14 } };

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

class UpstreamError extends Error {
    provider: string;
    status: number;
    constructor(provider: string, status: number, message: string) {
        super(message);
        this.name = 'UpstreamError';
        this.provider = provider;
        this.status = status;
    }
}

class TimeoutError extends Error {
    constructor(message: string) { super(message); this.name = 'TimeoutError'; }
}

class ValidationError extends Error {
    constructor(message: string) { super(message); this.name = 'ValidationError'; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Crypto helpers (exported for tests)
// ─────────────────────────────────────────────────────────────────────────────

function encryptionKey(): Buffer {
    return createHash('sha256').update(`${JWT_SECRET}:integrations`).digest();
}

export function encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decrypt(payload: string): string {
    const parts = payload.split(':');
    if (parts.length !== 3) throw new Error('Malformed encrypted secret');
    const [iv, tag, ct] = parts.map(p => Buffer.from(p, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

// ─────────────────────────────────────────────────────────────────────────────
// Small utilities (exported for tests)
// ─────────────────────────────────────────────────────────────────────────────

export function getPath(obj: unknown, path: string): unknown {
    if (!path) return undefined;
    let cur: unknown = obj;
    for (const seg of path.split('.')) {
        if (cur === null || cur === undefined) return undefined;
        if (typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[seg];
    }
    return cur;
}

export function quarterKey(dateStr: string | null | undefined): string | null {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (isPlainObject(v)) {
        // Reference objects (Clarizen: { id, Name }, OData: { Name }, etc.)
        for (const k of ['DisplayName', 'displayName', 'Name', 'name', 'Title', 'title', 'id', 'Id', 'ID']) {
            if (typeof v[k] === 'string') return v[k] as string;
        }
    }
    return null;
}

function num(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
}

/** Fetch with a hard timeout (AbortController + Promise.race, in case the fetch impl ignores the signal). */
async function fetchWithTimeout(url: string, init: RequestInit = {}, label = 'upstream'): Promise<Response> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            controller.abort();
            reject(new TimeoutError(`${label} did not respond within ${FETCH_TIMEOUT_MS / 1000}s`));
        }, FETCH_TIMEOUT_MS);
    });
    try {
        return await Promise.race([fetch(url, { ...init, signal: controller.signal }), timeout]);
    } catch (e: any) {
        if (e?.name === 'AbortError') throw new TimeoutError(`${label} did not respond within ${FETCH_TIMEOUT_MS / 1000}s`);
        throw e;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function readBody(res: Response): Promise<{ text: string; json: any }> {
    const text = await res.text();
    try { return { text, json: text ? JSON.parse(text) : null }; } catch { return { text, json: null }; }
}

function shortMessage(json: any, text: string): string {
    if (json) {
        if (Array.isArray(json.errorMessages) && json.errorMessages.length) return String(json.errorMessages[0]);
        if (json.errors && isPlainObject(json.errors)) {
            const first = Object.values(json.errors)[0];
            if (first) return String(first);
        }
        for (const k of ['message', 'Message', 'error', 'error_description', 'errorMessage', 'referenceId']) {
            if (typeof json[k] === 'string') return json[k];
        }
        if (isPlainObject(json.error) && typeof json.error.message === 'string') return json.error.message;
    }
    return (text || '').replace(/\s+/g, ' ').slice(0, 200) || 'Upstream request failed';
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage
// ─────────────────────────────────────────────────────────────────────────────

let tableEnsured = false;
async function ensureTable(sql: Sql) {
    if (tableEnsured) return;
    await sql`CREATE TABLE IF NOT EXISTS workspace_integrations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK (provider IN ('jira','planview','settings')),
        config JSONB NOT NULL DEFAULT '{}'::jsonb,
        secret_enc TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (workspace_id, provider)
    )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_workspace_integrations_workspace_id ON workspace_integrations(workspace_id)`;
    tableEnsured = true;
}

function parseConfig(raw: IntegrationRow['config']): Record<string, unknown> {
    if (isPlainObject(raw)) return raw;
    if (typeof raw === 'string') { try { const p = JSON.parse(raw); return isPlainObject(p) ? p : {}; } catch { return {}; } }
    return {};
}

function toStringArray(v: unknown): string[] {
    return Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean) : [];
}
function toNumberArray(v: unknown): number[] {
    return Array.isArray(v) ? v.map(x => Number(x)).filter(n => Number.isFinite(n)) : [];
}

function normaliseCalibration(raw: unknown, strict: boolean): Calibration {
    const out: Calibration = {};
    if (isPlainObject(raw)) {
        for (const [tribe, val] of Object.entries(raw)) {
            if (!isPlainObject(val)) { if (strict) throw new ValidationError(`calibration["${tribe}"] must be an object`); continue; }
            const pps = num(val.pointsPerSprintPerFte);
            const sld = num(val.sprintLengthDays);
            if (pps === null || pps <= 0 || sld === null || sld <= 0) {
                if (strict) throw new ValidationError(`calibration["${tribe}"]: pointsPerSprintPerFte and sprintLengthDays must be positive numbers`);
                continue;
            }
            out[tribe] = { pointsPerSprintPerFte: pps, sprintLengthDays: sld };
        }
    }
    if (!out['*']) out['*'] = { ...DEFAULT_CALIBRATION['*'] };
    return out;
}

function normaliseStringMap(raw: unknown, label: string, strict: boolean): Record<string, string> {
    const out: Record<string, string> = {};
    if (raw === undefined || raw === null) return out;
    if (!isPlainObject(raw)) { if (strict) throw new ValidationError(`${label} must be an object`); return out; }
    for (const [k, v] of Object.entries(raw)) {
        if (typeof v !== 'string') { if (strict) throw new ValidationError(`${label}["${k}"] must be a string`); continue; }
        if (k.trim() && v.trim()) out[k.trim()] = v.trim();
    }
    return out;
}

async function loadStored(sql: Sql, wsId: string): Promise<Stored> {
    const rows = (await sql`SELECT provider, config, secret_enc FROM workspace_integrations WHERE workspace_id = ${wsId}`) as IntegrationRow[];
    const stored: Stored = {};
    for (const row of rows) {
        const cfg = parseConfig(row.config);
        if (row.provider === 'jira') {
            stored.jira = {
                config: {
                    domain: typeof cfg.domain === 'string' ? cfg.domain : '',
                    email: typeof cfg.email === 'string' ? cfg.email : '',
                    projectKeys: toStringArray(cfg.projectKeys),
                    boardIds: toNumberArray(cfg.boardIds),
                    storyPointsFieldId: typeof cfg.storyPointsFieldId === 'string' && cfg.storyPointsFieldId ? cfg.storyPointsFieldId : undefined,
                    sprintFieldId: typeof cfg.sprintFieldId === 'string' && cfg.sprintFieldId ? cfg.sprintFieldId : undefined,
                },
                secretEnc: row.secret_enc || null,
            };
        } else if (row.provider === 'planview') {
            const generic = isPlainObject(cfg.generic) ? cfg.generic : undefined;
            stored.planview = {
                config: {
                    flavour: cfg.flavour === 'adaptivework' ? 'adaptivework' : 'generic',
                    baseUrl: typeof cfg.baseUrl === 'string' ? cfg.baseUrl : '',
                    username: typeof cfg.username === 'string' && cfg.username ? cfg.username : undefined,
                    generic: generic ? {
                        projectsPath: typeof generic.projectsPath === 'string' ? generic.projectsPath : '',
                        assignmentsPath: typeof generic.assignmentsPath === 'string' ? generic.assignmentsPath : '',
                        authHeaderName: typeof generic.authHeaderName === 'string' && generic.authHeaderName ? generic.authHeaderName : undefined,
                        fieldMap: normaliseStringMap(generic.fieldMap, 'fieldMap', false),
                    } : undefined,
                },
                secretEnc: row.secret_enc || null,
            };
        } else if (row.provider === 'settings') {
            const mappings = isPlainObject(cfg.mappings) ? cfg.mappings : {};
            stored.settings = {
                config: {
                    calibration: normaliseCalibration(cfg.calibration, false),
                    mappings: {
                        jira: normaliseStringMap(mappings.jira, 'mappings.jira', false),
                        planview: normaliseStringMap(mappings.planview, 'mappings.planview', false),
                    },
                },
            };
        }
    }
    return stored;
}

function buildConfigResponse(stored: Stored): ConfigResponse {
    const j = stored.jira?.config;
    const jiraHasSecret = !!stored.jira?.secretEnc;
    const p = stored.planview?.config;
    const pvHasSecret = !!stored.planview?.secretEnc;
    const s = stored.settings?.config;

    const jira: ConfigResponse['jira'] = {
        configured: !!(j?.domain && j?.email && jiraHasSecret),
        domain: j?.domain || '',
        email: j?.email || '',
        projectKeys: j?.projectKeys || [],
        boardIds: j?.boardIds || [],
        hasSecret: jiraHasSecret,
    };
    if (j?.storyPointsFieldId) jira.storyPointsFieldId = j.storyPointsFieldId;

    const planview: ConfigResponse['planview'] = {
        configured: !!(p?.baseUrl && pvHasSecret && (p.flavour === 'generic' || !!p.username)),
        flavour: p?.flavour || 'generic',
        baseUrl: p?.baseUrl || '',
        hasSecret: pvHasSecret,
    };
    if (p?.username) planview.username = p.username;
    if (p?.generic) planview.generic = p.generic;

    const settings: SettingsConfig = {
        calibration: s?.calibration || { '*': { ...DEFAULT_CALIBRATION['*'] } },
        mappings: { jira: s?.mappings.jira || {}, planview: s?.mappings.planview || {} },
    };
    return { jira, planview, settings };
}

async function upsertProvider(sql: Sql, wsId: string, provider: Provider, config: unknown, secretEnc: string | null) {
    // secret_enc = NULL keeps the previously stored secret (COALESCE); a value replaces it.
    await sql`INSERT INTO workspace_integrations (workspace_id, provider, config, secret_enc)
        VALUES (${wsId}, ${provider}, ${JSON.stringify(config)}::jsonb, ${secretEnc})
        ON CONFLICT (workspace_id, provider) DO UPDATE SET
            config = EXCLUDED.config,
            secret_enc = COALESCE(EXCLUDED.secret_enc, workspace_integrations.secret_enc),
            updated_at = CURRENT_TIMESTAMP`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

export function normaliseDomain(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const d = raw.trim().replace(/^https?:\/\//i, '').replace(/[/?#].*$/, '').replace(/\/+$/, '').toLowerCase();
    const hostRe = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{2,5})?$/;
    return hostRe.test(d) ? d : null;
}

function normaliseHttpsUrl(raw: unknown): string | null {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    try {
        const u = new URL(raw.trim());
        if (u.protocol !== 'https:') return null;
        return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
    } catch { return null; }
}

function normalisePath(raw: unknown, label: string): string {
    if (raw === undefined || raw === null || raw === '') return '';
    if (typeof raw !== 'string') throw new ValidationError(`${label} must be a string path`);
    const p = raw.trim();
    if (!p.startsWith('/')) throw new ValidationError(`${label} must start with "/"`);
    return p;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth + access
// ─────────────────────────────────────────────────────────────────────────────

type JwtUser = { id: string; role?: string; org_id?: string };

function authenticate(event: HandlerEvent): JwtUser | null {
    const h = event.headers?.authorization;
    if (!h?.startsWith('Bearer ')) return null;
    try {
        const decoded = jwt.verify(h.split(' ')[1], JWT_SECRET) as JwtUser;
        return decoded?.id ? decoded : null;
    } catch { return null; }
}

/**
 * Read access: SUPERUSER, or the caller's users.org_id equals the workspace's org_id.
 * Write access (same rules as workspace.ts): SUPERUSER always; ORG_ADMIN/ADMIN when the
 * caller's org matches; otherwise workspace_members.role in PMO_ADMIN/WORKSPACE_OWNER.
 */
async function resolveAccess(sql: Sql, user: JwtUser, wsId: string): Promise<Access | 'not_found'> {
    const wsRows = (await sql`SELECT id, org_id FROM workspaces WHERE id = ${wsId} LIMIT 1`) as { id: string; org_id: string }[];
    if (!wsRows.length) return 'not_found';
    const ws = wsRows[0];

    if (user.role === 'SUPERUSER') return { canRead: true, canWrite: true };

    const userRows = (await sql`SELECT org_id, role FROM users WHERE id = ${user.id} LIMIT 1`) as { org_id: string | null; role: string | null }[];
    const dbUser = userRows[0];
    if (!dbUser) return { canRead: false, canWrite: false };

    const role = dbUser.role || user.role || 'MEMBER';
    if (role === 'SUPERUSER') return { canRead: true, canWrite: true };

    const sameOrg = !!dbUser.org_id && dbUser.org_id === ws.org_id;
    if (!sameOrg) return { canRead: false, canWrite: false };

    if (['ORG_ADMIN', 'ADMIN'].includes(role)) return { canRead: true, canWrite: true };

    const memberRows = (await sql`SELECT role FROM workspace_members WHERE user_id = ${user.id} AND workspace_id = ${wsId} LIMIT 1`) as { role: string }[];
    const wsRole = memberRows[0]?.role || 'USER';
    return { canRead: true, canWrite: ['PMO_ADMIN', 'WORKSPACE_OWNER'].includes(wsRole) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Jira
// ─────────────────────────────────────────────────────────────────────────────

type JiraCreds = { domain: string; email: string; apiToken: string };

function jiraCreds(stored: Stored): JiraCreds {
    const cfg = stored.jira?.config;
    if (!cfg?.domain || !cfg.email || !stored.jira?.secretEnc) {
        throw new ValidationError('Jira is not configured for this workspace (domain, email and API token are required)');
    }
    return { domain: cfg.domain, email: cfg.email, apiToken: decrypt(stored.jira.secretEnc) };
}

async function jiraFetch(cfg: JiraCreds, path: string, init: RequestInit = {}): Promise<any> {
    const auth = Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString('base64');
    const res = await fetchWithTimeout(`https://${cfg.domain}${path}`, {
        ...init,
        headers: {
            Authorization: `Basic ${auth}`,
            Accept: 'application/json',
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
            ...(init.headers as Record<string, string> | undefined),
        },
    }, 'Jira');
    const { text, json } = await readBody(res);
    if (!res.ok) throw new UpstreamError('Jira', res.status, shortMessage(json, text));
    return json;
}

type JiraField = { id: string; name: string; schema?: { type?: string; custom?: string } };

function detectJiraFields(fields: JiraField[], preferredStoryPoints?: string) {
    const byName = (names: string[]) => fields.find(f => names.includes(String(f.name || '').trim().toLowerCase()));
    let storyPoints: JiraField | undefined;
    if (preferredStoryPoints) storyPoints = fields.find(f => f.id === preferredStoryPoints);
    if (!storyPoints) storyPoints = byName(['story point estimate', 'story points']);
    const sprint = byName(['sprint']);
    return { storyPointsFieldId: storyPoints?.id, sprintFieldId: sprint?.id };
}

async function ensureJiraFieldIds(creds: JiraCreds, stored: Stored, sql: Sql, wsId: string, canWrite: boolean) {
    const cfg = stored.jira!.config;
    if (cfg.storyPointsFieldId && cfg.sprintFieldId) return cfg;
    const fields = (await jiraFetch(creds, '/rest/api/3/field')) as JiraField[];
    const detected = detectJiraFields(Array.isArray(fields) ? fields : [], cfg.storyPointsFieldId);
    cfg.storyPointsFieldId = cfg.storyPointsFieldId || detected.storyPointsFieldId;
    cfg.sprintFieldId = cfg.sprintFieldId || detected.sprintFieldId;
    if (canWrite && (cfg.storyPointsFieldId || cfg.sprintFieldId)) await upsertProvider(sql, wsId, 'jira', cfg, null);
    return cfg;
}

type JiraSprint = { id: number; name: string; state: string; startDate: string | null; endDate: string | null; originBoardId: number | null };

function parseSprintValue(v: unknown): JiraSprint | null {
    if (isPlainObject(v)) {
        const id = num(v.id);
        if (id === null) return null;
        return {
            id, name: str(v.name) || `Sprint ${id}`, state: (str(v.state) || 'unknown').toLowerCase(),
            startDate: str(v.startDate), endDate: str(v.endDate), originBoardId: num(v.originBoardId),
        };
    }
    if (typeof v === 'string') {
        // Legacy "com.atlassian.greenhopper.service.sprint.Sprint@abc[id=1,name=Sprint 1,state=ACTIVE,...]" form
        const m = v.match(/\[(.*)\]$/);
        if (!m) return null;
        const kv: Record<string, string> = {};
        for (const pair of m[1].split(',')) {
            const idx = pair.indexOf('=');
            if (idx > 0) kv[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
        }
        const id = num(kv.id);
        if (id === null) return null;
        const clean = (s?: string) => (!s || s === '<null>' ? null : s);
        return {
            id, name: kv.name || `Sprint ${id}`, state: (kv.state || 'unknown').toLowerCase(),
            startDate: clean(kv.startDate), endDate: clean(kv.endDate), originBoardId: num(kv.rapidViewId),
        };
    }
    return null;
}

/** The issue's latest sprint: the one with the greatest startDate, else the last entry. */
function latestSprint(raw: unknown): JiraSprint | null {
    const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(parseSprintValue).filter((s): s is JiraSprint => !!s);
    if (!list.length) return null;
    let best = list[list.length - 1];
    let bestTime = best.startDate ? new Date(best.startDate).getTime() : -Infinity;
    for (const s of list) {
        const t = s.startDate ? new Date(s.startDate).getTime() : -Infinity;
        if (t > bestTime) { best = s; bestTime = t; }
    }
    return best;
}

function jqlString(s: string): string { return `"${String(s).replace(/["\\]/g, '')}"`; }
function isIsoDate(s: unknown): s is string { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

async function fetchBoardSprints(creds: JiraCreds, boardId: number, state: string): Promise<JiraSprint[]> {
    const out: JiraSprint[] = [];
    let startAt = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
        const data = await jiraFetch(creds, `/rest/agile/1.0/board/${boardId}/sprint?state=${encodeURIComponent(state)}&startAt=${startAt}&maxResults=50`);
        const values: unknown[] = Array.isArray(data?.values) ? data.values : [];
        for (const v of values) { const s = parseSprintValue(v); if (s) out.push(s); }
        if (data?.isLast !== false || values.length === 0) break;
        startAt += values.length;
    }
    return out;
}

type UsageBody = {
    projectKeys?: string[];
    boardId?: number;
    sprintIds?: number[];
    from?: string;
    to?: string;
    tribeByProjectKey?: Record<string, string>;
    sprintsInRange?: number;
};

async function jiraUsage(creds: JiraCreds, jiraCfg: JiraConfig, settings: SettingsConfig, body: UsageBody) {
    const projectKeys = toStringArray(body.projectKeys);
    let sprintIds = toNumberArray(body.sprintIds);
    const boardId = num(body.boardId);
    const tribeByProjectKey = normaliseStringMap(body.tribeByProjectKey, 'tribeByProjectKey', false);
    const sprintsInRange = (num(body.sprintsInRange) ?? 0) > 0 ? (num(body.sprintsInRange) as number) : 6;

    if (body.from !== undefined && !isIsoDate(body.from)) throw new ValidationError('from must be YYYY-MM-DD');
    if (body.to !== undefined && !isIsoDate(body.to)) throw new ValidationError('to must be YYYY-MM-DD');

    // A board can't be expressed in JQL, so resolve it to its sprints.
    if (boardId !== null && !sprintIds.length) {
        const sprints = await fetchBoardSprints(creds, boardId, 'active,future,closed');
        sprintIds = sprints
            .filter(s => {
                if (!body.from && !body.to) return true;
                const start = s.startDate ? s.startDate.slice(0, 10) : null;
                const end = s.endDate ? s.endDate.slice(0, 10) : null;
                if (body.from && end && end < body.from) return false;
                if (body.to && start && start > body.to) return false;
                return true;
            })
            .map(s => s.id);
        if (!sprintIds.length) throw new ValidationError(`Board ${boardId} has no sprints in the requested range`);
    }

    const clauses: string[] = [];
    const keys = projectKeys.length ? projectKeys : jiraCfg.projectKeys;
    if (keys.length) clauses.push(`project in (${keys.map(jqlString).join(',')})`);
    if (sprintIds.length) clauses.push(`sprint in (${sprintIds.join(',')})`);
    if (body.from) clauses.push(`updated >= ${jqlString(body.from)}`);
    if (body.to) clauses.push(`created <= ${jqlString(body.to)}`);
    if (!clauses.length) throw new ValidationError('Provide projectKeys, boardId or sprintIds (or configure projectKeys on the Jira integration)');
    const jql = `${clauses.join(' AND ')} ORDER BY updated DESC`;

    const spField = jiraCfg.storyPointsFieldId;
    const sprintField = jiraCfg.sprintFieldId;
    const fields = ['summary', 'status', 'assignee', 'project', 'issuetype', 'resolutiondate', 'created'];
    if (spField) fields.push(spField);
    if (sprintField) fields.push(sprintField);

    const issues: any[] = [];
    let nextPageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
        const data = await jiraFetch(creds, '/rest/api/3/search/jql', {
            method: 'POST',
            body: JSON.stringify({ jql, fields, maxResults: 100, ...(nextPageToken ? { nextPageToken } : {}) }),
        });
        if (Array.isArray(data?.issues)) issues.push(...data.issues);
        nextPageToken = typeof data?.nextPageToken === 'string' && data.nextPageToken ? data.nextPageToken : undefined;
        if (!nextPageToken || data?.isLast === true) break;
    }

    const calibrationFor = (projectKey: string) => {
        const tribe = tribeByProjectKey[projectKey] || '*';
        return settings.calibration[tribe] || settings.calibration['*'] || DEFAULT_CALIBRATION['*'];
    };

    type AssigneeAgg = { accountId: string; displayName: string; email: string; points: number; donePoints: number; issues: number };
    type ProjectAgg = { key: string; name: string; tribe: string; points: number; donePoints: number; issues: number };
    type SprintAgg = { sprintId: number; sprintName: string; state: string; startDate: string | null; endDate: string | null; points: number; donePoints: number; issues: number; byAssignee: Record<string, number> };
    type QuarterAgg = { quarterKey: string; points: number; donePoints: number; issues: number };

    const byAssignee = new Map<string, AssigneeAgg>();
    const byProject = new Map<string, ProjectAgg>();
    const bySprint = new Map<number, SprintAgg>();
    const byQuarter = new Map<string, QuarterAgg>();
    const fteBySprint: Record<string, number> = {};
    let totalPoints = 0;
    let donePointsTotal = 0;

    for (const issue of issues) {
        const f = issue?.fields || {};
        const points = spField ? (num(f[spField]) ?? 0) : 0;
        const done = String(f.status?.statusCategory?.key || '').toLowerCase() === 'done'
            || String(f.status?.statusCategory?.name || '').toLowerCase() === 'done';
        const donePts = done ? points : 0;
        totalPoints += points;
        donePointsTotal += donePts;

        const accountId = f.assignee?.accountId || 'unassigned';
        const a = byAssignee.get(accountId) || {
            accountId, displayName: f.assignee?.displayName || 'Unassigned', email: f.assignee?.emailAddress || '',
            points: 0, donePoints: 0, issues: 0,
        };
        a.points += points; a.donePoints += donePts; a.issues += 1;
        byAssignee.set(accountId, a);

        const projectKey = f.project?.key || (typeof issue?.key === 'string' ? issue.key.split('-')[0] : 'UNKNOWN');
        const p = byProject.get(projectKey) || {
            key: projectKey, name: f.project?.name || projectKey, tribe: tribeByProjectKey[projectKey] || '*',
            points: 0, donePoints: 0, issues: 0,
        };
        p.points += points; p.donePoints += donePts; p.issues += 1;
        byProject.set(projectKey, p);

        const sprint = sprintField ? latestSprint(f[sprintField]) : null;
        if (sprint) {
            const s = bySprint.get(sprint.id) || {
                sprintId: sprint.id, sprintName: sprint.name, state: sprint.state, startDate: sprint.startDate, endDate: sprint.endDate,
                points: 0, donePoints: 0, issues: 0, byAssignee: {},
            };
            s.points += points; s.donePoints += donePts; s.issues += 1;
            s.byAssignee[accountId] = (s.byAssignee[accountId] || 0) + points;
            bySprint.set(sprint.id, s);
            const sk = String(sprint.id);
            fteBySprint[sk] = (fteBySprint[sk] || 0) + points / calibrationFor(projectKey).pointsPerSprintPerFte;
        }

        const qk = quarterKey(sprint?.startDate) || quarterKey(f.resolutiondate) || quarterKey(f.created);
        if (qk) {
            const q = byQuarter.get(qk) || { quarterKey: qk, points: 0, donePoints: 0, issues: 0 };
            q.points += points; q.donePoints += donePts; q.issues += 1;
            byQuarter.set(qk, q);
        }
    }

    const fteByProject: Record<string, number> = {};
    for (const p of byProject.values()) {
        fteByProject[p.key] = round2(p.points / (calibrationFor(p.key).pointsPerSprintPerFte * sprintsInRange));
    }
    for (const k of Object.keys(fteBySprint)) fteBySprint[k] = round2(fteBySprint[k]);

    return {
        storyPointsFieldId: spField || null,
        issueCount: issues.length,
        totalPoints: round2(totalPoints),
        donePoints: round2(donePointsTotal),
        byAssignee: [...byAssignee.values()].sort((x, y) => y.points - x.points || x.displayName.localeCompare(y.displayName)),
        byProject: [...byProject.values()].sort((x, y) => x.key.localeCompare(y.key)),
        bySprint: [...bySprint.values()].sort((x, y) => (x.startDate || '').localeCompare(y.startDate || '') || x.sprintId - y.sprintId),
        byQuarter: [...byQuarter.values()].sort((x, y) => x.quarterKey.localeCompare(y.quarterKey)),
        fteEstimate: { byProject: fteByProject, bySprint: fteBySprint },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Planview
// ─────────────────────────────────────────────────────────────────────────────

type PlanviewCreds = { config: PlanviewConfig; secret: string };

function planviewCreds(stored: Stored): PlanviewCreds {
    const cfg = stored.planview?.config;
    if (!cfg?.baseUrl || !stored.planview?.secretEnc) {
        throw new ValidationError('Planview is not configured for this workspace (baseUrl and secret are required)');
    }
    if (cfg.flavour === 'adaptivework' && !cfg.username) throw new ValidationError('Planview AdaptiveWork requires a username');
    if (cfg.flavour === 'generic' && (!cfg.generic?.projectsPath)) throw new ValidationError('Planview generic connector requires generic.projectsPath');
    return { config: cfg, secret: decrypt(stored.planview.secretEnc) };
}

async function planviewJson(url: string, init: RequestInit, label: string): Promise<any> {
    const res = await fetchWithTimeout(url, { ...init, headers: { Accept: 'application/json', ...(init.headers as Record<string, string> | undefined) } }, label);
    const { text, json } = await readBody(res);
    if (!res.ok) throw new UpstreamError('Planview', res.status, shortMessage(json, text));
    return json;
}

// ── AdaptiveWork (Clarizen) ──

function clarizenLiteral(s: string): string { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

async function adaptiveLogin(pv: PlanviewCreds): Promise<string> {
    const data = await planviewJson(`${pv.config.baseUrl}/API2.0/services/authentication/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userName: pv.config.username, password: pv.secret }),
    }, 'Planview AdaptiveWork login');
    const sessionId = data?.sessionId;
    if (typeof sessionId !== 'string' || !sessionId) throw new UpstreamError('Planview', 502, 'AdaptiveWork login returned no sessionId');
    return sessionId;
}

async function adaptiveQuery(pv: PlanviewCreds, sessionId: string, q: string): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    const limit = 100;
    let from = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
        const data = await planviewJson(`${pv.config.baseUrl}/API2.0/services/data/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Session ${sessionId}` },
            body: JSON.stringify({ q, paging: { from, limit } }),
        }, 'Planview AdaptiveWork query');
        const entities: unknown[] = Array.isArray(data?.entities) ? data.entities : [];
        for (const e of entities) if (isPlainObject(e)) out.push(e);
        if (!data?.paging?.hasMore || entities.length === 0) break;
        from += entities.length;
    }
    return out;
}

function clarizenState(v: unknown): string | null {
    const s = str(v);
    if (!s) return null;
    return s.replace(/^\/State\//, '');
}

function adaptiveProjects(entities: Record<string, unknown>[]): NormalisedProject[] {
    return entities.map(e => ({
        externalId: str(e.id) || str(e.Id) || '',
        name: str(e.Name) || '',
        status: clarizenState(e.State),
        startDate: str(e.StartDate),
        endDate: str(e.DueDate),
        manager: str(e.ProjectManager),
    })).filter(p => p.externalId);
}

function adaptiveAssignments(entities: Record<string, unknown>[], projectId: string): NormalisedAssignment[] {
    return entities.map(e => {
        const units = e.Units;
        let percent: number | null = null;
        let hours: number | null = null;
        if (isPlainObject(units)) {
            const value = num(units.value ?? units.Value);
            const unit = String(units.unit ?? units.Unit ?? '').toLowerCase();
            if (unit.includes('hour') || unit === 'h') hours = value; else percent = value;
        } else {
            percent = num(units);
        }
        const resource = e.Resource;
        const a: NormalisedAssignment = {
            externalId: str(e.id) || str(e.Id) || '',
            projectExternalId: str(e.WorkItem) || projectId,
            resourceName: str(resource) || '',
            resourceEmail: isPlainObject(resource) ? (str(resource.Email) || str(resource.email)) : null,
            role: str(e.Role),
            startDate: str(e.StartDate),
            endDate: str(e.DueDate),
            percent,
        };
        if (hours !== null) a.hours = hours;
        return a;
    });
}

// ── Generic REST / OData ──

function genericHeaders(pv: PlanviewCreds): Record<string, string> {
    const name = pv.config.generic?.authHeaderName?.trim() || 'Authorization';
    const value = name.toLowerCase() === 'authorization' ? `Bearer ${pv.secret}` : pv.secret;
    return { [name]: value };
}

function unwrapList(data: unknown): Record<string, unknown>[] {
    let list: unknown = data;
    if (isPlainObject(data)) {
        for (const k of ['value', 'data', 'items', 'results', 'entities', 'records']) {
            if (Array.isArray(data[k])) { list = data[k]; break; }
        }
    }
    return Array.isArray(list) ? list.filter(isPlainObject) : [];
}

function mapWith(fieldMap: Record<string, string>, item: Record<string, unknown>, target: string, fallbacks: string[] = []): unknown {
    const candidates = [fieldMap[target], target, ...fallbacks].filter((c): c is string => !!c);
    for (const c of candidates) {
        const v = getPath(item, c);
        if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
}

function genericProjects(pv: PlanviewCreds, items: Record<string, unknown>[]): NormalisedProject[] {
    const fm = pv.config.generic?.fieldMap || {};
    return items.map(it => ({
        externalId: str(mapWith(fm, it, 'externalId', ['id', 'Id', 'ID', 'ProjectId', 'projectId'])) || '',
        name: str(mapWith(fm, it, 'name', ['Name', 'title', 'Title'])) || '',
        status: str(mapWith(fm, it, 'status', ['Status', 'state', 'State'])),
        startDate: str(mapWith(fm, it, 'startDate', ['StartDate', 'start_date', 'start'])),
        endDate: str(mapWith(fm, it, 'endDate', ['EndDate', 'end_date', 'end', 'finishDate', 'FinishDate'])),
        manager: str(mapWith(fm, it, 'manager', ['Manager', 'projectManager', 'ProjectManager', 'owner', 'Owner'])),
    })).filter(p => p.externalId);
}

function genericAssignments(pv: PlanviewCreds, items: Record<string, unknown>[], projectId: string): NormalisedAssignment[] {
    const fm = pv.config.generic?.fieldMap || {};
    return items.map(it => {
        const a: NormalisedAssignment = {
            externalId: str(mapWith(fm, it, 'externalId', ['id', 'Id', 'ID', 'AssignmentId', 'assignmentId'])) || '',
            projectExternalId: str(mapWith(fm, it, 'projectExternalId', ['projectId', 'ProjectId', 'project'])) || projectId,
            resourceName: str(mapWith(fm, it, 'resourceName', ['resource', 'Resource', 'ResourceName', 'name', 'Name'])) || '',
            resourceEmail: str(mapWith(fm, it, 'resourceEmail', ['email', 'Email', 'ResourceEmail'])),
            role: str(mapWith(fm, it, 'role', ['Role'])),
            startDate: str(mapWith(fm, it, 'startDate', ['StartDate', 'start_date', 'start'])),
            endDate: str(mapWith(fm, it, 'endDate', ['EndDate', 'end_date', 'end', 'finishDate', 'FinishDate'])),
            percent: num(mapWith(fm, it, 'percent', ['Percent', 'allocation', 'Allocation', 'units', 'Units'])),
        };
        const hours = num(mapWith(fm, it, 'hours', ['Hours', 'effort', 'Effort']));
        if (hours !== null) a.hours = hours;
        return a;
    });
}

function withQuery(url: string, key: string, value: string): string {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

async function planviewProjects(pv: PlanviewCreds): Promise<NormalisedProject[]> {
    if (pv.config.flavour === 'adaptivework') {
        const sessionId = await adaptiveLogin(pv);
        const rows = await adaptiveQuery(pv, sessionId, 'SELECT Name, StartDate, DueDate, State, ProjectManager FROM Project');
        return adaptiveProjects(rows);
    }
    const data = await planviewJson(`${pv.config.baseUrl}${pv.config.generic!.projectsPath}`, { method: 'GET', headers: genericHeaders(pv) }, 'Planview');
    return genericProjects(pv, unwrapList(data));
}

async function planviewAssignments(pv: PlanviewCreds, projectId: string): Promise<NormalisedAssignment[]> {
    if (pv.config.flavour === 'adaptivework') {
        const sessionId = await adaptiveLogin(pv);
        const rows = await adaptiveQuery(pv, sessionId,
            `SELECT WorkItem, Resource, StartDate, DueDate, Units, Role FROM RegularResourceLink WHERE WorkItem = '${clarizenLiteral(projectId)}'`);
        return adaptiveAssignments(rows, projectId);
    }
    if (!pv.config.generic?.assignmentsPath) throw new ValidationError('Planview generic connector requires generic.assignmentsPath');
    const url = withQuery(`${pv.config.baseUrl}${pv.config.generic.assignmentsPath}`, 'projectId', projectId);
    const data = await planviewJson(url, { method: 'GET', headers: genericHeaders(pv) }, 'Planview');
    return genericAssignments(pv, unwrapList(data), projectId);
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /config
// ─────────────────────────────────────────────────────────────────────────────

async function saveConfig(sql: Sql, wsId: string, stored: Stored, body: any) {
    if (!isPlainObject(body)) throw new ValidationError('Body must be a JSON object');
    if (body.jira === undefined && body.planview === undefined && body.settings === undefined) {
        throw new ValidationError('Provide at least one of jira, planview or settings');
    }

    if (body.jira !== undefined) {
        if (!isPlainObject(body.jira)) throw new ValidationError('jira must be an object');
        const existing = stored.jira?.config || { domain: '', email: '', projectKeys: [], boardIds: [] };
        const next: JiraConfig = { ...existing };
        if (body.jira.domain !== undefined) {
            const d = normaliseDomain(body.jira.domain);
            if (!d) throw new ValidationError('jira.domain must be a hostname such as your-site.atlassian.net');
            if (d !== existing.domain) { next.storyPointsFieldId = undefined; next.sprintFieldId = undefined; }
            next.domain = d;
        }
        if (body.jira.email !== undefined) {
            if (typeof body.jira.email !== 'string' || !body.jira.email.trim()) throw new ValidationError('jira.email is required');
            next.email = body.jira.email.trim();
        }
        if (body.jira.projectKeys !== undefined) {
            if (!Array.isArray(body.jira.projectKeys)) throw new ValidationError('jira.projectKeys must be an array');
            next.projectKeys = toStringArray(body.jira.projectKeys).map(k => k.toUpperCase());
        }
        if (body.jira.boardIds !== undefined) {
            if (!Array.isArray(body.jira.boardIds)) throw new ValidationError('jira.boardIds must be an array');
            next.boardIds = toNumberArray(body.jira.boardIds);
        }
        if (body.jira.storyPointsFieldId !== undefined) {
            next.storyPointsFieldId = typeof body.jira.storyPointsFieldId === 'string' && body.jira.storyPointsFieldId.trim()
                ? body.jira.storyPointsFieldId.trim() : undefined;
        }
        if (!next.domain) throw new ValidationError('jira.domain is required');
        if (!next.email) throw new ValidationError('jira.email is required');
        const token = typeof body.jira.apiToken === 'string' && body.jira.apiToken.trim() ? body.jira.apiToken.trim() : null;
        await upsertProvider(sql, wsId, 'jira', next, token ? encrypt(token) : null);
    }

    if (body.planview !== undefined) {
        if (!isPlainObject(body.planview)) throw new ValidationError('planview must be an object');
        const existing = stored.planview?.config || { flavour: 'generic' as const, baseUrl: '' };
        const next: PlanviewConfig = { ...existing };
        if (body.planview.flavour !== undefined) {
            if (body.planview.flavour !== 'adaptivework' && body.planview.flavour !== 'generic') {
                throw new ValidationError('planview.flavour must be "adaptivework" or "generic"');
            }
            next.flavour = body.planview.flavour;
        }
        if (body.planview.baseUrl !== undefined) {
            const u = normaliseHttpsUrl(body.planview.baseUrl);
            if (!u) throw new ValidationError('planview.baseUrl must be an https:// URL');
            next.baseUrl = u;
        }
        if (body.planview.username !== undefined) {
            next.username = typeof body.planview.username === 'string' && body.planview.username.trim() ? body.planview.username.trim() : undefined;
        }
        if (body.planview.generic !== undefined) {
            if (!isPlainObject(body.planview.generic)) throw new ValidationError('planview.generic must be an object');
            const g = body.planview.generic;
            const prev = existing.generic;
            next.generic = {
                projectsPath: g.projectsPath !== undefined ? normalisePath(g.projectsPath, 'planview.generic.projectsPath') : (prev?.projectsPath || ''),
                assignmentsPath: g.assignmentsPath !== undefined ? normalisePath(g.assignmentsPath, 'planview.generic.assignmentsPath') : (prev?.assignmentsPath || ''),
                authHeaderName: g.authHeaderName !== undefined
                    ? (typeof g.authHeaderName === 'string' && g.authHeaderName.trim() ? g.authHeaderName.trim() : undefined)
                    : prev?.authHeaderName,
                fieldMap: g.fieldMap !== undefined ? normaliseStringMap(g.fieldMap, 'planview.generic.fieldMap', true) : (prev?.fieldMap || {}),
            };
            if (next.generic.authHeaderName && !/^[A-Za-z0-9-]+$/.test(next.generic.authHeaderName)) {
                throw new ValidationError('planview.generic.authHeaderName must be a valid header name');
            }
        }
        if (!next.baseUrl) throw new ValidationError('planview.baseUrl is required');
        if (next.flavour === 'generic' && !next.generic) next.generic = { projectsPath: '', assignmentsPath: '', fieldMap: {} };
        const secret = typeof body.planview.secret === 'string' && body.planview.secret ? body.planview.secret : null;
        await upsertProvider(sql, wsId, 'planview', next, secret ? encrypt(secret) : null);
    }

    if (body.settings !== undefined) {
        if (!isPlainObject(body.settings)) throw new ValidationError('settings must be an object');
        const existing = stored.settings?.config || { calibration: { ...DEFAULT_CALIBRATION }, mappings: { jira: {}, planview: {} } };
        const next: SettingsConfig = {
            calibration: body.settings.calibration !== undefined ? normaliseCalibration(body.settings.calibration, true) : existing.calibration,
            mappings: { ...existing.mappings },
        };
        if (body.settings.mappings !== undefined) {
            if (!isPlainObject(body.settings.mappings)) throw new ValidationError('settings.mappings must be an object');
            const m = body.settings.mappings;
            if (m.jira !== undefined) next.mappings.jira = normaliseStringMap(m.jira, 'settings.mappings.jira', true);
            if (m.planview !== undefined) next.mappings.planview = normaliseStringMap(m.planview, 'settings.mappings.planview', true);
        }
        await upsertProvider(sql, wsId, 'settings', next, null);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

    const user = authenticate(event);
    if (!user) return fail('Unauthorized', 401);

    const wsId = event.queryStringParameters?.wsId;
    if (!wsId || !UUID_RE.test(wsId)) return fail('wsId query parameter is required', 400);

    const subpath = (event.path || '').replace(/^.*\/api\/integrations/, '').replace(/\/+$/, '') || '/';
    const method = event.httpMethod;
    const qs = event.queryStringParameters || {};
    const sql = getDb();

    try {
        await ensureTable(sql);

        const access = await resolveAccess(sql, user, wsId);
        if (access === 'not_found') return fail('Workspace not found', 404);
        if (!access.canRead) return fail('You do not have access to this workspace', 403);

        let body: any = {};
        if (method === 'POST') {
            try { body = event.body ? JSON.parse(event.body) : {}; } catch { return fail('Invalid JSON body', 400); }
        }

        const stored = await loadStored(sql, wsId);
        const settings = buildConfigResponse(stored).settings;

        // ── Config ──
        if (subpath === '/config' && method === 'GET') return ok(buildConfigResponse(stored));
        if (subpath === '/config' && method === 'POST') {
            if (!access.canWrite) return fail('You do not have write access to this workspace', 403);
            await saveConfig(sql, wsId, stored, body);
            return ok(buildConfigResponse(await loadStored(sql, wsId)));
        }

        // ── Jira ──
        if (subpath === '/jira/test' && method === 'POST') {
            const creds = jiraCreds(stored);
            const [me, fields] = await Promise.all([
                jiraFetch(creds, '/rest/api/3/myself'),
                jiraFetch(creds, '/rest/api/3/field'),
            ]);
            const cfg = stored.jira!.config;
            const detected = detectJiraFields(Array.isArray(fields) ? fields : [], cfg.storyPointsFieldId);
            cfg.storyPointsFieldId = detected.storyPointsFieldId;
            cfg.sprintFieldId = detected.sprintFieldId;
            if (access.canWrite) await upsertProvider(sql, wsId, 'jira', cfg, null);
            return ok({
                ok: true,
                displayName: me?.displayName || '',
                accountId: me?.accountId || '',
                storyPointsFieldId: detected.storyPointsFieldId || null,
                sprintFieldId: detected.sprintFieldId || null,
            });
        }

        if (subpath === '/jira/projects' && method === 'GET') {
            const creds = jiraCreds(stored);
            const data = await jiraFetch(creds, '/rest/api/3/project/search?maxResults=100');
            const values: any[] = Array.isArray(data?.values) ? data.values : [];
            return ok({ projects: values.map(p => ({ id: String(p.id), key: p.key, name: p.name, projectTypeKey: p.projectTypeKey || null })) });
        }

        if (subpath === '/jira/boards' && method === 'GET') {
            const creds = jiraCreds(stored);
            const projectKey = (qs.projectKey || '').trim();
            if (!projectKey) return fail('projectKey query parameter is required', 400);
            const data = await jiraFetch(creds, `/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(projectKey)}&maxResults=50`);
            const values: any[] = Array.isArray(data?.values) ? data.values : [];
            return ok({ boards: values.map(b => ({ id: Number(b.id), name: b.name, type: b.type || null })) });
        }

        if (subpath === '/jira/sprints' && method === 'GET') {
            const creds = jiraCreds(stored);
            const boardId = num(qs.boardId);
            if (boardId === null) return fail('boardId query parameter is required', 400);
            const state = (qs.state || 'active,future,closed').split(',').map(s => s.trim()).filter(s => ['active', 'future', 'closed'].includes(s)).join(',');
            if (!state) return fail('state must be a comma list of active, future, closed', 400);
            const sprints = await fetchBoardSprints(creds, boardId, state);
            return ok({ sprints });
        }

        if (subpath === '/jira/usage' && method === 'POST') {
            const creds = jiraCreds(stored);
            const cfg = await ensureJiraFieldIds(creds, stored, sql, wsId, access.canWrite);
            return ok(await jiraUsage(creds, cfg, settings, body as UsageBody));
        }

        // ── Planview ──
        if (subpath === '/planview/test' && method === 'POST') {
            const pv = planviewCreds(stored);
            if (pv.config.flavour === 'adaptivework') {
                await adaptiveLogin(pv);
                return ok({ ok: true, flavour: 'adaptivework' });
            }
            const projects = await planviewProjects(pv);
            return ok({ ok: true, flavour: 'generic', projectCount: projects.length });
        }

        if (subpath === '/planview/projects' && method === 'GET') {
            const pv = planviewCreds(stored);
            return ok({ projects: await planviewProjects(pv) });
        }

        if (subpath === '/planview/assignments' && method === 'GET') {
            const pv = planviewCreds(stored);
            const projectId = (qs.projectId || '').trim();
            if (!projectId) return fail('projectId query parameter is required', 400);
            return ok({ assignments: await planviewAssignments(pv, projectId) });
        }

        return fail('Not found', 404);
    } catch (e: any) {
        if (e instanceof ValidationError) return fail(e.message, 400);
        if (e instanceof TimeoutError) return fail(e.message, 504);
        if (e instanceof UpstreamError) return fail(`${e.provider} ${e.status}: ${e.message}`, 502, { upstreamStatus: e.status });
        console.error('[integrations]', e);
        return fail('Server error: ' + (e?.message || 'unknown'), 500);
    }
};
