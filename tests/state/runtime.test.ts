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
