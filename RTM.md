# PMO Capacity Planner - Requirements Traceability Matrix (v1.1)

This document captures all core requirements provided and implemented up to version 1.1. Design and roadmap: `docs/CURRENT_STATE_AND_ROADMAP.md`.

| Req ID | Requirement Description | Implementation Status | Component / Module |
|---|---|---|---|
| **REQ-001** | **Core Capacity Planning** |
| REQ-001.1 | Add/Edit/Delete Resources (Name, Role, Dept, Available Hours). | ✅ Implemented | `ResourceModal.tsx`, `App.tsx` |
| REQ-001.2 | Add/Edit/Delete Projects (Name, Client/Tribe, Budget, Type). | ✅ Implemented | `ProjectModal.tsx`, `App.tsx` |
| REQ-001.3 | Add/Edit/Delete Allocations (Resource to Project over Time with %). | ✅ Implemented | `AllocationModal.tsx`, `App.tsx` |
| **REQ-002** | **Views & Dashboards** |
| REQ-002.1 | Dashboard metrics (Total Resources, Projects, Over-allocated count). | ✅ Implemented | `Dashboard.tsx` |
| REQ-002.2 | Allocation Matrix (grid view of resources vs projects). | ✅ Implemented | `AllocationMatrix.tsx` |
| REQ-002.3 | By Tribe / Client View (Grouping projects and resources by Tribe). | ✅ Implemented | `TribeView.tsx` |
| REQ-002.4 | By Project View (Drill-down into specific projects). | ✅ Implemented | `ProjectView.tsx` |
| REQ-002.5 | By Resource View (Drill-down into individual capacity). | ✅ Implemented | `ResourceView.tsx` |
| REQ-002.6 | By Team View (Grouping by department/team). | ✅ Implemented | `TeamView.tsx` |
| **REQ-003** | **Time & Forecasting** |
| REQ-003.1 | 6-Month Time Forecasting grid indicating resource availability per month. | ✅ Implemented | `TimeForecastGrid.tsx`, `timeGrid.ts` |
| REQ-003.2 | Infinite forward/back pagination for the time forecast grid. | ✅ Implemented | `TimeForecastGrid.tsx` |
| **REQ-004** | **Data Management & Export** |
| REQ-004.1 | Export Executive Summary to PDF. | ✅ Implemented | `pdfExport.ts` |
| REQ-004.2 | Export raw data to CSV. | ✅ Implemented | `App.tsx` (exportCSV) |
| REQ-004.3 | Import / override data via CSV template. | ✅ Implemented | `ImportCSVModal.tsx` |
| **REQ-005** | **Advanced Planning (What-If)** |
| REQ-005.1 | Sandboxed "What-If" mode to test allocations without affecting live data. | ✅ Implemented | `WhatIfPanel.tsx`, `App.tsx` |
| REQ-005.2 | AI Advisor integration (OpenAI) to provide insights on scenarios. | ✅ Implemented | `geminiService.ts`, `api/ai` |
| **REQ-006** | **Authentication & Security** |
| REQ-006.1 | User Registration & Login with JWT via Neon Postgres. | ✅ Implemented | `auth.ts`, `Login.tsx` |
| REQ-006.2 | Email OTP verification step during User Registration (Resend). | ✅ Implemented | `verify.ts` |
| REQ-006.3 | Two-Factor Authentication (2FA) toggle and enforcement on login. | ✅ Implemented | `auth.ts`, `Login.tsx` |
| REQ-006.4 | Secure "Forgot Password" flow with OTP. | ✅ Implemented | `auth.ts`, `Login.tsx` |
| **REQ-007** | **Multi-Tenant SaaS Architecture** |
| REQ-007.1 | URL-Based Routing (`/o/:orgSlug`) using `react-router-dom`. | ✅ Implemented | `App.tsx`, `index.tsx` |
| REQ-007.2 | Workspace Provisioning (Org creation and user binding). | ✅ Implemented | `org_create.ts` |
| REQ-007.3 | Hardened Data layer scoping all database operations by `org_id`. | ✅ Implemented | `workspace.ts` |
| REQ-007.4 | Role-Based Access Control (RBAC): Free users/Viewers restricted from editing (Write locks). | ✅ Implemented | `App.tsx` (authGate) |
| **REQ-008** | **Monetization & Limits** |
| REQ-008.1 | Freemium Model (Limit 5 resources, 1 project on Free plan). | ✅ Implemented | `workspace.ts` |
| REQ-008.2 | Feature Flagging UI differences based on `VITE_APP_MODE` (public vs internal). | ✅ Implemented | `App.tsx` |
| REQ-008.3 | Stripe hosted checkout integration for tier upgrades (Basic, Pro, Max). | ✅ Implemented | `checkout.ts`, `PricingPage.tsx` |
| REQ-008.4 | Stripe webhook implementation to automatically upgrade organizational plans in Postgres. | ✅ Implemented | `webhook.ts` |
| REQ-008.5 | Transactional Email Receipts via Resend (Welcome & Upgrade emails). | ✅ Implemented | `email_receipt.ts` |
| **REQ-009** | **Integrations** |
| REQ-009.1 | Jira Cloud connection with server-side encrypted credentials, story-points field auto-detection, usage by project/sprint/assignee/quarter. | ✅ Implemented (v1.1) | `netlify/functions/integrations.ts`, `IntegrationsHub.tsx` |
| REQ-009.2 | Per-tribe story point → capacity calibration and a planned-vs-implied FTE "delivery signal". | ✅ Implemented (v1.1) | `IntegrationsHub.tsx` (Calibration tab) |
| REQ-009.3 | Planview connection (AdaptiveWork REST v2 and generic REST/OData adapter), project import and assignment import into allocations. | ✅ Implemented (v1.1) | `integrations.ts`, `IntegrationsHub.tsx` |
| **REQ-010** | **PMO Crafts & Demand (v1.1)** |
| REQ-010.1 | Capture per individual an above-the-table (primary) craft and below-the-table (secondary) crafts with proficiency and capacity cap. | ✅ Implemented | `types.ts`, `Modals.tsx` (ResourceModal), `CraftProfilesView.tsx` |
| REQ-010.2 | Record the craft performed on every allocation. | ✅ Implemented | `AllocationModal.tsx`, `workspace.ts` |
| REQ-010.3 | Rolling four-quarter view (QBR1–QBR4) of each person's above/below-the-table load and bench. | ✅ Implemented | `utils/quarters.ts`, `utils/craftEngine.ts`, `CraftProfilesView.tsx` |
| REQ-010.4 | Project requirement roadmap: stage, initiation date and anticipated craft demand (FTE) per quarter, with staffed vs gap. | ✅ Implemented | `DemandRoadmapView.tsx`, `Modals.tsx` (ProjectModal) |
| REQ-010.5 | Supply vs demand per craft per quarter including secondary-craft reach. | ✅ Implemented | `craftEngine.ts` (`craftBalance`), `DemandRoadmapView.tsx` |
| REQ-010.6 | Squad marketplace: open demand, ranked match suggestions, one-click proposal; service catalogue of what the squad can offer each tribe. | ✅ Implemented | `SquadMarketplaceView.tsx`, `craftEngine.ts` (`suggestMatches`) |
| REQ-010.7 | Utilisation outlook towards 100% target: four-quarter capacity vs demand, under-used and strained people, by person/team/tribe. | ✅ Implemented | `UtilisationView.tsx` |
| REQ-010.8 | Persist craft profile, demand, stage and links per workspace. | ✅ Implemented | `workspace.ts`, `scripts/migrate_crafts.sql` |
| REQ-010.9 | AI advisor aware of crafts, outlook and open demand. | ✅ Implemented | `services/geminiService.ts` |
| **REQ-011** | **Defect fixes (v1.1)** |
| REQ-011.1 | QBR module readable on the light theme; scenario bookings refresh; quarter selection stable; errors surfaced. | ✅ Fixed | `components/qbr/*` |
| REQ-011.2 | Remove unreachable Jira modal and localStorage-stored API tokens. | ✅ Fixed | `App.tsx`, `netlify/functions/jira.ts` (410) |
| REQ-011.3 | Dashboard trend derived from data (QBR1 → QBR2), not hard-coded. | ✅ Fixed | `Dashboard.tsx` |
