/** Default craft catalogue seeded into every new organisation (same ids as v1.1 PMO_CRAFTS and migration 0004). */
import type { Queryable } from './db';

export const DEFAULT_CRAFTS: Array<{ id: string; name: string; short: string; description: string }> = [
  {
    id: 'programme-mgmt',
    name: 'Programme Management',
    short: 'PGM',
    description: 'Multi-project programmes, benefits and governance',
  },
  { id: 'project-mgmt', name: 'Project Management', short: 'PM', description: 'Plan, run and close a single project' },
  {
    id: 'scrum-master',
    name: 'Scrum Master / Agile Delivery',
    short: 'SM',
    description: 'Sprint facilitation, flow, impediments',
  },
  {
    id: 'product-mgmt',
    name: 'Product Management',
    short: 'PDM',
    description: 'Backlog ownership, discovery, roadmaps',
  },
  {
    id: 'business-analysis',
    name: 'Business Analysis',
    short: 'BA',
    description: 'Requirements, process mapping, acceptance',
  },
  {
    id: 'digital-planning',
    name: 'Digital Planning',
    short: 'DP',
    description: 'Portfolio sequencing, roadmap and demand planning',
  },
  { id: 'change-mgmt', name: 'Change & Adoption', short: 'CM', description: 'Stakeholder readiness, comms, training' },
  {
    id: 'pmo-analytics',
    name: 'PMO Analytics & Reporting',
    short: 'AN',
    description: 'Dashboards, status reporting, capacity data',
  },
  {
    id: 'risk-governance',
    name: 'Risk, Governance & Compliance',
    short: 'RG',
    description: 'RAID, audit, regulatory gates',
  },
  {
    id: 'vendor-mgmt',
    name: 'Vendor & Commercial Management',
    short: 'VM',
    description: 'Contracts, SOWs, supplier delivery',
  },
  {
    id: 'release-coord',
    name: 'Release & Delivery Coordination',
    short: 'RC',
    description: 'Release trains, cutover, dependency tracking',
  },
  {
    id: 'tooling-admin',
    name: 'Jira / Tooling Administration',
    short: 'JA',
    description: 'Jira, Planview and workflow configuration',
  },
];

export async function seedCrafts(q: Queryable, orgId: string): Promise<void> {
  const values: string[] = [];
  const params: unknown[] = [orgId];
  DEFAULT_CRAFTS.forEach((c, i) => {
    const b = params.length;
    values.push(`($1, $${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, ${i + 1})`);
    params.push(c.id, c.name, c.short, c.description);
  });
  await q.query(
    `INSERT INTO crafts (org_id, id, name, short, description, sort_order) VALUES ${values.join(', ')} ON CONFLICT DO NOTHING`,
    params,
  );
}
