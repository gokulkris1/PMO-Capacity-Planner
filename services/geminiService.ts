/// <reference types="vite/client" />
import { Resource, Project, Allocation } from "../types";

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY || '';

function buildSystemPrompt(resources: Resource[], projects: Project[], allocations: Allocation[]): string {
  // Build rich allocation table for context
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
    return `  - ${p.name} | Status: ${p.status || 'active'} | Team: ${assignedResources || 'none assigned'}`;
  }).join('\n');

  const overAllocated = resources.filter(r =>
    allocations.filter(a => a.resourceId === r.id).reduce((s, a) => s + a.percentage, 0) > 100
  );
  const unassigned = resources.filter(r =>
    allocations.filter(a => a.resourceId === r.id).length === 0
  );
  const avgUtil = resources.length > 0
    ? Math.round(resources.reduce((sum, r) =>
      sum + allocations.filter(a => a.resourceId === r.id).reduce((s, a) => s + a.percentage, 0)
      , 0) / resources.length)
    : 0;

  return `You are an expert PMO Capacity Planning AI assistant. You have complete access to the following live data from this user's PMO workspace.

TEAM OVERVIEW:
- Total resources: ${resources.length}
- Total projects: ${projects.length}
- Average utilisation: ${avgUtil}%
- Over-allocated: ${overAllocated.length} (${overAllocated.map(r => r.name).join(', ') || 'none'})
- Unassigned: ${unassigned.length} (${unassigned.map(r => r.name).join(', ') || 'none'})

RESOURCES & ALLOCATIONS:
${resourceSummary || '  (No resources yet)'}

PROJECTS:
${projectSummary || '  (No projects yet)'}

INSTRUCTIONS:
- Answer questions directly about THIS team's data above — names, percentages, projects.
- Give specific, actionable advice. Never be vague.
- If someone is over-allocated, name them and suggest specific rebalancing options using real resource names.
- If capacity is available, say who specifically is available and for what kind of work.
- Format answers using bullet points or short paragraphs. Keep it concise.
- You can reason about scenarios (e.g. "if we hire one more developer...").
- Do NOT say you don't have the data — you have it all above.`;
}

export const getCapacityInsights = async (
  resources: Resource[],
  projects: Project[],
  allocations: Allocation[],
  userPrompt: string
): Promise<string> => {
  if (!OPENAI_API_KEY) {
    // Fallback: give a real answer based on the actual data (no API needed)
    const overAlloc = resources.filter(r =>
      allocations.filter(a => a.resourceId === r.id).reduce((s, a) => s + a.percentage, 0) > 100
    );
    const underUtil = resources.filter(r => {
      const total = allocations.filter(a => a.resourceId === r.id).reduce((s, a) => s + a.percentage, 0);
      return total > 0 && total < 60;
    });
    const unassigned = resources.filter(r =>
      allocations.filter(a => a.resourceId === r.id).length === 0
    );

    const lines: string[] = [`**Analysis: "${userPrompt}"**\n`];

    if (overAlloc.length) {
      lines.push(`⚠️ **Over-allocated (>100%):** ${overAlloc.map(r => {
        const total = allocations.filter(a => a.resourceId === r.id).reduce((s, a) => s + a.percentage, 0);
        return `${r.name} (${total}%)`;
      }).join(', ')} — recommend reducing their project load or adding headcount.`);
    } else {
      lines.push(`✅ No over-allocations. Team is within safe capacity limits.`);
    }
    if (underUtil.length) lines.push(`💡 **Available capacity:** ${underUtil.map(r => r.name).join(', ')} are under 60% — consider assigning them to new initiatives.`);
    if (unassigned.length) lines.push(`👤 **Unassigned:** ${unassigned.map(r => r.name).join(', ')} — fully available for new project work.`);
    if (resources.length === 0) lines.push(`📋 Add your team resources first to get AI capacity insights.`);

    lines.push(`\n_Set VITE_OPENAI_API_KEY in Netlify env vars to enable full conversational AI._`);
    return new Promise(resolve => setTimeout(() => resolve(lines.join('\n')), 400));
  }

  try {
    const systemPrompt = buildSystemPrompt(resources, projects, allocations);

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 600,
        temperature: 0.4,
      }),
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error?.message || `OpenAI error ${res.status}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || "I couldn't generate insights at this moment.";
  } catch (error: any) {
    console.error('AI Error:', error.message);
    return `⚠️ AI error: ${error.message}. Check that VITE_OPENAI_API_KEY is set correctly.`;
  }
};
