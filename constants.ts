
import { Resource, Project, Allocation, ResourceType, ProjectStatus } from './types';

export const MOCK_RESOURCES: Resource[] = [
  { id: 'r1', name: 'Sarah Chen', role: 'Full Stack Dev', type: ResourceType.PERMANENT, department: 'Engineering', totalCapacity: 100 },
  { id: 'r2', name: 'James Wilson', role: 'UI/UX Designer', type: ResourceType.PERMANENT, department: 'Design', totalCapacity: 100 },
  { id: 'r3', name: 'Maria Garcia', role: 'Project Manager', type: ResourceType.CONTRACTOR, department: 'PMO', totalCapacity: 100 },
  { id: 'r4', name: 'David Kim', role: 'QA Lead', type: ResourceType.PERMANENT, department: 'QA', totalCapacity: 100 },
  { id: 'r5', name: 'Emma Thompson', role: 'Backend Engineer', type: ResourceType.CONTRACTOR, department: 'Engineering', totalCapacity: 100 },
  { id: 'r6', name: 'Liam O’Brien', role: 'DevOps Specialist', type: ResourceType.PERMANENT, department: 'Engineering', totalCapacity: 100 },
];

export const MOCK_PROJECTS: Project[] = [
  { id: 'p1', name: 'Apollo Revamp', status: ProjectStatus.ACTIVE, priority: 'High', description: 'Major UI overhaul of the main customer portal.', startDate: '2026-01-05', endDate: '2026-04-15' },
  { id: 'p2', name: 'Skyline API', status: ProjectStatus.ACTIVE, priority: 'Medium', description: 'Internal API modernization project.', startDate: '2026-02-01', endDate: '2026-06-30' },
  { id: 'p3', name: 'Nebula Analytics', status: ProjectStatus.PLANNING, priority: 'High', description: 'Next-gen data visualization tool development.', startDate: '2026-05-01', endDate: '2026-10-15' },
  { id: 'p4', name: 'Legacy Patching', status: ProjectStatus.ON_HOLD, priority: 'Low', description: 'Ongoing maintenance for v1.0 platforms.', startDate: '2025-11-01', endDate: '2026-03-01' },
];

export const MOCK_ALLOCATIONS: Allocation[] = [
  { id: 'a1', resourceId: 'r1', projectId: 'p1', percentage: 60 },
  { id: 'a2', resourceId: 'r1', projectId: 'p2', percentage: 40 },
  { id: 'a3', resourceId: 'r2', projectId: 'p1', percentage: 100 },
  { id: 'a4', resourceId: 'r3', projectId: 'p1', percentage: 30 },
  { id: 'a5', resourceId: 'r3', projectId: 'p3', percentage: 70 },
  { id: 'a6', resourceId: 'r4', projectId: 'p2', percentage: 50 },
  { id: 'a7', resourceId: 'r5', projectId: 'p2', percentage: 100 },
  { id: 'a8', resourceId: 'r6', projectId: 'p3', percentage: 80 },
];
