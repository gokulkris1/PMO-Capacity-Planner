import { entitled, entitlementsFor, PLAN_ENTITLEMENTS, withinLimit } from '../../shared/entitlements';
import { DEFAULT_FEATURES, FEATURE_FLAGS, resolveFeatures } from '../../shared/features';
import {
  fromLegacyUserRole,
  fromLegacyWorkspaceRole,
  permissionsFor,
  PERMISSIONS,
  ROLE_LABEL,
  toLegacyWorkspaceRole,
  WORKSPACE_ROLE_RANK,
} from '../../shared/permissions';
import { BAND_LABEL, bandFor, bandForLoad, DEFAULT_THRESHOLDS, relativeLoad, validateThresholds } from '../../shared/utilisation';
import { API } from '../../shared/contracts/api';
import { QUARTER_KEY_RE as DTO_RE } from '../../shared/contracts/dto';

describe('shared/utilisation (RP-03#AC1)', () => {
  it('bands 49, 50, 89, 90, 100, 105, 106 as bench, under, under, on-target ×3, over', () => {
    expect([49, 50, 89, 90, 100, 105, 106].map((p) => bandFor(p))).toEqual([
      'bench',
      'under',
      'under',
      'on-target',
      'on-target',
      'on-target',
      'over',
    ]);
    expect([49.4, 89.5, 105.4, 105.5].map((p) => bandFor(p))).toEqual(['bench', 'on-target', 'on-target', 'over']);
    expect(BAND_LABEL).toEqual({ bench: 'Available', under: 'Under target', 'on-target': 'On target', over: 'Over capacity' });
  });

  it('bands load relative to the target (A-4)', () => {
    expect(relativeLoad(60, 60)).toBe(100);
    expect(relativeLoad(60, 0)).toBe(60);
    expect(relativeLoad(60, null)).toBe(60);
    expect(bandForLoad(60, 60)).toBe('on-target');
    expect(bandForLoad(60, 100)).toBe('under');
  });

  it('validates thresholds (ST-03#AC2)', () => {
    expect(validateThresholds(DEFAULT_THRESHOLDS)).toBeNull();
    expect(validateThresholds({ benchBelow: 50, onTargetFrom: 110, onTargetTo: 100 })).toBe(
      'On-target range must start below where it ends, and above the Available threshold.',
    );
    expect(validateThresholds({ benchBelow: 95, onTargetFrom: 90, onTargetTo: 100 })).not.toBeNull();
  });
});

describe('shared/permissions (D-3, AC-04)', () => {
  const ws = (orgRole: 'ORG_ADMIN' | 'MEMBER' | null, workspaceRole: Parameters<typeof permissionsFor>[0]['workspaceRole']) =>
    permissionsFor({ isPlatformAdmin: false, orgRole, workspaceRole });

  it('builds each role on the one below it', () => {
    const viewer = ws('MEMBER', 'VIEWER');
    const contributor = ws('MEMBER', 'CONTRIBUTOR');
    const planner = ws('MEMBER', 'PLANNER');
    const admin = ws('MEMBER', 'WORKSPACE_ADMIN');
    expect(viewer).toEqual(['org.view', 'data.read', 'export', 'ai.use']);
    expect(contributor).toEqual(expect.arrayContaining([...viewer, 'people.write.own', 'allocations.respond.own', 'offers.write.own']));
    expect(contributor).not.toContain('people.write');
    expect(planner).toEqual(expect.arrayContaining([...contributor, 'people.write', 'allocations.write', 'allocations.propose', 'import.csv']));
    expect(planner).not.toContain('structure.write');
    expect(admin).toEqual(expect.arrayContaining([...planner, 'structure.write', 'workspace.members.manage', 'integrations.manage']));
    expect(admin).not.toContain('org.manage');
  });

  it('ORG_ADMIN implies PMO Admin everywhere plus org permissions', () => {
    const p = ws('ORG_ADMIN', null);
    expect(p).toEqual(expect.arrayContaining(['structure.write', 'org.manage', 'org.billing', 'org.members.manage', 'workspace.manage']));
    expect(p).not.toContain('platform.admin');
    expect(permissionsFor({ isPlatformAdmin: true, orgRole: null, workspaceRole: null })).toEqual(['platform.admin']);
    expect(ws('MEMBER', null)).toEqual(['org.view']);
    expect(ws(null, null)).toEqual([]);
  });

  it('returns permissions in canonical order with no duplicates', () => {
    const p = ws('ORG_ADMIN', 'PLANNER');
    expect(p).toEqual(PERMISSIONS.filter((x) => p.includes(x)));
    expect(new Set(p).size).toBe(p.length);
  });

  it('maps legacy roles both ways (dual read/write)', () => {
    expect(toLegacyWorkspaceRole('WORKSPACE_ADMIN')).toBe('PMO_ADMIN');
    expect(toLegacyWorkspaceRole('PLANNER')).toBe('WORKSPACE_OWNER');
    expect(toLegacyWorkspaceRole('VIEWER')).toBe('USER');
    expect(fromLegacyWorkspaceRole('PMO_ADMIN')).toBe('WORKSPACE_ADMIN');
    expect(fromLegacyWorkspaceRole('WORKSPACE_OWNER')).toBe('PLANNER');
    expect(fromLegacyWorkspaceRole('USER')).toBe('VIEWER');
    expect(fromLegacyWorkspaceRole(undefined)).toBe('VIEWER');
    expect(fromLegacyUserRole('SUPERUSER')).toEqual({ isPlatformAdmin: true, orgRole: null });
    expect(fromLegacyUserRole('ADMIN')).toEqual({ isPlatformAdmin: false, orgRole: 'ORG_ADMIN' });
    expect(fromLegacyUserRole('USER')).toEqual({ isPlatformAdmin: false, orgRole: 'MEMBER' });
  });

  it('labels roles exactly as ST-02#AC4', () => {
    expect(ROLE_LABEL).toEqual({ ORG_ADMIN: 'Org Admin', WORKSPACE_ADMIN: 'PMO Admin', PLANNER: 'Planner', CONTRIBUTOR: 'Squad member', VIEWER: 'Viewer' });
    expect(WORKSPACE_ROLE_RANK.WORKSPACE_ADMIN).toBeGreaterThan(WORKSPACE_ROLE_RANK.PLANNER);
  });
});

describe('shared/entitlements (PL-07)', () => {
  it('internal mode is ENTERPRISE with billing hidden', () => {
    expect(entitlementsFor('BASIC', 'internal')).toBe(PLAN_ENTITLEMENTS.ENTERPRISE);
    expect(entitlementsFor('BASIC', 'internal').billingVisible).toBe(false);
    expect(entitlementsFor('PRO', 'public').maxPeople).toBe(20);
  });

  it('limits block only creating beyond the limit (A-5)', () => {
    const basic = entitlementsFor('BASIC', 'public');
    expect(withinLimit(basic, 'maxPeople', 5)).toBe(true);
    expect(withinLimit(basic, 'maxPeople', 6)).toBe(false);
    expect(withinLimit(entitlementsFor('MAX', 'public'), 'maxPeople', 10_000)).toBe(true);
    expect(entitled(basic, 'csvImport')).toBe(false);
    expect(entitled(entitlementsFor('PRO', 'public'), 'csvImport')).toBe(true);
  });
});

describe('shared/features (SH-05#AC1)', () => {
  it('defaults every flag and merges stored values', () => {
    expect(resolveFeatures(null)).toEqual({ qbrSprintModule: false, aiAssistant: false, scenarios: false, planviewScheduledImport: false, jiraScheduledSync: true });
    expect(resolveFeatures({ aiAssistant: true }).aiAssistant).toBe(true);
    expect(Object.keys(DEFAULT_FEATURES)).toEqual([...FEATURE_FLAGS]);
  });
});

describe('shared/contracts/api route builder', () => {
  it('builds the §4.3 paths', () => {
    expect(API.people('w', 'p')).toBe('/api/v2/workspaces/w/people/p');
    expect(API.orgEntity('o', 'crafts')).toBe('/api/v2/orgs/o/crafts');
    expect(API.craftRequestDecision('w', 'r', 'approve')).toBe('/api/v2/workspaces/w/craft-requests/r/approve');
    expect(API.offer('w', 'p', '2027-Q1')).toBe('/api/v2/workspaces/w/offers/p/2027-Q1');
    expect(API.calibration('w')).toBe('/api/v2/workspaces/w/calibration');
    expect(DTO_RE.test('2027-Q4')).toBe(true);
    expect(DTO_RE.test('2027-Q5')).toBe(false);
  });
});
