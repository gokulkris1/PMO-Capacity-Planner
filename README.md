# PMO Capacity Planner (v1.0 SaaS Edition) 🚀

The **PMO Capacity Planner** is an enterprise-grade, Multi-Tenant SaaS platform built to intelligently manage organizational resources, visualize cross-project allocations, and predict future capacity constraints utilizing AI and real-time interactive matrices.

![App Screenshot](./public/screenshot.png)

## 🌟 Core Capabilities & Features

### 1. 🏢 Multi-Tenant SaaS Environments
- **Dedicated Workspaces:** Each registered organization gets an isolated cryptographic container defined by a unique `orgSlug` and secured via `org_id` context routing.
- **Role-Based Access Control (RBAC):** Strict front-end and back-end gating. Viewers cannot mutate data; SuperAdmins manage billing and global settings.
- **Freemium Limits Engine:** Cloud-enforced quotas rejecting allocations beyond the active Stripe Tier limits (`Basic`, `Pro`, `Max`).

### 2. 📅 Interactive Allocation Matrix & Time Forecasting
- **Visual Capacity Grid:** Instantly identifiable RGB status badges (Red = Over, Yellow = High, Green = Optimal).
- **6-Month Rolling Forecasts:** Predictive resource timeline highlighting critical drops in utilization mapping out to future quarters.
- **Tribe & Client Grouping:** Deep dive grouping functionality allowing management to analyze bandwidth exclusively for a specific business vertical or client.

### 3. 🛡️ Advanced Security & Identity
- **Two-Factor Authentication (2FA):** Opt-in 6-digit email OTP enforcement injected cleanly into the login verification lifecycle.
- **Post-Exploitation Prevention:** Rate limited Auth routes, BCrypt hashed passwords, short-lived JSON Web Tokens (JWT).
- **Stripe & Resend Integration:** Webhook driven Postgres tier upgrades connected firmly to Stripe Checkout. Automated transactional HTML receipts triggered upon provisioning.

### 4. 🔬 Scenario Planning & AI Guidance
- **What-If "Sandbox" Mode:** Toggle a temporary state to drag, drop, and edit allocations without affecting live production data.
- **AI Analytics Sidebar:** Conversational LLM assistant natively hooked to your specific Workspace capacity matrix to provide real-time leveling advice and risk assessments.

## 🛠️ Tech Stack Architecture

- **Frontend:** React 18, Vite, TypeScript, React Router Dom, Vanilla CSS Framework.
- **Backend:** Netlify Edge Serverless Functions (`auth`, `workspace`, `webhook`, `org_create`, `email_receipt`).
- **Database:** Neon serverless PostgreSQL (JSON Web Token verified Row-Level queries).
- **Integrations:** Stripe (Billing), Resend (Transactional Email), OpenAI/Gemini (Intelligence).

## 🚀 Getting Started (Ways of Working)

### Prerequisites

You need `Node.js` (v18+) and a configured `Neon` Postgres Database instance. Ensure the following `.env` is populated:

```env
NEON_DATABASE_URL=postgres://user:password@hostname/dbname
JWT_SECRET=your_super_secret_jwt_key
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
RESEND_API_KEY=re_...
OPENAI_API_KEY=sk-...
VITE_APP_MODE=public # Set to 'internal' for local sample data injection bypassing Stripe limits
```

### Local Development

This project utilizes `concurrently` to multiplex the Vite frontend and local Node.js serverless proxy.

```bash
# Install dependencies
npm install

# Run backend migrations (only needed once)
npm run migrate

# Start the full stack locally
npm run dev:all
```
The application will boot at `http://localhost:5173`.

## 🚢 Deployment

The repository relies on a unified Netlify continuous deployment bridge. Pushing to `main` automatically fires `npm run build`, bundling the Vite front end and deploying the nested `netlify/functions` directory as API endpoints conforming to the `netlify.toml` redirect proxies.

## 📈 Roadmap (v1.1 Branch)
- Jira & Azure DevOps active sync integrations.
- Granular daily allocation precision (currently Monthly fractional %).
- Financial burn-rate overlays intersecting with capacity levels.
