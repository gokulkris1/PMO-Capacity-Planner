import type * as D from '../../shared/contracts/dto';
import { DEFAULT_THRESHOLDS } from '../../shared/utilisation';
import { setClock } from '../../utils/clock';
import {
  buildAllocationGrid,
  buildCapacityOutlook,
  buildCatalogue,
  buildCraftAdminRows,
  buildCraftBalance,
  buildCraftRequestQueue,
  buildDemandGrid,
  buildHome,
  buildMyPlan,
  buildOpenDemand,
  buildPeopleRows,
  buildProjectRows,
  buildStructureRows,
  buildTimeToStaff,
  buildTribeView,
  buildUnderTarget,
  chaptersFromCrafts,
  projectsWithoutDemand,
  proposalWindow,
  validateCraft,
  validateDemandLine,
  validatePerson,
  validateStructureName,
} from '../../utils/viewModels';
import { alloc, craft, demandLine, demoSnapshot, person, project, QUARTERS, snapshot, TODAY } from './fixtures';

const t = DEFAULT_THRESHOLDS;
const [Q4, Q1] = QUARTERS;
let s: D.WorkspaceSnapshot;
beforeAll(async () => {
  setClock(TODAY);
  s = await demoSnapshot();
});
afterAll(() => setClock());
const byName = (name: string) => s.people.find((p) => p.name === name)!;

describe('buildPeopleRows (PPL-01)', () => {
  it('resolves chapter, team and crafts from the snapshot catalogue', () => {
    const tom = buildPeopleRows(s, QUARTERS, t).find((r) => r.person.name === 'Tom Hayes')!;
    expect(tom.chapter?.name).toBe('Programme Management');
    expect(tom.team?.name).toBe('Programme Management');
    expect(tom.primary?.short).toBe('PGM');
    expect(tom.secondary.map((x) => [x.craft.short, x.proficiency, x.maxPct])).toEqual([
      ['RG', 3, 30],
      ['DP', 2, 20],
    ]);
  });

  it('acceptance check 23: QBR1 over capacity is Maria Kelly and Noma Odigie; 100% is On target', () => {
    const rows = buildPeopleRows(s, QUARTERS, t);
    expect(
      rows
        .filter((r) => r.quarters[0].band === 'over')
        .map((r) => r.person.name)
        .sort(),
    ).toEqual(['Maria Kelly', 'Noma Odigie']);
    const claire = rows.find((r) => r.person.name === 'Claire Ryan')!;
    expect(claire.quarters[0]).toMatchObject({ loadPct: 100, band: 'on-target', free: 0 });
    const noma = rows.find((r) => r.person.name === 'Noma Odigie')!.quarters[0];
    expect(noma).toMatchObject({ loadPct: 115, above: 115, below: 0, undeclared: 0, band: 'over' });
  });

  it('splits above / below / undeclared and shows 0% as Available (PPL-01#AC6)', () => {
    const rows = buildPeopleRows(s, QUARTERS, t);
    const gokul = rows.find((r) => r.person.name === 'Gokul Gurijala')!.quarters[0];
    expect(gokul).toMatchObject({ above: 32.6, below: 25, undeclared: 0, loadPct: 57.6 });
    const kerrieQ4 = rows.find((r) => r.person.name === 'Kerrie Dalton')!.quarters[3];
    expect(kerrieQ4.loadPct).toBe(60);
    const tomQ4 = rows.find((r) => r.person.name === 'Tom Hayes')!.quarters[3];
    expect(tomQ4).toMatchObject({ loadPct: 0, relativePct: 0, band: 'bench', free: 100 });
  });

  it("bands load relative to the person's target (A-4)", () => {
    const one = snapshot({
      people: [person('pt', { targetUtil: 60 })],
      projects: [project('p')],
      allocations: [alloc('a', { resourceId: 'pt', projectId: 'p', percentage: 60 })],
    });
    expect(buildPeopleRows(one, QUARTERS, t)[0].quarters[0]).toMatchObject({
      loadPct: 60,
      relativePct: 100,
      band: 'on-target',
      free: 0,
    });
  });

  it('counts tentative bookings and ignores declined ones', () => {
    const one = snapshot({
      people: [person('x')],
      projects: [project('p')],
      allocations: [
        alloc('t', { resourceId: 'x', projectId: 'p', percentage: 30, state: 'tentative' }),
        alloc('d', { resourceId: 'x', projectId: 'p', percentage: 70, state: 'declined' }),
      ],
    });
    expect(buildPeopleRows(one, QUARTERS, t)[0].quarters[0].loadPct).toBe(30);
  });
});

describe('buildAllocationGrid (AL-01, AL-04, AL-05)', () => {
  const opts = { groupBy: 'team' as const, pivot: 'person' as const, includeTentative: true, thresholds: t };

  it('groups people with booking sub-rows and Σload ÷ Σtarget totals', () => {
    const g = buildAllocationGrid(s, QUARTERS, opts);
    expect(g.quarters).toBe(QUARTERS);
    const delivery = g.groups.find((x) => x.label === 'Delivery')!;
    expect(delivery.rows.map((r) => [r.kind, r.label])).toEqual([
      ['person', 'Noma Odigie'],
      ['booking', 'Apollo Revamp'],
      ['booking', 'Phoenix Mobile'],
      ['booking', 'Skyline API'],
    ]);
    expect(delivery.totals[0]).toMatchObject({ pct: 115, band: 'over' });
    const pm = g.groups.find((x) => x.label === 'Project Management')!;
    expect(pm.totals[0].pct).toBe(58.8); // (57.6 + 60) / 2
    expect(g.groups.map((x) => x.label)).toEqual([...g.groups.map((x) => x.label)].sort((a, b) => a.localeCompare(b)));
  });

  it('marks partial quarters, provenance and the Planview lock', () => {
    const g = buildAllocationGrid(s, QUARTERS, opts);
    const rows = g.groups.flatMap((x) => x.rows);
    const tomOrion = rows.find((r) => r.kind === 'booking' && r.personId === 'r1' && r.projectId === 'p6')!;
    expect(tomOrion.cells[0]).toMatchObject({
      pct: 13,
      partial: true,
      state: 'confirmed',
      source: 'manual',
      locked: false,
    });
    const kerrieLegacy = rows.find((r) => r.kind === 'booking' && r.personId === 'r4' && r.projectId === 'p4')!;
    expect(kerrieLegacy.cells[0]).toMatchObject({ source: 'planview', locked: true, allocationIds: ['a9'] });
    const open = {
      ...s,
      org: { ...s.org, planning: { ...s.org.planning, planviewOwnership: 'overridable' as const } },
    };
    const unlocked = buildAllocationGrid(open, QUARTERS, opts)
      .groups.flatMap((x) => x.rows)
      .find((r) => r.key === kerrieLegacy.key)!;
    expect(unlocked.cells[0].locked).toBe(false);
  });

  it('"Show tentative" off excludes tentative bookings from cells and totals (AL-01#AC4)', () => {
    const on = buildAllocationGrid(s, QUARTERS, opts)
      .groups.flatMap((x) => x.rows)
      .find((r) => r.kind === 'person' && r.personId === 'r9')!;
    const off = buildAllocationGrid(s, QUARTERS, { ...opts, includeTentative: false })
      .groups.flatMap((x) => x.rows)
      .find((r) => r.kind === 'person' && r.personId === 'r9')!;
    expect(on.cells[1].pct - off.cells[1].pct).toBeCloseTo(17.7, 5); // 20% on Nebula from 11 Jan
    const tentativeRow = buildAllocationGrid(s, QUARTERS, opts)
      .groups.flatMap((x) => x.rows)
      .find((r) => r.kind === 'booking' && r.personId === 'r9' && r.projectId === 'p3')!;
    expect(tentativeRow.cells[1]).toMatchObject({ state: 'tentative', source: 'marketplace', partial: true });
  });

  it('project pivot: projects grouped by tribe with people sub-rows (AL-04)', () => {
    const g = buildAllocationGrid(s, QUARTERS, {
      groupBy: 'tribe',
      pivot: 'project',
      includeTentative: true,
      thresholds: t,
    });
    const digital = g.groups.find((x) => x.label === 'Digital')!;
    const apollo = digital.rows.find((r) => r.kind === 'project' && r.label === 'Apollo Revamp')!;
    expect(apollo.cells[0].pct).toBe(205); // 2.05 FTE booked in Q4
    expect(apollo.cells[0].band).toBeNull();
    expect(digital.rows.filter((r) => r.kind === 'booking' && r.projectId === 'p1').length).toBeGreaterThan(3);
    expect(digital.totals[0].pct).toBe(
      digital.rows.filter((r) => r.depth === 0).reduce((x, r) => x + r.cells[0].pct, 0),
    );
  });

  it('groups by chapter, tribe and none with the "No …" group last', () => {
    const extra = {
      ...s,
      people: [...s.people, person('loner', { name: 'Zed Loner', chapterId: null, homeTribeId: null })],
    };
    const byChapter = buildAllocationGrid(extra, QUARTERS, { ...opts, groupBy: 'chapter' });
    expect(byChapter.groups[byChapter.groups.length - 1].label).toBe('No chapter');
    expect(buildAllocationGrid(extra, QUARTERS, { ...opts, groupBy: 'none' }).groups.map((x) => x.label)).toEqual([
      'Everyone',
    ]);
    const byTribe = buildAllocationGrid(extra, QUARTERS, { ...opts, groupBy: 'tribe' });
    expect(byTribe.groups[byTribe.groups.length - 1].label).toBe('No tribe');
  });
});

describe('buildCapacityOutlook (RP-02)', () => {
  it('squad point stacks above + below + undeclared + free and uses Σload ÷ Σtarget', () => {
    const o = buildCapacityOutlook(s, QUARTERS, { pivot: 'craft', thresholds: t });
    const q1 = o.squad[0];
    expect(q1.supplyFte).toBe(10);
    expect(q1.utilisationPct).toBe(70.3);
    expect(q1.band).toBe('under');
    expect(q1.demandFte).toBe(5.9);
    expect(Math.round((q1.aboveFte + q1.belowFte + q1.undeclaredFte) * 100)).toBe(704);
  });

  it('craft pivot: holders of the craft and its demand; archived crafts hidden', () => {
    const archived = { ...s, crafts: s.crafts.map((c) => (c.id === 'tooling-admin' ? { ...c, archived: true } : c)) };
    const o = buildCapacityOutlook(archived, QUARTERS, { pivot: 'craft', thresholds: t });
    expect(o.rows.map((r) => r.id)).not.toContain('tooling-admin');
    const pm = o.rows.find((r) => r.id === 'project-mgmt')!;
    expect(pm.points[0].supplyFte).toBe(2);
    expect(pm.points[0].demandFte).toBe(1.8); // Apollo 1 + Legacy 0.3 + Orion 0.5
  });

  it('filters the squad by craft, chapter and tribe', () => {
    const sm = buildCapacityOutlook(s, QUARTERS, { pivot: 'person', craftId: 'scrum-master', thresholds: t });
    expect(sm.rows.map((r) => r.label)).toEqual(['Noma Odigie']);
    expect(sm.squad[0].demandFte).toBe(1.5);
    const chapter = buildCapacityOutlook(s, QUARTERS, {
      pivot: 'chapter',
      chapterId: 'chapter-programme-mgmt',
      thresholds: t,
    });
    expect(chapter.rows).toHaveLength(1);
    expect(chapter.rows[0].points[0].supplyFte).toBe(4);
  });

  it("tribe pivot: committed FTE on the tribe's projects vs its demand (coverage)", () => {
    const o = buildCapacityOutlook(s, QUARTERS, { pivot: 'tribe', thresholds: t });
    const digital = o.rows.find((r) => r.label === 'Digital')!.points[0];
    expect(digital).toMatchObject({ supplyFte: 3.6, demandFte: 3.3, freeFte: 0 });
    expect(digital.utilisationPct).toBe(109.1);
  });
});

describe('buildDemandGrid (DM-02)', () => {
  it('splits staffed (confirmed) from proposed (tentative); gap is what is still open', () => {
    const nebula = buildDemandGrid(s, QUARTERS).find((r) => r.project.id === 'p3')!;
    expect(nebula.tribe?.name).toBe('Lending');
    const q1 = nebula.cells[1];
    expect(q1.lines.map((l) => l.craftId).sort()).toEqual(['business-analysis', 'pmo-analytics', 'programme-mgmt']);
    expect(q1.demandFte).toBe(2);
    expect(q1.proposedFte).toBe(0.18);
    expect(q1.staffedFte).toBe(1.24);
    expect(q1.gapFte).toBe(0.58);
  });

  it('flags Initiated and Mobilising projects without demand for QBR1–2 (DM-02#AC3)', () => {
    expect(projectsWithoutDemand(s, QUARTERS)).toEqual([]);
    const noDemand = { ...s, demand: s.demand.filter((l) => l.projectId !== 'p6') };
    expect(projectsWithoutDemand(noDemand, QUARTERS).map((p) => p.name)).toEqual(['Orion Security']);
    expect(buildProjectRows(noDemand, QUARTERS).find((r) => r.project.id === 'p6')?.noDemandWarning).toBe(true);
  });

  it('Projects table carries per-quarter numbers and the Planview date lock (PPL-07)', () => {
    const rows = buildProjectRows(s, QUARTERS);
    expect(rows.find((r) => r.project.id === 'p4')?.datesLocked).toBe(true);
    expect(rows.find((r) => r.project.id === 'p1')?.datesLocked).toBe(false);
    // Staffed counts bookings under the crafts the project demands (QA-004); the gap is the Marketplace's open FTE.
    expect(rows.find((r) => r.project.id === 'p1')?.quarters[0]).toMatchObject({ demandFte: 1.8, staffedFte: 1.3 });
    const open = buildOpenDemand(s, QUARTERS, { quarterKey: Q4.key }).filter((l) => l.project.id === 'p1');
    expect(rows.find((r) => r.project.id === 'p1')?.quarters[0].gapFte).toBeCloseTo(
      open.reduce((x, l) => x + l.openFte, 0),
      2,
    );
    expect(buildDemandGrid(s, QUARTERS).find((r) => r.project.id === 'p1')?.cells[0].bookedFte).toBe(2.05);
  });

  it('By craft: supply, committed, demand, gap, bench and reach (DM-02#AC1)', () => {
    const pm = buildCraftBalance(s, QUARTERS).find((r) => r.craft.id === 'project-mgmt')!.quarters[0];
    expect(pm).toMatchObject({ supplyFte: 2, demandFte: 1.8 });
    // Unstaffed per project × craft (QA-004): the Marketplace's open FTE for the craft, not demand − committed.
    const open = buildOpenDemand(s, QUARTERS, { quarterKey: Q4.key, craftId: 'project-mgmt' });
    expect(pm.gapFte).toBeCloseTo(
      open.reduce((x, l) => x + l.openFte, 0),
      2,
    );
    expect(pm.reachFte).toBe(0); // Claire holds PM below the table but is fully booked in Q4
    const q3 = buildCraftBalance(s, QUARTERS).find((r) => r.craft.id === 'project-mgmt')!.quarters[2];
    expect(q3.reachFte).toBe(0.5); // …and free in QBR3, capped at her 50%
  });
});

describe('Marketplace view-models (DM-03 … DM-05)', () => {
  it('catalogue: above-the-table free capacity, below-the-table reach, offers (DM-04)', () => {
    const cat = buildCatalogue(s, QUARTERS, Q4.key);
    const pgm = cat.find((c) => c.craft.id === 'programme-mgmt')!;
    expect(pgm.people[0]).toMatchObject({ via: 'above', person: { name: 'Kerrie Dalton' }, freePct: 70 });
    expect(pgm.people[0].offer?.note).toBe('Free until Nebula starts in January');
    expect(pgm.freeAboveFte).toBe(1.19);
    const ba = cat.find((c) => c.craft.id === 'business-analysis')!;
    expect(ba.people.every((p) => p.via === 'below')).toBe(true);
    expect(ba.people.find((p) => p.person.name === 'Emer Ward')).toMatchObject({ proficiency: 3, freePct: 40 });
    expect(buildCatalogue(s, QUARTERS, '2031-Q1')).toEqual([]);
  });

  it('open demand: staffed and proposed counted, matches exclude people already on the line', () => {
    const open = buildOpenDemand(s, QUARTERS, { quarterKey: Q1.key });
    const nebulaAn = buildOpenDemand(s, QUARTERS, { quarterKey: Q1.key, includeCovered: true }).find(
      (l) => l.project.id === 'p3' && l.craftId === 'pmo-analytics',
    )!;
    expect(nebulaAn).toMatchObject({ demandFte: 0.4, proposedFte: 0.18, staffedFte: 0 });
    expect(nebulaAn.openFte).toBe(0.22);
    expect(nebulaAn.matches.map((m) => m.resourceId)).not.toContain('r9'); // already proposed
    expect(open.every((l) => l.openFte > 0)).toBe(true);
    const apolloPm = buildOpenDemand(s, QUARTERS, { quarterKey: Q4.key }).find(
      (l) => l.project.id === 'p1' && l.craftId === 'project-mgmt',
    )!;
    expect(apolloPm.matches[0]).toMatchObject({ resourceName: 'Gokul Gurijala', via: 'primary' });
    expect(apolloPm.matches[0].reasons).toEqual(expect.arrayContaining(['Above the table', 'Knows Digital']));
  });

  it('under-target list and proposal window', () => {
    const under = buildUnderTarget(s, QUARTERS, Q4.key, t);
    expect(under[0].person.name).toBe('Mary Vithalani');
    expect(under.every((r) => r.band === 'under' || r.band === 'bench')).toBe(true);
    expect(under.find((r) => r.person.name === 'Kerrie Dalton')?.offer?.pct).toBe(50);
    expect(
      proposalWindow(
        s.projects.find((p) => p.id === 'p3'),
        Q1,
      ),
    ).toEqual({ startDate: '2027-01-11', endDate: '2027-03-31' });
    expect(proposalWindow(undefined, Q1)).toEqual({ startDate: Q1.start, endDate: Q1.end });
  });

  it('time to staff: confirmed marketplace bookings and the 90-day median (RP-04)', () => {
    const lines = [
      demandLine('dl', {
        projectId: 'p',
        quarterKey: Q1.key,
        craftId: 'pm',
        fte: 1,
        createdAt: '2026-10-01T00:00:00.000Z',
      }),
    ];
    const mk = (id: string, responded: string, extra: Partial<D.AllocationDTO> = {}) =>
      alloc(id, {
        resourceId: 'x',
        projectId: 'p',
        percentage: 50,
        source: 'marketplace',
        state: 'confirmed',
        demandLineId: 'dl',
        respondedAt: responded,
        ...extra,
      });
    const one = snapshot({
      people: [person('x')],
      projects: [project('p')],
      demand: lines,
      allocations: [
        mk('a', '2026-10-05T00:00:00.000Z'),
        mk('b', '2026-10-11T00:00:00.000Z', { demandLineId: null, proposedAt: '2026-10-09T00:00:00.000Z' }),
        mk('c', '2026-10-15T00:00:00.000Z'),
        mk('old', '2026-01-01T00:00:00.000Z'),
        mk('tent', '2026-10-15T00:00:00.000Z', { state: 'tentative' }),
      ],
    });
    const r = buildTimeToStaff(one, TODAY);
    expect(r.rows.map((x) => [x.allocation.id, x.days])).toEqual([
      ['c', 14],
      ['b', 2],
      ['a', 4],
      ['old', 0],
    ]);
    expect(r.medianDays90).toBe(4);
  });
});

describe('Home, tribes, My Plan and requests', () => {
  it('Home KPIs for QBR1 (RP-01)', () => {
    const me: D.MeWorkspace = {
      id: 'demo',
      name: 'x',
      role: 'CONTRIBUTOR',
      implicit: false,
      permissions: [],
      linkedPersonId: 'r9',
    };
    const h = buildHome(s, QUARTERS, { kind: 'quarter', key: Q4.key }, t, me);
    expect(h.kpis).toMatchObject({
      utilisationPct: 70.3,
      band: 'under',
      nextQuarterPct: 68.8,
      overCount: 2,
      availableCount: 2,
    });
    const open = buildOpenDemand(s, QUARTERS, { quarterKey: Q4.key }).reduce((x, l) => x + l.openFte, 0);
    expect(h.kpis.unstaffedFte).toBeCloseTo(open, 2); // QA-004: the Marketplace number
    expect(h.kpis.unstaffedFte).toBeGreaterThan(0);
    expect(h.over.map((r) => r.person.name)).toEqual(['Noma Odigie', 'Maria Kelly']);
    expect(h.pendingApprovals).toBe(1);
    expect(h.myPendingProposals).toBe(1);
    expect(h.outlook).toHaveLength(4);
    expect(buildHome(s, QUARTERS, { kind: 'quarter', key: Q1.key }, t, null).kpis.nextQuarterPct).toBe(
      h.outlook[2].utilisationPct,
    );
  });

  it('tribe view: projects, demand, staffed, gap and people serving it (ORG-05)', () => {
    const v = buildTribeView(s, QUARTERS, 'tribe-payments');
    expect(v.projects.map((p) => p.name)).toEqual(['Orion Security', 'Skyline API']);
    expect(v.demandFte[0]).toBe(2.3);
    const open = buildOpenDemand(s, QUARTERS, { quarterKey: Q4.key, tribeId: 'tribe-payments' });
    expect(v.gapFte[0]).toBeCloseTo(
      open.reduce((x, l) => x + l.openFte, 0),
      2,
    ); // QA-004
    expect(v.people.find((p) => p.person.name === 'Noma Odigie')?.pctByQuarter[0]).toBe(40);
    expect(() => buildTribeView(s, QUARTERS, 'nope')).toThrow('Unknown tribe');
  });

  it('My Plan: load, proposals, bookings, crafts and approver (PPL-05)', () => {
    const plan = buildMyPlan(s, QUARTERS, 'r9', t)!;
    expect(plan.quarters.map((q) => q.loadPct)).toEqual([57.6, 75.8, 16.5, 0]);
    expect(plan.proposals.map((x) => x.project?.name)).toEqual(['Nebula Analytics']);
    expect(plan.bookings).toHaveLength(2);
    expect(plan.crafts.primary?.short).toBe('PM');
    expect(plan.approverLabel).toBe('a Planner');
    expect(buildMyPlan(s, QUARTERS, 'r2', t)!.approverLabel).toBe('Tom Hayes');
    expect(buildMyPlan(s, QUARTERS, null, t)).toBeNull();
  });

  it("craft-change queue lists the viewer's chapter first with a diff (PPL-06#AC2)", () => {
    const extra: D.CraftChangeRequestDTO = {
      ...s.craftRequests[0],
      id: 'cr-2',
      personId: 'r2',
      current: byName('Claire Ryan').secondaryCrafts,
      proposed: [{ craftId: 'project-mgmt', proficiency: 3, maxPct: 60 }],
      submittedAt: '2026-10-15T00:00:00.000Z',
    };
    const q = buildCraftRequestQueue({ ...s, craftRequests: [...s.craftRequests, extra] }, 'r1');
    expect(q.map((r) => [r.request.id, r.yourChapter])).toEqual([
      ['cr-2', true],
      ['cr-1', false],
    ]);
    expect(q[0].changed).toEqual([
      {
        from: { craftId: 'project-mgmt', proficiency: 3, maxPct: 50 },
        to: { craftId: 'project-mgmt', proficiency: 3, maxPct: 60 },
      },
    ]);
    expect(q[0].removed.map((c) => c.craftId)).toEqual(['change-mgmt']);
    expect(q[1].added.map((c) => c.craftId)).toEqual(['change-mgmt']);
  });
});

describe('structure, catalogue admin and validation (ORG-02 … ORG-04)', () => {
  it('counts people and projects per tribe, chapter and team', () => {
    const r = buildStructureRows(s);
    expect(r.tribes.find((x) => x.entity.name === 'Payments')).toMatchObject({ projectsCount: 2, peopleCount: 3 });
    expect(r.chapters.find((x) => x.entity.id === 'chapter-programme-mgmt')).toMatchObject({
      peopleCount: 4,
      lead: { name: 'Tom Hayes' },
    });
    expect(r.teams.find((x) => x.entity.id === 't5')?.peopleCount).toBe(2);
  });

  it('craft admin counts holders and references; chapters from crafts', () => {
    const rows = buildCraftAdminRows(s);
    expect(rows.find((r) => r.craft.id === 'project-mgmt')).toMatchObject({ aboveHolders: 2, belowHolders: 1 });
    expect(rows.find((r) => r.craft.id === 'project-mgmt')!.inUse).toBeGreaterThan(3);
    expect(chaptersFromCrafts(s).map((c) => c.craft.id)).toEqual([
      'programme-mgmt',
      'project-mgmt',
      'scrum-master',
      'product-mgmt',
      'digital-planning',
    ]);
  });

  it('validators mirror the API rules', () => {
    expect(validateCraft(s, { name: 'Service Design', short: 'SD' })).toEqual({});
    expect(validateCraft(s, { name: 'project management', short: 'sd1x9' })).toEqual({
      name: 'Already exists',
      short: 'Use 2–4 capital letters or digits',
    });
    expect(validateCraft(s, { id: 'project-mgmt', name: 'Project Management', short: 'PM' })).toEqual({});
    expect(validateCraft(s, { name: 'X', short: 'PM' }).short).toBe('Already used by another craft');
    expect(validateStructureName(s.tribes, { name: ' digital ' })).toEqual({ name: 'Already exists' });
    expect(validateStructureName(s.tribes, { name: '' })).toEqual({ name: 'Enter a name' });
    expect(
      validateDemandLine(s, { quarterKey: '2027-Q2', fte: 0.5, craftId: 'project-mgmt', projectId: 'p1' }),
    ).toEqual({});
    expect(validateDemandLine(s, { quarterKey: '2027-Q5', fte: 60, craftId: 'nope' })).toEqual({
      quarterKey: 'Use a quarter like 2027-Q1',
      fte: 'Enter 0–50 FTE',
      craftId: 'Choose a craft',
    });
    expect(
      validateDemandLine(
        { ...s, crafts: [craft('old', 'OL', { archived: true })] },
        { quarterKey: '2027-Q2', fte: 1, craftId: 'old' },
      ).craftId,
    ).toBe('This craft is archived');
    expect(validatePerson({ targetUtil: 151, email: 'nope' })).toEqual({
      targetUtil: 'Target must be 0–150',
      email: 'Enter a valid email',
    });
    expect(
      validatePerson({
        primaryCraft: 'pm',
        secondaryCrafts: [
          { craftId: 'pm', proficiency: 2, maxPct: 40 },
          { craftId: 'sm', proficiency: 2, maxPct: 40 },
          { craftId: 'sm', proficiency: 1, maxPct: 40 },
        ],
      }),
    ).toEqual({ 'secondaryCrafts.0': 'Already their above-the-table craft', 'secondaryCrafts.2': 'Listed twice' });
  });
});
