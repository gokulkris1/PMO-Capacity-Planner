/**
 * Route → lazy page module (SH-01, SH-08). Every page is its own chunk.
 */
import { lazy } from 'react';

// ---- Product pages (pages/home|me|plan|org|delivery|reports/**) ----------------------------------------
export const B2_PAGES = {
  home: lazy(() => import('../../pages/home/HomePage')),
  myPlan: lazy(() => import('../../pages/me/MyPlanPage')),
  capacity: lazy(() => import('../../pages/plan/capacity/CapacityOutlookPage')),
  demand: lazy(() => import('../../pages/plan/demand/DemandPage')),
  allocations: lazy(() => import('../../pages/plan/allocations/AllocationsPage')),
  marketplace: lazy(() => import('../../pages/plan/marketplace/MarketplacePage')),
  people: lazy(() => import('../../pages/org/people/PeoplePage')),
  projects: lazy(() => import('../../pages/org/projects/ProjectsPage')),
  tribes: lazy(() => import('../../pages/org/tribes/TribesPage')),
  /** Route /org/tribes/:tribeId */
  tribe: lazy(() => import('../../pages/org/tribes/TribeDetailPage')),
  delivery: lazy(() => import('../../pages/delivery/jira-planview/DeliveryPage')),
  sprints: lazy(() => import('../../pages/delivery/sprints/SprintsPage')),
  reports: lazy(() => import('../../pages/reports/ReportsPage')),
};

// ---- Auth, settings, admin and system pages ------------------------------------------------------------
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
