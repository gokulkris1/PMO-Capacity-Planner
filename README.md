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
Create a `.env` in the root and add the following:
```
NEON_DATABASE_URL=postgres://...
JWT_SECRET=your_super_secret_jwt_key
OPENAI_API_KEY=sk-...
PORT=4000
```

## Running Locally
1. Install everything: `npm install`
2. Start the dev server: `npm run dev`
3. Run backend tests: `npm test`

## Swagger API Documentation
Once the server is running on port 4000, visit `http://localhost:4000/api-docs` to interact with the API definition via Swagger UI.

## Deployment
This repository includes a `.github/workflows/deploy.yml` configured for automatic CI testing and build generation. You can deploy the frontend to Vercel/Netlify and the Node process to your cloud provider of choice.
