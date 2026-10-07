import { Allocation, Project, projectConsumesCapacity } from '../types';

type DateBoundary = 'start' | 'end';

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDateBoundary(value: string, boundary: DateBoundary): Date | null {
    const dateOnlyMatch = DATE_ONLY_PATTERN.exec(value);

    if (dateOnlyMatch) {
        const [, yearString, monthString, dayString] = dateOnlyMatch;
        const year = Number(yearString);
        const month = Number(monthString);
        const day = Number(dayString);
        const date = boundary === 'start'
            ? new Date(year, month - 1, day, 0, 0, 0, 0)
            : new Date(year, month - 1, day, 23, 59, 59, 999);

        // Date normalizes invalid calendar values, so reject those rather than
        // silently moving an allocation into a different month.
        if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
            return null;
        }

        return date;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Check if an allocation is active on a given date,
 * considering its optional startDate/endDate range.
 */
export function isAllocActiveOn(a: Allocation, date: Date): boolean {
    if (Number.isNaN(date.getTime())) return false;
    if (!a.startDate && !a.endDate) return true;
    const start = a.startDate ? parseDateBoundary(a.startDate, 'start') : new Date('2000-01-01T00:00:00');
    const end = a.endDate ? parseDateBoundary(a.endDate, 'end') : new Date('2099-12-31T23:59:59.999');
    return !!start && !!end && start <= date && end >= date;
}

function allocationConsumesCapacity(a: Allocation, projects?: Project[]): boolean {
    if (!projects) return true;
    const project = projects.find(candidate => candidate.id === a.projectId);

    // Keep orphaned records visible in capacity figures rather than silently
    // hiding a data-integrity problem.
    return !project || projectConsumesCapacity(project.status);
}

/**
 * Get the CURRENT utilization for a resource — only counting allocations
 * whose date range overlaps with today.
 */
export function getCurrentUtil(allocs: Allocation[], resId: string, projects?: Project[]): number {
    const now = new Date();
    return allocs
    .filter(a => a.resourceId === resId && isAllocActiveOn(a, now) && allocationConsumesCapacity(a, projects))
        .reduce((s, a) => s + a.percentage, 0);
}

/**
 * Get utilization for a resource at a specific date.
 */
export function getUtilAtDate(allocs: Allocation[], resId: string, date: Date, projects?: Project[]): number {
    return allocs
    .filter(a => a.resourceId === resId && isAllocActiveOn(a, date) && allocationConsumesCapacity(a, projects))
        .reduce((s, a) => s + a.percentage, 0);
}
