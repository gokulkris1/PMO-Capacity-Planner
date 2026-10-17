import { DemoTransport } from '../../services/api/demoTransport';
import { HttpTransport } from '../../services/api/httpTransport';
import { DataRuntime } from '../../state/runtime';
import { createDataRuntime, selectMode } from '../../state/session';
import { memoryStorage } from './helpers';

describe('transport selection', () => {
  it('uses DemoTransport for /demo, ?demo=1 or forceDemo, else HttpTransport', () => {
    expect(selectMode({ pathname: '/demo', search: '' })).toBe('demo');
    expect(selectMode({ pathname: '/demo/w/demo/home', search: '' })).toBe('demo');
    expect(selectMode({ pathname: '/o/acme/w/1/home', search: '?demo=1' })).toBe('demo');
    expect(selectMode({ pathname: '/demonstration', search: '' })).toBe('live');
    expect(selectMode({ pathname: '/o/acme', search: '' })).toBe('live');
    expect(selectMode(null, true)).toBe('demo');
    expect(
      createDataRuntime({
        location: { pathname: '/demo', search: '?demoRole=VIEWER' },
        demoStorage: null,
        storage: null,
      }).transport,
    ).toBeInstanceOf(DemoTransport);
    const live = createDataRuntime({ location: { pathname: '/login', search: '' }, storage: null });
    expect(live.transport).toBeInstanceOf(HttpTransport);
    expect(live.getState().mode).toBe('live');
  });

  it('reads ?demoRole when booting the demo', async () => {
    const rt = createDataRuntime({
      location: { pathname: '/demo', search: '?demoRole=VIEWER' },
      demoStorage: null,
      storage: null,
    });
    await rt.start();
    expect(rt.activeMeWorkspace()?.role).toBe('VIEWER');
    expect(rt.getState().dataStatus).toBe('ready');
  });
});

describe('live boot (AC-03#AC2, AC-04#AC4)', () => {
  function json(status: number, body: unknown) {
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k: string) => (k === 'content-type' ? 'application/json' : null) },
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response);
  }

  it('an expired legacy token signs out with "Please sign in again." and clears it', async () => {
    const urls: string[] = [];
    const transport = new HttpTransport({
      getCookies: () => '',
      fetchImpl: (url) => {
        urls.push(url);
        return json(401, { error: 'expired', code: 'unauthorized' });
      },
    });
    const storage = memoryStorage({ pcp_token: 'old', pcp_user: '{}', pcp_resources: '[]' });
    const rt = new DataRuntime({ transport, storage });
    await rt.start();
    expect(rt.getState()).toMatchObject({
      status: 'anonymous',
      notice: { kind: 'legacy-session-expired', message: 'Please sign in again.' },
    });
    expect([...storage.data.keys()]).toEqual([]);
    // No session cookie after the failed exchange: the boot does not call /me (no 401 noise for signed-out visitors).
    expect(urls).toEqual(['/api/auth/session']);
  });

  it('a valid legacy token is exchanged and the user stays signed in', async () => {
    const me = {
      user: {
        id: 'u',
        email: 'a@b.co',
        name: 'A',
        isPlatformAdmin: false,
        emailVerified: true,
        twoFactorEnabled: false,
      },
      org: null,
      workspaces: [],
      entitlements: { plan: 'ENTERPRISE' },
      appMode: 'internal',
    };
    const transport = new HttpTransport({
      getCookies: () => '',
      fetchImpl: (url) => (url === '/api/auth/session' ? json(200, { user: me.user }) : json(200, me)),
    });
    const storage = memoryStorage({ pcp_token: 'valid', pcp_user: '{}' });
    const rt = new DataRuntime({ transport, storage });
    await rt.start();
    expect(rt.getState().status).toBe('authenticated');
    expect(rt.getState().notice).toBeNull();
    expect(storage.data.size).toBe(0);
  });
});

describe('deploy migration while signing in (QA-039)', () => {
  const PENDING = { error: 'PMO Capacity Planner is being updated.', code: 'migration_pending' };
  const user = {
    id: 'u',
    email: 'a@b.co',
    name: 'A',
    isPlatformAdmin: false,
    emailVerified: true,
    twoFactorEnabled: false,
  };
  const me = { user, org: null, workspaces: [], entitlements: { plan: 'ENTERPRISE' }, appMode: 'internal' };
  function json(status: number, body: unknown) {
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k: string) => (k === 'content-type' ? 'application/json' : null) },
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response);
  }
  /** Timers the test fires by hand; records each delay. */
  function manualTimers() {
    const queue: Array<() => void> = [];
    const delays: number[] = [];
    return {
      delays,
      set: (fn: () => void, ms: number) => {
        delays.push(ms);
        queue.push(fn);
      },
      clear: () => undefined,
      fire: () => queue.splice(0).forEach((fn) => fn()),
      pending: () => queue.length,
    };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('keeps the v1.1 token through several 503s, shows maintenance, then exchanges it and signs in', async () => {
    let pendingLeft = 3;
    const calls: string[] = [];
    const transport = new HttpTransport({
      getCookies: () => '',
      fetchImpl: (url) => {
        calls.push(url);
        if (pendingLeft > 0) {
          pendingLeft--;
          return json(503, PENDING);
        }
        return url === '/api/auth/session' ? json(200, { user }) : json(200, me);
      },
    });
    const storage = memoryStorage({ pcp_token: 'v11', pcp_user: '{}' });
    const timers = manualTimers();
    const rt = new DataRuntime({ transport, storage, timers });
    await rt.start();
    for (let i = 0; i < 2; i++) {
      expect(rt.getState()).toMatchObject({ status: 'loading', dataStatus: 'error' });
      expect(rt.getState().dataError).toMatchObject({ status: 503, code: 'migration_pending' });
      expect(rt.getState().maintenance).not.toBeNull();
      expect(storage.data.get('pcp_token')).toBe('v11');
      timers.fire();
      await flush();
    }
    timers.fire();
    await flush();
    expect(rt.getState().status).toBe('authenticated');
    expect(rt.getState().maintenance).toBeNull();
    expect(rt.getState().notice).toBeNull();
    expect(storage.data.has('pcp_token')).toBe(false);
    expect(calls.filter((u) => u === '/api/auth/session')).toHaveLength(4);
    expect(timers.pending()).toBe(0);
  });

  it('a token another tab already exchanged (401, session cookie present) boots signed in without a notice', async () => {
    const transport = new HttpTransport({
      getCookies: () => 'pcp_csrf=abc',
      fetchImpl: (url) =>
        url === '/api/auth/session' ? json(401, { error: 'x', code: 'unauthorized' }) : json(200, me),
    });
    const storage = memoryStorage({ pcp_token: 'v11' });
    const rt = new DataRuntime({ transport, storage });
    await rt.start();
    expect(rt.getState().status).toBe('authenticated');
    expect(rt.getState().notice).toBeNull();
    expect(storage.data.has('pcp_token')).toBe(false);
  });

  it('sign-in during the migration waits with backoff, tells the form, then signs in', async () => {
    let pendingLeft = 3;
    const transport = new HttpTransport({
      getCookies: () => '',
      fetchImpl: (url) => {
        if (url === '/api/auth/login') {
          if (pendingLeft > 0) {
            pendingLeft--;
            return json(503, PENDING);
          }
          return json(200, { user });
        }
        return json(200, me);
      },
    });
    const timers = manualTimers();
    const rt = new DataRuntime({ transport, storage: memoryStorage(), timers });
    await rt.start();
    expect(rt.getState().status).toBe('anonymous');
    const waits: Array<{ attempt: number; retryInMs: number }> = [];
    const done = rt.login('a@b.co', 'pw', undefined, { onWaiting: (w) => waits.push(w) });
    for (let i = 0; i < 3; i++) {
      await flush();
      timers.fire();
    }
    await expect(done).resolves.toEqual({ require2FA: false });
    expect(waits).toEqual([
      { attempt: 1, retryInMs: 2000 },
      { attempt: 2, retryInMs: 3000 },
      { attempt: 3, retryInMs: 5000 },
    ]);
    expect(rt.getState().status).toBe('authenticated');
  });

  it('without onWaiting, or after maxWaitMs, the 503 is the answer', async () => {
    let now = 0;
    const transport = new HttpTransport({ getCookies: () => '', fetchImpl: () => json(503, PENDING) });
    const timers = manualTimers();
    const rt = new DataRuntime({ transport, storage: memoryStorage(), timers, nowMs: () => now });
    await expect(rt.login('a@b.co', 'pw')).rejects.toMatchObject({ code: 'migration_pending' });
    const done = rt.login('a@b.co', 'pw', undefined, { onWaiting: () => (now += 6000), maxWaitMs: 10_000 });
    await flush();
    timers.fire();
    await flush();
    timers.fire();
    await expect(done).rejects.toMatchObject({ status: 503 });
  });

  it('a form that is left stops retrying', async () => {
    let cancelled = false;
    const transport = new HttpTransport({ getCookies: () => '', fetchImpl: () => json(503, PENDING) });
    const timers = manualTimers();
    const rt = new DataRuntime({ transport, storage: memoryStorage(), timers });
    const done = rt.login('a@b.co', 'pw', undefined, { onWaiting: () => undefined, isCancelled: () => cancelled });
    await flush();
    cancelled = true;
    timers.fire();
    await expect(done).rejects.toMatchObject({ code: 'migration_pending' });
  });

  it('signed in, but /me answers 503: maintenance, then boots from the cookie session', async () => {
    let meCalls = 0;
    let cookie = '';
    const transport = new HttpTransport({
      getCookies: () => cookie,
      fetchImpl: (url) => {
        if (url === '/api/auth/login') {
          cookie = 'pcp_csrf=abc';
          return json(200, { user });
        }
        meCalls++;
        return meCalls === 1 ? json(503, PENDING) : json(200, me);
      },
    });
    const timers = manualTimers();
    const rt = new DataRuntime({ transport, storage: memoryStorage(), timers });
    await rt.start();
    await expect(rt.login('a@b.co', 'pw', undefined, { onWaiting: () => undefined })).resolves.toEqual({
      require2FA: false,
    });
    expect(rt.getState()).toMatchObject({ status: 'loading', dataStatus: 'error' });
    expect(rt.getState().maintenance).not.toBeNull();
    timers.fire();
    await flush();
    expect(rt.getState().status).toBe('authenticated');
    expect(rt.getState().maintenance).toBeNull();
  });
});
