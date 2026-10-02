
import { Resource, Project, Allocation, Team, ResourceType, ProjectStatus, Craft } from './types';

/* ═══════════════════════════════════════════════════════════════
   PMO Craft catalogue
   "Above the table" = the craft a person is hired/reported for.
   "Below the table" = crafts they can also serve for a share of
   their capacity. Both are captured per individual.
   ═══════════════════════════════════════════════════════════════ */
export const PMO_CRAFTS: Craft[] = [
  { id: 'programme-mgmt', name: 'Programme Management', short: 'PgM', color: '#6366f1', description: 'Multi-project programmes, benefits and governance' },
  { id: 'project-mgmt', name: 'Project Management', short: 'PM', color: '#3b82f6', description: 'Plan, run and close a single project' },
  { id: 'scrum-master', name: 'Scrum Master / Agile Delivery', short: 'SM', color: '#10b981', description: 'Sprint facilitation, flow, impediments' },
  { id: 'product-mgmt', name: 'Product Management', short: 'PdM', color: '#f59e0b', description: 'Backlog ownership, discovery, roadmaps' },
  { id: 'business-analysis', name: 'Business Analysis', short: 'BA', color: '#ec4899', description: 'Requirements, process mapping, acceptance' },
  { id: 'digital-planning', name: 'Digital Planning', short: 'DP', color: '#8b5cf6', description: 'Portfolio sequencing, roadmap and demand planning' },
  { id: 'change-mgmt', name: 'Change & Adoption', short: 'CM', color: '#14b8a6', description: 'Stakeholder readiness, comms, training' },
  { id: 'pmo-analytics', name: 'PMO Analytics & Reporting', short: 'AN', color: '#0ea5e9', description: 'Dashboards, status reporting, capacity data' },
  { id: 'risk-governance', name: 'Risk, Governance & Compliance', short: 'RG', color: '#ef4444', description: 'RAID, audit, regulatory gates' },
  { id: 'vendor-mgmt', name: 'Vendor & Commercial Management', short: 'VM', color: '#a16207', description: 'Contracts, SOWs, supplier delivery' },
  { id: 'release-coord', name: 'Release & Delivery Coordination', short: 'RC', color: '#64748b', description: 'Release trains, cutover, dependency tracking' },
  { id: 'tooling-admin', name: 'Jira / Tooling Administration', short: 'JA', color: '#0052CC', description: 'Jira, Planview and workflow configuration' },
];

export const CRAFT_BY_ID: Record<string, Craft> = Object.fromEntries(PMO_CRAFTS.map(c => [c.id, c]));

export const PROJECT_STAGES: { id: 'Pipeline' | 'Initiated' | 'Mobilising' | 'In Flight' | 'Closing'; color: string; hint: string }[] = [
  { id: 'Pipeline', color: '#94a3b8', hint: 'Idea / business case – demand is a forecast' },
  { id: 'Initiated', color: '#8b5cf6', hint: 'Approved – craft demand must be captured' },
  { id: 'Mobilising', color: '#f59e0b', hint: 'Staffing in progress' },
  { id: 'In Flight', color: '#10b981', hint: 'Delivering' },
  { id: 'Closing', color: '#64748b', hint: 'Winding down – capacity releasing' },
];

export const TEAMS: Team[] = [
  { id: 't1', name: 'Programme Management', color: '#6366f1' },
  { id: 't2', name: 'Digital Planning', color: '#ec4899' },
  { id: 't3', name: 'Product Management', color: '#f59e0b' },
  { id: 't4', name: 'Delivery', color: '#10b981' },
  { id: 't5', name: 'Project Management', color: '#3b82f6' },
];

export const MOCK_RESOURCES: Resource[] = [
  // Chapter Lead — above the table: Programme Mgmt; below: Governance, Digital Planning
  { id: 'r1', name: 'Tom Hayes', role: 'Chapter Lead – Business Delivery', type: ResourceType.PERMANENT, department: 'IE Portfolio & Change Office', teamId: 't1', totalCapacity: 100, email: 'tom.hayes@company.ie', location: 'Dublin',
    primaryCraft: 'programme-mgmt', secondaryCrafts: [{ craftId: 'risk-governance', proficiency: 3, maxPct: 30 }, { craftId: 'digital-planning', proficiency: 2, maxPct: 20 }], tribeAffinity: ['Payments', 'Lending'], skills: ['Stakeholder Mgmt', 'Benefits Tracking'] },
  // Programme Managers
  { id: 'r2', name: 'Claire Ryan', role: 'Programme Manager', type: ResourceType.PERMANENT, department: 'IE Portfolio & Change Office', teamId: 't1', totalCapacity: 100, email: 'claire.ryan@company.ie', location: 'Dublin',
    primaryCraft: 'programme-mgmt', secondaryCrafts: [{ craftId: 'project-mgmt', proficiency: 3, maxPct: 50 }, { craftId: 'change-mgmt', proficiency: 2, maxPct: 30 }], tribeAffinity: ['Digital'], skills: ['MSP', 'Change Comms'] },
  { id: 'r3', name: 'Agnese Markusevska', role: 'Programme Manager', type: ResourceType.PERMANENT, department: 'IE Portfolio & Change Office', teamId: 't1', totalCapacity: 100, email: 'agnese.m@company.ie', location: 'Dublin',
    primaryCraft: 'programme-mgmt', secondaryCrafts: [{ craftId: 'vendor-mgmt', proficiency: 3, maxPct: 40 }, { craftId: 'risk-governance', proficiency: 2, maxPct: 20 }], tribeAffinity: ['Payments'], skills: ['Vendor SOWs', 'PCI'] },
  { id: 'r4', name: 'Kerrie Dalton', role: 'Programme Manager', type: ResourceType.PERMANENT, department: 'IE Portfolio & Change Office', teamId: 't1', totalCapacity: 100, email: 'kerrie.dalton@company.ie', location: 'Dublin',
    primaryCraft: 'programme-mgmt', secondaryCrafts: [{ craftId: 'pmo-analytics', proficiency: 2, maxPct: 30 }], tribeAffinity: ['Lending', 'Operations'], skills: ['Power BI', 'Benefits'] },
  // Digital Planning
  { id: 'r5', name: 'Emer Ward', role: 'Digital Planning Lead', type: ResourceType.PERMANENT, department: 'IE Portfolio & Change Office', teamId: 't2', totalCapacity: 100, email: 'emer.ward@company.ie', location: 'Dublin',
    primaryCraft: 'digital-planning', secondaryCrafts: [{ craftId: 'business-analysis', proficiency: 3, maxPct: 40 }, { craftId: 'pmo-analytics', proficiency: 3, maxPct: 40 }], tribeAffinity: ['Digital', 'Payments'], skills: ['Roadmapping', 'OKRs'] },
  // Product Managers
  { id: 'r6', name: 'Maria Kelly', role: 'Telephony Product Manager', type: ResourceType.PERMANENT, department: 'IE Portfolio & Change Office', teamId: 't3', totalCapacity: 100, email: 'maria.kelly@company.ie', location: 'Dublin',
    primaryCraft: 'product-mgmt', secondaryCrafts: [{ craftId: 'business-analysis', proficiency: 2, maxPct: 30 }, { craftId: 'vendor-mgmt', proficiency: 2, maxPct: 20 }], tribeAffinity: ['Operations'], skills: ['Telephony', 'Genesys'] },
  { id: 'r7', name: 'Mary Vithalani', role: 'Automation Product Manager', type: ResourceType.PERMANENT, department: 'IE Portfolio & Change Office', teamId: 't3', totalCapacity: 100, email: 'mary.vithalani@company.ie', location: 'Dublin',
    primaryCraft: 'product-mgmt', secondaryCrafts: [{ craftId: 'business-analysis', proficiency: 3, maxPct: 40 }, { craftId: 'tooling-admin', proficiency: 2, maxPct: 20 }], tribeAffinity: ['Operations', 'Lending'], skills: ['RPA', 'Process Mining'] },
  // Scrum Master
  { id: 'r8', name: 'Noma Odigie', role: 'Scrum Master', type: ResourceType.PERMANENT, department: 'IE Portfolio & Change Office', teamId: 't4', totalCapacity: 100, email: 'noma.odigie@company.ie', location: 'Dublin',
    primaryCraft: 'scrum-master', secondaryCrafts: [{ craftId: 'release-coord', proficiency: 3, maxPct: 40 }, { craftId: 'tooling-admin', proficiency: 3, maxPct: 30 }], tribeAffinity: ['Digital', 'Payments'], skills: ['Scrum', 'Kanban', 'Jira Admin'] },
  // Project Managers
  { id: 'r9', name: 'Gokul Gurijala', role: 'Project Manager', type: ResourceType.PERMANENT, department: 'IE Portfolio & Change Office', teamId: 't5', totalCapacity: 100, email: 'gokul.gurijala@company.ie', location: 'Dublin',
    primaryCraft: 'project-mgmt', secondaryCrafts: [{ craftId: 'scrum-master', proficiency: 3, maxPct: 50 }, { craftId: 'pmo-analytics', proficiency: 3, maxPct: 40 }, { craftId: 'tooling-admin', proficiency: 3, maxPct: 30 }], tribeAffinity: ['Payments', 'Digital'], skills: ['SAFe', 'Jira', 'Planview'] },
  { id: 'r10', name: "Linda O'Dwyer", role: 'Project Manager', type: ResourceType.PERMANENT, department: 'IE Portfolio & Change Office', teamId: 't5', totalCapacity: 100, email: 'linda.odwyer@company.ie', location: 'Dublin',
    primaryCraft: 'project-mgmt', secondaryCrafts: [{ craftId: 'change-mgmt', proficiency: 3, maxPct: 40 }, { craftId: 'business-analysis', proficiency: 1, maxPct: 20 }], tribeAffinity: ['Operations'], skills: ['Prince2', 'Training Design'] },
];

// Rolling window at build time of this demo data: QBR1 = Q4 2026 … QBR4 = Q3 2027
export const MOCK_PROJECTS: Project[] = [
  { id: 'p1', name: 'Apollo Revamp', status: ProjectStatus.ACTIVE, priority: 'High', description: 'Major UI overhaul of the main customer portal.', startDate: '2026-07-06', endDate: '2027-01-29', budget: 250000, clientName: 'Digital', color: '#6366f1', stage: 'In Flight', initiatedOn: '2026-05-11', jiraKey: 'APOLLO',
    craftDemand: [
      { quarterKey: '2026-Q4', craftId: 'project-mgmt', fte: 1 }, { quarterKey: '2026-Q4', craftId: 'scrum-master', fte: 0.5 }, { quarterKey: '2026-Q4', craftId: 'change-mgmt', fte: 0.3 },
      { quarterKey: '2027-Q1', craftId: 'project-mgmt', fte: 0.5 }, { quarterKey: '2027-Q1', craftId: 'change-mgmt', fte: 0.5 },
    ] },
  { id: 'p2', name: 'Skyline API', status: ProjectStatus.ACTIVE, priority: 'Medium', description: 'Internal API modernization project.', startDate: '2026-09-01', endDate: '2027-03-31', budget: 180000, clientName: 'Payments', color: '#3b82f6', stage: 'In Flight', initiatedOn: '2026-06-22', jiraKey: 'SKY',
    craftDemand: [
      { quarterKey: '2026-Q4', craftId: 'programme-mgmt', fte: 0.5 }, { quarterKey: '2026-Q4', craftId: 'scrum-master', fte: 0.5 }, { quarterKey: '2026-Q4', craftId: 'vendor-mgmt', fte: 0.3 },
      { quarterKey: '2027-Q1', craftId: 'programme-mgmt', fte: 0.5 }, { quarterKey: '2027-Q1', craftId: 'scrum-master', fte: 0.5 },
    ] },
  { id: 'p3', name: 'Nebula Analytics', status: ProjectStatus.PLANNING, priority: 'Critical', description: 'Next-gen data visualization tool development.', startDate: '2027-01-11', endDate: '2027-09-30', budget: 420000, clientName: 'Lending', color: '#8b5cf6', stage: 'Initiated', initiatedOn: '2026-09-15',
    craftDemand: [
      { quarterKey: '2027-Q1', craftId: 'programme-mgmt', fte: 0.6 }, { quarterKey: '2027-Q1', craftId: 'business-analysis', fte: 1 }, { quarterKey: '2027-Q1', craftId: 'pmo-analytics', fte: 0.4 },
      { quarterKey: '2027-Q2', craftId: 'programme-mgmt', fte: 0.6 }, { quarterKey: '2027-Q2', craftId: 'project-mgmt', fte: 1 }, { quarterKey: '2027-Q2', craftId: 'business-analysis', fte: 1 }, { quarterKey: '2027-Q2', craftId: 'pmo-analytics', fte: 0.4 },
      { quarterKey: '2027-Q3', craftId: 'project-mgmt', fte: 1 }, { quarterKey: '2027-Q3', craftId: 'change-mgmt', fte: 0.5 }, { quarterKey: '2027-Q3', craftId: 'pmo-analytics', fte: 0.4 },
    ] },
  { id: 'p4', name: 'Legacy Patching', status: ProjectStatus.ON_HOLD, priority: 'Low', description: 'Ongoing maintenance for v1.0 platforms.', startDate: '2026-10-01', endDate: '2027-06-30', budget: 50000, clientName: 'Operations', color: '#6b7280', stage: 'Closing', initiatedOn: '2025-10-01',
    craftDemand: [{ quarterKey: '2026-Q4', craftId: 'project-mgmt', fte: 0.3 }, { quarterKey: '2027-Q1', craftId: 'project-mgmt', fte: 0.3 }] },
  { id: 'p5', name: 'Phoenix Mobile', status: ProjectStatus.ACTIVE, priority: 'High', description: 'New React Native mobile app for field teams.', startDate: '2026-08-03', endDate: '2027-05-28', budget: 300000, clientName: 'Digital', color: '#f59e0b', stage: 'In Flight', initiatedOn: '2026-06-01', jiraKey: 'PHX',
    craftDemand: [
      { quarterKey: '2026-Q4', craftId: 'programme-mgmt', fte: 0.5 }, { quarterKey: '2026-Q4', craftId: 'product-mgmt', fte: 0.5 }, { quarterKey: '2026-Q4', craftId: 'scrum-master', fte: 0.5 },
      { quarterKey: '2027-Q1', craftId: 'programme-mgmt', fte: 0.5 }, { quarterKey: '2027-Q1', craftId: 'product-mgmt', fte: 0.5 }, { quarterKey: '2027-Q1', craftId: 'scrum-master', fte: 0.5 }, { quarterKey: '2027-Q1', craftId: 'release-coord', fte: 0.3 },
      { quarterKey: '2027-Q2', craftId: 'project-mgmt', fte: 0.5 }, { quarterKey: '2027-Q2', craftId: 'release-coord', fte: 0.5 }, { quarterKey: '2027-Q2', craftId: 'change-mgmt', fte: 0.5 },
    ] },
  { id: 'p6', name: 'Orion Security', status: ProjectStatus.PLANNING, priority: 'Critical', description: 'Security hardening and compliance audit.', startDate: '2026-11-02', endDate: '2027-04-30', budget: 120000, clientName: 'Payments', color: '#ef4444', stage: 'Mobilising', initiatedOn: '2026-09-28',
    craftDemand: [
      { quarterKey: '2026-Q4', craftId: 'project-mgmt', fte: 0.5 }, { quarterKey: '2026-Q4', craftId: 'risk-governance', fte: 0.5 },
      { quarterKey: '2027-Q1', craftId: 'project-mgmt', fte: 1 }, { quarterKey: '2027-Q1', craftId: 'risk-governance', fte: 0.5 }, { quarterKey: '2027-Q1', craftId: 'vendor-mgmt', fte: 0.3 },
      { quarterKey: '2027-Q2', craftId: 'project-mgmt', fte: 0.5 }, { quarterKey: '2027-Q2', craftId: 'risk-governance', fte: 0.3 },
    ] },
  { id: 'p7', name: 'Telephony Cloud Migration', status: ProjectStatus.PLANNING, priority: 'High', description: 'Move contact-centre telephony to cloud (Genesys).', startDate: '2027-04-05', endDate: '2027-12-17', budget: 380000, clientName: 'Operations', color: '#14b8a6', stage: 'Pipeline', initiatedOn: '2026-09-30',
    craftDemand: [
      { quarterKey: '2027-Q2', craftId: 'product-mgmt', fte: 0.6 }, { quarterKey: '2027-Q2', craftId: 'project-mgmt', fte: 0.5 }, { quarterKey: '2027-Q2', craftId: 'vendor-mgmt', fte: 0.4 },
      { quarterKey: '2027-Q3', craftId: 'product-mgmt', fte: 0.6 }, { quarterKey: '2027-Q3', craftId: 'project-mgmt', fte: 1 }, { quarterKey: '2027-Q3', craftId: 'scrum-master', fte: 0.5 }, { quarterKey: '2027-Q3', craftId: 'change-mgmt', fte: 0.5 }, { quarterKey: '2027-Q3', craftId: 'vendor-mgmt', fte: 0.4 },
    ] },
];

export const MOCK_ALLOCATIONS: Allocation[] = [
  // Tom Hayes (r1) – oversight across programmes
  { id: 'a1', resourceId: 'r1', projectId: 'p1', percentage: 20, craftId: 'programme-mgmt' },
  { id: 'a2', resourceId: 'r1', projectId: 'p2', percentage: 25, craftId: 'programme-mgmt' },
  { id: 'a3', resourceId: 'r1', projectId: 'p6', percentage: 20, craftId: 'risk-governance', startDate: '2026-11-02', endDate: '2027-04-30' },
  // Claire Ryan (r2)
  { id: 'a4', resourceId: 'r2', projectId: 'p1', percentage: 60, craftId: 'project-mgmt' },
  { id: 'a5', resourceId: 'r2', projectId: 'p5', percentage: 40, craftId: 'programme-mgmt' },
  // Agnese Markusevska (r3)
  { id: 'a6', resourceId: 'r3', projectId: 'p2', percentage: 50, craftId: 'programme-mgmt' },
  { id: 'a7', resourceId: 'r3', projectId: 'p2', percentage: 30, craftId: 'vendor-mgmt' },
  { id: 'a8', resourceId: 'r3', projectId: 'p6', percentage: 20, craftId: 'programme-mgmt', startDate: '2026-11-02', endDate: '2027-04-30' },
  // Kerrie Dalton (r4) – rolls onto Nebula in 2027
  { id: 'a9', resourceId: 'r4', projectId: 'p4', percentage: 30, craftId: 'project-mgmt', startDate: '2026-10-01', endDate: '2027-03-31' },
  { id: 'a10', resourceId: 'r4', projectId: 'p3', percentage: 60, craftId: 'programme-mgmt', startDate: '2027-01-11', endDate: '2027-09-30' },
  // Emer Ward (r5)
  { id: 'a11', resourceId: 'r5', projectId: 'p1', percentage: 30, craftId: 'digital-planning' },
  { id: 'a12', resourceId: 'r5', projectId: 'p5', percentage: 30, craftId: 'digital-planning' },
  { id: 'a13', resourceId: 'r5', projectId: 'p3', percentage: 40, craftId: 'business-analysis', startDate: '2027-01-11', endDate: '2027-06-30' },
  // Maria Kelly (r6) – over-allocated in Q4
  { id: 'a14', resourceId: 'r6', projectId: 'p2', percentage: 60, craftId: 'business-analysis', startDate: '2026-09-01', endDate: '2026-12-31' },
  { id: 'a15', resourceId: 'r6', projectId: 'p5', percentage: 50, craftId: 'product-mgmt' },
  // Mary Vithalani (r7)
  { id: 'a16', resourceId: 'r7', projectId: 'p3', percentage: 40, craftId: 'business-analysis', startDate: '2027-01-11', endDate: '2027-09-30' },
  { id: 'a17', resourceId: 'r7', projectId: 'p6', percentage: 30, craftId: 'business-analysis', startDate: '2026-11-02', endDate: '2027-04-30' },
  // Noma Odigie (r8) – over-allocated
  { id: 'a18', resourceId: 'r8', projectId: 'p1', percentage: 40, craftId: 'scrum-master' },
  { id: 'a19', resourceId: 'r8', projectId: 'p2', percentage: 40, craftId: 'scrum-master' },
  { id: 'a20', resourceId: 'r8', projectId: 'p5', percentage: 35, craftId: 'scrum-master' },
  // Gokul Gurijala (r9)
  { id: 'a21', resourceId: 'r9', projectId: 'p6', percentage: 50, craftId: 'project-mgmt', startDate: '2026-11-02', endDate: '2027-04-30' },
  { id: 'a22', resourceId: 'r9', projectId: 'p1', percentage: 25, craftId: 'pmo-analytics' },
  // Linda O'Dwyer (r10)
  { id: 'a23', resourceId: 'r10', projectId: 'p4', percentage: 30, craftId: 'project-mgmt', startDate: '2026-10-01', endDate: '2027-06-30' },
  { id: 'a24', resourceId: 'r10', projectId: 'p1', percentage: 30, craftId: 'change-mgmt', startDate: '2026-10-01', endDate: '2027-01-29' },
];

export const PLAN_LIMITS: Record<string, any> = {
  BASIC: {
    maxAdmins: 1,
    maxUsers: 5,
    maxProjects: 5,
    features: {
      aiTickets: 0,
      whatIfMode: false,
      importExport: false,
      prioritySupport: false
    }
  },
  PRO: {
    maxAdmins: 1,
    maxUsers: 20,
    maxProjects: 10,
    features: {
      aiTickets: 50,
      whatIfMode: true,
      importExport: true,
      prioritySupport: false
    }
  },
  MAX: {
    maxAdmins: Infinity,
    maxUsers: Infinity,
    maxProjects: Infinity,
    features: {
      aiTickets: Infinity,
      whatIfMode: true,
      importExport: true,
      prioritySupport: true
    }
  }
};
