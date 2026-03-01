
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
  | 'by-skills'
  | 'by-team'
  | 'by-tribe'
  | 'what-if'
  | 'qbr';

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
  teamName?: string;
  skills?: string[];
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

/* ═══════════════════════════════════════════════════════════════
   QBR Planning Module Types
   ═══════════════════════════════════════════════════════════════ */

export type QBRMemberType = 'INTERNAL' | 'VENDOR' | 'CONTRACTOR';
export type QBROKRLevel = 'LEADERSHIP' | 'TRIBE' | 'COE';
export type QBRSquadRole = 'LEAD' | 'MEMBER' | 'ADVISOR';

export interface QBRTribe {
  id: string;
  name: string;
  description?: string;
  lead_name?: string;
  color: string;
  member_count?: number;
  squad_count?: number;
}

export interface QBRChapter {
  id: string;
  name: string;
  description?: string;
  lead_name?: string;
  color: string;
  member_count?: number;
}

export interface QBRCoE {
  id: string;
  name: string;
  description?: string;
  lead_name?: string;
  color: string;
  member_count?: number;
}

export interface QBRQuarter {
  id: string;
  label: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
  sprints: QBRSprint[];
}

export interface QBRSprint {
  id: string;
  quarter_id: string;
  sprint_number: number;
  label: string;
  start_date: string;
  end_date: string;
}

export interface QBRMember {
  id: string;
  name: string;
  email?: string;
  role_title?: string;
  tribe_id?: string;
  tribe_name?: string;
  chapter_id?: string;
  chapter_name?: string;
  coe_id?: string;
  coe_name?: string;
  member_type: QBRMemberType;
  daily_rate?: number;
  skills?: string[];
  avatar_color: string;
  total_capacity: number;
  bookings?: QBRBooking[];
}

export interface QBROKR {
  id: string;
  title: string;
  description?: string;
  level: QBROKRLevel;
  parent_okr_id?: string;
  tribe_id?: string;
  tribe_name?: string;
  quarter_id?: string;
  progress: number;
  children?: QBROKR[];
  projects?: QBRProject[];
}

export interface QBRProject {
  id: string;
  name: string;
  description?: string;
  tribe_id?: string;
  tribe_name?: string;
  okr_id?: string;
  okr_title?: string;
  status: 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED';
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  start_quarter_id?: string;
  end_quarter_id?: string;
  color: string;
}

export interface QBRSquad {
  id: string;
  name: string;
  tribe_id?: string;
  tribe_name?: string;
  project_id?: string;
  project_name?: string;
  okr_id?: string;
  members: QBRSquadMember[];
}

export interface QBRSquadMember {
  id: string;
  member_id: string;
  member_name: string;
  squad_role: QBRSquadRole;
  chapter_name?: string;
  tribe_name?: string;
  coe_name?: string;
  member_type: QBRMemberType;
}

export interface QBRBooking {
  id: string;
  member_id: string;
  member_name?: string;
  project_id: string;
  project_name?: string;
  project_color?: string;
  sprint_id: string;
  sprint_number?: number;
  percentage: number;
  scenario_id?: string;
  notes?: string;
}

export interface QBRScenario {
  id: string;
  name: string;
  description?: string;
  quarter_id: string;
  is_committed: boolean;
  created_by?: string;
  created_at?: string;
  bookings?: QBRBooking[];
}
