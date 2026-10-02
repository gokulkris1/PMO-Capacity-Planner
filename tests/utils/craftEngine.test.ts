import { getRollingQuarters, quarterFromKey, quarterKeyFor, overlapFraction, parseDay } from '../../utils/quarters';
import {
    allocationPctInQuarter, personQuarterLoad, craftBalance, demandLines, suggestMatches, quarterSummary, upsertDemand,
} from '../../utils/craftEngine';
import { Allocation, Craft, Project, ProjectStatus, Resource, ResourceType } from '../../types';

const crafts: Craft[] = [
    { id: 'pm', name: 'Project Management', short: 'PM', color: '#000' },
    { id: 'sm', name: 'Scrum Master', short: 'SM', color: '#000' },
    { id: 'ba', name: 'Business Analysis', short: 'BA', color: '#000' },
];

const q4 = quarterFromKey('2026-Q4', 0)!;
const q1 = quarterFromKey('2027-Q1', 1)!;

const projects: Project[] = [
    {
        id: 'p1', name: 'Alpha', status: ProjectStatus.ACTIVE, priority: 'High', description: '', clientName: 'Payments',
        startDate: '2026-10-01', endDate: '2027-03-31',
        craftDemand: [
            { quarterKey: '2026-Q4', craftId: 'pm', fte: 1 },
            { quarterKey: '2026-Q4', craftId: 'ba', fte: 0.5 },
            { quarterKey: '2027-Q1', craftId: 'sm', fte: 0.5 },
        ],
    },
];

const resources: Resource[] = [
    { id: 'r1', name: 'Ann PM', role: 'PM', type: ResourceType.PERMANENT, department: 'PMO', totalCapacity: 100, primaryCraft: 'pm', secondaryCrafts: [{ craftId: 'ba', proficiency: 3, maxPct: 40 }] },
    { id: 'r2', name: 'Bob SM', role: 'SM', type: ResourceType.PERMANENT, department: 'PMO', totalCapacity: 100, primaryCraft: 'sm', secondaryCrafts: [{ craftId: 'pm', proficiency: 2, maxPct: 50 }], tribeAffinity: ['Payments'] },
    { id: 'r3', name: 'Cat BA', role: 'BA', type: ResourceType.PART_TIME, department: 'PMO', totalCapacity: 50, primaryCraft: 'ba' },
];

const allocations: Allocation[] = [
    { id: 'a1', resourceId: 'r1', projectId: 'p1', percentage: 50, craftId: 'pm' },                                   // whole project window
    { id: 'a2', resourceId: 'r1', projectId: 'p1', percentage: 20, craftId: 'ba', startDate: '2026-10-01', endDate: '2026-12-31' },
    { id: 'a3', resourceId: 'r2', projectId: 'p1', percentage: 40, craftId: 'sm', startDate: '2027-01-01', endDate: '2027-03-31' },
];

describe('quarters', () => {
    it('builds a rolling four-quarter window labelled QBR1..QBR4', () => {
        const qs = getRollingQuarters(new Date(2026, 9, 2), 4);
        expect(qs.map(q => q.key)).toEqual(['2026-Q4', '2027-Q1', '2027-Q2', '2027-Q3']);
        expect(qs.map(q => q.label)).toEqual(['QBR1', 'QBR2', 'QBR3', 'QBR4']);
        expect(qs[0].name).toBe('Q4 2026');
        expect(qs[0].range).toBe('Oct–Dec 2026');
        expect(qs[0].days).toBe(92);
    });

    it('derives quarter keys from dates', () => {
        expect(quarterKeyFor(new Date(2026, 0, 15))).toBe('2026-Q1');
        expect(quarterKeyFor(new Date(2026, 11, 31))).toBe('2026-Q4');
        expect(quarterFromKey('bad')).toBeNull();
    });

    it('computes overlap fractions and parses days safely', () => {
        expect(overlapFraction(null, null, q4)).toBe(1);
        expect(overlapFraction(parseDay('2026-11-01', 'start'), null, q4)).toBeCloseTo(61 / 92, 5);
        expect(overlapFraction(parseDay('2027-01-01', 'start'), null, q4)).toBe(0);
        expect(parseDay('2026-13-01', 'start')).toBeNull();
        expect(parseDay(undefined, 'end')).toBeNull();
    });
});

describe('craftEngine', () => {
    it('averages an allocation over the quarter it overlaps', () => {
        expect(allocationPctInQuarter(allocations[0], q4, projects[0])).toBe(50);     // project covers all of Q4
        expect(allocationPctInQuarter(allocations[2], q4, projects[0])).toBe(0);      // starts in Q1
        expect(allocationPctInQuarter(allocations[2], q1, projects[0])).toBe(40);
    });

    it('splits a person into above-the-table, below-the-table and bench', () => {
        const load = personQuarterLoad(resources[0], q4, allocations, projects);
        expect(load.aboveTable).toBe(50);
        expect(load.belowTable).toBe(20);
        expect(load.total).toBe(70);
        expect(load.bench).toBe(30);
        const next = personQuarterLoad(resources[0], q1, allocations, projects);
        expect(next.belowTable).toBe(0);
        expect(next.bench).toBe(50);
    });

    it('balances supply, committed and demand per craft per quarter', () => {
        const pm = craftBalance(crafts[0], q4, resources, projects, allocations);
        expect(pm.primarySupply).toBe(1);        // Ann
        expect(pm.committed).toBe(0.5);          // Ann 50%
        expect(pm.demand).toBe(1);
        expect(pm.gap).toBe(0.5);
        expect(pm.primaryBench).toBe(0.5);
        // Bob can reach PM below the table: free 100% in Q4, capped at maxPct 50
        expect(pm.secondaryReach).toBe(0.5);

        const ba = craftBalance(crafts[2], q4, resources, projects, allocations);
        expect(ba.primarySupply).toBe(0.5);      // Cat is part-time
        expect(ba.committed).toBe(0.2);          // Ann below the table
        // Ann's BA reach: free 30%, maxPct 40 minus 20 already on BA => 0.2
        expect(ba.secondaryReach).toBe(0.2);
    });

    it('lists demand lines with staffed and gap FTE', () => {
        const lines = demandLines(projects, resources, allocations, [q4, q1]);
        const pmQ4 = lines.find(l => l.craftId === 'pm' && l.quarterKey === '2026-Q4')!;
        expect(pmQ4.staffedFte).toBe(0.5);
        expect(pmQ4.gapFte).toBe(0.5);
        const smQ1 = lines.find(l => l.craftId === 'sm' && l.quarterKey === '2027-Q1')!;
        expect(smQ1.staffedFte).toBe(0.4);
        expect(smQ1.gapFte).toBeCloseTo(0.1, 5);
    });

    it('suggests ranked matches honouring free capacity and secondary caps', () => {
        const lines = demandLines(projects, resources, allocations, [q4]);
        const pmQ4 = lines.find(l => l.craftId === 'pm')!;
        const matches = suggestMatches(pmQ4, q4, resources, projects, allocations);
        // Ann is already on p1 as PM so she is excluded; Bob matches below the table with tribe affinity
        expect(matches.map(m => m.resourceId)).toEqual(['r2']);
        expect(matches[0].via).toBe('secondary');
        expect(matches[0].proposedPct).toBe(50);
        expect(matches[0].reasons).toEqual(expect.arrayContaining(['Knows Payments', 'Covers the full gap']));

        const baQ4 = lines.find(l => l.craftId === 'ba')!;
        const baMatches = suggestMatches(baQ4, q4, resources, projects, allocations);
        // Ann is already on p1 as BA so only Cat (primary BA, 50% free) is offered
        expect(baMatches.map(m => m.resourceId)).toEqual(['r3']);
        expect(baMatches[0].via).toBe('primary');
        expect(baMatches[0].proposedPct).toBe(30); // gap is 0.5 - 0.2 already staffed
    });

    it('summarises a quarter for the portfolio', () => {
        const s = quarterSummary(q4, resources, projects, allocations);
        expect(s.headcount).toBe(3);
        expect(s.capacityFte).toBe(2.5);
        expect(s.committedFte).toBe(0.7);
        expect(s.aboveTableFte).toBe(0.5);
        expect(s.belowTableFte).toBe(0.2);
        expect(s.benchFte).toBe(1.8);
        expect(s.avgUtil).toBe(28);
        expect(s.demandFte).toBe(1.5);
        expect(s.unstaffedFte).toBe(0.8);
        expect(s.underTarget).toBe(3);
    });

    it('upserts demand entries and drops zero lines', () => {
        const base = upsertDemand(undefined, { quarterKey: '2026-Q4', craftId: 'pm', fte: 1 });
        expect(base).toHaveLength(1);
        const updated = upsertDemand(base, { quarterKey: '2026-Q4', craftId: 'pm', fte: 0.5 });
        expect(updated[0].fte).toBe(0.5);
        expect(upsertDemand(updated, { quarterKey: '2026-Q4', craftId: 'pm', fte: 0 })).toHaveLength(0);
    });
});
