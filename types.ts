
export enum ResourceType {
  PERMANENT = 'Permanent',
  CONTRACTOR = 'Contractor'
}

export enum ProjectStatus {
  ACTIVE = 'Active',
  ON_HOLD = 'On Hold',
  PLANNING = 'Planning',
  COMPLETED = 'Completed'
}

export interface Project {
  id: string;
  name: string;
  status: ProjectStatus;
  priority: 'High' | 'Medium' | 'Low';
  description: string;
}

export interface Resource {
  id: string;
  name: string;
  role: string;
  type: ResourceType;
  department: string;
  totalCapacity: number; // usually 100
}

export interface Allocation {
  id: string;
  resourceId: string;
  projectId: string;
  percentage: number;
}

export interface CapacitySummary {
  resourceId: string;
  totalAllocated: number;
  available: number;
}
