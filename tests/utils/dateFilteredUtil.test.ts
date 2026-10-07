import { Allocation } from '../../types';
import { getUtilAtDate, isAllocActiveOn } from '../../utils/dateFilteredUtil';

describe('date-filtered utilization', () => {
    const originalTimeZone = process.env.TZ;

    beforeAll(() => {
        process.env.TZ = 'America/Los_Angeles';
    });

    afterAll(() => {
        if (originalTimeZone === undefined) {
            delete process.env.TZ;
        } else {
            process.env.TZ = originalTimeZone;
        }
    });

    it('does not count a next-day date-only allocation before its local start date', () => {
        const allocations: Allocation[] = [
            { id: 'current', resourceId: 'r1', projectId: 'p1', percentage: 100 },
            { id: 'tomorrow', resourceId: 'r1', projectId: 'p2', percentage: 5, startDate: '2026-10-08' },
        ];
        const eveningBeforeStart = new Date(2026, 9, 7, 18, 0, 0);

        expect(isAllocActiveOn(allocations[1], eveningBeforeStart)).toBe(false);
        expect(getUtilAtDate(allocations, 'r1', eveningBeforeStart)).toBe(100);
    });

    it('keeps a date-only allocation active through the end of its local end date', () => {
        const allocation: Allocation = {
            id: 'ending', resourceId: 'r1', projectId: 'p1', percentage: 100,
            endDate: '2026-10-07',
        };

        expect(isAllocActiveOn(allocation, new Date(2026, 9, 7, 23, 59, 59))).toBe(true);
        expect(isAllocActiveOn(allocation, new Date(2026, 9, 8, 0, 0, 0))).toBe(false);
    });
});