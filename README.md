# PMO Capacity Planner

A comprehensive, enterprise-grade resource management and capacity planning dashboard designed for PMOs, Delivery Managers, and Team Leads. The platform enables organizations to forecast capacity, allocate personnel, optimize utilization rates, and generate C-Suite executive summaries.

## 🚀 Key Features

### 1. Advanced Resource & Project Management
- **Interactive Matrix View**: A powerful allocation matrix allowing precise percentage allocations of resources across multiple projects.
- **Dynamic Dashboards**: Real-time roll-ups of committed FTEs, estimated monthly costs, and availability metrics.
- **"What-If" Scenario Engine**: A dedicated sandbox mode to safely simulate team reallocations and project shifts without affecting live production data.

### 2. Enterprise-Grade Architecture
- **Multi-Tenant Postgres Sync**: Built on a highly-scalable Neon PostgreSQL serverless architecture. Your entire PMO workspace (`resources`, `projects`, `allocations`) is decoupled from local storage and continuously synced to the cloud via debounced background processes.
- **Role-Based Access Control (RBAC)**: Secure multi-tier access supporting **SUPERUSER**, **PMO** (Admin), **PM** (Editor), and **VIEWER** (Read-only) roles.
- **Superuser Console**: A dedicated backend-powered dashboard for super admins to monitor platform MRR, manage organizations, grant licenses, and audit usage.

### 3. AI PMO Director (OpenAI)
- **Context-Aware Analytics**: Powered by OpenAI's `gpt-4o-mini`, the AI Advisor analyzes your live matrix (resources, utilizations, project commits) to act as a proactive Senior PMO Director.
- **Resource Smoothing**: Automatically identifies over-allocated personnel and suggests specific, named reallocations from your under-utilized pool.
- **Scaling Forecaster**: Highlights when your aggregate utilization necessitates hiring contractors to hit specific project timelines.

### 4. Board-Ready Reporting
- **Executive Summary PDF**: Native, one-click PDF generation utilizing `jsPDF` and `jspdf-autotable`.
- Instantly packages Portfolio Metrics (FTEs, Run Rate Cost), an Over-Allocation Risk Scanner, and a Project Capacity Breakdown into a branded, beautiful one-pager for stakeholders.

### 5. Seamless Authentication
- **Secure JWT Flow**: Email and password authentication secured by `bcrypt` and JWT.
- **Email Verification**: One-Time Password (OTP) validation strictly via email on signup (powered by Resend) to eliminate spam while preserving a frictionless B2B login experience.

---

## 🛠 Tech Stack

The PMO Capacity Planner follows a modern, decoupled serverless architecture optimized for Netlify:

### Frontend
- **Framework**: React 18 & Vite
- **Language**: TypeScript
- **Styling**: Vanilla CSS with CSS Variables for theme control (no heavy frameworks).
- **PDF Generation**: `jspdf` & `jspdf-autotable`

### Backend (Serverless)
- **Infrastructure**: Netlify Functions (`@netlify/functions`)
- **Database**: Neon PostgreSQL Serverless (`@neondatabase/serverless`) executing raw SQL tagged templates.
- **Authentication**: `jsonwebtoken` and `bcryptjs`
- **Email Provider**: Resend API
- **AI Integration**: OpenAI REST API (Standard HTTP layer to minimize bundle size).

---

## ⚙️ Environment Variables

To run the application, configure your environment variables in Netlify (or a local `.env` file):

| Key | Description | Required? |
|-----|-------------|-----------|
| `JWT_SECRET` | A secure, random string used to sign authentication tokens. | **Yes** |
| `NEON_DATABASE_URL` | The Neon connection string (`postgres://...`). | **Yes** |
| `SUPER_ADMIN_EMAIL` | The email address that is automatically granted the `SUPERUSER` system role upon login. | **Yes** |
| `VITE_OPENAI_API_KEY` | Your OpenAI secret key (`sk-...`) for the AI Advisor. | **Yes** |
| `RESEND_API_KEY` | Your Resend API key for OTP signup verification. | Optional* |

*\*If `RESEND_API_KEY` is omitted, the Netlify Function falls back to "dev mode" and will return the OTP directly in the API response payload.*

---

## 💻 Local Development

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure your `.env` file** in the root directory using the keys listed above.

3. **Start the environment:**
   We use `netlify-cli` to accurately mirror the production serverless routing and function execution:
   ```bash
   # Install the Netlify CLI globally if you haven't already
   npm install -g netlify-cli

   # Run the unified dev server (Frontend Vite + Backend Netlify Functions)
   netlify dev
   ```

4. **Access the App:** Open `http://localhost:8888`. Unauthenticated users will see the public "Demo Mode" with mock data.

---

## 🚀 Deployment (Netlify)

This project is optimized for a unified deployment on **Netlify** (both the React frontend and the serverless API).

1. Push your repository to GitHub.
2. In Netlify, select **Add new site** -> **Import an existing project**.
3. Choose your GitHub repository.
4. **Build Settings** (Automatically detected via `netlify.toml`):
   - **Build command**: `npm run build`
   - **Publish directory**: `dist`
   - **Functions directory**: `netlify/functions`
5. Add your environment variables under **Site Settings -> Environment Variables**.
6. Click **Deploy Site**.

*Routing for the SPA (`/*`) and API Functions (`/api/*`) are handled automatically by the included `netlify.toml`.*
