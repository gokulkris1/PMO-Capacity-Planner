export type Plan = 'BASIC' | 'PRO' | 'MAX' | 'ENTERPRISE';
export interface Entitlements {
  plan: Plan;
  maxPeople: number | null;        // null = unlimited
  maxProjects: number | null;
  maxWorkspaces: number | null;
  aiQueriesPerMonth: number | null;
  scenarios: boolean;
  csvImport: boolean;
  csvExport: boolean;
  pdfExport: boolean;
  integrations: boolean;
  billingVisible: boolean;
}
export type EntitlementFeature = 'scenarios' | 'csvImport' | 'csvExport' | 'pdfExport' | 'integrations';
export type EntitlementLimit = 'maxPeople' | 'maxProjects' | 'maxWorkspaces' | 'aiQueriesPerMonth';
export const PLAN_ENTITLEMENTS: Record<Plan, Entitlements> = {
  BASIC:      { plan: 'BASIC', maxPeople: 5,  maxProjects: 5,  maxWorkspaces: 1,    aiQueriesPerMonth: 25,  scenarios: false, csvImport: false, csvExport: false, pdfExport: true, integrations: true, billingVisible: true },
  PRO:        { plan: 'PRO',   maxPeople: 20, maxProjects: 10, maxWorkspaces: 3,    aiQueriesPerMonth: 50,  scenarios: true,  csvImport: true,  csvExport: true,  pdfExport: true, integrations: true, billingVisible: true },
  MAX:        { plan: 'MAX',   maxPeople: null, maxProjects: null, maxWorkspaces: null, aiQueriesPerMonth: 1000, scenarios: true, csvImport: true, csvExport: true, pdfExport: true, integrations: true, billingVisible: true },
  ENTERPRISE: { plan: 'ENTERPRISE', maxPeople: null, maxProjects: null, maxWorkspaces: null, aiQueriesPerMonth: null, scenarios: true, csvImport: true, csvExport: true, pdfExport: true, integrations: true, billingVisible: false },
};
export function entitlementsFor(plan: Plan, appMode: 'public' | 'internal'): Entitlements {
  return appMode === 'internal' ? PLAN_ENTITLEMENTS.ENTERPRISE : PLAN_ENTITLEMENTS[plan] ?? PLAN_ENTITLEMENTS.BASIC;
}
export function entitled(e: Entitlements, feature: EntitlementFeature): boolean { return e[feature]; }
/** True when creating one more item keeps the count within the limit. */
export function withinLimit(e: Entitlements, limit: EntitlementLimit, countAfterCreate: number): boolean {
  const max = e[limit];
  return max === null || countAfterCreate <= max;
}
