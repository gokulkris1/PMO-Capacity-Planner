# PMO Capacity Planner - Requirements Traceability Matrix (v1.0)

This document captures all core requirements provided and implemented up to version 1.0.

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
| REQ-009.1 | Jira Mock Integration UI to simulate importing from external boards. | ✅ Implemented | `JiraImportModal.tsx` |
