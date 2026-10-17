/** JI-08#AC2: aggregation cases from the v1.1 integrations tests, now against the pure module. */
import {
  aggregatePage,
  aggregateUsage,
  impliedFte,
  plannedFte,
  suggestCalibration,
} from '../../netlify/functions/_lib/jira/aggregate';
import { detectJiraFields, latestSprint, parseSprintValue, quarterKey } from '../../netlify/functions/_lib/jira/fields';

const SP = 'customfield_10016';
const SPRINT = 'customfield_10020';
const S1 = {
  id: 101,
  name: 'Sprint 1',
  state: 'closed',
  startDate: '2026-01-05T09:00:00.000Z',
  endDate: '2026-01-16T17:00:00.000Z',
  originBoardId: 7,
};
const S2 = {
  id: 102,
  name: 'Sprint 2',
  state: 'active',
  startDate: '2026-04-13T09:00:00.000Z',
  endDate: '2026-04-24T17:00:00.000Z',
  originBoardId: 7,
};
const ALICE = { accountId: 'acc-alice', displayName: 'Alice', emailAddress: 'alice@acme.com' };
const BOB = { accountId: 'acc-bob', displayName: 'Bob', emailAddress: 'bob@acme.com' };
const done = { name: 'Done', statusCategory: { key: 'done', name: 'Done' } };
const todo = { name: 'To Do', statusCategory: { key: 'new', name: 'To Do' } };
const inProg = { name: 'In Progress', statusCategory: { key: 'indeterminate', name: 'In Progress' } };
const ABC = { id: '1', key: 'ABC', name: 'Alpha Build' };
const XYZ = { id: '2', key: 'XYZ', name: 'Xylo' };
const issue = (key: string, fields: Record<string, unknown>) => ({ id: key, key, fields: { summary: key, ...fields } });

const ISSUES = [
  issue('ABC-1', {
    status: done,
    assignee: ALICE,
    project: ABC,
    [SP]: 5,
    [SPRINT]: [S1],
    created: '2026-01-06T00:00:00.000Z',
    resolutiondate: '2026-01-15T00:00:00.000Z',
  }),
  issue('ABC-2', {
    status: todo,
    assignee: BOB,
    project: ABC,
    [SP]: 3,
    [SPRINT]: [S1],
    created: '2026-01-06T00:00:00.000Z',
    resolutiondate: null,
  }),
  issue('XYZ-3', {
    status: done,
    assignee: ALICE,
    project: XYZ,
    [SP]: 8,
    [SPRINT]: [S1, S2],
    created: '2026-01-10T00:00:00.000Z',
    resolutiondate: '2026-04-20T00:00:00.000Z',
  }),
  issue('XYZ-4', {
    status: inProg,
    assignee: BOB,
    project: XYZ,
    [SP]: 2,
    [SPRINT]: [S2],
    created: '2026-04-14T00:00:00.000Z',
    resolutiondate: null,
  }),
  issue('ABC-5', {
    status: done,
    assignee: null,
    project: ABC,
    [SP]: 4,
    [SPRINT]: null,
    created: '2026-02-01T00:00:00.000Z',
    resolutiondate: '2026-02-10T00:00:00.000Z',
  }),
];

describe('aggregateUsage (legacy /jira/usage report)', () => {
  it('aggregates by assignee, project, sprint and quarter with FTE estimates', () => {
    const json = aggregateUsage(ISSUES, {
      storyPointsFieldId: SP,
      sprintFieldId: SPRINT,
      tribeByProjectKey: { ABC: 'Payments' },
      calibration: {
        '*': { pointsPerSprintPerFte: 10, sprintLengthDays: 14 },
        Payments: { pointsPerSprintPerFte: 20, sprintLengthDays: 14 },
      },
      sprintsInRange: 6,
    });
    expect(json.issueCount).toBe(5);
    expect(json.totalPoints).toBe(22);
    expect(json.donePoints).toBe(17);
    expect(json.byAssignee).toEqual([
      { accountId: 'acc-alice', displayName: 'Alice', email: 'alice@acme.com', points: 13, donePoints: 13, issues: 2 },
      { accountId: 'acc-bob', displayName: 'Bob', email: 'bob@acme.com', points: 5, donePoints: 0, issues: 2 },
      { accountId: 'unassigned', displayName: 'Unassigned', email: '', points: 4, donePoints: 4, issues: 1 },
    ]);
    expect(json.byProject).toEqual([
      { key: 'ABC', name: 'Alpha Build', tribe: 'Payments', points: 12, donePoints: 9, issues: 3 },
      { key: 'XYZ', name: 'Xylo', tribe: '*', points: 10, donePoints: 8, issues: 2 },
    ]);
    expect(json.bySprint.map((s) => [s.sprintId, s.points, s.donePoints, s.byAssignee])).toEqual([
      [101, 8, 5, { 'acc-alice': 5, 'acc-bob': 3 }],
      [102, 10, 8, { 'acc-alice': 8, 'acc-bob': 2 }],
    ]);
    expect(json.byQuarter).toEqual([
      { quarterKey: '2026-Q1', points: 12, donePoints: 9, issues: 3 },
      { quarterKey: '2026-Q2', points: 10, donePoints: 8, issues: 2 },
    ]);
    expect(json.fteEstimate.byProject).toEqual({ ABC: 0.1, XYZ: 0.17 });
    expect(json.fteEstimate.bySprint).toEqual({ '101': 0.4, '102': 1 });
  });
});

describe('aggregatePage (sync snapshot rows)', () => {
  it('groups by project, latest sprint and assignee', () => {
    const rows = aggregatePage(ISSUES, SP, SPRINT);
    const key = (r: { jiraProjectKey: string; sprintId: string | null; assigneeAccountId: string | null }) =>
      `${r.jiraProjectKey}|${r.sprintId}|${r.assigneeAccountId}`;
    const byKey = Object.fromEntries(rows.map((r) => [key(r), r]));
    expect(byKey['ABC|101|acc-alice']).toMatchObject({
      pointsTotal: 5,
      pointsDone: 5,
      issuesTotal: 1,
      issuesDone: 1,
      quarterKey: '2026-Q1',
      sprintEnd: '2026-01-16',
    });
    expect(byKey['XYZ|102|acc-alice']).toMatchObject({ pointsDone: 8, sprintState: 'active' });
    expect(byKey['ABC|null|null']).toMatchObject({ pointsTotal: 4, sprintId: null, quarterKey: '2026-Q1' });
    expect(rows).toHaveLength(5);
  });
});

describe('fields and calibration helpers', () => {
  it('parses object and legacy string sprint values and picks the latest', () => {
    expect(
      parseSprintValue(
        'com.atlassian.greenhopper.service.sprint.Sprint@1[id=7,rapidViewId=3,state=CLOSED,name=S7,startDate=2026-01-01T00:00:00Z,endDate=<null>]',
      ),
    ).toEqual({
      id: 7,
      name: 'S7',
      state: 'closed',
      startDate: '2026-01-01T00:00:00Z',
      endDate: null,
      originBoardId: 3,
    });
    expect(latestSprint([S1, S2])?.id).toBe(102);
    expect(latestSprint(null)).toBeNull();
    expect(quarterKey('2026-11-02')).toBe('2026-Q4');
    expect(quarterKey('nope')).toBeNull();
  });

  it('detects the story points and sprint fields', () => {
    const f = [
      { id: 'customfield_10020', name: 'Sprint' },
      { id: 'customfield_10028', name: 'Story point estimate' },
      { id: 'customfield_10016', name: 'Story Points' },
    ];
    expect(detectJiraFields(f)).toEqual({
      storyPointsFieldId: 'customfield_10028',
      sprintFieldId: 'customfield_10020',
    });
    expect(detectJiraFields(f, 'customfield_10016').storyPointsFieldId).toBe('customfield_10016');
  });

  it('implied FTE and suggested calibration (JI-01#AC6, JI-04#AC1)', () => {
    expect(impliedFte(30, { pointsPerSprintPerFte: 10, sprintLengthDays: 14 }, 1)).toBe(3);
    expect(impliedFte(30, { pointsPerSprintPerFte: 10, sprintLengthDays: 14 }, 3)).toBe(1);
    const s = suggestCalibration([
      { sprintId: '41', name: 'Sprint 41', end: '2026-08-01', pointsDone: 30, plannedFte: 3.2 },
      { sprintId: '42', name: 'Sprint 42', end: '2026-08-15', pointsDone: 32, plannedFte: 3.2 },
      { sprintId: '43', name: 'Sprint 43', end: '2026-08-29', pointsDone: 34, plannedFte: 3.2 },
      { sprintId: '40', name: 'Sprint 40', end: '2026-07-18', pointsDone: 99, plannedFte: 1 },
    ]);
    expect(s).toEqual({
      value: 10,
      basis: { sprintNames: ['Sprint 41', 'Sprint 42', 'Sprint 43'], points: 96, fte: 3.2 },
    });
    expect(suggestCalibration([])).toBeNull();
  });

  it('planned FTE is overlap-weighted and ignores declined bookings', () => {
    const fte = plannedFte(
      [
        { projectId: 'p', resourceId: 'a', percentage: 100, startDate: null, endDate: null },
        { projectId: 'p', resourceId: 'b', percentage: 50, startDate: '2026-01-01', endDate: '2026-01-07' },
        { projectId: 'p', resourceId: 'c', percentage: 100, startDate: null, endDate: null, state: 'declined' },
      ],
      '2026-01-01',
      '2026-01-14',
    );
    expect(fte).toBe(1.25);
  });
});
