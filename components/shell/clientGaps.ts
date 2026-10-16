/**
 * Client calls the auth, settings and platform pages need that `state/index.ts` (BACKLOG §4.3) does not
 * expose yet. B1 never calls fetch; until C adds these to `state/` (request in docs/release/handoff-B1.md
 * §5), this module gives the pages one typed seam:
 *   - demo mode (useSession().mode === 'demo'): simulated, in memory, no network;
 *   - live mode: rejects with ApiRequestError 501 so the page shows its error state.
 * INTEGRATION: C implements `useClientGaps()` (same shape) in state/ and I changes the one import in
 * each page from '../../components/shell/clientGaps' to '../../state'.
 */
import { useMemo } from 'react';
import { ApiRequestError, useSession } from '../../state';
import type * as D from '../../shared/contracts/dto';
import type { InvitationLookup } from '../../shared/contracts/api';

export interface PendingInvitation {
  id: D.ID;
  email: string;
  orgRole: D.OrgRole;
  workspaces: Array<{ workspaceId: D.ID; role: D.WorkspaceRole }>;
  invitedAt: D.ISODateTime;
  expiresAt: D.ISODateTime;
  inviteUrl: string | null;
}

export interface JiraConnection {
  status: 'not_connected' | 'connected' | 'error';
  siteUrl: string;
  email: string;
  hasSecret: boolean;
  projectKeys: string[];
  boardIds: number[];
  storyPointField: string | null;
  lastTestedAt: D.ISODateTime | null;
}

export interface PlanviewConnection {
  enabled: boolean;
  status: 'not_connected' | 'connected' | 'error';
  adapter: 'rest' | 'odata';
  baseUrl: string;
  username: string;
  hasSecret: boolean;
  fieldMap: Record<string, string>;
}

export interface PlatformOverview {
  stats: { orgs: number; users: number; workspaces: number; activeLast30d: number };
  orgs: Array<{
    id: D.ID;
    name: string;
    slug: string;
    plan: D.Plan;
    members: number;
    workspaces: number;
    lastActivityAt: D.ISODateTime | null;
  }>;
  events: Array<{ id: string; at: D.ISODateTime; actor: string; action: string; org: string | null }>;
}

export interface ClientGaps {
  auth: {
    register(r: { name: string; email: string; password: string }): Promise<{ verificationSent: boolean }>;
    requestPasswordReset(email: string): Promise<void>;
    confirmPasswordReset(r: { email: string; code: string; newPassword: string }): Promise<void>;
    sendVerification(email: string): Promise<void>;
    checkVerification(r: { email: string; code: string }): Promise<void>;
    lookupInvitation(token: string): Promise<InvitationLookup>;
    acceptInvitation(token: string, r: { name: string; password: string }): Promise<void>;
  };
  account: {
    createOrg(r: { orgName: string; workspaceName: string }): Promise<{ orgSlug: string; workspaceId: D.ID }>;
    updateProfile(r: { name: string }): Promise<void>;
    changePassword(r: { currentPassword: string; newPassword: string }): Promise<void>;
    setTwoFactor(r: { enabled: boolean; currentPassword: string }): Promise<void>;
  };
  org: {
    createWorkspace(name: string): Promise<{ id: D.ID }>;
    renameWorkspace(id: D.ID, name: string): Promise<void>;
    deleteWorkspace(id: D.ID): Promise<void>;
    listInvitations(): Promise<PendingInvitation[]>;
    resendInvitation(id: D.ID): Promise<void>;
    revokeInvitation(id: D.ID): Promise<void>;
    startCheckout(plan: D.Plan): Promise<{ url: string }>;
  };
  integrations: {
    get(): Promise<{ jira: JiraConnection; planview: PlanviewConnection }>;
    saveJira(r: Partial<Omit<JiraConnection, 'status' | 'hasSecret'>> & { apiToken?: string }): Promise<void>;
    testJira(): Promise<{ ok: boolean; storyPointField: string | null; message: string }>;
    savePlanview(r: Partial<Omit<PlanviewConnection, 'status' | 'hasSecret'>> & { secret?: string }): Promise<void>;
    testPlanview(): Promise<{ ok: boolean; message: string }>;
  };
  platform: {
    overview(): Promise<PlatformOverview>;
  };
}

const wait = (ms = 450) => new Promise<void>((r) => setTimeout(r, ms));
const notAvailable = (): never => {
  throw new ApiRequestError(501, 'server_error', 'This action is not connected yet.');
};

// Demo-mode memory (resets on reload, like the WP-0 stub).
const demoInvitations: PendingInvitation[] = [];
const demo = {
  jira: {
    status: 'not_connected',
    siteUrl: '',
    email: '',
    hasSecret: false,
    projectKeys: [],
    boardIds: [],
    storyPointField: null,
    lastTestedAt: null,
  } as JiraConnection,
  planview: {
    enabled: false,
    status: 'not_connected',
    adapter: 'rest',
    baseUrl: '',
    username: '',
    hasSecret: false,
    fieldMap: {},
  } as PlanviewConnection,
};

/** Records an invitation created through useMutations().admin.invite() so the Members table lists it (demo). */
export function rememberDemoInvitation(inv: PendingInvitation): void {
  demoInvitations.unshift(inv);
}

function demoGaps(): ClientGaps {
  return {
    auth: {
      async register() {
        await wait();
        return { verificationSent: true };
      },
      async requestPasswordReset() {
        await wait();
      },
      async confirmPasswordReset(r) {
        await wait();
        if (!/^\d{6}$/.test(r.code))
          throw new ApiRequestError(400, 'bad_request', 'That code is not valid.', {
            fields: { code: 'Enter the 6-digit code.' },
          });
      },
      async sendVerification() {
        await wait();
      },
      async checkVerification(r) {
        await wait();
        if (!/^\d{6}$/.test(r.code)) throw new ApiRequestError(400, 'bad_request', 'That code is not valid.');
      },
      async lookupInvitation(token) {
        await wait(250);
        if (!token.startsWith('demo-')) throw new ApiRequestError(404, 'not_found', 'Invitation not found.');
        return {
          email: 'new.colleague@example.com',
          orgName: 'Demo Organisation',
          workspaces: [{ id: 'demo', name: 'IE Portfolio & Change Office', role: 'PLANNER' }],
          expiresAt: new Date(Date.now() + 6 * 86_400_000).toISOString(),
          existingUser: false,
        };
      },
      async acceptInvitation() {
        await wait();
      },
    },
    account: {
      async createOrg(r) {
        await wait();
        return {
          orgSlug:
            r.orgName
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '') || 'demo',
          workspaceId: 'demo',
        };
      },
      async updateProfile() {
        await wait();
      },
      async changePassword(r) {
        await wait();
        if (r.currentPassword.length === 0)
          throw new ApiRequestError(400, 'bad_request', 'Enter your current password.');
      },
      async setTwoFactor() {
        await wait();
      },
    },
    org: {
      async createWorkspace() {
        await wait();
        throw new ApiRequestError(403, 'entitlement', 'The demo organisation has one workspace.');
      },
      async renameWorkspace() {
        await wait();
      },
      async deleteWorkspace() {
        await wait();
        throw new ApiRequestError(409, 'conflict', 'The demo workspace cannot be deleted.');
      },
      async listInvitations() {
        await wait(200);
        return [...demoInvitations];
      },
      async resendInvitation() {
        await wait();
      },
      async revokeInvitation(id) {
        await wait();
        const i = demoInvitations.findIndex((x) => x.id === id);
        if (i >= 0) demoInvitations.splice(i, 1);
      },
      async startCheckout() {
        await wait();
        throw new ApiRequestError(403, 'forbidden', 'Billing is not available in the demo workspace.');
      },
    },
    integrations: {
      async get() {
        await wait(250);
        return { jira: { ...demo.jira }, planview: { ...demo.planview } };
      },
      async saveJira(r) {
        await wait();
        demo.jira = {
          ...demo.jira,
          ...r,
          hasSecret: demo.jira.hasSecret || !!r.apiToken,
          status: (r.siteUrl ?? demo.jira.siteUrl) ? 'connected' : 'not_connected',
        };
      },
      async testJira() {
        await wait(700);
        if (!demo.jira.siteUrl || !demo.jira.hasSecret)
          return { ok: false, storyPointField: null, message: 'Add the site, email and API token first.' };
        demo.jira = {
          ...demo.jira,
          storyPointField: 'customfield_10016',
          lastTestedAt: new Date().toISOString(),
          status: 'connected',
        };
        return { ok: true, storyPointField: 'customfield_10016', message: 'Connected. Story points field detected.' };
      },
      async savePlanview(r) {
        await wait();
        demo.planview = { ...demo.planview, ...r, hasSecret: demo.planview.hasSecret || !!r.secret };
      },
      async testPlanview() {
        await wait(700);
        return demo.planview.baseUrl
          ? { ok: true, message: 'Connected to Planview.' }
          : { ok: false, message: 'Add the base URL and credentials first.' };
      },
    },
    platform: {
      async overview() {
        await wait(300);
        return {
          stats: { orgs: 1, users: 1, workspaces: 1, activeLast30d: 1 },
          orgs: [
            {
              id: 'demo-org',
              name: 'Demo Organisation',
              slug: 'demo',
              plan: 'ENTERPRISE',
              members: 1,
              workspaces: 1,
              lastActivityAt: new Date().toISOString(),
            },
          ],
          events: [
            {
              id: 'e1',
              at: new Date().toISOString(),
              actor: 'Demo User',
              action: 'auth.login',
              org: 'Demo Organisation',
            },
          ],
        };
      },
    },
  };
}

function liveGaps(): ClientGaps {
  const na = async () => notAvailable();
  return {
    auth: {
      register: na,
      requestPasswordReset: na,
      confirmPasswordReset: na,
      sendVerification: na,
      checkVerification: na,
      lookupInvitation: na,
      acceptInvitation: na,
    },
    account: { createOrg: na, updateProfile: na, changePassword: na, setTwoFactor: na },
    org: {
      createWorkspace: na,
      renameWorkspace: na,
      deleteWorkspace: na,
      listInvitations: async () => [],
      resendInvitation: na,
      revokeInvitation: na,
      startCheckout: na,
    },
    integrations: { get: na, saveJira: na, testJira: na, savePlanview: na, testPlanview: na },
    platform: { overview: na },
  };
}

const DEMO = demoGaps();
const LIVE = liveGaps();

/** See the file header. Stable object per mode. */
export function useClientGaps(): ClientGaps {
  const { mode } = useSession();
  return useMemo(() => (mode === 'demo' ? DEMO : LIVE), [mode]);
}
