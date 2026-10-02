/**
 * Craft engine — turns resources, projects and allocations into the numbers the
 * PMO needs to run a rolling four-quarter plan:
 *
 *   • per person per quarter: above-the-table %, below-the-table %, bench %
 *   • per craft per quarter: supply (people who hold the craft), committed, demand, gap
 *   • marketplace matches: who can absorb unstaffed demand, ranked
 *
 * All FTE figures are quarter-averaged: an allocation of 50% that only covers half
 * the quarter counts as 0.25 FTE for that quarter.
 */
import { Allocation, Craft, CraftDemand, Project, Resource, SecondaryCraft } from '../types';
import { Quarter, overlapFraction, parseDay } from './quarters';

export const DEFAULT_SECONDARY_MAX_PCT = 40;
export const DEFAULT_TARGET_UTIL = 100;

/* ── allocation → quarter ─────────────────────────────────────── */

/** Effective date window of an allocation: its own dates, else the project's dates, else open-ended. */
export function allocationWindow(a: Allocation, project?: Project): { start: Date | null; end: Date | null } {
    const start = parseDay(a.startDate, 'start') ?? parseDay(project?.startDate, 'start');
    const end = parseDay(a.endDate, 'end') ?? parseDay(project?.endDate, 'end');
    return { start, end };
}

/** Quarter-averaged percentage contributed by one allocation in one quarter. */
export function allocationPctInQuarter(a: Allocation, quarter: Quarter, project?: Project): number {
    if (!a.percentage || a.percentage <= 0) return 0;
    const { start, end } = allocationWindow(a, project);
    return a.percentage * overlapFraction(start, end, quarter);
}

export function allocationCraft(a: Allocation, resource?: Resource): string | undefined {
    return a.craftId || resource?.primaryCraft;
}

/* ── per person ───────────────────────────────────────────────── */

export interface PersonQuarterLoad {
    quarterKey: string;
    aboveTable: number;   // % of capacity spent on primary craft
    belowTable: number;   // % of capacity spent on secondary crafts
    other: number;        // % spent on allocations whose craft is unknown / not in the catalogue
    total: number;        // aboveTable + belowTable + other
    capacity: number;     // resource.totalCapacity
    bench: number;        // max(0, capacity - total)
    byProject: { projectId: string; pct: number; craftId?: string }[];
}

export function personQuarterLoad(
    resource: Resource,
    quarter: Quarter,
    allocations: Allocation[],
    projects: Project[],
): PersonQuarterLoad {
    const projectMap = new Map(projects.map(p => [p.id, p]));
    const secondaryIds = new Set((resource.secondaryCrafts || []).map(s => s.craftId));
    let above = 0, below = 0, other = 0;
    const byProject: PersonQuarterLoad['byProject'] = [];

    for (const a of allocations) {
        if (a.resourceId !== resource.id) continue;
        const pct = allocationPctInQuarter(a, quarter, projectMap.get(a.projectId));
        if (pct <= 0) continue;
        const craft = allocationCraft(a, resource);
        if (craft && craft === resource.primaryCraft) above += pct;
        else if (craft && secondaryIds.has(craft)) below += pct;
        else other += pct;
        byProject.push({ projectId: a.projectId, pct, craftId: craft });
    }

    const capacity = resource.totalCapacity ?? 100;
    const total = above + below + other;
    return {
        quarterKey: quarter.key,
        aboveTable: round1(above),
        belowTable: round1(below),
        other: round1(other),
        total: round1(total),
        capacity,
        bench: round1(Math.max(0, capacity - total)),
        byProject,
    };
}

export function personOutlook(resource: Resource, quarters: Quarter[], allocations: Allocation[], projects: Project[]): PersonQuarterLoad[] {
    return quarters.map(q => personQuarterLoad(resource, q, allocations, projects));
}

/* ── per craft ────────────────────────────────────────────────── */

export interface CraftQuarterBalance {
    craftId: string;
    quarterKey: string;
    /** FTE of people whose primary craft this is (above-the-table supply) */
    primarySupply: number;
    /** FTE that holders of this craft as a secondary could add, bounded by their maxPct and free capacity */
    secondaryReach: number;
    /** FTE currently allocated under this craft */
    committed: number;
    /** FTE of anticipated demand captured on projects */
    demand: number;
    /** demand − committed (positive = unstaffed) */
    gap: number;
    /** primarySupply − committed-by-primary-holders (positive = bench in this craft) */
    primaryBench: number;
}

export function craftBalance(
    craft: Craft,
    quarter: Quarter,
    resources: Resource[],
    projects: Project[],
    allocations: Allocation[],
): CraftQuarterBalance {
    const projectMap = new Map(projects.map(p => [p.id, p]));
    const resourceMap = new Map(resources.map(r => [r.id, r]));

    let primarySupply = 0;
    let primaryCommitted = 0;
    let committed = 0;
    let secondaryReach = 0;

    for (const r of resources) {
        const load = personQuarterLoad(r, quarter, allocations, projects);
        const freeFte = Math.max(0, load.bench) / 100;
        if (r.primaryCraft === craft.id) {
            primarySupply += (r.totalCapacity ?? 100) / 100;
            primaryCommitted += load.byProject.filter(b => b.craftId === craft.id).reduce((s, b) => s + b.pct, 0) / 100;
        }
        const sec = (r.secondaryCrafts || []).find(s => s.craftId === craft.id);
        if (sec) {
            const cap = (sec.maxPct ?? DEFAULT_SECONDARY_MAX_PCT) / 100;
            const alreadyOnCraft = load.byProject.filter(b => b.craftId === craft.id).reduce((s, b) => s + b.pct, 0) / 100;
            secondaryReach += Math.max(0, Math.min(freeFte, cap - alreadyOnCraft));
        }
    }

    for (const a of allocations) {
        const r = resourceMap.get(a.resourceId);
        if (allocationCraft(a, r) !== craft.id) continue;
        committed += allocationPctInQuarter(a, quarter, projectMap.get(a.projectId)) / 100;
    }

    const demand = projects.reduce((s, p) => s + (p.craftDemand || [])
        .filter(d => d.quarterKey === quarter.key && d.craftId === craft.id)
        .reduce((x, d) => x + (Number(d.fte) || 0), 0), 0);

    return {
        craftId: craft.id,
        quarterKey: quarter.key,
        primarySupply: round2(primarySupply),
        secondaryReach: round2(secondaryReach),
        committed: round2(committed),
        demand: round2(demand),
        gap: round2(demand - committed),
        primaryBench: round2(primarySupply - primaryCommitted),
    };
}

export function craftMatrix(crafts: Craft[], quarters: Quarter[], resources: Resource[], projects: Project[], allocations: Allocation[]) {
    const out: Record<string, Record<string, CraftQuarterBalance>> = {};
    for (const c of crafts) {
        out[c.id] = {};
        for (const q of quarters) out[c.id][q.key] = craftBalance(c, q, resources, projects, allocations);
    }
    return out;
}

/* ── demand lines ─────────────────────────────────────────────── */

export interface DemandLine {
    projectId: string;
    projectName: string;
    tribe?: string;
    quarterKey: string;
    craftId: string;
    demandFte: number;
    staffedFte: number;   // allocations on this project under this craft in this quarter
    gapFte: number;
    note?: string;
}

export function demandLines(projects: Project[], resources: Resource[], allocations: Allocation[], quarters: Quarter[]): DemandLine[] {
    const resourceMap = new Map(resources.map(r => [r.id, r]));
    const quarterMap = new Map(quarters.map(q => [q.key, q]));
    const lines: DemandLine[] = [];
    for (const p of projects) {
        for (const d of p.craftDemand || []) {
            const q = quarterMap.get(d.quarterKey);
            if (!q) continue;
            const staffed = allocations
                .filter(a => a.projectId === p.id && allocationCraft(a, resourceMap.get(a.resourceId)) === d.craftId)
                .reduce((s, a) => s + allocationPctInQuarter(a, q, p), 0) / 100;
            lines.push({
                projectId: p.id,
                projectName: p.name,
                tribe: p.clientName,
                quarterKey: d.quarterKey,
                craftId: d.craftId,
                demandFte: round2(Number(d.fte) || 0),
                staffedFte: round2(staffed),
                gapFte: round2((Number(d.fte) || 0) - staffed),
                note: d.note,
            });
        }
    }
    return lines;
}

/* ── marketplace matching ─────────────────────────────────────── */

export interface MatchSuggestion {
    resourceId: string;
    resourceName: string;
    craftId: string;
    quarterKey: string;
    projectId: string;
    /** 'primary' = above the table, 'secondary' = below the table */
    via: 'primary' | 'secondary';
    proficiency: 1 | 2 | 3;
    /** % of the person's capacity we propose to book */
    proposedPct: number;
    /** person's free % in that quarter before this proposal */
    freePct: number;
    score: number;
    reasons: string[];
}

/**
 * Rank who could absorb an unstaffed demand line. Scoring favours people who hold
 * the craft above the table, then higher secondary proficiency, then more free
 * capacity, then tribe familiarity. Each candidate is capped at their free capacity
 * and (for secondary crafts) at their declared maxPct.
 */
export function suggestMatches(
    line: DemandLine,
    quarter: Quarter,
    resources: Resource[],
    projects: Project[],
    allocations: Allocation[],
    limit = 5,
): MatchSuggestion[] {
    if (line.gapFte <= 0) return [];
    const needPct = Math.round(line.gapFte * 100);
    const out: MatchSuggestion[] = [];

    for (const r of resources) {
        const load = personQuarterLoad(r, quarter, allocations, projects);
        const target = r.targetUtil ?? DEFAULT_TARGET_UTIL;
        const freePct = Math.max(0, Math.min(load.capacity, target) - load.total);
        if (freePct < 5) continue;
        if (load.byProject.some(b => b.projectId === line.projectId && b.craftId === line.craftId)) continue; // already on it

        let via: 'primary' | 'secondary' | null = null;
        let proficiency: 1 | 2 | 3 = 3;
        let cap = freePct;
        if (r.primaryCraft === line.craftId) {
            via = 'primary';
        } else {
            const sec: SecondaryCraft | undefined = (r.secondaryCrafts || []).find(s => s.craftId === line.craftId);
            if (!sec) continue;
            via = 'secondary';
            proficiency = sec.proficiency;
            const alreadyOnCraft = load.byProject.filter(b => b.craftId === line.craftId).reduce((s, b) => s + b.pct, 0);
            cap = Math.min(freePct, Math.max(0, (sec.maxPct ?? DEFAULT_SECONDARY_MAX_PCT) - alreadyOnCraft));
        }
        if (cap < 5) continue;

        const proposedPct = Math.max(5, Math.min(cap, needPct));
        const reasons: string[] = [];
        let score = 0;
        if (via === 'primary') { score += 60; reasons.push('Above-the-table craft'); }
        else { score += 20 + proficiency * 8; reasons.push(`Below-the-table craft (level ${proficiency})`); }
        score += Math.min(25, freePct / 4);
        reasons.push(`${Math.round(freePct)}% free in ${quarter.label}`);
        if (line.tribe && (r.tribeAffinity || []).some(t => t.toLowerCase() === line.tribe!.toLowerCase())) {
            score += 10; reasons.push(`Knows ${line.tribe}`);
        }
        if (proposedPct >= needPct) { score += 5; reasons.push('Covers the full gap'); }
        if (load.total < 60) { score += 5; reasons.push('Currently under-used'); }

        out.push({
            resourceId: r.id, resourceName: r.name, craftId: line.craftId, quarterKey: quarter.key,
            projectId: line.projectId, via, proficiency, proposedPct: Math.round(proposedPct),
            freePct: Math.round(freePct), score: Math.round(score), reasons,
        });
    }

    return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/* ── portfolio summary ────────────────────────────────────────── */

export interface QuarterSummary {
    quarterKey: string;
    headcount: number;
    capacityFte: number;
    committedFte: number;
    aboveTableFte: number;
    belowTableFte: number;
    benchFte: number;
    avgUtil: number;        // committed / capacity
    demandFte: number;
    unstaffedFte: number;   // sum of positive demand gaps
    overAllocated: number;  // people > capacity
    underTarget: number;    // people below their target
}

export function quarterSummary(quarter: Quarter, resources: Resource[], projects: Project[], allocations: Allocation[]): QuarterSummary {
    let capacity = 0, committed = 0, above = 0, below = 0, bench = 0, over = 0, under = 0;
    for (const r of resources) {
        const l = personQuarterLoad(r, quarter, allocations, projects);
        capacity += l.capacity; committed += l.total; above += l.aboveTable; below += l.belowTable; bench += l.bench;
        if (l.total > l.capacity) over++;
        if (l.total < (r.targetUtil ?? DEFAULT_TARGET_UTIL)) under++;
    }
    const lines = demandLines(projects, resources, allocations, [quarter]);
    const demand = lines.reduce((s, l) => s + l.demandFte, 0);
    const unstaffed = lines.reduce((s, l) => s + Math.max(0, l.gapFte), 0);
    return {
        quarterKey: quarter.key,
        headcount: resources.length,
        capacityFte: round2(capacity / 100),
        committedFte: round2(committed / 100),
        aboveTableFte: round2(above / 100),
        belowTableFte: round2(below / 100),
        benchFte: round2(bench / 100),
        avgUtil: capacity ? Math.round((committed / capacity) * 100) : 0,
        demandFte: round2(demand),
        unstaffedFte: round2(unstaffed),
        overAllocated: over,
        underTarget: under,
    };
}

/* ── helpers ──────────────────────────────────────────────────── */

export function upsertDemand(list: CraftDemand[] | undefined, next: CraftDemand): CraftDemand[] {
    const base = [...(list || [])].filter(d => !(d.quarterKey === next.quarterKey && d.craftId === next.craftId));
    if (next.fte > 0) base.push(next);
    return base.sort((a, b) => a.quarterKey.localeCompare(b.quarterKey) || a.craftId.localeCompare(b.craftId));
}

function round1(n: number) { return Math.round(n * 10) / 10; }
function round2(n: number) { return Math.round(n * 100) / 100; }
