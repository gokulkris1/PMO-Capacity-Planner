import { Allocation, Project, getAllocationStatus, AllocationStatus } from '../types';

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
export function buildTimeForecast(allocations: Allocation[], projects: Project[], monthsCount: number = 6, monthOffset: number = 0): MonthForecast[] {
    const forecast: MonthForecast[] = [];
    const now = new Date();

    // Normalize allocation dates
    const normalizedAllocs = allocations.map(a => {
        const proj = projects.find(p => p.id === a.projectId);
        const effStart = a.startDate || proj?.startDate;
        const effEnd = a.endDate || proj?.endDate;
        const start = effStart ? new Date(effStart) : new Date('2000-01-01');
        const end = effEnd ? new Date(effEnd + 'T23:59:59') : new Date('2099-12-31T23:59:59');
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

export interface DayForecast {
    date: Date;
    dayOfMonth: number;
    utilization: number;
    availability: number;
    status: AllocationStatus;
    projects: { id: string; name: string; pct: number }[];
}

export function buildMonthDayForecast(
    year: number,
    month: number, // 0-indexed
    allocations: Allocation[],
    projects: Project[]
): DayForecast[] {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const forecast: DayForecast[] = [];

    const normalizedAllocs = allocations.map(a => {
        const proj = projects.find(p => p.id === a.projectId);
        // Netlify might be returning raw Postgres rows with snake_case
        const effStart = a.startDate || (a as any).start_date || proj?.startDate || (proj as any)?.start_date;
        const effEnd = a.endDate || (a as any).end_date || proj?.endDate || (proj as any)?.end_date;

        // Parse 'YYYY-MM-DD' exactly into local timezone so it aligns with our calendar days
        let start = new Date('2000-01-01T00:00:00');
        if (effStart) {
            const [y, m, d] = String(effStart).split('T')[0].split('-').map(Number);
            start = new Date(y, m - 1, d, 0, 0, 0);
        }

        let end = new Date('2099-12-31T23:59:59');
        if (effEnd) {
            const [y, m, d] = String(effEnd).split('T')[0].split('-').map(Number);
            end = new Date(y, m - 1, d, 23, 59, 59);
        }

        return { ...a, start, end, projName: proj?.name || 'Unknown Project' };
    });

    for (let d = 1; d <= daysInMonth; d++) {
        const currentData = new Date(year, month, d);
        // Exclude weekends from pure booking counting if you wish, 
        // but typically capacity tools show standard days. We'll show all days.

        let util = 0;
        const activeProjects: { id: string; name: string; pct: number }[] = [];

        // Check which allocations cover this specific day
        // using just the date parts to prevent timezone weirdness
        const startOfDay = new Date(year, month, d, 0, 0, 0);
        const endOfDay = new Date(year, month, d, 23, 59, 59);

        for (const alloc of normalizedAllocs) {
            if (alloc.start <= endOfDay && alloc.end >= startOfDay) {
                util += alloc.percentage;
                activeProjects.push({ id: alloc.projectId, name: alloc.projName, pct: alloc.percentage });
            }
        }

        forecast.push({
            date: currentData,
            dayOfMonth: d,
            utilization: util,
            availability: Math.max(0, 100 - util),
            status: getAllocationStatus(util),
            projects: activeProjects
        });
    }

    return forecast;
}
