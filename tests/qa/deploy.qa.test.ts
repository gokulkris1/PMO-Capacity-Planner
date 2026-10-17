/**
 * Independent QA (Release 2.0, re-test round 2): the boot of a browser that still holds a v1.1 token while the
 * deploy is migrating the database.
 *
 * QA-039 (Minor): on the live stack (PostgreSQL 16 with v1.1 data, migration lock held by another session, and again
 * with one migration file slowed past its statement_timeout) a browser holding `localStorage.pcp_token` called
 * `POST /api/auth/session`, got 503 `migration_pending`, and the runtime went straight to "anonymous": the sign-in
 * page, no maintenance notice and no automatic retry. A browser with a 2.0 cookie session in the same situation sees
 * "PMO Capacity Planner is being updated" and opens the workspace on its own (QA-011 fix). The v1.1 upgrade path -
 * every user on go-live day - is shown the sign-in page instead; the token is kept, so a manual reload after the
 * migration (or signing in with the unchanged password) recovers. Signing in during the migration shows the
 * generic "Something went wrong" instead of the update notice.
 */
import { HttpTransport } from '../../services/api/httpTransport';
import { DataRuntime, type Timers } from '../../state/runtime';
import { memoryStorage } from '../state/helpers';

function json(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => (k === 'content-type' ? 'application/json' : null) },
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response);
}

const me = {
  user: { id: 'u', email: 'a@b.co', name: 'A', isPlatformAdmin: false, emailVerified: true, twoFactorEnabled: false },
  org: null,
  workspaces: [],
  entitlements: { plan: 'ENTERPRISE' },
  appMode: 'internal',
};
const PENDING = { error: 'PMO Capacity Planner is being updated.', code: 'migration_pending' };

/** Timers the test fires by hand. */
function manualTimers(): Timers & { fire(): void } {
  const queue: Array<() => void> = [];
  return {
    set: (fn) => queue.push(fn),
    clear: () => undefined,
    fire: () => queue.splice(0).forEach((fn) => fn()),
  };
}

describe('QA: v1.1 token holder during a deploy migration (AC-03#AC2, SH-07#AC4)', () => {
  it('a v1.1 token that the API rejects as expired still signs out with a notice (unchanged behaviour)', async () => {
    const transport = new HttpTransport({
      getCookies: () => '',
      fetchImpl: () => json(401, { error: 'expired', code: 'unauthorized' }),
    });
    const rt = new DataRuntime({ transport, storage: memoryStorage({ pcp_token: 'old' }) });
    await rt.start();
    expect(rt.getState().status).toBe('anonymous');
  });

  it('QA-039 a v1.1 token exchange answered 503 migration_pending waits in maintenance and then signs in', async () => {
    let migrating = true;
    const calls: string[] = [];
    const transport = new HttpTransport({
      getCookies: () => '',
      fetchImpl: (url) => {
        calls.push(url);
        if (migrating) return json(503, PENDING);
        return url === '/api/auth/session' ? json(200, { user: me.user }) : json(200, me);
      },
    });
    const storage = memoryStorage({ pcp_token: 'valid-v11-token', pcp_user: '{}' });
    const timers = manualTimers();
    const rt = new DataRuntime({ transport, storage, timers });
    await rt.start();
    // While the API migrates: the maintenance state, never the sign-in page, and the v1.1 token is kept.
    expect(rt.getState().status).not.toBe('anonymous');
    expect(rt.getState().maintenance).not.toBeNull();
    expect(storage.data.get('pcp_token')).toBe('valid-v11-token');
    // The migration finishes; the automatic retry exchanges the token and the user is signed in.
    migrating = false;
    timers.fire();
    await new Promise((r) => setTimeout(r, 0));
    await rt.retryNow();
    expect(rt.getState().status).toBe('authenticated');
    expect(storage.data.has('pcp_token')).toBe(false);
    expect(calls.filter((u) => u === '/api/auth/session').length).toBeGreaterThan(1);
  });
});
