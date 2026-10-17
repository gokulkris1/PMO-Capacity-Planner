/**
 * API contract scenario (C checklist §4.4): one ordered list of requests with the assertions the
 * §4.3 route table implies. `contract.test.ts` runs it against DemoTransport and against
 * HttpTransport replaying `http-contract.json`; `record.ts` re-records that fixture from a live API.
 *
 * Ids are taken from earlier responses (`vars`), so the scenario runs against any workspace where
 * the signed-in user is a Planner (or above) with at least one person and one allocation.
 */
import type * as D from '../../../../shared/contracts/dto';
import type { AllocationBatchResponse, AllocationOp, LoginResponse } from '../../../../shared/contracts/api';
import { API } from '../../../../shared/contracts/api';
import type { ApiRequestError } from '../../../../services/api/errors';
import type { HttpMethod } from '../../../../services/api/transport';

export interface Vars {
  wsId: string;
  person: D.PersonDTO;
  allocation: D.AllocationDTO;
  email: string;
  password: string;
}

type Check<T> = (value: T, v: Vars) => void;

export interface Step {
  name: string;
  method: HttpMethod;
  path: (v: Vars) => string;
  body?: (v: Vars) => unknown;
  /** Expected success (with checks), or expected error status/code. */
  ok?: Check<never>;
  error?: { status: number | number[]; code?: string; check?: Check<ApiRequestError> };
}

const isStr = (x: unknown) => typeof x === 'string' && x.length > 0;

function expectTrue(cond: unknown, message: string): void {
  if (!cond) throw new Error(`Contract violation: ${message}`);
}

export const scenario: Step[] = [
  {
    name: 'login with a wrong password is 401 unauthorized',
    method: 'POST',
    path: () => API.login,
    body: (v) => ({ email: v.email, password: `${v.password}-wrong` }),
    error: { status: 401, code: 'unauthorized' },
  },
  {
    // AC-03#AC1 asks for no token in the body. 2.0 still returns the v1.1 `token` so browser tabs left open on the
    // v1.1 bundle across the deploy keep working (handoff-A deviation, removal planned for 2.1); the client never
    // reads or stores it (tests/state/runtime.test.ts).
    name: 'login returns { user } (and at most the v1.1 compatibility token)',
    method: 'POST',
    path: () => API.login,
    body: (v) => ({ email: v.email, password: v.password }),
    ok: ((res: LoginResponse, v: Vars) => {
      expectTrue('user' in res && res.user.email.toLowerCase() === v.email.toLowerCase(), 'login returns the user');
      const token = (res as { token?: unknown }).token;
      expectTrue(token === undefined || typeof token === 'string', 'token, if present, is the v1.1 bearer string');
    }) as Check<never>,
  },
  {
    name: 'GET /me returns workspaces with permissions and entitlements',
    method: 'GET',
    path: () => API.me,
    ok: ((me: D.MeResponse, v: Vars) => {
      expectTrue(me.workspaces.length > 0, 'at least one workspace');
      const ws = me.workspaces[0];
      expectTrue(
        Array.isArray(ws.permissions) && ws.permissions.includes('data.read'),
        'permissions computed by permissionsFor',
      );
      expectTrue(ws.permissions.includes('people.write'), 'scenario user is a Planner or above');
      expectTrue(typeof me.entitlements.plan === 'string', 'entitlements present');
      expectTrue(me.appMode === 'internal' || me.appMode === 'public', 'appMode');
      v.wsId = ws.id;
    }) as Check<never>,
  },
  {
    name: 'GET snapshot returns a WorkspaceSnapshot',
    method: 'GET',
    path: (v) => API.snapshot(v.wsId),
    ok: ((s: D.WorkspaceSnapshot, v: Vars) => {
      for (const k of [
        'people',
        'projects',
        'allocations',
        'demand',
        'tribes',
        'chapters',
        'teams',
        'crafts',
        'offers',
        'craftRequests',
      ] as const)
        expectTrue(Array.isArray(s[k]), `snapshot.${k} is a list`);
      expectTrue(isStr(s.serverTime) && typeof s.workspace.dataVersion === 'number', 'serverTime and dataVersion');
      expectTrue(typeof s.org.planning.fiscalYearStartMonth === 'number', 'org planning settings');
      expectTrue(s.people.length > 0 && s.allocations.length > 0, 'workspace has people and allocations');
      v.person = s.people[0];
      v.allocation = s.allocations.find((a) => a.source !== 'planview') ?? s.allocations[0];
      expectTrue(typeof v.person.version === 'number', 'people are versioned');
    }) as Check<never>,
  },
  {
    name: 'PATCH a person with the current version bumps the version',
    method: 'PATCH',
    path: (v) => API.people(v.wsId, v.person.id),
    body: (v) => ({ version: v.person.version, patch: { targetUtil: 95 } }),
    ok: ((p: D.PersonDTO, v: Vars) => {
      expectTrue(p.version === v.person.version + 1, 'version + 1 (PL-04#AC2)');
      expectTrue(p.targetUtil === 95, 'patch applied');
      expectTrue(isStr(p.updatedAt), 'updatedAt set server-side');
    }) as Check<never>,
  },
  {
    name: 'PATCH with a stale version is 409 with current, changedBy, changedAt',
    method: 'PATCH',
    path: (v) => API.people(v.wsId, v.person.id),
    body: (v) => ({ version: v.person.version, patch: { targetUtil: 80 } }),
    error: {
      status: 409,
      code: 'conflict',
      check: (e, v) => {
        const body = e.body as { current?: D.PersonDTO; changedBy?: D.UserRef; changedAt?: string };
        expectTrue(body.current?.version === v.person.version + 1, '409 carries the latest row (PL-04#AC3)');
        expectTrue(body.current?.targetUtil === 95, 'row unchanged by the stale write');
        expectTrue(isStr(body.changedBy?.name) && isStr(body.changedAt), 'changedBy and changedAt');
      },
    },
  },
  {
    name: 'an allocation batch over 500 ops is 413',
    method: 'POST',
    path: (v) => API.allocationsBatch(v.wsId),
    body: (v) => ({
      ops: Array.from({ length: 501 }, (): AllocationOp => ({
        op: 'delete',
        id: v.allocation.id,
        version: v.allocation.version,
      })),
      label: 'too big',
    }),
    error: { status: 413, code: 'payload_too_large' },
  },
  {
    name: 'an allocation batch returns { upserted, deleted, dataVersion }',
    method: 'POST',
    path: (v) => API.allocationsBatch(v.wsId),
    body: (v) => ({
      ops: [{ op: 'update', id: v.allocation.id, version: v.allocation.version, patch: { percentage: 33 } }],
      label: 'contract',
    }),
    ok: ((r: AllocationBatchResponse, v: Vars) => {
      expectTrue(r.upserted.length === 1 && r.upserted[0].id === v.allocation.id, 'upserted row returned');
      expectTrue(
        r.upserted[0].percentage === 33 && r.upserted[0].version === v.allocation.version + 1,
        'versioned update',
      );
      expectTrue(Array.isArray(r.deleted) && typeof r.dataVersion === 'number', 'deleted and dataVersion');
    }) as Check<never>,
  },
  {
    name: 'invalid demand is 400 with field errors',
    method: 'POST',
    path: (v) => API.demand(v.wsId),
    body: (v) => ({
      projectId: v.allocation.projectId,
      quarterKey: '2027-Q5',
      craftId: 'project-mgmt',
      fte: 99,
      status: 'Forecast',
      ownerUserId: null,
      note: null,
    }),
    error: {
      status: 400,
      code: 'bad_request',
      check: (e) => expectTrue(isStr(e.fields?.fte) && isStr(e.fields?.quarterKey), 'fields.fte and fields.quarterKey'),
    },
  },
  {
    name: 'a person without a name is 400',
    method: 'POST',
    path: (v) => API.people(v.wsId),
    body: () => ({ name: '' }),
    error: { status: 400, code: 'bad_request', check: (e) => expectTrue(isStr(e.fields?.name), 'fields.name') },
  },
  {
    name: 'an unknown workspace is 403 or 404',
    method: 'GET',
    path: () => API.snapshot('00000000-0000-4000-8000-000000000000'),
    error: { status: [403, 404] },
  },
  {
    name: 'the legacy full save is 410 gone',
    method: 'POST',
    path: () => '/api/workspace',
    body: () => ({}),
    error: { status: 410, code: 'gone' },
  },
  {
    name: 'AI is off by default: 403 feature_disabled',
    method: 'POST',
    path: () => API.ai,
    body: (v) => ({ wsId: v.wsId, question: 'How are we doing?' }),
    error: { status: 403, code: 'feature_disabled' },
  },
  {
    name: 'logout succeeds',
    method: 'POST',
    path: () => API.logout,
    ok: (() => undefined) as Check<never>,
  },
  {
    name: 'after logout /me is 401',
    method: 'GET',
    path: () => API.me,
    error: { status: 401, code: 'unauthorized' },
  },
];

/** Runs the scenario with any request function; throws on the first contract violation. */
export async function runScenario(
  request: (method: HttpMethod, path: string, body?: unknown) => Promise<unknown>,
  creds: { email: string; password: string },
): Promise<string[]> {
  const v = { email: creds.email, password: creds.password } as Vars;
  const passed: string[] = [];
  for (const step of scenario) {
    let result: unknown;
    let error: unknown = null;
    try {
      result = await request(step.method, step.path(v), step.body?.(v));
    } catch (e) {
      error = e;
    }
    if (step.error) {
      const e = error as ApiRequestError | null;
      expectTrue(e && typeof e.status === 'number', `${step.name}: expected an ApiRequestError, got success`);
      const statuses = Array.isArray(step.error.status) ? step.error.status : [step.error.status];
      expectTrue(statuses.includes(e!.status), `${step.name}: status ${e!.status}, expected ${statuses.join('/')}`);
      if (step.error.code)
        expectTrue(e!.code === step.error.code, `${step.name}: code ${e!.code}, expected ${step.error.code}`);
      step.error.check?.(e!, v);
    } else {
      if (error) throw new Error(`${step.name}: unexpected error ${(error as Error).message}`);
      (step.ok as Check<unknown> | undefined)?.(result, v);
    }
    passed.push(step.name);
  }
  return passed;
}
