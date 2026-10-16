/**
 * Demo data for the legacy QBR sprint module (moved out of qbr.ts). Runs inside the caller's transaction and only
 * for the caller's workspace; qbr.ts restricts it to non-production or platform admins (HS-04#AC6).
 */
import type { Queryable } from './db';

const TRIBES = [
  ['Payments', 'All payment-related products and services', 'Sarah Mitchell', '#6366f1'],
  ['Lending & Credit', 'Loan origination, credit decisioning, servicing', "James O'Brien", '#3b82f6'],
  ['Digital Experience', 'Mobile app, web portal, customer self-service', 'Aisha Patel', '#8b5cf6'],
] as const;
const CHAPTERS = [
  ['Engineering', 'Full-stack and backend engineers', 'Tom Hayes', '#10b981'],
  ['Design & UX', 'Product designers, UX researchers', 'Fiona Kelly', '#ec4899'],
  ['Quality Assurance', 'Test automation, manual QA', 'Derek Nolan', '#f59e0b'],
  ['Project Management', 'Delivery leads, scrum masters', 'Claire Ryan', '#ef4444'],
] as const;
const COES = [
  ['Security & Compliance', 'InfoSec, PCI-DSS, GDPR specialists', 'Ravi Shankar', '#dc2626'],
  ['Data & Analytics', 'Data engineers, ML engineers, BI analysts', 'Lisa Chen', '#0891b2'],
] as const;
// name, role, tribe idx | null, chapter idx | null, coe idx | null, type, colour, skills, daily rate
const MEMBERS: Array<
  [string, string, number | null, number | null, number | null, string, string, string[], number | null]
> = [
  ['Liam Murphy', 'Senior Backend Engineer', 0, 0, null, 'INTERNAL', '#6366f1', ['Java', 'Kafka', 'PostgreSQL'], null],
  ['Emma Walsh', 'Full-Stack Engineer', 0, 0, null, 'INTERNAL', '#818cf8', ['React', 'Node.js', 'TypeScript'], null],
  ['Ciaran Burke', 'Platform Engineer', 0, 0, null, 'INTERNAL', '#a78bfa', ['AWS', 'Terraform', 'Docker'], null],
  ['Aoife Brennan', 'Product Designer', 0, 1, null, 'INTERNAL', '#ec4899', ['Figma', 'User Research'], null],
  ['Gokul Gurijala', 'Delivery Lead', 0, 3, null, 'INTERNAL', '#f43f5e', ['Agile', 'SAFe', 'JIRA'], null],
  ['Sean Doyle', 'Lead Engineer', 1, 0, null, 'INTERNAL', '#3b82f6', ['Python', 'FastAPI'], null],
  ['Niamh Carroll', 'Backend Engineer', 1, 0, null, 'INTERNAL', '#60a5fa', ['Java', 'Spring Boot'], null],
  ['Raj Kapoor', 'Contract Developer', 1, 0, null, 'VENDOR', '#93c5fd', ['React', 'Node.js'], 650],
  ['Michelle Keane', 'QA Lead', 1, 2, null, 'INTERNAL', '#f59e0b', ['Selenium', 'Cypress'], null],
  ['Tom Hayes', 'Chapter Lead, Delivery', 1, 3, null, 'INTERNAL', '#ef4444', ['Agile', 'SAFe'], null],
  ['Oisin Flynn', 'Mobile Engineer', 2, 0, null, 'INTERNAL', '#8b5cf6', ['React Native', 'Swift'], null],
  ['Saoirse Kelly', 'Frontend Engineer', 2, 0, null, 'INTERNAL', '#a78bfa', ['React', 'TypeScript'], null],
  ['Kate Murphy', 'Senior UX Designer', 2, 1, null, 'INTERNAL', '#f472b6', ['Figma', 'Accessibility'], null],
  ["Linda O'Dwyer", 'Scrum Master', 2, 3, null, 'INTERNAL', '#fb923c', ['Scrum', 'Kanban'], null],
  ['Ravi Shankar', 'Security Architect', null, null, 0, 'INTERNAL', '#dc2626', ['PCI-DSS', 'GDPR'], null],
  ['Lisa Chen', 'Lead Data Engineer', null, null, 1, 'INTERNAL', '#0891b2', ['Spark', 'dbt'], null],
];
// name, tribe idx, status, priority, colour
const PROJECTS: Array<[string, number, string, string, string]> = [
  ['Real-Time Payments v2', 0, 'ACTIVE', 'CRITICAL', '#6366f1'],
  ['PCI-DSS Remediation', 0, 'ACTIVE', 'HIGH', '#ef4444'],
  ['Automated Credit Engine', 1, 'ACTIVE', 'CRITICAL', '#3b82f6'],
  ['Mobile App v3', 2, 'PLANNING', 'HIGH', '#8b5cf6'],
  ['Legacy System Decommission', 1, 'ACTIVE', 'LOW', '#6b7280'],
];
// member idx, project idx, percentage, sprints (from sprint 1 of the active quarter)
const BOOKINGS: Array<[number, number, number, number]> = [
  [0, 0, 50, 4],
  [1, 0, 40, 3],
  [5, 2, 60, 6],
  [6, 2, 50, 4],
  [11, 3, 70, 6],
  [12, 3, 50, 4],
  [14, 1, 80, 4],
  [4, 0, 30, 6],
  [9, 2, 20, 6],
  [9, 4, 20, 6],
];

async function ids(q: Queryable, sql: string, rows: unknown[][]): Promise<string[]> {
  const out: string[] = [];
  for (const params of rows) out.push(String((await q.query<{ id: string }>(sql, params))[0].id));
  return out;
}

export async function seedQbr(q: Queryable, orgId: string, wsId: string) {
  await q.query(`DELETE FROM qbr_bookings WHERE workspace_id = $1`, [wsId]);
  await q.query(`DELETE FROM qbr_squad_members WHERE squad_id IN (SELECT id FROM qbr_squads WHERE workspace_id = $1)`, [
    wsId,
  ]);
  for (const t of ['qbr_squads', 'qbr_projects', 'qbr_okrs', 'qbr_scenarios'])
    await q.query(`DELETE FROM ${t} WHERE workspace_id = $1`, [wsId]);
  await q.query(`DELETE FROM qbr_sprints WHERE quarter_id IN (SELECT id FROM qbr_quarters WHERE workspace_id = $1)`, [
    wsId,
  ]);
  for (const t of ['qbr_quarters', 'qbr_members', 'qbr_coe_groups', 'qbr_chapters', 'qbr_tribes'])
    await q.query(`DELETE FROM ${t} WHERE workspace_id = $1`, [wsId]);

  const group = (table: string) =>
    `INSERT INTO ${table} (org_id, workspace_id, name, description, lead_name, color) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`;
  const tribes = await ids(
    q,
    group('qbr_tribes'),
    TRIBES.map((t) => [orgId, wsId, ...t]),
  );
  const chapters = await ids(
    q,
    group('qbr_chapters'),
    CHAPTERS.map((t) => [orgId, wsId, ...t]),
  );
  const coes = await ids(
    q,
    group('qbr_coe_groups'),
    COES.map((t) => [orgId, wsId, ...t]),
  );
  const members = await ids(
    q,
    `INSERT INTO qbr_members (org_id, workspace_id, name, email, role_title, tribe_id, chapter_id, coe_id, member_type, daily_rate, skills, avatar_color)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::text[], $12) RETURNING id`,
    MEMBERS.map(([name, role, t, c, e, type, colour, skills, rate]) => [
      orgId,
      wsId,
      name,
      `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.test`,
      role,
      t === null ? null : tribes[t],
      c === null ? null : chapters[c],
      e === null ? null : coes[e],
      type,
      rate,
      skills,
      colour,
    ]),
  );
  const year = new Date().getUTCFullYear();
  const qStart = new Date(Date.UTC(year, Math.floor(new Date().getUTCMonth() / 3) * 3, 1));
  const [quarter] = await ids(
    q,
    `INSERT INTO qbr_quarters (org_id, workspace_id, label, start_date, end_date, is_active) VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
    [
      [
        orgId,
        wsId,
        `Q${Math.floor(qStart.getUTCMonth() / 3) + 1} ${year}`,
        qStart.toISOString().slice(0, 10),
        new Date(qStart.getTime() + 83 * 86400000).toISOString().slice(0, 10),
      ],
    ],
  );
  const sprints = await ids(
    q,
    `INSERT INTO qbr_sprints (quarter_id, sprint_number, label, start_date, end_date) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    Array.from({ length: 6 }, (_, i) => {
      const s = new Date(qStart.getTime() + i * 14 * 86400000);
      const e = new Date(s.getTime() + 11 * 86400000);
      return [quarter, i + 1, `S${i + 1}`, s.toISOString().slice(0, 10), e.toISOString().slice(0, 10)];
    }),
  );
  const projects = await ids(
    q,
    `INSERT INTO qbr_projects (org_id, workspace_id, name, tribe_id, status, priority, start_quarter_id, end_quarter_id, color)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8) RETURNING id`,
    PROJECTS.map(([name, t, status, priority, colour]) => [
      orgId,
      wsId,
      name,
      tribes[t],
      status,
      priority,
      quarter,
      colour,
    ]),
  );
  for (const [m, p, pct, n] of BOOKINGS) {
    for (const s of sprints.slice(0, n)) {
      await q.query(
        `INSERT INTO qbr_bookings (org_id, workspace_id, member_id, project_id, sprint_id, percentage) VALUES ($1, $2, $3, $4, $5, $6)`,
        [orgId, wsId, members[m], projects[p], s, pct],
      );
    }
  }
  const [squad] = await ids(
    q,
    `INSERT INTO qbr_squads (org_id, workspace_id, name, tribe_id, project_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [[orgId, wsId, 'Squad RTP', tribes[0], projects[0]]],
  );
  for (const [m, role] of [
    [4, 'LEAD'],
    [0, 'MEMBER'],
    [1, 'MEMBER'],
  ] as const) {
    await q.query(`INSERT INTO qbr_squad_members (squad_id, member_id, squad_role) VALUES ($1, $2, $3)`, [
      squad,
      members[m],
      role,
    ]);
  }
  return { members: members.length, quarters: 1, sprints: sprints.length, projects: projects.length, squads: 1 };
}
