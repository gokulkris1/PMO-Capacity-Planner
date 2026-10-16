/**
 * Planview adapters (AdaptiveWork / Clarizen REST, and a generic REST/OData adapter driven by a field map).
 * Every call re-checks that the base URL is a public HTTPS address (HS-08#AC3), never follows redirects and is
 * bounded in time.
 */
import { MAX_OUTBOUND_MS, UpstreamError, assertPublicHttpsUrl, readJson, safeFetch, upstreamMessage } from '../net';
import type { PlanviewConfig } from '../integrationsStore';
import { isPlainObject, num, str } from '../jira/fields';

export interface PlanviewCreds {
  config: PlanviewConfig;
  secret: string;
}

export interface NormalisedProject {
  externalId: string;
  name: string;
  status: string | null;
  startDate: string | null;
  endDate: string | null;
  manager: string | null;
}
export interface NormalisedAssignment {
  externalId: string;
  projectExternalId: string;
  resourceName: string;
  resourceEmail: string | null;
  role: string | null;
  startDate: string | null;
  endDate: string | null;
  percent: number | null;
  hours?: number | null;
}

const MAX_PAGES = 10;

export function getPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  let cur: unknown = obj;
  for (const seg of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

async function pvJson(pv: PlanviewCreds, url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  await assertPublicHttpsUrl(pv.config.baseUrl);
  const res = await safeFetch(
    url,
    { ...init, headers: { Accept: 'application/json', ...((init.headers as Record<string, string>) ?? {}) } },
    {
      label: 'Planview',
      timeoutMs,
    },
  );
  const { text, json } = await readJson(res);
  if (!res.ok) throw new UpstreamError('Planview', res.status, upstreamMessage(json, text));
  return json;
}

function clarizenLiteral(s: string): string {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export async function adaptiveLogin(pv: PlanviewCreds, timeoutMs = MAX_OUTBOUND_MS): Promise<string> {
  const data = (await pvJson(
    pv,
    `${pv.config.baseUrl}/API2.0/services/authentication/login`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userName: pv.config.username, password: pv.secret }),
    },
    timeoutMs,
  )) as { sessionId?: unknown } | null;
  if (typeof data?.sessionId !== 'string' || !data.sessionId)
    throw new UpstreamError('Planview', 502, 'AdaptiveWork login returned no session');
  return data.sessionId;
}

async function adaptiveQuery(
  pv: PlanviewCreds,
  sessionId: string,
  q: string,
  timeoutMs: number,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let from = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = (await pvJson(
      pv,
      `${pv.config.baseUrl}/API2.0/services/data/query`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Session ${sessionId}` },
        body: JSON.stringify({ q, paging: { from, limit: 100 } }),
      },
      timeoutMs,
    )) as { entities?: unknown[]; paging?: { hasMore?: boolean } } | null;
    const entities = Array.isArray(data?.entities) ? data.entities : [];
    for (const e of entities) if (isPlainObject(e)) out.push(e);
    if (!data?.paging?.hasMore || entities.length === 0) break;
    from += entities.length;
  }
  return out;
}

const clarizenState = (v: unknown) => str(v)?.replace(/^\/State\//, '') ?? null;

export function adaptiveProjects(entities: Record<string, unknown>[]): NormalisedProject[] {
  return entities
    .map((e) => ({
      externalId: str(e.id) || str(e.Id) || '',
      name: str(e.Name) || '',
      status: clarizenState(e.State),
      startDate: str(e.StartDate),
      endDate: str(e.DueDate),
      manager: str(e.ProjectManager),
    }))
    .filter((p) => p.externalId);
}

export function adaptiveAssignments(entities: Record<string, unknown>[], projectId: string): NormalisedAssignment[] {
  return entities.map((e) => {
    const units = e.Units;
    let percent: number | null = null;
    let hours: number | null = null;
    if (isPlainObject(units)) {
      const value = num(units.value ?? units.Value);
      const unit = String(units.unit ?? units.Unit ?? '').toLowerCase();
      if (unit.includes('hour') || unit === 'h') hours = value;
      else percent = value;
    } else percent = num(units);
    const resource = e.Resource;
    const a: NormalisedAssignment = {
      externalId: str(e.id) || str(e.Id) || '',
      projectExternalId: str(e.WorkItem) || projectId,
      resourceName: str(resource) || '',
      resourceEmail: isPlainObject(resource) ? str(resource.Email) || str(resource.email) : null,
      role: str(e.Role),
      startDate: str(e.StartDate),
      endDate: str(e.DueDate),
      percent,
    };
    if (hours !== null) a.hours = hours;
    return a;
  });
}

function genericHeaders(pv: PlanviewCreds): Record<string, string> {
  const name = pv.config.generic?.authHeaderName?.trim() || 'Authorization';
  return { [name]: name.toLowerCase() === 'authorization' ? `Bearer ${pv.secret}` : pv.secret };
}

export function unwrapList(data: unknown): Record<string, unknown>[] {
  let list: unknown = data;
  if (isPlainObject(data)) {
    for (const k of ['value', 'data', 'items', 'results', 'entities', 'records']) {
      if (Array.isArray(data[k])) {
        list = data[k];
        break;
      }
    }
  }
  return Array.isArray(list) ? list.filter(isPlainObject) : [];
}

function mapWith(
  fieldMap: Record<string, string>,
  item: Record<string, unknown>,
  target: string,
  fallbacks: string[] = [],
): unknown {
  for (const c of [fieldMap[target], target, ...fallbacks].filter((x): x is string => !!x)) {
    const v = getPath(item, c);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

export function genericProjects(fm: Record<string, string>, items: Record<string, unknown>[]): NormalisedProject[] {
  return items
    .map((it) => ({
      externalId: str(mapWith(fm, it, 'externalId', ['id', 'Id', 'ID', 'ProjectId', 'projectId'])) || '',
      name: str(mapWith(fm, it, 'name', ['Name', 'title', 'Title'])) || '',
      status: str(mapWith(fm, it, 'status', ['Status', 'state', 'State'])),
      startDate: str(mapWith(fm, it, 'startDate', ['StartDate', 'start_date', 'start'])),
      endDate: str(mapWith(fm, it, 'endDate', ['EndDate', 'end_date', 'end', 'finishDate', 'FinishDate'])),
      manager: str(mapWith(fm, it, 'manager', ['Manager', 'projectManager', 'ProjectManager', 'owner', 'Owner'])),
    }))
    .filter((p) => p.externalId);
}

export function genericAssignments(
  fm: Record<string, string>,
  items: Record<string, unknown>[],
  projectId: string,
): NormalisedAssignment[] {
  return items.map((it) => {
    const a: NormalisedAssignment = {
      externalId: str(mapWith(fm, it, 'externalId', ['id', 'Id', 'ID', 'AssignmentId', 'assignmentId'])) || '',
      projectExternalId: str(mapWith(fm, it, 'projectExternalId', ['projectId', 'ProjectId', 'project'])) || projectId,
      resourceName:
        str(mapWith(fm, it, 'resourceName', ['resource', 'Resource', 'ResourceName', 'name', 'Name'])) || '',
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
  return `${url}${url.includes('?') ? '&' : '?'}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

/** Raw first items (for the field-map test) and normalised lists. */
export async function fetchProjectsRaw(
  pv: PlanviewCreds,
  timeoutMs = MAX_OUTBOUND_MS,
): Promise<Record<string, unknown>[]> {
  if (pv.config.flavour === 'adaptivework') {
    const session = await adaptiveLogin(pv, timeoutMs);
    return adaptiveQuery(pv, session, 'SELECT Name, StartDate, DueDate, State, ProjectManager FROM Project', timeoutMs);
  }
  return unwrapList(
    await pvJson(
      pv,
      `${pv.config.baseUrl}${pv.config.generic?.projectsPath ?? ''}`,
      { method: 'GET', headers: genericHeaders(pv) },
      timeoutMs,
    ),
  );
}

export function normaliseProjects(pv: PlanviewCreds, raw: Record<string, unknown>[]): NormalisedProject[] {
  return pv.config.flavour === 'adaptivework'
    ? adaptiveProjects(raw)
    : genericProjects(pv.config.generic?.fieldMap ?? {}, raw);
}

export async function fetchAssignmentsRaw(
  pv: PlanviewCreds,
  projectId: string,
  timeoutMs = MAX_OUTBOUND_MS,
  session?: string,
) {
  if (pv.config.flavour === 'adaptivework') {
    const sid = session ?? (await adaptiveLogin(pv, timeoutMs));
    return adaptiveQuery(
      pv,
      sid,
      `SELECT WorkItem, Resource, StartDate, DueDate, Units, Role FROM RegularResourceLink WHERE WorkItem = '${clarizenLiteral(projectId)}'`,
      timeoutMs,
    );
  }
  if (!pv.config.generic?.assignmentsPath)
    throw new UpstreamError('Planview', 400, 'Planview needs an assignments path');
  const url = withQuery(`${pv.config.baseUrl}${pv.config.generic.assignmentsPath}`, 'projectId', projectId);
  return unwrapList(await pvJson(pv, url, { method: 'GET', headers: genericHeaders(pv) }, timeoutMs));
}

export function normaliseAssignments(
  pv: PlanviewCreds,
  raw: Record<string, unknown>[],
  projectId: string,
): NormalisedAssignment[] {
  return pv.config.flavour === 'adaptivework'
    ? adaptiveAssignments(raw, projectId)
    : genericAssignments(pv.config.generic?.fieldMap ?? {}, raw, projectId);
}
