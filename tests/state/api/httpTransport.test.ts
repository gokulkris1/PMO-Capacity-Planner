/** @jest-environment node */
import { HttpTransport, readCookie } from '../../../services/api/httpTransport';
import { ApiRequestError, userMessage } from '../../../services/api/errors';

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function setup(handler: Handler, cookies = 'pcp_csrf=tok123; other=1') {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const t = new HttpTransport({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return handler(url, init);
    },
    getCookies: () => cookies,
  });
  const expired = jest.fn();
  t.on('session-expired', expired);
  return { t, calls, expired };
}

const header = (init: RequestInit, name: string) => new Headers(init.headers).get(name);

describe('HttpTransport', () => {
  it('reads cookies', () => {
    expect(readCookie('a=1; pcp_csrf=x%3Dy; b=2', 'pcp_csrf')).toBe('x=y');
    expect(readCookie('a=1', 'pcp_csrf')).toBeNull();
  });

  it('sends JSON with credentials and the CSRF header only on writes', async () => {
    const { t, calls } = setup(() => json(200, { ok: true }));
    await t.request('GET', '/api/v2/me', undefined, { query: { a: 1, b: null } });
    await t.request('PATCH', '/api/v2/workspaces/w/people/p', { version: 1, patch: {} });
    expect(calls[0].url).toBe('/api/v2/me?a=1');
    expect(calls[0].init.credentials).toBe('include');
    expect(header(calls[0].init, 'X-CSRF-Token')).toBeNull();
    expect(calls[1].init.method).toBe('PATCH');
    expect(header(calls[1].init, 'X-CSRF-Token')).toBe('tok123');
    expect(header(calls[1].init, 'Content-Type')).toBe('application/json');
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ version: 1, patch: {} });
  });

  it('returns undefined for 204 and text for non-JSON success (CSV)', async () => {
    const { t } = setup((url) =>
      url.includes('csv')
        ? new Response('a,b\r\n', { status: 200, headers: { 'content-type': 'text/csv' } })
        : new Response(null, { status: 204 }),
    );
    await expect(t.request('POST', '/api/auth/logout')).resolves.toBeUndefined();
    await expect(t.request('GET', '/x?format=csv')).resolves.toBe('a,b\r\n');
  });

  it('maps ApiError bodies to ApiRequestError with fields and request id', async () => {
    const { t } = setup(() =>
      json(400, { error: 'Fix it', code: 'bad_request', fields: { name: 'Enter a name' } }, { 'x-request-id': 'r-1' }),
    );
    const err = (await t.request('POST', '/api/v2/workspaces/w/people', {}).catch((e) => e)) as ApiRequestError;
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toMatchObject({
      status: 400,
      code: 'bad_request',
      message: 'Fix it',
      fields: { name: 'Enter a name' },
      requestId: 'r-1',
    });
  });

  it('never surfaces raw non-JSON error text', async () => {
    const { t } = setup(
      () => new Response('<html>Bad gateway stack trace</html>', { status: 502, headers: { 'x-request-id': 'r-9' } }),
    );
    const err = (await t.request('GET', '/api/health').catch((e) => e)) as ApiRequestError;
    expect(err.status).toBe(502);
    expect(err.code).toBe('server_error');
    expect(err.message).not.toContain('stack trace');
    expect(userMessage(err)).toBe('Something went wrong. Try again, or quote reference r-9.');
  });

  it('maps a network failure to status 0 network_error', async () => {
    const { t } = setup(() => {
      throw new TypeError('Failed to fetch');
    });
    const err = (await t.request('GET', '/api/v2/me').catch((e) => e)) as ApiRequestError;
    expect(err).toMatchObject({ status: 0, code: 'network_error' });
  });

  it('on 401 refreshes once, retries the request, and succeeds', async () => {
    let n = 0;
    const { t, calls, expired } = setup((url) => {
      if (url === '/api/auth/refresh') return json(200, { ok: true });
      n += 1;
      return n === 1 ? json(401, { error: 'expired', code: 'unauthorized' }) : json(200, { ok: 1 });
    });
    await expect(t.request('GET', '/api/v2/workspaces/w/snapshot')).resolves.toEqual({ ok: 1 });
    expect(calls.map((c) => c.url)).toEqual([
      '/api/v2/workspaces/w/snapshot',
      '/api/auth/refresh',
      '/api/v2/workspaces/w/snapshot',
    ]);
    expect(header(calls[1].init, 'X-CSRF-Token')).toBe('tok123');
    expect(expired).not.toHaveBeenCalled();
  });

  it('emits session-expired on a second 401 and refreshes at most once per page load', async () => {
    const { t, calls, expired } = setup((url) =>
      url === '/api/auth/refresh' ? json(200, { ok: true }) : json(401, { error: 'expired', code: 'unauthorized' }),
    );
    await expect(t.request('GET', '/a')).rejects.toMatchObject({ status: 401 });
    await expect(t.request('GET', '/b')).rejects.toMatchObject({ status: 401 });
    expect(calls.filter((c) => c.url === '/api/auth/refresh')).toHaveLength(1);
    expect(expired).toHaveBeenCalledTimes(2);
  });

  it('shares one refresh between concurrent 401s', async () => {
    let refreshed = false;
    const { t, calls } = setup((url) => {
      if (url === '/api/auth/refresh') {
        refreshed = true;
        return json(200, { ok: true });
      }
      return refreshed ? json(200, { url }) : json(401, { error: 'expired', code: 'unauthorized' });
    });
    const results = await Promise.all([t.request('GET', '/a'), t.request('GET', '/b'), t.request('GET', '/c')]);
    expect(results).toEqual([{ url: '/a' }, { url: '/b' }, { url: '/c' }]);
    expect(calls.filter((c) => c.url === '/api/auth/refresh')).toHaveLength(1);
  });

  it('does not refresh on a failed login', async () => {
    const { t, calls, expired } = setup(() =>
      json(401, { error: 'Email or password is incorrect.', code: 'unauthorized' }),
    );
    await expect(t.request('POST', '/api/auth/login', { email: 'a', password: 'b' })).rejects.toMatchObject({
      message: 'Email or password is incorrect.',
    });
    expect(calls).toHaveLength(1);
    expect(expired).not.toHaveBeenCalled();
  });

  describe('legacy v1.1 token exchange (AC-03#AC2)', () => {
    function storage(init: Record<string, string>) {
      const data = new Map(Object.entries(init));
      return {
        data,
        getItem: (k: string) => data.get(k) ?? null,
        removeItem: (k: string) => void data.delete(k),
      };
    }

    it('exchanges the bearer token once and removes pcp_token and pcp_user', async () => {
      const { t, calls } = setup(() => json(200, { user: { id: 'u' } }));
      const s = storage({ pcp_token: 'legacy.jwt', pcp_user: '{}', keep: '1' });
      await expect(t.exchangeLegacyToken(s)).resolves.toBe('exchanged');
      expect(calls[0].url).toBe('/api/auth/session');
      expect(calls[0].init.method).toBe('POST');
      expect(header(calls[0].init, 'Authorization')).toBe('Bearer legacy.jwt');
      expect([...s.data.keys()]).toEqual(['keep']);
      await expect(t.exchangeLegacyToken(s)).resolves.toBe('none');
      expect(calls).toHaveLength(1);
    });

    it('on 401 removes the token and reports expired', async () => {
      const { t } = setup(() => json(401, { error: 'x', code: 'unauthorized' }));
      const s = storage({ pcp_token: 'old', pcp_user: '{}' });
      await expect(t.exchangeLegacyToken(s)).resolves.toBe('expired');
      expect(s.data.size).toBe(0);
    });

    it('QA-039 keeps the token and reports pending while the API is migrating (503)', async () => {
      const { t } = setup(() => json(503, { error: 'x', code: 'migration_pending' }));
      const s = storage({ pcp_token: 'old' });
      await expect(t.exchangeLegacyToken(s)).resolves.toBe('pending');
      expect(s.data.get('pcp_token')).toBe('old');
    });

    it('keeps the token for the next load when the server fails otherwise', async () => {
      const { t } = setup(() => json(500, { error: 'x', code: 'server_error' }));
      const s = storage({ pcp_token: 'old' });
      await expect(t.exchangeLegacyToken(s)).resolves.toBe('failed');
      expect(s.data.get('pcp_token')).toBe('old');
    });
  });
});
