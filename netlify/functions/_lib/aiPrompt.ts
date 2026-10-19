/**
 * Server-built system prompt for the AI assistant (HS-11#AC3). The client only sends a question; this module
 * decides what workspace data leaves the company: names, job titles, crafts, utilisation, projects and open demand
 * for the current and next three quarters. No emails, rates or user accounts. Capped in size.
 */
import type { WorkspaceSnapshot, WorkspaceRole } from '../../../shared/contracts/dto';
import { quarterKeyOf, quarterRange } from './entity';
import { plannedFte } from './jira/aggregate';
import { PRODUCT_NAME } from './email';
import { productGuideText } from '../../../shared/help/guide';

const MAX_CHARS = 12000;

function quarters(n: number): string[] {
  const now = new Date();
  return Array.from({ length: n }, (_, i) =>
    quarterKeyOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 3 * i, 1))),
  );
}

export function buildSystemPrompt(s: WorkspaceSnapshot, role: WorkspaceRole | null): string {
  const craftName = new Map(s.crafts.map((c) => [c.id, c.name]));
  const projectName = new Map(s.projects.map((p) => [p.id, p.name]));
  const qks = quarters(4);
  const live = s.allocations.filter((a) => a.state !== 'declined');
  const load = (personId: string, qk: string) => {
    const { from, to } = quarterRange(qk);
    return Math.round(
      100 *
        plannedFte(
          live.filter((a) => a.resourceId === personId),
          from,
          to,
        ),
    );
  };
  const people = s.people
    .map((p) => {
      const loads = qks.map((qk) => `${qk} ${load(p.id, qk)}%`).join(', ');
      const below =
        p.secondaryCrafts.map((c) => `${craftName.get(c.craftId) ?? c.craftId} L${c.proficiency}`).join('/') || 'none';
      const projects = [
        ...new Set(live.filter((a) => a.resourceId === p.id).map((a) => projectName.get(a.projectId) ?? '?')),
      ].join(', ');
      return `- ${p.name} | ${p.role || 'n/a'} | above: ${craftName.get(p.primaryCraft ?? '') ?? 'n/a'} | below: ${below} | target ${p.targetUtil}% | load ${loads} | projects: ${projects || 'none'}`;
    })
    .join('\n');
  const projects = s.projects
    .map((p) => `- ${p.name} | ${p.status} | ${p.stage ?? 'no stage'} | priority ${p.priority}`)
    .join('\n');
  const demand = s.demand
    .filter((d) => qks.includes(d.quarterKey))
    .map(
      (d) =>
        `- ${projectName.get(d.projectId) ?? '?'} needs ${d.fte} FTE ${craftName.get(d.craftId) ?? d.craftId} in ${d.quarterKey} (${d.status})`,
    )
    .join('\n');
  const strategic = role === 'WORKSPACE_ADMIN' || role === 'PLANNER';
  const directive = strategic
    ? 'The user plans this portfolio: you may recommend reallocations, hiring or deferring work.'
    : 'The user has read-only access: keep advice to observations and questions they could raise with their PMO; do not recommend budget or organisational changes.';
  const prompt = `WORKSPACE "${s.workspace.name}". ${directive}
Utilisation bands: Available below ${s.org.planning.thresholds.benchBelow}%, On target ${s.org.planning.thresholds.onTargetFrom}–${s.org.planning.thresholds.onTargetTo}% of each person's target.

PEOPLE (quarter load as % of a full-time person):
${people || '- none'}

PROJECTS:
${projects || '- none'}

DEMAND (next four quarters):
${demand || '- none'}`;
  return prompt.length > MAX_CHARS ? `${prompt.slice(0, MAX_CHARS)}\n[data truncated]` : prompt;
}

/**
 * Ask Tom's standing instructions plus the product guide. Identical for every request (no workspace data), so it is
 * sent as the first system block and cached.
 */
export function tomInstructions(): string {
  return `You are Tom, the assistant built into ${PRODUCT_NAME}, a tool a PMO uses to plan people's capacity against project demand by quarter.
You answer two kinds of question:
1. About this workspace's plan: who is free or over capacity, where demand is not covered, which crafts are short, what to do about it. Use only the workspace data in the next block and say when it is not enough. Never invent people, projects or numbers.
2. About using ${PRODUCT_NAME}: where something is, what a term means, how to do a task. Use the product guide below, name the page (and the Settings section) to go to, and give the steps.
Answer in plain English, concisely (normally under 200 words), with short lists where they help. If a question is unrelated to capacity planning or to ${PRODUCT_NAME}, say briefly that you can only help with those.

PRODUCT GUIDE
${productGuideText()}`;
}
