/**
 * The product guide: one plain-English description of every area of PMO Capacity Planner. The guided tour shows it
 * page by page and Ask Tom reads it (server side) so it can answer "how do I…" questions about the tool itself.
 * Keep it in step with the navigation in components/shell/nav.ts: entries are keyed by nav item id.
 */

export interface GuideEntry {
  /** Nav item id (components/shell/nav.ts) or a shell element id. */
  id: string;
  title: string;
  /** One or two sentences: what the page is for. Shown in the tour. */
  summary: string;
  /** Concrete things to do there. Shown in the tour and given to Ask Tom. */
  howTo: string[];
}

export const PAGE_GUIDE: GuideEntry[] = [
  {
    id: 'home',
    title: 'Home',
    summary: 'Your starting point: squad utilisation against target, open demand, and what needs attention next.',
    howTo: [
      'Read the tiles: squad utilisation, unstaffed demand, people over capacity and people available.',
      'Work through "Needs a decision": each item opens the page where you fix it.',
    ],
  },
  {
    id: 'me',
    title: 'My plan',
    summary: 'Your own bookings for the next four quarters, the proposals waiting for your answer, and your crafts.',
    howTo: [
      'Accept or decline tentative bookings proposed to you; only confirmed bookings count as load.',
      'Use "Suggest changes" to propose changes to your below-the-table crafts; your chapter lead (or a Planner) approves them.',
      'Use "Offer my capacity" so planners can see your spare time in the Marketplace.',
    ],
  },
  {
    id: 'capacity',
    title: 'Capacity Outlook',
    summary: 'Supply against demand for the next four quarters (QBR1–QBR4), by craft, chapter, tribe or person.',
    howTo: [
      'Use Pivot to group by craft, chapter, tribe or person, and the filters to narrow it down.',
      'Cell colours are utilisation bands (load as a share of target); the Gap column shows demand nobody is staffed on.',
      'The side lists show who is over capacity, under target or available. With the tribe grouping, tick Delivery signal to compare the plan with Jira.',
      'Use it before a QBR to decide whether to hire, re-balance or defer work.',
    ],
  },
  {
    id: 'demand',
    title: 'Demand',
    summary: 'Craft demand per project and quarter, what is already staffed, and the gap.',
    howTo: [
      'Use "Add demand" to ask for FTE of a craft on a project in a quarter (for example 0.5 FTE Programme management in QBR2); mark it forecast or confirmed.',
      'Switch between the By project and By craft tabs; copy a line to later quarters instead of retyping it.',
      'Watch the gap: demand not covered by bookings is open demand, and each gap links to the Marketplace to staff it.',
    ],
  },
  {
    id: 'allocations',
    title: 'Allocations',
    summary: 'The planning grid: each person across QBR1–QBR4, with the share of their time booked to each project.',
    howTo: [
      'Type a percentage into a cell; Enter or Tab saves, Escape cancels, Ctrl+Z (⌘Z on Mac) undoes.',
      'Use the arrow keys to move between cells; Ctrl+Shift+→ (⌘⇧→) copies a value forward, and you can paste a block.',
      'Switch between By person and By project, group by team or chapter, and use "Show tentative" to include proposals.',
      'Bookings typed here are confirmed straight away; proposals sent from the Marketplace stay tentative until accepted.',
    ],
  },
  {
    id: 'marketplace',
    title: 'Marketplace',
    summary: 'Match open demand to people with the right crafts and free capacity, and show tribes what the squad can offer.',
    howTo: [
      'Pick an open demand line to see people ranked by craft fit and free time (people who know the tribe or offered capacity rank higher).',
      'Propose a booking from a match: the person gets a tentative booking to accept or decline; Planners see it under Proposals.',
      'The Squad catalogue tab shows (and exports) what the squad can offer each quarter; Under target lists people with spare time.',
    ],
  },
  {
    id: 'people',
    title: 'People',
    summary: 'The PMO squad: each person with their above-the-table and below-the-table crafts, target and load.',
    howTo: [
      'Add people (or import a CSV, where your plan allows it), set their primary craft and utilisation target (lower it for part-timers).',
      'Select several people to bulk-edit chapter, team, target or craft; export the list as CSV.',
      'If you approve craft changes, the Requests tab lists the ones waiting for you.',
      'Open a person to see their bookings and load per quarter.',
    ],
  },
  {
    id: 'projects',
    title: 'Projects',
    summary: 'Every project with its stage, initiation date, demand and staffing, plus its Jira and Planview links.',
    howTo: [
      'Create a project, set its status, stage and priority, and assign it to a tribe.',
      'Open a project to add demand and see who is staffed on it.',
    ],
  },
  {
    id: 'tribes',
    title: 'Tribes',
    summary: 'Demand, PMO staffing and the delivery signal for each tribe over the next four quarters.',
    howTo: [
      'The Delivery signal column compares planned FTE with what Jira story points imply.',
      'Open a tribe to see its projects, the PMO people serving it and its story-point calibration.',
      'Tribe names and leads are managed in Settings › Structure.',
    ],
  },
  {
    id: 'delivery',
    title: 'Jira & Planview',
    summary: 'Jira story points per tribe, quarter and sprint turned into FTE and compared with the plan.',
    howTo: [
      'Connect Jira in Settings › Integrations first, then use the Project mapping and People mapping tabs.',
      'On the Calibration tab set story points one FTE delivers per sprint for each tribe, so points convert to FTE.',
      'Overview and Sprints show the comparison; Sync health shows when data last arrived. Planview projects can be imported here too.',
    ],
  },
  {
    id: 'sprints',
    title: 'Sprint planning',
    summary: 'Sprint-level bookings, squads and OKRs per quarter (the QBR sprint module). It keeps its own members and projects.',
    howTo: [
      'Switched on per organisation in Settings › Features.',
      'Tabs: Capacity grid, Tribes, OKRs, Squads, Members; scenarios let you try bookings without changing the live sprint plan.',
    ],
  },
  {
    id: 'reports',
    title: 'Reports',
    summary: 'The QBR pack and CSV exports for the next four quarters, plus utilisation and demand at a glance.',
    howTo: ['Download the QBR pack (PDF) before a quarterly business review.', 'Export the CSVs for your own analysis.'],
  },
  {
    id: 'settings',
    title: 'Settings',
    summary:
      'Profile, Organisation, Members and roles, Structure, Crafts, Planning, Integrations, Features and Billing. What you see depends on your role.',
    howTo: [
      'Profile: your own name, password and preferences.',
      'Members and roles: invite people and choose their role.',
      'Structure: tribes, chapters and teams. Crafts: the craft catalogue and short codes.',
      'Planning: fiscal year, utilisation band thresholds, default target utilisation and sprint length.',
      'Integrations: connect Jira and Planview. Features: switch Ask Tom, Sprint planning, scenarios and the daily Jira sync on or off.',
      'Billing: the organisation\'s plan (Org Admins only).',
    ],
  },
];

/** Shell elements the tour points at, in addition to the pages. */
export const SHELL_GUIDE: GuideEntry[] = [
  {
    id: 'search',
    title: 'Search',
    summary: 'Find any person, project, tribe or craft from anywhere. Press Ctrl K (⌘K on Mac).',
    howTo: [],
  },
  {
    id: 'notifications',
    title: 'Notifications',
    summary: 'Bookings proposed to you and craft changes waiting for your approval appear here.',
    howTo: [],
  },
  {
    id: 'help',
    title: 'Help',
    summary: 'The glossary, keyboard shortcuts, what is new, and this tour, whenever you want to see it again.',
    howTo: [],
  },
  {
    id: 'ask-tom',
    title: 'Ask Tom',
    summary:
      'Ask Tom anything: who is free next quarter, where the gaps are, or how to do something in the tool. Answers use this workspace\'s plan.',
    howTo: [],
  },
];

export const ROLES: Array<[string, string]> = [
  ['Org Admin', 'Everything in every workspace: organisation settings, members, structure, crafts, features, billing.'],
  ['PMO Admin', 'Everything in the workspace: people, projects, demand, bookings, structure, crafts, integrations, workspace members.'],
  ['Planner', 'People, projects, demand, bookings and proposals; approves craft-change requests.'],
  ['Squad member', 'Their own crafts (as a request), answering proposals, offering their own capacity in My plan.'],
  ['Viewer', 'Reads every page and export; makes no changes.'],
];

export const GLOSSARY: Array<[string, string]> = [
  ['Above the table', "A person's primary craft: the work they are hired and measured for. One per person."],
  [
    'Below the table',
    'Additional crafts a person can contribute, each with a proficiency level and a maximum share of time.',
  ],
  ['Craft', 'A PMO discipline such as Programme management or Risk and governance, with a short code (e.g. PM).'],
  [
    'Proficiency L1–L3',
    'L1 contributes with support, L2 contributes independently, L3 can own the craft independently.',
  ],
  ['FTE', 'Full-time equivalent. 1.0 FTE is one person at 100% of their capacity for the period.'],
  ['QBR1–QBR4', 'The four rolling quarters, starting with the current calendar quarter (QBR1).'],
  [
    'Utilisation bands',
    'Available below 50%, Under target 50–89%, On target 90–105%, Over capacity above 105% of target.',
  ],
  ['Calibration', 'Story points per sprint that one FTE delivers in a tribe; turns Jira points into implied FTE.'],
  ['Delivery signal', 'Planned FTE compared with the FTE implied by Jira story points for the same period.'],
  [
    'Tentative / Confirmed',
    'A tentative booking is proposed and waits for the person to accept; confirmed bookings count as load.',
  ],
];

/** The guide as plain text for Ask Tom's system prompt. Stable across requests so it can be cached. */
export function productGuideText(): string {
  const pages = PAGE_GUIDE.map(
    (p) => `## ${p.title}\n${p.summary}\n${p.howTo.map((h) => `- ${h}`).join('\n')}`.trimEnd(),
  ).join('\n\n');
  const shell = SHELL_GUIDE.map((s) => `- ${s.title}: ${s.summary}`).join('\n');
  const roles = ROLES.map(([r, d]) => `- ${r}: ${d}`).join('\n');
  const terms = GLOSSARY.map(([t, d]) => `- ${t}: ${d}`).join('\n');
  return `# Pages (left-hand navigation; Settings is pinned at the bottom)\n\n${pages}\n\n# Everywhere\n${shell}\n\n# Roles\n${roles}\n\n# Glossary\n${terms}`;
}
