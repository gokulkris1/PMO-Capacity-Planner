
export enum ResourceType {
  PERMANENT = 'Permanent',
  CONTRACTOR = 'Contractor',
  PART_TIME = 'Part-Time',
}

export enum ProjectStatus {
  ACTIVE = 'Active',
  ON_HOLD = 'On Hold',
  PLANNING = 'Planning',
  COMPLETED = 'Completed',
}

export enum AllocationStatus {
  UNDER = 'Under',
  OPTIMAL = 'Optimal',
  HIGH = 'High',
  OVER = 'Over',
}

export type Priority = 'Critical' | 'High' | 'Medium' | 'Low';

export type ViewTab =
  | 'dashboard'
  | 'allocations'
  | 'by-project'
  | 'by-resource'
  | 'by-team'
  | 'what-if';

export interface Team {
  id: string;
  name: string;
  color: string; // hex or tailwind-style
}

export interface Resource {
  id: string;
  name: string;
  role: string;
  type: ResourceType;
  department: string;
  teamId?: string;
  totalCapacity: number; // usually 100
  avatarInitials?: string;
  email?: string;
  location?: string;
  dailyRate?: number; // optional cost per day in EUR/USD
}

export interface Project {
  id: string;
  name: string;
  status: ProjectStatus;
  priority: Priority;
  description: string;
  startDate?: string; // ISO date string
  endDate?: string;   // ISO date string
  budget?: number;
  clientName?: string;
  color?: string;
}

export interface Allocation {
  id: string;
  resourceId: string;
  projectId: string;
  percentage: number;
  startDate?: string;
  endDate?: string;
  notes?: string;
}

export interface WhatIfScenario {
  id: string;
  name: string;
  description: string;
  allocations: Allocation[];
  createdAt: string;
}

export interface CapacitySummary {
  resourceId: string;
  totalAllocated: number;
  available: number;
  status: AllocationStatus;
}

export function getAllocationStatus(pct: number): AllocationStatus {
  if (pct > 100) return AllocationStatus.OVER;
  if (pct >= 80) return AllocationStatus.HIGH;
  if (pct >= 60) return AllocationStatus.OPTIMAL;
  return AllocationStatus.UNDER;
}

export function getStatusColor(status: AllocationStatus): string {
  switch (status) {
    case AllocationStatus.OVER: return '#ef4444';
    case AllocationStatus.HIGH: return '#f59e0b';
    case AllocationStatus.OPTIMAL: return '#10b981';
    case AllocationStatus.UNDER: return '#6b7280';
  }
}
