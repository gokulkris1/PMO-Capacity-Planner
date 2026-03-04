import { Allocation } from '../types';

/**
 * Check if an allocation is active on a given date,
 * considering its optional startDate/endDate range.
 */
export function isAllocActiveOn(a: Allocation, date: Date): boolean {
    if (!a.startDate && !a.endDate) return true;
    const start = a.startDate ? new Date(a.startDate) : new Date('2000-01-01');
    const end = a.endDate ? new Date(a.endDate + 'T23:59:59') : new Date('2099-12-31T23:59:59');
    return start <= date && end >= date;
}

/**
 * Get the CURRENT utilization for a resource — only counting allocations
 * whose date range overlaps with today.
 */
export function getCurrentUtil(allocs: Allocation[], resId: string): number {
    const now = new Date();
    return allocs
        .filter(a => a.resourceId === resId && isAllocActiveOn(a, now))
        .reduce((s, a) => s + a.percentage, 0);
}

/**
 * Get utilization for a resource at a specific date.
 */
export function getUtilAtDate(allocs: Allocation[], resId: string, date: Date): number {
    return allocs
        .filter(a => a.resourceId === resId && isAllocActiveOn(a, date))
        .reduce((s, a) => s + a.percentage, 0);
}
