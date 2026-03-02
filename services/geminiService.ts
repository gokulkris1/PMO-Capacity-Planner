/// <reference types="vite/client" />
import { Resource, Project, Allocation } from "../types";

import { User, WorkspaceInfo, WorkspaceRole } from "../context/AuthContext";

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY || '';

function buildSystemPrompt(
  resources: Resource[],
  projects: Project[],
  allocations: Allocation[],
  user: User | null,
  activeWorkspace: WorkspaceInfo | null,
  workspaceRole: WorkspaceRole | null
): string {
  const resourceSummary = resources.map(r => {
    const rAllocs = allocations.filter(a => a.resourceId === r.id);
    const totalPct = rAllocs.reduce((s, a) => s + a.percentage, 0);
    const projectNames = rAllocs.map(a => {
      const p = projects.find(pr => pr.id === a.projectId);
      return p ? `${p.name}(${a.percentage}%)` : null;
    }).filter(Boolean).join(', ');
    return `  - ${r.name} | Dept: ${r.department} | Role: ${r.role} | Utilisation: ${totalPct}%${totalPct > 100 ? ' ⚠️ OVER' : totalPct < 50 ? ' (under-used)' : ''} | Projects: ${projectNames || 'unassigned'}`;
  }).join('\n');

  const projectSummary = projects.map(p => {
    const pAllocs = allocations.filter(a => a.projectId === p.id);
    const assignedResources = pAllocs.map(a => {
      const r = resources.find(res => res.id === a.resourceId);
      return r ? `${r.name}(${a.percentage}%)` : null;
    }).filter(Boolean).join(', ');
    return `  - ${p.name} | Status: ${p.status || 'active'} | Priority: ${p.priority} | Team: ${assignedResources || 'none assigned'}`;
  }).join('\n');

  const overAllocated = resources.filter(r =>
    allocations.filter(a => a.resourceId === r.id).reduce((s, a) => s + a.percentage, 0) > 100
  );
  const unassigned = resources.filter(r =>
    allocations.filter(a => a.resourceId === r.id).length === 0
  );

  const isAdmin = user?.role === 'SUPERUSER' || user?.role === 'ORG_ADMIN' || workspaceRole === 'PMO_ADMIN' || workspaceRole === 'WORKSPACE_OWNER';

  const roleDirectives = isAdmin
    ? `Since the user is an Executive/Admin, you MAY provide explicit financial reallocation advice, strategic organizational shifts, and unconstrained insights across all departments.`
    : `Since the user is a standard Viewer/Editor, STRICTLY RESTRICT your advice to tactical team resource capacity. DO NOT advise on financial budgets, organization-wide strategy changes, or sensitive management decisions.`;

  return `You are Orbit AI, an elite PMO Strategic Advisor. The user asking for your advice is "${user?.name || user?.email || 'Unknown User'}", who holds the role of ${user?.role || 'User'} in the organization "${activeWorkspace?.org_name || 'Organization'}" (Workspace: "${activeWorkspace?.name || 'Workspace'}").

📊 LIVE PORTFOLIO DATA FOR THEIR WORKSPACE:
RESOURCES & ALLOCATIONS:
${resourceSummary || '  (No resources yet)'}

PROJECTS:
${projectSummary || '  (No projects yet)'}

BURN & RISK METRICS:
- Over-allocated Risks: ${overAllocated.length} individuals (${overAllocated.map(r => r.name).join(', ') || 'none'})
- Bench / Unutilized: ${unassigned.length} individuals (${unassigned.map(r => r.name).join(', ') || 'none'})

🎯 YOUR DIRECTIVES:
1. DELIVER HARD TRUTHS: Be direct, analytical, and executive. Do not use fluff. Address the user directly by their name occasionally.
2. ROLE AWARENESS: ${roleDirectives}
3. SYNTHESIZE, DON'T REGURGITATE: Formulate a strategic thesis before answering. If someone is over-allocated, specifically suggest WHO on the bench can take their load based on matching roles/departments.
4. ALIGN WITH PRIORITIES: Call out strategic misalignment if low-priority projects consume critical resources.
5. FORMATTING: Use Markdown flawlessly. Use *Bold* for names and projects. Use clear headers.

Respond strictly to the user's prompt using the data above. If their query is general ("How are we doing?"), provide a comprehensive health check and reallocation roadmap.`;
}

export const getCapacityInsights = async (
  resources: Resource[],
  projects: Project[],
  allocations: Allocation[],
  userPrompt: string,
  user: User | null,
  activeWorkspace: WorkspaceInfo | null,
  workspaceRole: WorkspaceRole | null
): Promise<string> => {
  const token = localStorage.getItem('pcp_token');

  if (!token) {
    return "You must be logged in to use the AI Advisor.";
  }

  try {
    const systemPrompt = buildSystemPrompt(resources, projects, allocations, user, activeWorkspace, workspaceRole);

    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ systemPrompt, userPrompt })
    });

    const data = await res.json();

    if (!res.ok) {
      if (res.status === 429) {
        // Explicitly return the Quota string
        return `⚠️ ${data.error || 'AI Quota limit reached. Please upgrade to Pro.'}`;
      }

      if (data.response && data.response.includes('disabled')) {
        return data.response;
      }
      const genericError = data.error || data.errorMessage || data.errorType || 'Failed to generate AI insights';
      throw new Error(genericError);
    }

    return data.response;
  } catch (err: any) {
    console.error('AI Service Error:', err);
    return `⚠️ Error generating AI insights: ${err.message}. Please try again later.`;
  }
};
