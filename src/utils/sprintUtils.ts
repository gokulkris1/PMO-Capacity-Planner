import { Sprint, QuarterDef } from '../../types';

/**
 * The PMO Capacity Planner operates on a strict Sprint cadence.
 * Anchor Date: January 7, 2026 (Start of Sprint 1)
 * Sprint Length: 14 Days
 * 
 * Quarters:
 * Q1: Jan 1 - Mar 31
 * Q2: Apr 1 - Jun 30
 * Q3: Jul 1 - Sep 30
 * Q4: Oct 1 - Dec 31
 * 
 * Sprints are assigned to the Quarter in which they START.
 */

const ANCHOR_DATE = new Date('2026-01-07T00:00:00Z');
const SPRINT_DAYS = 14;

// Cache generated years to avoid infinite recalculations
const cache: Record<number, QuarterDef[]> = {};

function addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setUTCDate(result.getUTCDate() + days);
    return result;
}

function getQuarterForDate(date: Date): { year: number, q: number } {
    const month = date.getUTCMonth(); // 0-11
    return {
        year: date.getUTCFullYear(),
        q: Math.floor(month / 3) + 1
    };
}

/**
 * Lazily computes the sprints for an entire given calendar year.
 * O(1) mostly, runs from Anchor linearly outwards since it calculates sequentially.
 */
export function getQuartersForYear(year: number): QuarterDef[] {
    if (cache[year]) return cache[year];

    // Determine how many days separate Jan 1 of requested year from Anchor Date
    const targetStart = new Date(Date.UTC(year, 0, 1)); // Jan 1st of requested year
    const diffTime = targetStart.getTime() - ANCHOR_DATE.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    // Find the sprint index that overlaps with Jan 1st of this year
    let sprintIndex = Math.floor(diffDays / SPRINT_DAYS);
    let currentSprintStart = addDays(ANCHOR_DATE, sprintIndex * SPRINT_DAYS);

    const quarters: Record<number, QuarterDef> = {
        1: { id: `${year}-Q1`, name: `Q1 ${year}`, year, sprints: [] },
        2: { id: `${year}-Q2`, name: `Q2 ${year}`, year, sprints: [] },
        3: { id: `${year}-Q3`, name: `Q3 ${year}`, year, sprints: [] },
        4: { id: `${year}-Q4`, name: `Q4 ${year}`, year, sprints: [] },
    };

    // Keep generating sprints until we exit the target year
    while (currentSprintStart.getUTCFullYear() <= year) {
        const sprintEnd = addDays(currentSprintStart, SPRINT_DAYS - 1);
        const { year: qYear, q } = getQuarterForDate(currentSprintStart);

        // Only push sprints that START in the requested year
        if (qYear === year) {
            quarters[q].sprints.push({
                id: `S${sprintIndex + 1}`,
                name: `Sprint ${sprintIndex + 1}`,
                startDate: currentSprintStart.toISOString().slice(0, 10),
                endDate: sprintEnd.toISOString().slice(0, 10)
            });
        }

        currentSprintStart = addDays(currentSprintStart, SPRINT_DAYS);
        sprintIndex++;
    }

    const result = [quarters[1], quarters[2], quarters[3], quarters[4]];
    cache[year] = result;
    return result;
}

/**
 * Validates if a specific sprint overlaps with a project's boundaries.
 * A sprint is valid if any part of it falls within the project dates.
 */
export function isSprintWithinProject(sprint: Sprint, projectStart?: string, projectEnd?: string): boolean {
    if (!projectStart && !projectEnd) return true; // Unbound project

    const sStart = new Date(sprint.startDate);
    const sEnd = new Date(sprint.endDate);

    // Default unbound project dates to infinity boundaries
    const pStart = projectStart ? new Date(projectStart) : new Date('2000-01-01');
    const pEnd = projectEnd ? new Date(projectEnd) : new Date('2099-12-31');

    // Overlap condition: SprintStart <= ProjectEnd AND SprintEnd >= ProjectStart
    return sStart <= pEnd && sEnd >= pStart;
}

/**
 * Helpers to populate UI dropdowns
 */
export function getAvailableYears(): number[] {
    const currentYear = new Date().getUTCFullYear();
    return [currentYear - 1, currentYear, currentYear + 1, currentYear + 2];
}
