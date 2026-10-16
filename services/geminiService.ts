/**
 * @deprecated HS-11 compatibility shim for the legacy App.tsx only. Package B removes the import
 * (the assistant drawer calls `useApi().api.ai.ask(wsId, question)`), then this file is deleted.
 *
 * The 2.0 contract: the client sends only `{ wsId, question }` to `POST /api/ai`; the server builds
 * the prompt from the database (`_lib/aiPrompt.ts`) and checks the `aiAssistant` flag, `ai.use` and
 * the quota. No API key, prompt or workspace data is sent from the browser (HS-11#AC3, HS-15#AC1).
 */
import type { Allocation, Project, Resource } from '../types';
import { createApiClient } from './api/client';
import { ApiRequestError } from './api/errors';
import { HttpTransport } from './api/httpTransport';

interface LegacyWorkspace {
  id: string;
}

let client: ReturnType<typeof createApiClient> | null = null;

export async function getCapacityInsights(
  _resources: Resource[],
  _projects: Project[],
  _allocations: Allocation[],
  userPrompt: string,
  _user: unknown,
  activeWorkspace: LegacyWorkspace | null,
  _workspaceRole: unknown,
): Promise<string> {
  if (!activeWorkspace) return 'Open a workspace to use the assistant.';
  client ??= createApiClient(new HttpTransport());
  try {
    const { answer } = await client.ai.ask(activeWorkspace.id, userPrompt.slice(0, 2000));
    return answer;
  } catch (e) {
    if (e instanceof ApiRequestError) {
      if (e.code === 'feature_disabled') return 'The AI assistant is turned off for your organisation.';
      if (e.status === 429 || e.status === 403 || e.status === 400) return e.message;
    }
    return 'The AI service is unavailable. Try again later.';
  }
}
