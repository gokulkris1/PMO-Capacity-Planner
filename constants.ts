
import { Resource, Project, Allocation, Team, ResourceType, ProjectStatus } from './types';

export const TEAMS: Team[] = [
  { id: 't1', name: 'Programme Management', color: '#6366f1' },
  { id: 't2', name: 'Digital Planning', color: '#ec4899' },
  { id: 't3', name: 'Product Management', color: '#f59e0b' },
  { id: 't4', name: 'Delivery', color: '#10b981' },
  { id: 't5', name: 'Project Management', color: '#3b82f6' },
];

export const MOCK_RESOURCES: Resource[] = [
  // Chapter Lead
  { id: 'r1', name: 'Tom Hayes', role: 'Chapter Lead – Business Delivery', type: ResourceType.PERMANENT, department: 'IE Portfolio & Change Office', teamId: 't1', totalCapacity: 100, email: 'tom.hayes@company.ie', location: 'Dublin' },
  // Programme Managers
  { id: 'r2', name: 'Claire Ryan', role: 'Programme Manager', type: ResourceType.PERMANENT, department: 'IE Portfolio & Change Office', teamId: 't1', totalCapacity: 100, email: 'claire.ryan@company.ie', location: 'Dublin' },
  { id: 'r3', name: 'Agnese Markusevska', role: 'Programme Manager', type: ResourceType.PERMANENT, department: 'IE Portfolio & Change Office', teamId: 't1', totalCapacity: 100, email: 'agnese.m@company.ie', location: 'Dublin' },
  { id: 'r4', name: 'Kerrie Dalton', role: 'Programme Manager', type: ResourceType.PERMANENT, department: 'IE Portfolio & Change Office', teamId: 't1', totalCapacity: 100, email: 'kerrie.dalton@company.ie', location: 'Dublin' },
  // Digital Planning
  { id: 'r5', name: 'Emer Ward', role: 'Digital Planning Lead', type: ResourceType.PERMANENT, department: 'IE Portfolio & Change Office', teamId: 't2', totalCapacity: 100, email: 'emer.ward@company.ie', location: 'Dublin' },
  // Product Managers
  { id: 'r6', name: 'Maria Kelly', role: 'Telephony Product Manager', type: ResourceType.PERMANENT, department: 'IE Portfolio & Change Office', teamId: 't3', totalCapacity: 100, email: 'maria.kelly@company.ie', location: 'Dublin' },
  { id: 'r7', name: 'Mary Vithalani', role: 'Automation Product Manager', type: ResourceType.PERMANENT, department: 'IE Portfolio & Change Office', teamId: 't3', totalCapacity: 100, email: 'mary.vithalani@company.ie', location: 'Dublin' },
  // Scrum Master
  { id: 'r8', name: 'Noma Odigie', role: 'Scrum Master', type: ResourceType.PERMANENT, department: 'IE Portfolio & Change Office', teamId: 't4', totalCapacity: 100, email: 'noma.odigie@company.ie', location: 'Dublin' },
  // Project Managers (added)
  { id: 'r9', name: 'Gokul Gurijala', role: 'Project Manager', type: ResourceType.PERMANENT, department: 'IE Portfolio & Change Office', teamId: 't5', totalCapacity: 100, email: 'gokul.gurijala@company.ie', location: 'Dublin' },
  { id: 'r10', name: 'Linda O\'Dwyer', role: 'Project Manager', type: ResourceType.PERMANENT, department: 'IE Portfolio & Change Office', teamId: 't5', totalCapacity: 100, email: 'linda.odwyer@company.ie', location: 'Dublin' },
];

export const MOCK_PROJECTS: Project[] = [
  { id: 'p1', name: 'Apollo Revamp', status: ProjectStatus.ACTIVE, priority: 'High', description: 'Major UI overhaul of the main customer portal.', startDate: '2026-01-05', endDate: '2026-04-15', budget: 250000, clientName: 'Internal', color: '#6366f1' },
  { id: 'p2', name: 'Skyline API', status: ProjectStatus.ACTIVE, priority: 'Medium', description: 'Internal API modernization project.', startDate: '2026-02-01', endDate: '2026-06-30', budget: 180000, clientName: 'Acme Corp', color: '#3b82f6' },
  { id: 'p3', name: 'Nebula Analytics', status: ProjectStatus.PLANNING, priority: 'Critical', description: 'Next-gen data visualization tool development.', startDate: '2026-05-01', endDate: '2026-10-15', budget: 420000, clientName: 'DataViz Inc', color: '#8b5cf6' },
  { id: 'p4', name: 'Legacy Patching', status: ProjectStatus.ON_HOLD, priority: 'Low', description: 'Ongoing maintenance for v1.0 platforms.', startDate: '2025-11-01', endDate: '2026-03-01', budget: 50000, clientName: 'Internal', color: '#6b7280' },
  { id: 'p5', name: 'Phoenix Mobile', status: ProjectStatus.ACTIVE, priority: 'High', description: 'New React Native mobile app for field teams.', startDate: '2026-01-20', endDate: '2026-07-28', budget: 300000, clientName: 'FieldOps Ltd', color: '#f59e0b' },
  { id: 'p6', name: 'Orion Security', status: ProjectStatus.PLANNING, priority: 'Critical', description: 'Security hardening and compliance audit.', startDate: '2026-03-01', endDate: '2026-05-15', budget: 120000, clientName: 'Compliance Dept', color: '#ef4444' },
];

export const MOCK_ALLOCATIONS: Allocation[] = [
  // Tom Hayes (r1) – Chapter Lead, oversight across projects: 80%
  { id: 'a1', resourceId: 'r1', projectId: 'p1', percentage: 35 },
  { id: 'a2', resourceId: 'r1', projectId: 'p2', percentage: 25 },
  { id: 'a3', resourceId: 'r1', projectId: 'p3', percentage: 20 },
  // Claire Ryan (r2) – 100%
  { id: 'a4', resourceId: 'r2', projectId: 'p1', percentage: 60 },
  { id: 'a5', resourceId: 'r2', projectId: 'p5', percentage: 40 },
  // Agnese Markusevska (r3) – 100%
  { id: 'a6', resourceId: 'r3', projectId: 'p2', percentage: 70 },
  { id: 'a7', resourceId: 'r3', projectId: 'p6', percentage: 30 },
  // Kerrie Dalton (r4) – 90%
  { id: 'a8', resourceId: 'r4', projectId: 'p3', percentage: 60 },
  { id: 'a9', resourceId: 'r4', projectId: 'p4', percentage: 30 },
  // Emer Ward (r5) – 85%
  { id: 'a10', resourceId: 'r5', projectId: 'p1', percentage: 50 },
  { id: 'a11', resourceId: 'r5', projectId: 'p5', percentage: 35 },
  // Maria Kelly (r6) – over-allocated 110%
  { id: 'a12', resourceId: 'r6', projectId: 'p2', percentage: 60 },
  { id: 'a13', resourceId: 'r6', projectId: 'p5', percentage: 50 },
  // Mary Vithalani (r7) – 70%
  { id: 'a14', resourceId: 'r7', projectId: 'p3', percentage: 40 },
  { id: 'a15', resourceId: 'r7', projectId: 'p6', percentage: 30 },
  // Noma Odigie (r8) – over-allocated 115%
  { id: 'a16', resourceId: 'r8', projectId: 'p1', percentage: 40 },
  { id: 'a17', resourceId: 'r8', projectId: 'p2', percentage: 40 },
  { id: 'a18', resourceId: 'r8', projectId: 'p5', percentage: 35 },
  // Gokul Gurijala (r9) – 75%
  { id: 'a19', resourceId: 'r9', projectId: 'p3', percentage: 50 },
  { id: 'a20', resourceId: 'r9', projectId: 'p6', percentage: 25 },
  // Linda O'Dwyer (r10) – 80%
  { id: 'a21', resourceId: 'r10', projectId: 'p4', percentage: 40 },
  { id: 'a22', resourceId: 'r10', projectId: 'p5', percentage: 40 },
];
