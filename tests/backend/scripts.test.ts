/** PL-14#AC1 parity report and HS-16#AC2 destructive-script guard. */
import { compareSnapshots, summarise, takeSnapshot } from '../../scripts/db/parity';
import { assertDestructiveAllowed } from '../../scripts/lib/destructiveGuard';
import type { PgliteDb } from './helpers/pglite';
import { createOrg, createPerson, createUser, createWorkspace, setupDb, teardownDb } from './helpers/harness';

let db: PgliteDb;
beforeAll(async () => {
  db = await setupDb();
});
afterAll(() => teardownDb(db));

describe('db:parity (PL-14#AC1)', () => {
  it('reports "0 rows lost, 0 credential changes" when only new columns change', async () => {
    const org = await createOrg(db, 'Parity');
    const ws = await createWorkspace(db, org);
    const user = await createUser(db, { orgId: org, orgRole: 'MEMBER' });
    const person = await createPerson(db, ws, { name: 'Ada' });
    const before = await takeSnapshot(db);
    await db.query(`UPDATE users SET token_version = token_version + 1, last_sign_in_at = now() WHERE id = $1`, [
      user.id,
    ]);
    await db.query(`UPDATE resources SET chapter_id = NULL, version = version + 1 WHERE id = $1`, [person]);
    const same = summarise(compareSnapshots(before, await takeSnapshot(db)));
    expect(same.ok).toBe(true);
    expect(same.text.split('\n')[0]).toBe('0 rows lost, 0 credential changes');

    await db.query(`UPDATE users SET password_hash = 'x' WHERE id = $1`, [user.id]);
    await db.query(`DELETE FROM resources WHERE id = $1`, [person]);
    const diff = compareSnapshots(before, await takeSnapshot(db));
    expect(diff.credentialChanges).toEqual([user.id]);
    expect(diff.lost.resources).toEqual([person]);
    const s = summarise(diff);
    expect(s.ok).toBe(false);
    expect(s.text).not.toContain('correct horse');
  });
});

describe('destructive guard (HS-16#AC2)', () => {
  let exit: jest.SpyInstance;
  let err: jest.SpyInstance;
  beforeEach(() => {
    exit = jest.spyOn(process, 'exit').mockImplementation(((code: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    exit.mockRestore();
    err.mockRestore();
  });
  const dev = 'postgres://u:p@ep-dev-123.eu-central-1.aws.neon.tech/db';
  const prod = 'postgres://u:p@ep-prod-999.eu-central-1.aws.neon.tech/db';

  it('exits 1 without ALLOW_DESTRUCTIVE=yes, without PROD_DB_HOST, or against production', () => {
    expect(() => assertDestructiveAllowed(dev, {})).toThrow('exit 1');
    expect(() => assertDestructiveAllowed(dev, { ALLOW_DESTRUCTIVE: 'yes' })).toThrow('exit 1');
    expect(() =>
      assertDestructiveAllowed(prod, {
        ALLOW_DESTRUCTIVE: 'yes',
        PROD_DB_HOST: 'ep-prod-999.eu-central-1.aws.neon.tech',
      }),
    ).toThrow('exit 1');
    expect(() =>
      assertDestructiveAllowed(dev, {
        ALLOW_DESTRUCTIVE: 'yes',
        PROD_DB_HOST: 'ep-prod-999.eu-central-1.aws.neon.tech',
      }),
    ).not.toThrow();
  });
});
