/** UAT-08: Sprint planning names quarters the way the rest of the app does ("QBR1 = Q4 2026"). */
import { rollingQuarterViews, sprintQuarterLabel } from '../../utils/quarters';

const views = rollingQuarterViews('2026-10-17', 1);

describe('sprintQuarterLabel (UAT-08)', () => {
  it('names a v1.1 sprint quarter by its QBR position and calendar quarter, with the stored label in brackets', () => {
    expect(sprintQuarterLabel({ start_date: '2026-10-01', label: 'QBR1 FY27' }, views)).toBe(
      'QBR1 · Q4 2026 (QBR1 FY27)',
    );
    expect(sprintQuarterLabel({ start_date: '2027-01-05T00:00:00.000Z', label: 'FY27 Q2' }, views)).toBe(
      'QBR2 · Q1 2027 (FY27 Q2)',
    );
  });
  it('drops the stored label when it says the same thing, and uses the calendar name outside the window', () => {
    expect(sprintQuarterLabel({ start_date: '2026-10-01', label: 'QBR1' }, views)).toBe('QBR1 · Q4 2026');
    expect(sprintQuarterLabel({ start_date: '2026-04-01', label: null }, views)).toBe('Q2 2026');
    expect(sprintQuarterLabel({ start_date: 'not a date', label: 'Legacy' }, views)).toBe('Legacy');
  });
});
