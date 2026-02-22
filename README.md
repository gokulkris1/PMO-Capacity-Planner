# PMO Capacity Planner

A comprehensive resource management and capacity planning dashboard for PMOs and Team Leads. The tool features interactive sliders, drag-and-drop allocations, role-based access control (RBAC), AI-driven suggestions, and resource load heatmaps.

## Key Features
- **Interactive UI**: Vertical and horizontal sliders for precise capacity filtering.
- **RBAC**: Multi-user support with PMO (Admin), PM (Editor), and Viewer (Read-only) roles.
- **Visualizations**: Allocation Matrix, Resource Heatmaps, Project Breakdown, and By-Team Heatmap views.
- **What-If Scenarios**: Sandbox mode to simulate reallocations without affecting live data.
- **Risk Scanner**: Automatically flag over-allocated resources and recommend mitigations.
- **AI Advisor**: Gemeni/OpenAI-powered capacity insights directly in a chat widget.
- **Data Import/Export**: End-to-end full CSV import wizard with column mapping and data export functions.

## Tech Stack
- **Frontend**: React 18, Vite, Context API for state management, Vanilla CSS (CSS Variables for theming).
- **Backend**: Node.js, Express.js (protected with Helmet & Rate Limiting), JSON Web Tokens (JWT) for stateless authentication.
- **Database**: Neon PostgreSQL accessed via `pg` node client with raw SQL/connection pooling.
- **Testing**: Jest and Supertest for API integration testing.
- **AI Integrations**: OpenAI Node SDK v4 / Google Gemini API for intelligent capacity advisor.
- **CI/CD**: GitHub Actions for automated linting, testing, and deployment.
- **API Documentation**: Swagger UI (swagger-jsdoc & swagger-ui-express).

## Implementation Architecture
The PMO Capacity Planner follows a modern, decoupled client-server architecture:

1. **Client Layer (React Single Page Application)**
   - Communicates with the backend via REST APIs.
   - Manages state using React Context (e.g., `AuthContext`) and local component state.
   - Securely stores JWT tokens in `localStorage` for persistent sessions.

2. **Server Layer (Express.js REST API)**
   - Acts as an intermediary, validating incoming requests using Zod schemas.
   - Enforces Role-Based Access Control (RBAC) via custom middleware, gating access to specific CRUD operations based on `user.role`.
   - Delegates AI tasks to external LLM providers.

3. **Data Layer (Neon PostgreSQL)**
   - Hosts relational tables for `users`, `resources`, `projects`, and `allocations`.
   - Provides horizontal scalability and seamless connection pooling for serverless environments.

## Environment Variables
Create a `.env` in the root:
```
NEON_DATABASE_URL=postgres://...
JWT_SECRET=your_super_secret_jwt_key
OPENAI_API_KEY=sk-...
PORT=4000
```

## Running Locally
```bash
npm install

# Start frontend (Vite, port 3000) + backend (Express, port 4000) together:
npm run dev:all

# Or separately:
npm run dev      # Frontend only
npm run server   # Backend only
```

Visit `http://localhost:3000` — the app loads with demo data without requiring login.

## Running DB Migrations
```bash
node -e "
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });
Promise.all([
  pool.query(fs.readFileSync('server/migrations_user.sql','utf8')),
  pool.query(fs.readFileSync('server/migrations.sql','utf8'))
]).then(() => { console.log('Migrations OK'); pool.end(); });
"
```

## Swagger API Docs
With backend running: `http://localhost:4000/api-docs`

## Deployment

### Backend → Render.com (Free tier)
1. Go to [render.com](https://render.com) → **New Web Service** → connect GitHub repo
2. Render auto-detects `render.yaml` — click **Deploy**
3. Set environment variables in the Render dashboard:
   - `NEON_DATABASE_URL`, `JWT_SECRET`, `OPENAI_API_KEY`
4. Copy the **Deploy Hook URL** from Render → add as `RENDER_DEPLOY_HOOK_URL` in GitHub Secrets

### Frontend → Vercel (Free tier)
1. Go to [vercel.com](https://vercel.com) → **New Project** → import GitHub repo
2. Framework: **Vite** | Output: `dist`
3. Add env var: `VITE_API_URL` = your Render backend URL
4. Add GitHub Secrets for CI: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`

### GitHub Secrets required
| Secret | Where to get it |
|--------|----------------|
| `NEON_DATABASE_URL` | Neon dashboard → Connection string |
| `JWT_SECRET` | Any long random string |
| `OPENAI_API_KEY` | platform.openai.com |
| `RENDER_DEPLOY_HOOK_URL` | Render → Service → Settings → Deploy Hook |
| `VERCEL_TOKEN` | vercel.com → Settings → Tokens |
| `VERCEL_ORG_ID` | `vercel.json` or Vercel dashboard |
| `VERCEL_PROJECT_ID` | `vercel.json` or Vercel dashboard |

## Pricing
| Plan | Price | Projects | Resources | AI Questions |
|------|-------|----------|-----------|--------------|
| Free | €0 | Demo only | — | — |
| Basic | €29/mo | 1 | 5 | 50 |
| Pro | €79/mo | 10 | 50 | 500 |
| Max | €199/mo | Unlimited | Unlimited | 2,000 |
