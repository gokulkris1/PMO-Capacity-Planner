import {
  Activity,
  CalendarDays,
  CircleUserRound,
  FileChartColumn,
  FolderKanban,
  Gauge,
  Grid3x3,
  LayoutDashboard,
  Map as MapIcon,
  Network,
  Settings,
  Store,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useFeature, useWorkspace } from '../../state';

export interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Path below the workspace base, e.g. 'plan/capacity'. */
  path: string;
}

export interface NavGroup {
  id: string;
  /** Group heading (overline); none for the first group. */
  label: string | null;
  items: NavItem[];
}

/** Areas used for embedded-mode tabs and breadcrumbs. */
export const AREA_LABEL: Record<string, string> = {
  home: 'Home',
  me: 'My plan',
  plan: 'Plan',
  org: 'Organisation',
  delivery: 'Delivery',
  reports: 'Reports',
  settings: 'Settings',
};

const ITEMS = {
  home: { id: 'home', label: 'Home', icon: LayoutDashboard, path: 'home' },
  me: { id: 'me', label: 'My plan', icon: CircleUserRound, path: 'me' },
  capacity: { id: 'capacity', label: 'Capacity Outlook', icon: Gauge, path: 'plan/capacity' },
  demand: { id: 'demand', label: 'Demand', icon: MapIcon, path: 'plan/demand' },
  allocations: { id: 'allocations', label: 'Allocations', icon: Grid3x3, path: 'plan/allocations' },
  marketplace: { id: 'marketplace', label: 'Marketplace', icon: Store, path: 'plan/marketplace' },
  people: { id: 'people', label: 'People', icon: Users, path: 'org/people' },
  projects: { id: 'projects', label: 'Projects', icon: FolderKanban, path: 'org/projects' },
  tribes: { id: 'tribes', label: 'Tribes', icon: Network, path: 'org/tribes' },
  delivery: { id: 'delivery', label: 'Jira & Planview', icon: Activity, path: 'delivery/jira-planview' },
  sprints: { id: 'sprints', label: 'Sprint planning', icon: CalendarDays, path: 'delivery/sprints' },
  reports: { id: 'reports', label: 'Reports', icon: FileChartColumn, path: 'reports' },
  settings: { id: 'settings', label: 'Settings', icon: Settings, path: 'settings' },
} satisfies Record<string, NavItem>;

export const SETTINGS_ITEM: NavItem = ITEMS.settings;

/**
 * The grouped IA (SH-02#AC1, DESIGN_SYSTEM §8.1), filtered by permissions and flags only (AC-04#AC2):
 * Home, [My plan]; Plan; Organisation; Delivery (+ Sprint planning when `qbrSprintModule`); Reports.
 * Settings is pinned at the bottom separately.
 */
export function useNavGroups(): NavGroup[] {
  const { can, workspace } = useWorkspace();
  const sprintModule = useFeature('qbrSprintModule');
  // "My plan" for people linked to a person record, or squad members (own-only write permissions).
  const isSquadMember = can('people.write.own') && !can('people.write');
  const showMyPlan = !!workspace?.linkedPersonId || isSquadMember;
  const groups: NavGroup[] = [
    { id: 'main', label: null, items: [ITEMS.home, ...(showMyPlan ? [ITEMS.me] : [])] },
    { id: 'plan', label: 'Plan', items: [ITEMS.capacity, ITEMS.demand, ITEMS.allocations, ITEMS.marketplace] },
    { id: 'org', label: 'Organisation', items: [ITEMS.people, ITEMS.projects, ITEMS.tribes] },
    { id: 'delivery', label: 'Delivery', items: [ITEMS.delivery, ...(sprintModule ? [ITEMS.sprints] : [])] },
    { id: 'reports', label: 'Reports', items: can('export') ? [ITEMS.reports] : [] },
  ];
  return groups.filter((g) => g.items.length > 0);
}

/** Views per area, shown as underline tabs in embedded mode (SH-02#AC6). */
export function areaViews(area: string, groups: NavGroup[]): NavItem[] {
  const group = groups.find((g) => g.id === area);
  return group ? group.items : [];
}
