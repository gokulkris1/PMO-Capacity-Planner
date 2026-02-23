/// <reference types="vite/client" />
import { Resource, Project, Allocation } from "../types";

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY || '';

function buildSystemPrompt(resources: Resource[], projects: Project[], allocations: Allocation[]): string {
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

  return `You are an elite McKinsey/BCG Partner and Senior PMO Strategic Advisor. The user is a PMO Director asking for your analytical capacity consulting based on their live portfolio data.

📊 LIVE PORTFOLIO DATA:
RESOURCES & ALLOCATIONS:
${resourceSummary || '  (No resources yet)'}

PROJECTS:
${projectSummary || '  (No projects yet)'}

BURN & RISK METRICS:
- Over-allocated Risks: ${overAllocated.length} individuals (${overAllocated.map(r => r.name).join(', ') || 'none'})
- Bench / Unutilized: ${unassigned.length} individuals (${unassigned.map(r => r.name).join(', ') || 'none'})

🎯 YOUR DIRECTIVES:
1. DELIVER HARD TRUTHS: Be direct, analytical, and executive. Do not use fluff. Treat this as a high-stakes Board presentation.
2. SYNTHESIZE, DON'T REGURGITATE: Formulate a strategic thesis before answering. If someone is over-allocated, specifically suggest WHO on the bench can take their load based on matching roles/departments.
3. ALIGN WITH PRIORITIES: If low-priority projects are consuming 100% of a critical resource while high-priority projects are starved, call out the strategic misalignment immediately.
4. FORMATTING: Use Markdown flawlessly. Use *Bold* for names and projects. Use clear headers (e.g., ### 🚨 Immediate Risks, ### 💡 Reallocation Strategy).
5. BE ACTIONABLE: Give explicit steps like "Transfer 30% of John's allocation from Project B to Project A to relieve bottleneck."

Respond strictly to the user's prompt using the data above. If their query is general ("How are we doing?"), provide a comprehensive health check and reallocation roadmap.`;
}

export const getCapacityInsights = async (
  resources: Resource[],
  projects: Project[],
  allocations: Allocation[],
  userPrompt: string
): Promise<string> => {
  const token = localStorage.getItem('pcp_token');

  if (!token) {
    return "You must be logged in to use the AI Advisor.";
  }

  try {
    const systemPrompt = buildSystemPrompt(resources, projects, allocations);

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
      throw new Error(data.error || 'Failed to generate AI insights');
    }

    return data.response;
  } catch (err: any) {
    console.error('AI Service Error:', err);
    return `⚠️ Error generating AI insights: ${err.message}. Please try again later.`;
  }
};
