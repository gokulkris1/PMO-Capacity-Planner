/**
 * Independent QA (Release 2.0): QBR quarter maths at the 31 Dec / 1 Jan and 31 Mar / 1 Apr boundaries, evaluated in
 * several process time zones (UTC-11 … UTC+14, including DST zones). Node re-reads process.env.TZ at runtime, so each
 * case switches the zone before computing. The planning engine works on ISO calendar days, so the results must be the
 * same in every zone: a booking that ends on 31 Dec never leaks into Q1, one that starts on 1 Apr never leaks into Q1,
 * and "today" (utils/clock) is the user's local calendar day.
 */
import { setClock, today } from '../../utils/clock';
import { allocationPctInQuarter } from '../../utils/craftEngine';
import { overlapShare, quarterBounds, quarterKeyOf, rollingQuarterViews } from '../../utils/quarters';

const ZONES = [
  'UTC',
  'Pacific/Pago_Pago',
  'America/Los_Angeles',
  'Europe/Dublin',
  'Asia/Kolkata',
  'Pacific/Kiritimati',
];
const ORIGINAL_TZ = process.env.TZ;

afterAll(() => {
  setClock();
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe.each(ZONES)('quarter boundaries in TZ=%s', (zone) => {
  beforeAll(() => {
    process.env.TZ = zone;
  });
  afterEach(() => setClock());

  it('QBR1 is the quarter of the given calendar day on both sides of 31 Dec / 1 Jan and 31 Mar / 1 Apr', () => {
    expect(rollingQuarterViews('2026-12-31').map((q) => q.key)).toEqual(['2026-Q4', '2027-Q1', '2027-Q2', '2027-Q3']);
    expect(rollingQuarterViews('2027-01-01')[0].key).toBe('2027-Q1');
    expect(rollingQuarterViews('2027-03-31')[0].key).toBe('2027-Q1');
    expect(rollingQuarterViews('2027-04-01')[0].key).toBe('2027-Q2');
    expect(quarterKeyOf('2027-03-31')).toBe('2027-Q1');
  });

  it('quarter bounds are inclusive calendar days (Q1 2027 = 1 Jan – 31 Mar, 90 days)', () => {
    expect(quarterBounds('2027-Q1')).toEqual({ start: '2027-01-01', end: '2027-03-31' });
    expect(quarterBounds('2026-Q4')).toEqual({ start: '2026-10-01', end: '2026-12-31' });
  });

  it('a booking ending 31 Dec counts fully in Q4 and not at all in Q1; one starting 1 Apr not at all in Q1', () => {
    const [q4, q1, q2] = rollingQuarterViews('2026-11-15');
    const endsDec = { resourceId: 'r', projectId: 'p', percentage: 60, startDate: '2026-10-01', endDate: '2026-12-31' };
    const startsApr = {
      resourceId: 'r',
      projectId: 'p',
      percentage: 50,
      startDate: '2027-04-01',
      endDate: '2027-06-30',
    };
    expect(allocationPctInQuarter(endsDec, q4)).toBe(60);
    expect(allocationPctInQuarter(endsDec, q1)).toBe(0);
    expect(allocationPctInQuarter(startsApr, q1)).toBe(0);
    expect(allocationPctInQuarter(startsApr, q2)).toBe(50);
  });

  it('a one-day booking on 31 Mar is 1/90 of Q1 (no DST hour lost or gained)', () => {
    expect(overlapShare('2027-03-31', '2027-03-31', '2027-01-01', '2027-03-31')).toBeCloseTo(1 / 90, 10);
    expect(overlapShare('2026-12-31', '2027-01-01', '2026-10-01', '2026-12-31')).toBeCloseTo(1 / 92, 10);
  });

  it('"today" is the local calendar day of the pinned instant', () => {
    setClock('2026-12-31');
    expect(today()).toBe('2026-12-31');
    setClock(new Date(2027, 0, 1, 0, 0, 1));
    expect(today()).toBe('2027-01-01');
    expect(rollingQuarterViews(today())[0].key).toBe('2027-Q1');
  });
});
