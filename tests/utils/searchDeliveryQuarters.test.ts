import type * as D from '../../shared/contracts/dto';
import { now, nowIso, setClock, today, toIsoDate } from '../../utils/clock';
import {
  addDays,
  dayNumber,
  fiscalLabel,
  isIsoDate,
  overlapDays,
  overlapShare,
  quarterBounds,
  quarterKeyOf,
  quarterRangeLabel,
  rollingQuarterViews,
  shiftQuarter,
} from '../../utils/quarters';
import { buildSearchIndex, normalise } from '../../utils/search';
import {
  buildDeliveryTrend,
  buildProjectDelivery,
  buildSprintView,
  DEFAULT_CALIBRATION,
  deliverySignal,
  effectiveCalibration,
  impliedFte,
  relativeTime,
  suggestedBasisLabel,
  syncHealthBanner,
  syncHealthState,
  syncJobLabel,
} from '../../utils/viewModels';
import { demoSnapshot } from './fixtures';

describe('clock', () => {
  afterEach(() => setClock());
  it('pins and restores the date', () => {
    setClock('2026-10-16');
    expect(today()).toBe('2026-10-16');
    expect(toIsoDate(now())).toBe('2026-10-16');
    setClock(() => new Date('2027-01-02T12:00:00Z'));
    expect(nowIso()).toBe('2027-01-02T12:00:00.000Z');
    setClock();
    expect(Math.abs(now().getTime() - Date.now())).toBeLessThan(1000);
  });
});

describe('quarters (A-1)', () => {
  it('builds QBR1–QBR4 from today with calendar and fiscal labels', () => {
    const q = rollingQuarterViews('2026-10-16', 10);
    expect(q.map((x) => x.key)).toEqual(['2026-Q4', '2027-Q1', '2027-Q2', '2027-Q3']);
    expect(q.map((x) => x.label)).toEqual(['QBR1', 'QBR2', 'QBR3', 'QBR4']);
    expect(q[0]).toMatchObject({
      index: 0,
      calendarLabel: 'Q4 2026',
      fiscalLabel: 'FY27 Q1',
      start: '2026-10-01',
      end: '2026-12-31',
    });
    expect(q[1].fiscalLabel).toBe('FY27 Q2');
    expect(rollingQuarterViews('2027-03-31')[0].key).toBe('2027-Q1');
  });

  it('labels fiscal years by the calendar year they end in', () => {
    expect(fiscalLabel(2026, 4, 1)).toBe('FY26 Q4');
    expect(fiscalLabel(2026, 4, 4)).toBe('FY27 Q3');
    expect(fiscalLabel(2026, 2, 7)).toBe('FY26 Q4');
    expect(fiscalLabel(2026, 3, 7)).toBe('FY27 Q1');
  });

  it('does ISO-day arithmetic without time-zone drift', () => {
    expect(isIsoDate('2027-02-29')).toBe(false);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate(42)).toBe(false);
    expect(dayNumber('1970-01-02')).toBe(1);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-29', -1)).toBe('2026-03-28');
    expect(quarterKeyOf('2027-05-01')).toBe('2027-Q2');
    expect(quarterBounds('2028-Q1')).toEqual({ start: '2028-01-01', end: '2028-03-31' });
    expect(quarterBounds('nope')).toBeNull();
    expect(shiftQuarter('2026-Q4', 1)).toBe('2027-Q1');
    expect(shiftQuarter('2027-Q1', -2)).toBe('2026-Q3');
    expect(quarterRangeLabel('2026-Q4')).toBe('Oct–Dec 2026');
    expect(overlapDays('2026-11-02', null, '2026-10-01', '2026-12-31')).toBe(60);
    expect(overlapDays(null, '2026-09-30', '2026-10-01', '2026-12-31')).toBe(0);
    expect(overlapShare(null, null, '2026-10-01', '2026-12-31')).toBe(1);
  });
});

describe('global search (SH-06)', () => {
  it('finds "neb" under Projects; groups People, Projects, Tribes, Crafts with at most 5 each', async () => {
    const s = await demoSnapshot();
    const search = buildSearchIndex(s);
    expect(search('neb')).toEqual([
      { kind: 'project', id: 'p3', label: 'Nebula Analytics', sublabel: 'Lending · Initiated' },
    ]);
    const results = search('a');
    const kinds = results.map((r) => r.kind);
    expect(kinds).toEqual(
      [...kinds].sort(
        (a, b) =>
          ['person', 'project', 'tribe', 'craft'].indexOf(a) - ['person', 'project', 'tribe', 'craft'].indexOf(b),
      ),
    );
    for (const k of ['person', 'project', 'tribe', 'craft'])
      expect(kinds.filter((x) => x === k).length).toBeLessThanOrEqual(5);
    expect(search('  ')).toEqual([]);
  });

  it('ranks label prefixes first and matches secondary text, accents and codes', async () => {
    const s = await demoSnapshot();
    const search = buildSearchIndex({
      ...s,
      people: [...s.people, { ...s.people[0], id: 'x', name: 'Seán Ó Dálaigh', skills: [] }],
    });
    expect(search('sean')[0]).toMatchObject({ kind: 'person', label: 'Seán Ó Dálaigh' });
    expect(search('APOLLO').map((r) => r.label)).toContain('Apollo Revamp');
    expect(search('genesys').map((r) => r.label)).toEqual(['Maria Kelly', 'Telephony Cloud Migration']); // skill, description
    expect(search('pgm')).toEqual([
      { kind: 'craft', id: 'programme-mgmt', label: 'Programme Management', sublabel: 'PGM' },
    ]);
    expect(normalise('  Ó Dálaigh ')).toBe('o dalaigh');
  });
});

describe('delivery view-models (JI-04 … JI-07)', () => {
  const cal = (o: Partial<D.TribeCalibrationDTO>): D.TribeCalibrationDTO => ({
    tribeId: 't',
    pointsPerSprintPerFte: 12,
    sprintLengthDays: 14,
    isDefault: false,
    suggestedValue: null,
    suggestedBasis: null,
    note: null,
    version: 1,
    updatedAt: '2026-10-01T00:00:00Z',
    updatedBy: null,
    ...o,
  });

  it('uses the workspace default when a tribe has no calibration (JI-04#AC3)', () => {
    expect(effectiveCalibration([], 't')).toMatchObject({ ...DEFAULT_CALIBRATION, isDefault: true, calibration: null });
    expect(effectiveCalibration([cal({})], 't')).toMatchObject({ pointsPerSprintPerFte: 12, isDefault: false });
    expect(effectiveCalibration([cal({ isDefault: true })], 't').isDefault).toBe(true);
  });

  it('computes implied FTE and the basis label', () => {
    expect(impliedFte(96, { pointsPerSprintPerFte: 10, sprintLengthDays: 14 }, 42)).toBe(3.2);
    expect(impliedFte(10, { pointsPerSprintPerFte: 10, sprintLengthDays: 14 }, 0)).toBe(0);
    expect(
      suggestedBasisLabel(
        cal({ suggestedBasis: { sprintNames: ['Sprint 41', 'Sprint 42', 'Sprint 43'], points: 96, fte: 3.2 } }),
      ),
    ).toBe('Based on Sprint 41–Sprint 43: 96 pts, 3.2 FTE');
    expect(suggestedBasisLabel(cal({}))).toBeNull();
  });

  it('delivery signal thresholds (JI-06#AC1)', () => {
    expect(deliverySignal(1, 1.21)).toBe('more');
    expect(deliverySignal(1, 1.2)).toBe('in-line');
    expect(deliverySignal(1, 0.8)).toBe('in-line');
    expect(deliverySignal(1, 0.79)).toBe('less');
    expect(deliverySignal(0, 0.5)).toBe('more');
    expect(deliverySignal(0, 0)).toBe('none');
  });

  it('project delivery, sprint view and trend from delivery rows', async () => {
    const s = await demoSnapshot();
    const row = (o: Partial<D.DeliveryRowDTO>): D.DeliveryRowDTO => ({
      key: 'k',
      label: 'Sprint',
      tribeId: 'tribe-digital',
      projectId: 'p1',
      sprintId: 's',
      sprintName: 'Sprint',
      quarterKey: '2026-Q3',
      from: '2026-09-01',
      to: '2026-09-14',
      pointsTotal: 10,
      pointsDone: 8,
      issuesDone: 3,
      impliedFte: 1,
      plannedFte: 1,
      ...o,
    });
    const rows = Array.from({ length: 8 }, (_, i) =>
      row({ key: `k${i}`, sprintId: `s${i}`, to: `2026-0${i + 1}-14`, from: `2026-0${i + 1}-01` }),
    );
    const view = buildSprintView(rows, 'tribe-digital');
    expect(view).toHaveLength(6);
    expect(view[0].to < view[5].to).toBe(true);
    const pd = buildProjectDelivery(s, rows, 'p1');
    expect(pd.hasData).toBe(true);
    expect(pd.qbr1).toMatchObject({ plannedFte: 2.05, impliedFte: 2.8, signal: 'more' });
    expect(pd.sprints).toHaveLength(3);
    expect(buildProjectDelivery({ ...s, delivery: null }, [], 'p1')).toEqual({
      qbr1: null,
      sprints: [],
      hasData: false,
    });
    expect(buildDeliveryTrend(rows)[0].points).toHaveLength(8);
    expect(buildDeliveryTrend([rows[0]])).toEqual([]);
  });

  it('sync health: failed, stale after 48 h, running and labels (JI-07, RP-01#AC4)', () => {
    const at = new Date('2026-10-16T12:00:00Z');
    const job = (o: Partial<D.SyncJobDTO>): D.SyncJobDTO => ({
      id: 'j',
      provider: 'jira',
      trigger: 'schedule',
      status: 'succeeded',
      pagesDone: 1,
      issuesSeen: 1,
      error: null,
      rateLimitedUntil: null,
      startedAt: '2026-10-16T05:00:00Z',
      finishedAt: '2026-10-16T05:02:00Z',
      requestedBy: null,
      ...o,
    });
    const health = (o: Partial<D.SyncHealthDTO>): D.SyncHealthDTO => ({
      provider: 'jira',
      configured: true,
      state: 'ok',
      lastSuccessAt: '2026-10-16T05:02:00Z',
      lastJob: job({}),
      recentJobs: [],
      ...o,
    });
    expect(syncHealthState(health({}), at)).toBe('ok');
    expect(syncHealthBanner(health({}), at)).toBeNull();
    const failed = health({
      lastJob: job({ status: 'failed', error: 'Jira rejected the credentials', finishedAt: '2026-10-16T09:00:00Z' }),
    });
    expect(syncHealthBanner(failed, at)).toEqual({
      kind: 'failed',
      message: 'Jira sync failed 3 hours ago: Jira rejected the credentials',
    });
    const stale = health({ lastSuccessAt: '2026-10-13T12:00:00Z' });
    expect(syncHealthState(stale, at)).toBe('stale');
    expect(syncHealthBanner(stale, at)?.message).toBe('Jira data is stale: last successful sync 3 days ago.');
    expect(syncHealthState(health({ configured: false }), at)).toBe('never');
    expect(syncHealthState(health({ lastJob: job({ status: 'running' }) }), at)).toBe('running');
    expect(syncJobLabel(job({ status: 'running', rateLimitedUntil: '2026-10-16T12:05:00Z' }), at)).toBe('Rate limited');
    expect(syncJobLabel(job({ status: 'partial' }), at)).toBe('Partial');
    expect(relativeTime('2026-10-16T11:59:30Z', at)).toBe('just now');
    expect(relativeTime('2026-10-16T11:00:00Z', at)).toBe('1 hour ago');
  });
});
