/**
 * Workspace integration configuration (`workspace_integrations`), shared by the legacy /api/integrations routes
 * and the v2 sync/planview routes. Secrets are encrypted (HS-09) and never returned.
 * HS-08#AC1: changing where a secret is sent (Jira domain/email, Planview baseUrl/flavour/username/auth header)
 * without supplying a new secret clears the stored secret.
 */
import type { Queryable } from './db';
import { json } from './db';
import { decryptSecret, encryptSecret } from './crypto';
import { badRequest } from './errors';
import { JIRA_DOMAIN_MESSAGE, assertPublicHttpsUrl, normaliseJiraDomain } from './net';
import { DEFAULT_CALIBRATION, type Calibration } from './jira/aggregate';

export interface JiraConfig {
  domain: string;
  email: string;
  projectKeys: string[];
  boardIds: number[];
  storyPointsFieldId?: string;
  sprintFieldId?: string;
}
export interface PlanviewGeneric {
  projectsPath: string;
  assignmentsPath: string;
  authHeaderName?: string;
  fieldMap: Record<string, string>;
}
export interface PlanviewConfig {
  flavour: 'adaptivework' | 'generic';
  baseUrl: string;
  username?: string;
  generic?: PlanviewGeneric;
}
export interface SettingsConfig {
  calibration: Record<string, Calibration>;
  mappings: { jira: Record<string, string>; planview: Record<string, string> };
}
export interface Stored {
  jira?: { config: JiraConfig; secretEnc: string | null };
  planview?: { config: PlanviewConfig; secretEnc: string | null };
  settings?: { config: SettingsConfig };
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const strArr = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);
const numArr = (v: unknown) => (Array.isArray(v) ? v.map(Number).filter((n) => Number.isFinite(n)) : []);
const optStr = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export function stringMap(raw: unknown, label: string, strict: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw === undefined || raw === null) return out;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    if (strict) throw badRequest(`${label} must be an object`, { [label]: 'Must be an object' });
    return out;
  }
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== 'string') {
      if (strict) throw badRequest(`${label}["${k}"] must be a string`, { [label]: 'Values must be strings' });
      continue;
    }
    if (k.trim() && v.trim()) out[k.trim()] = v.trim();
  }
  return out;
}

export function calibrationMap(raw: unknown, strict: boolean): Record<string, Calibration> {
  const out: Record<string, Calibration> = {};
  for (const [tribe, val] of Object.entries(obj(raw))) {
    const v = obj(val);
    const pps = Number(v.pointsPerSprintPerFte);
    const sld = Number(v.sprintLengthDays);
    if (!(pps > 0) || !(sld > 0)) {
      if (strict) throw badRequest('Calibration values must be positive numbers', { calibration: tribe });
      continue;
    }
    out[tribe] = { pointsPerSprintPerFte: pps, sprintLengthDays: sld };
  }
  if (!out['*']) out['*'] = { ...DEFAULT_CALIBRATION };
  return out;
}

export async function loadStored(q: Queryable, wsId: string): Promise<Stored> {
  const rows = await q.query<{ provider: string; config: unknown; secret_enc: string | null }>(
    `SELECT provider, config, secret_enc FROM workspace_integrations WHERE workspace_id = $1`,
    [wsId],
  );
  const stored: Stored = {};
  for (const row of rows) {
    const cfg = obj(json(row.config, {}));
    if (row.provider === 'jira') {
      stored.jira = {
        config: {
          domain: typeof cfg.domain === 'string' ? cfg.domain : '',
          email: typeof cfg.email === 'string' ? cfg.email : '',
          projectKeys: strArr(cfg.projectKeys),
          boardIds: numArr(cfg.boardIds),
          storyPointsFieldId: optStr(cfg.storyPointsFieldId),
          sprintFieldId: optStr(cfg.sprintFieldId),
        },
        secretEnc: row.secret_enc || null,
      };
    } else if (row.provider === 'planview') {
      const g = cfg.generic ? obj(cfg.generic) : null;
      stored.planview = {
        config: {
          flavour: cfg.flavour === 'adaptivework' ? 'adaptivework' : 'generic',
          baseUrl: typeof cfg.baseUrl === 'string' ? cfg.baseUrl : '',
          username: optStr(cfg.username),
          generic: g
            ? {
                projectsPath: typeof g.projectsPath === 'string' ? g.projectsPath : '',
                assignmentsPath: typeof g.assignmentsPath === 'string' ? g.assignmentsPath : '',
                authHeaderName: optStr(g.authHeaderName),
                fieldMap: stringMap(g.fieldMap, 'fieldMap', false),
              }
            : undefined,
        },
        secretEnc: row.secret_enc || null,
      };
    } else if (row.provider === 'settings') {
      const m = obj(cfg.mappings);
      stored.settings = {
        config: {
          calibration: calibrationMap(cfg.calibration, false),
          mappings: {
            jira: stringMap(m.jira, 'mappings.jira', false),
            planview: stringMap(m.planview, 'mappings.planview', false),
          },
        },
      };
    }
  }
  return stored;
}

export function jiraConfigured(s: Stored): boolean {
  return !!(s.jira?.config.domain && s.jira.config.email && s.jira.secretEnc);
}
export function planviewConfigured(s: Stored): boolean {
  const p = s.planview?.config;
  return !!(p?.baseUrl && s.planview?.secretEnc && (p.flavour === 'generic' || p.username));
}

export function configResponse(s: Stored) {
  const j = s.jira?.config;
  const p = s.planview?.config;
  return {
    jira: {
      configured: jiraConfigured(s),
      domain: j?.domain || '',
      email: j?.email || '',
      projectKeys: j?.projectKeys || [],
      boardIds: j?.boardIds || [],
      ...(j?.storyPointsFieldId ? { storyPointsFieldId: j.storyPointsFieldId } : {}),
      hasSecret: !!s.jira?.secretEnc,
    },
    planview: {
      configured: planviewConfigured(s),
      flavour: p?.flavour || 'generic',
      baseUrl: p?.baseUrl || '',
      ...(p?.username ? { username: p.username } : {}),
      hasSecret: !!s.planview?.secretEnc,
      ...(p?.generic ? { generic: p.generic } : {}),
    },
    settings: {
      calibration: s.settings?.config.calibration || { '*': { ...DEFAULT_CALIBRATION } },
      mappings: { jira: s.settings?.config.mappings.jira || {}, planview: s.settings?.config.mappings.planview || {} },
    },
  };
}

/** secret: string = replace, null = clear, undefined = keep. */
export async function upsertProvider(
  q: Queryable,
  wsId: string,
  provider: 'jira' | 'planview' | 'settings',
  config: unknown,
  encrypted: string | null | undefined,
) {
  if (encrypted === undefined) {
    await q.query(
      `INSERT INTO workspace_integrations (workspace_id, provider, config) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (workspace_id, provider) DO UPDATE SET config = EXCLUDED.config, updated_at = CURRENT_TIMESTAMP`,
      [wsId, provider, JSON.stringify(config)],
    );
  } else {
    await q.query(
      `INSERT INTO workspace_integrations (workspace_id, provider, config, secret_enc) VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (workspace_id, provider) DO UPDATE SET config = EXCLUDED.config, secret_enc = EXCLUDED.secret_enc,
         updated_at = CURRENT_TIMESTAMP`,
      [wsId, provider, JSON.stringify(config), encrypted],
    );
  }
}

function normalisePath(raw: unknown, label: string): string {
  if (raw === undefined || raw === null || raw === '') return '';
  if (typeof raw !== 'string' || !raw.trim().startsWith('/'))
    throw badRequest(`${label} must start with "/"`, { [label]: 'Must start with /' });
  return raw.trim();
}

export interface SaveResult {
  secretCleared: { jira: boolean; planview: boolean };
}

/** POST /api/integrations/config body: { jira?, planview?, settings? } (HS-08). */
export async function saveConfig(q: Queryable, wsId: string, stored: Stored, body: unknown): Promise<SaveResult> {
  const b = obj(body);
  const result: SaveResult = { secretCleared: { jira: false, planview: false } };
  if (b.jira === undefined && b.planview === undefined && b.settings === undefined) {
    throw badRequest('Provide at least one of jira, planview or settings');
  }
  if (b.jira !== undefined) {
    const j = obj(b.jira);
    const existing: JiraConfig = stored.jira?.config ?? { domain: '', email: '', projectKeys: [], boardIds: [] };
    const next: JiraConfig = { ...existing };
    if (j.domain !== undefined) {
      const d = normaliseJiraDomain(j.domain);
      if (!d) throw badRequest(JIRA_DOMAIN_MESSAGE, { domain: JIRA_DOMAIN_MESSAGE });
      if (d !== existing.domain) {
        next.storyPointsFieldId = undefined;
        next.sprintFieldId = undefined;
      }
      next.domain = d;
    }
    if (j.email !== undefined) {
      if (typeof j.email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(j.email.trim()))
        throw badRequest('Enter the Jira account email', { email: 'Required' });
      next.email = j.email.trim();
    }
    if (j.projectKeys !== undefined) {
      if (!Array.isArray(j.projectKeys))
        throw badRequest('projectKeys must be an array', { projectKeys: 'Must be a list' });
      next.projectKeys = strArr(j.projectKeys)
        .map((k) => k.toUpperCase())
        .filter((k) => /^[A-Z][A-Z0-9_]{0,19}$/.test(k));
    }
    if (j.boardIds !== undefined) {
      if (!Array.isArray(j.boardIds)) throw badRequest('boardIds must be an array', { boardIds: 'Must be a list' });
      next.boardIds = numArr(j.boardIds);
    }
    if (j.storyPointsFieldId !== undefined) next.storyPointsFieldId = optStr(j.storyPointsFieldId);
    if (!next.domain) throw badRequest(JIRA_DOMAIN_MESSAGE, { domain: JIRA_DOMAIN_MESSAGE });
    if (!next.email) throw badRequest('Enter the Jira account email', { email: 'Required' });
    const token = optStr(j.apiToken);
    const moved = !!stored.jira?.secretEnc && (next.domain !== existing.domain || next.email !== existing.email);
    let secret: string | null | undefined;
    if (token) secret = encryptSecret(token);
    else if (moved) {
      secret = null;
      result.secretCleared.jira = true;
    }
    await upsertProvider(q, wsId, 'jira', next, secret);
  }
  if (b.planview !== undefined) {
    const p = obj(b.planview);
    const existing: PlanviewConfig = stored.planview?.config ?? { flavour: 'generic', baseUrl: '' };
    const next: PlanviewConfig = { ...existing };
    if (p.flavour !== undefined) {
      if (p.flavour !== 'adaptivework' && p.flavour !== 'generic')
        throw badRequest('Choose a Planview adapter', { flavour: 'Invalid' });
      next.flavour = p.flavour;
    }
    if (p.baseUrl !== undefined) next.baseUrl = await assertPublicHttpsUrl(p.baseUrl);
    if (p.username !== undefined) next.username = optStr(p.username);
    if (p.generic !== undefined) {
      const g = obj(p.generic);
      const prev = existing.generic;
      next.generic = {
        projectsPath:
          g.projectsPath !== undefined ? normalisePath(g.projectsPath, 'projectsPath') : (prev?.projectsPath ?? ''),
        assignmentsPath:
          g.assignmentsPath !== undefined
            ? normalisePath(g.assignmentsPath, 'assignmentsPath')
            : (prev?.assignmentsPath ?? ''),
        authHeaderName: g.authHeaderName !== undefined ? optStr(g.authHeaderName) : prev?.authHeaderName,
        fieldMap: g.fieldMap !== undefined ? stringMap(g.fieldMap, 'fieldMap', true) : (prev?.fieldMap ?? {}),
      };
      if (next.generic.authHeaderName && !/^[A-Za-z0-9-]+$/.test(next.generic.authHeaderName)) {
        throw badRequest('Enter a valid header name', { authHeaderName: 'Invalid header name' });
      }
    }
    if (!next.baseUrl) throw badRequest('Planview URL must be a public HTTPS address', { baseUrl: 'Required' });
    if (next.flavour === 'generic' && !next.generic)
      next.generic = { projectsPath: '', assignmentsPath: '', fieldMap: {} };
    const secretIn = typeof p.secret === 'string' && p.secret ? p.secret : null;
    const moved =
      !!stored.planview?.secretEnc &&
      (next.baseUrl !== existing.baseUrl ||
        next.flavour !== existing.flavour ||
        next.username !== existing.username ||
        next.generic?.authHeaderName !== existing.generic?.authHeaderName);
    let secret: string | null | undefined;
    if (secretIn) secret = encryptSecret(secretIn);
    else if (moved) {
      secret = null;
      result.secretCleared.planview = true;
    }
    await upsertProvider(q, wsId, 'planview', next, secret);
  }
  if (b.settings !== undefined) {
    const s = obj(b.settings);
    const existing = stored.settings?.config ?? {
      calibration: { '*': { ...DEFAULT_CALIBRATION } },
      mappings: { jira: {}, planview: {} },
    };
    const next: SettingsConfig = {
      calibration: s.calibration !== undefined ? calibrationMap(s.calibration, true) : existing.calibration,
      mappings: { ...existing.mappings },
    };
    if (s.mappings !== undefined) {
      const m = obj(s.mappings);
      if (m.jira !== undefined) next.mappings.jira = stringMap(m.jira, 'mappings.jira', true);
      if (m.planview !== undefined) next.mappings.planview = stringMap(m.planview, 'mappings.planview', true);
    }
    await upsertProvider(q, wsId, 'settings', next, undefined);
  }
  return result;
}

export function jiraCreds(s: Stored): { domain: string; email: string; apiToken: string; config: JiraConfig } {
  const cfg = s.jira?.config;
  if (!cfg?.domain || !cfg.email || !s.jira?.secretEnc) {
    throw badRequest('Jira is not configured for this workspace (site, email and API token are required)');
  }
  if (!normaliseJiraDomain(cfg.domain)) throw badRequest(JIRA_DOMAIN_MESSAGE, { domain: JIRA_DOMAIN_MESSAGE });
  return { domain: cfg.domain, email: cfg.email, apiToken: decryptSecret(s.jira.secretEnc), config: cfg };
}

export function planviewCreds(s: Stored): { config: PlanviewConfig; secret: string } {
  const cfg = s.planview?.config;
  if (!cfg?.baseUrl || !s.planview?.secretEnc) throw badRequest('Planview is not configured for this workspace');
  if (cfg.flavour === 'adaptivework' && !cfg.username) throw badRequest('Planview AdaptiveWork requires a username');
  if (cfg.flavour === 'generic' && !cfg.generic?.projectsPath) throw badRequest('Planview needs a projects path');
  return { config: cfg, secret: decryptSecret(s.planview.secretEnc) };
}
