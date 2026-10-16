/** @jest-environment node */
/**
 * C checklist §4.4: the same contract assertions run against DemoTransport and against
 * HttpTransport replaying a recorded HTTP fixture (`contract/http-contract.json`, re-recordable with
 * `contract/record.ts`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DemoTransport } from '../../../services/api/demoTransport';
import { HttpTransport } from '../../../services/api/httpTransport';
import { DEMO_PASSWORD } from '../../../services/api/demo/seed';
import { runScenario, scenario } from './contract/scenario';
import type { Interaction } from './contract/record';

interface Recording {
  credentials: { email: string };
  interactions: Array<Interaction & { request: Interaction['request'] & { bodyOmitted?: boolean } }>;
}

const recording = JSON.parse(readFileSync(join(__dirname, 'contract', 'http-contract.json'), 'utf8')) as Recording;
const CSRF = 'csrf-from-cookie';

/** A fetch that replays the recording in order and enforces the server's CSRF rule. */
function replayFetch() {
  let i = 0;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    const it = recording.interactions[i++];
    if (!it) throw new Error(`Unexpected request ${init.method} ${url}`);
    const method = String(init.method ?? 'GET');
    expect(`${method} ${url}`).toBe(`${it.request.method} ${it.request.path}`);
    expect(init.credentials).toBe('include');
    const headers = new Headers(init.headers);
    if (it.request.csrf) expect(headers.get('X-CSRF-Token')).toBe(CSRF);
    if (it.request.body !== null && !it.request.bodyOmitted && !url.endsWith('/api/auth/login')) {
      expect(JSON.parse(String(init.body))).toEqual(it.request.body);
    }
    const body = it.response.body === null || it.response.status === 204 ? null : JSON.stringify(it.response.body);
    return new Response(body, { status: it.response.status, headers: it.response.headers });
  };
  return { fetchImpl, calls, done: () => i === recording.interactions.length };
}

describe('API contract (BACKLOG §4.3 route table)', () => {
  it('DemoTransport satisfies every contract step', async () => {
    const t = new DemoTransport({ acceptAnyPassword: false, signedIn: false });
    const passed = await runScenario((m, p, b) => t.request(m, p, b), {
      email: 'tom.hayes@company.ie',
      password: DEMO_PASSWORD,
    });
    expect(passed).toEqual(scenario.map((s) => s.name));
  });

  it('HttpTransport replaying the recorded API satisfies the same steps', async () => {
    const replay = replayFetch();
    let loggedIn = false;
    const t = new HttpTransport({
      fetchImpl: async (url, init) => {
        const res = await replay.fetchImpl(url, init);
        if (url.endsWith('/api/auth/login') && res.status === 200) loggedIn = true;
        if (url.endsWith('/api/auth/logout')) loggedIn = false;
        return res;
      },
      getCookies: () => (loggedIn ? `pcp_csrf=${CSRF}` : ''),
    });
    const expired = jest.fn();
    t.on('session-expired', expired);
    const passed = await runScenario((m, p, b) => t.request(m, p, b), {
      email: recording.credentials.email,
      password: 'recorded',
    });
    expect(passed).toEqual(scenario.map((s) => s.name));
    expect(replay.done()).toBe(true);
    // The final /me 401 tried one refresh, which failed, so the session-expired event fired once.
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it('the recording sent the CSRF header on every cookie-authenticated write', () => {
    const writes = recording.interactions.filter(
      (i) => i.request.method !== 'GET' && !['/api/auth/login', '/api/auth/refresh'].includes(i.request.path),
    );
    expect(writes.length).toBeGreaterThan(5);
    expect(writes.every((i) => i.request.csrf)).toBe(true);
  });

  it('every error response in the recording is an ApiError body with a request id', () => {
    const errors = recording.interactions.filter((i) => i.response.status >= 400);
    expect(errors.length).toBeGreaterThan(5);
    for (const e of errors) {
      const body = e.response.body as { error?: unknown; code?: unknown; requestId?: unknown };
      expect(typeof body.error).toBe('string');
      expect(typeof body.code).toBe('string');
      expect(typeof body.requestId).toBe('string');
    }
  });
});
