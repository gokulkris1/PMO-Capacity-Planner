/**
 * Route → lazy page module (SH-01, SH-08). Every page is its own chunk.
 *
 * ┌──────────────────────────────────────────────────────────────────────────────────────────────┐
 * │ INTEGRATION (package I): the B2 entries below point at RoutePlaceholder until B2's pages are   │
 * │ merged. Replace each `placeholder({...})` call with the import shown in its comment — one line │
 * │ per route. B2 pages default-export their component. Nothing else in the router changes.       │
 * └──────────────────────────────────────────────────────────────────────────────────────────────┘
 */
import { lazy } from 'react';
import { placeholder } from './RoutePlaceholder';

// ---- B2-owned pages (pages/home|me|plan|org|delivery|reports/**) ------------------------------------
export const B2_PAGES = {
  // INTEGRATE: lazy(() => import('../../pages/home/HomePage'))
  home: lazy(() => placeholder({ title: 'Home', story: 'RP-01', module: 'pages/home/HomePage.tsx' })),
  // INTEGRATE: lazy(() => import('../../pages/me/MyPlanPage'))
  myPlan: lazy(() => placeholder({ title: 'My plan', story: 'PPL-05', module: 'pages/me/MyPlanPage.tsx' })),
  // INTEGRATE: lazy(() => import('../../pages/plan/CapacityOutlookPage'))
  capacity: lazy(() =>
    placeholder({
      title: 'Capacity Outlook',
      area: 'Plan',
      story: 'RP-02',
      module: 'pages/plan/CapacityOutlookPage.tsx',
    }),
  ),
  // INTEGRATE: lazy(() => import('../../pages/plan/DemandPage'))
  demand: lazy(() =>
    placeholder({ title: 'Demand', area: 'Plan', story: 'DM-02', module: 'pages/plan/DemandPage.tsx' }),
  ),
  // INTEGRATE: lazy(() => import('../../pages/plan/AllocationsPage'))
  allocations: lazy(() =>
    placeholder({ title: 'Allocations', area: 'Plan', story: 'AL-01', module: 'pages/plan/AllocationsPage.tsx' }),
  ),
  // INTEGRATE: lazy(() => import('../../pages/plan/MarketplacePage'))
  marketplace: lazy(() =>
    placeholder({ title: 'Marketplace', area: 'Plan', story: 'DM-03/04', module: 'pages/plan/MarketplacePage.tsx' }),
  ),
  // INTEGRATE: lazy(() => import('../../pages/org/PeoplePage'))
  people: lazy(() =>
    placeholder({ title: 'People', area: 'Organisation', story: 'PPL-01/02', module: 'pages/org/PeoplePage.tsx' }),
  ),
  // INTEGRATE: lazy(() => import('../../pages/org/ProjectsPage'))
  projects: lazy(() =>
    placeholder({ title: 'Projects', area: 'Organisation', story: 'PPL-07', module: 'pages/org/ProjectsPage.tsx' }),
  ),
  // INTEGRATE: lazy(() => import('../../pages/org/TribesPage'))
  tribes: lazy(() =>
    placeholder({ title: 'Tribes', area: 'Organisation', story: 'ORG-05', module: 'pages/org/TribesPage.tsx' }),
  ),
  // INTEGRATE: lazy(() => import('../../pages/org/TribePage'))   (route /org/tribes/:tribeId)
  tribe: lazy(() =>
    placeholder({ title: 'Tribe', area: 'Organisation', story: 'ORG-05', module: 'pages/org/TribePage.tsx' }),
  ),
  // INTEGRATE: lazy(() => import('../../pages/delivery/DeliveryPage'))
  delivery: lazy(() =>
    placeholder({
      title: 'Jira & Planview',
      area: 'Delivery',
      story: 'JI-*, PV-01',
      module: 'pages/delivery/DeliveryPage.tsx',
    }),
  ),
  // INTEGRATE: lazy(() => import('../../pages/delivery/sprints/SprintPlanningPage'))
  sprints: lazy(() =>
    placeholder({
      title: 'Sprint planning',
      area: 'Delivery',
      story: 'SH-05',
      module: 'pages/delivery/sprints/SprintPlanningPage.tsx',
    }),
  ),
  // INTEGRATE: lazy(() => import('../../pages/reports/ReportsPage'))
  reports: lazy(() => placeholder({ title: 'Reports', story: 'RP-04', module: 'pages/reports/ReportsPage.tsx' })),
};

// ---- B1-owned pages ----------------------------------------------------------------------------------
export const AUTH_PAGES = {
  login: lazy(() => import('../../pages/auth/LoginPage')),
  register: lazy(() => import('../../pages/auth/RegisterPage')),
  reset: lazy(() => import('../../pages/auth/ResetPasswordPage')),
  verifyEmail: lazy(() => import('../../pages/auth/VerifyEmailPage')),
  invite: lazy(() => import('../../pages/auth/AcceptInvitePage')),
  createOrg: lazy(() => import('../../pages/auth/CreateOrgPage')),
};

export const SETTINGS_PAGES = {
  layout: lazy(() => import('../../pages/settings/SettingsLayout')),
  profile: lazy(() => import('../../pages/settings/ProfileSettings')),
  organisation: lazy(() => import('../../pages/settings/OrganisationSettings')),
  members: lazy(() => import('../../pages/settings/MembersSettings')),
  structure: lazy(() => import('../../pages/settings/StructureSettings')),
  crafts: lazy(() => import('../../pages/settings/CraftsSettings')),
  planning: lazy(() => import('../../pages/settings/PlanningSettings')),
  integrations: lazy(() => import('../../pages/settings/IntegrationsSettings')),
  features: lazy(() => import('../../pages/settings/FeaturesSettings')),
  billing: lazy(() => import('../../pages/settings/BillingSettings')),
};

export const ADMIN_PAGES = {
  cockpit: lazy(() => import('../../pages/admin/CockpitPage')),
};

export const SYSTEM_PAGES = {
  /** Development-only component gallery (…/w/:ws/kit). */
  kit: lazy(() => import('../../pages/system/KitGallery')),
};
