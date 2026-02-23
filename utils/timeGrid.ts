import { Allocation, getAllocationStatus, AllocationStatus } from '../types';

export interface MonthForecast {
    label: string;      // e.g. "Jan", "Feb", "Mar 2026"
    year: number;
    month: number;      // 0-11
    percentage: number;
    status: AllocationStatus;
}

/**
 * Returns an array of the next `monthsCount` months, starting from the current month + monthOffset.
 * Computes the total utilization for the given allocations in each month.
 */
export function buildTimeForecast(allocations: Allocation[], monthsCount: number = 6, monthOffset: number = 0): MonthForecast[] {
    const forecast: MonthForecast[] = [];
    const now = new Date();

    // Normalize allocation dates
    const normalizedAllocs = allocations.map(a => {
        const start = a.startDate ? new Date(a.startDate) : new Date('2000-01-01');
        const end = a.endDate ? new Date(a.endDate + 'T23:59:59') : new Date('2099-12-31T23:59:59');
        return { ...a, start, end };
    });

    for (let i = 0; i < monthsCount; i++) {
        // Calculate the target month based on today + offset + iterator
        const targetDate = new Date(now.getFullYear(), now.getMonth() + monthOffset + i, 1);
        const y = targetDate.getFullYear();
        const m = targetDate.getMonth();

        // Month boundaries
        const monthStart = new Date(y, m, 1);
        const monthEnd = new Date(y, m + 1, 0, 23, 59, 59); // Last day of month

        // Check overlaps
        let totalPct = 0;
        for (const alloc of normalizedAllocs) {
            // Overlaps if alloc starts before month ends AND alloc ends after month starts
            if (alloc.start <= monthEnd && alloc.end >= monthStart) {
                totalPct += alloc.percentage;
            }
        }

        const formatter = new Intl.DateTimeFormat('en-US', { month: 'short' });
        let label = formatter.format(targetDate);
        // Add year if we cross into a new year, or for the very first item if we want clarity
        if (i === 0 || m === 0) {
            label += ` '${String(y).slice(-2)}`;
        }

        forecast.push({
            label,
            year: y,
            month: m,
            percentage: totalPct,
            status: getAllocationStatus(totalPct)
        });
    }

    return forecast;
}

export function forecastColor(s: AllocationStatus) {
    if (s === AllocationStatus.OVER) return '#ef4444';     // Red
    if (s === AllocationStatus.HIGH) return '#f59e0b';     // Yellow
    if (s === AllocationStatus.OPTIMAL) return '#10b981';  // Green
    return '#94a3b8';                                      // Gray (Under)
}
