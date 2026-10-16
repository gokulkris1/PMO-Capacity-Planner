/**
 * Account, organisation, integration-settings and platform actions that have no snapshot to mutate
 * (auth pages, Settings › Organisation/Members/Integrations/Billing, the platform cockpit). Additive
 * to §4.3, requested by B1: same method names, signatures and types as B1's interim
 * `components/shell/clientGaps.ts`, so each page switches one import (handoff-C.md §3).
 *
 * v2 routes where §4.3 has them; the legacy v1.1 endpoints the coordinator kept otherwise
 * (`/api/auth/register`, `/api/auth/reset/*`, `/api/verify/*`, `/api/checkout`,
 * `/api/integrations/config|jira/test|planview/test`). Works on HttpTransport and DemoTransport alike.
 */
import type * as D from '../shared/contracts/dto';
import type { InvitationLookup } from '../shared/contracts/api';
import type { LegacyIntegrationConfig } from '../services/api/client';
import { ApiRequestError } from '../services/api/errors';
import type { DataRuntime } from './runtime';

export type { InvitationLookup };

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

export type { PlatformOverview } from '../shared/contracts/api';
import type { PlatformOverview } from '../shared/contracts/api';

export interface AccountActions {
  register(r: { name: string; email: string; password: string }): Promise<{ verificationSent: boolean }>;
  requestPasswordReset(email: string): Promise<void>;
  confirmPasswordReset(r: { email: string; code: string; newPassword: string }): Promise<void>;
  sendVerification(email: string): Promise<void>;
  checkVerification(r: { email: string; code: string }): Promise<void>;
  lookupInvitation(token: string): Promise<InvitationLookup>;
  acceptInvitation(token: string, r: { name: string; password: string }): Promise<void>;
  createOrg(r: { orgName: string; workspaceName: string }): Promise<{ orgSlug: string; workspaceId: D.ID }>;
  updateProfile(r: { name: string }): Promise<void>;
  changePassword(r: { currentPassword: string; newPassword: string }): Promise<void>;
  setTwoFactor(r: { enabled: boolean; currentPassword: string }): Promise<void>;
}

export interface OrgAdmin {
  createWorkspace(name: string): Promise<{ id: D.ID }>;
  renameWorkspace(id: D.ID, name: string): Promise<void>;
  deleteWorkspace(id: D.ID): Promise<void>;
  listInvitations(): Promise<PendingInvitation[]>;
  resendInvitation(id: D.ID): Promise<void>;
  revokeInvitation(id: D.ID): Promise<void>;
  startCheckout(plan: D.Plan): Promise<{ url: string }>;
}

export interface IntegrationSettings {
  get(): Promise<{ jira: JiraConnection; planview: PlanviewConnection }>;
  saveJira(r: Partial<Omit<JiraConnection, 'status' | 'hasSecret'>> & { apiToken?: string }): Promise<void>;
  testJira(): Promise<{ ok: boolean; storyPointField: string | null; message: string }>;
  savePlanview(r: Partial<Omit<PlanviewConnection, 'status' | 'hasSecret'>> & { secret?: string }): Promise<void>;
  testPlanview(): Promise<{ ok: boolean; message: string }>;
}

export interface PlatformAdmin {
  overview(): Promise<PlatformOverview>;
}

/** B1's `ClientGaps` shape (one object with every group). */
export interface ClientGaps {
  auth: Pick<
    AccountActions,
    | 'register'
    | 'requestPasswordReset'
    | 'confirmPasswordReset'
    | 'sendVerification'
    | 'checkVerification'
    | 'lookupInvitation'
    | 'acceptInvitation'
  >;
  account: Pick<AccountActions, 'createOrg' | 'updateProfile' | 'changePassword' | 'setTwoFactor'>;
  org: OrgAdmin;
  integrations: IntegrationSettings;
  platform: PlatformAdmin;
}

const noop = () => undefined;

function requireOrg(rt: DataRuntime): { id: D.ID; slug: string } {
  const org = rt.getState().me?.org;
  if (!org) throw new ApiRequestError(403, 'forbidden', 'You are not in an organisation.');
  return { id: org.id, slug: org.slug };
}

function requireWs(rt: DataRuntime): D.ID {
  const ws = rt.getState().activeWorkspaceId;
  if (!ws) throw new ApiRequestError(409, 'conflict', 'Open a workspace first.');
  return ws;
}

const siteUrlOf = (domain: string) => (domain ? `https://${domain}` : '');
const domainOf = (siteUrl: string) =>
  siteUrl
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '');

/** Local, per-runtime connection-test state (the legacy config does not store it). */
const testState = new WeakMap<
  DataRuntime,
  { jiraTestedAt: string | null; jiraOk: boolean | null; planviewOk: boolean | null }
>();
function tests(rt: DataRuntime) {
  let t = testState.get(rt);
  if (!t) {
    t = { jiraTestedAt: null, jiraOk: null, planviewOk: null };
    testState.set(rt, t);
  }
  return t;
}

function jiraFrom(rt: DataRuntime, c: LegacyIntegrationConfig['jira']): JiraConnection {
  const t = tests(rt);
  return {
    status: t.jiraOk === false ? 'error' : c.configured ? 'connected' : 'not_connected',
    siteUrl: siteUrlOf(c.domain),
    email: c.email,
    hasSecret: c.hasSecret,
    projectKeys: c.projectKeys,
    boardIds: c.boardIds,
    storyPointField: c.storyPointsFieldId ?? null,
    lastTestedAt: t.jiraTestedAt,
  };
}

function planviewFrom(rt: DataRuntime, c: LegacyIntegrationConfig['planview']): PlanviewConnection {
  const t = tests(rt);
  return {
    enabled: c.configured || !!c.baseUrl,
    status: t.planviewOk === false ? 'error' : c.configured ? 'connected' : 'not_connected',
    adapter: c.flavour === 'adaptivework' ? 'odata' : 'rest',
    baseUrl: c.baseUrl,
    username: c.username ?? '',
    hasSecret: c.hasSecret,
    fieldMap: c.generic?.fieldMap ?? {},
  };
}

export function buildAccountActions(rt: DataRuntime): AccountActions {
  const api = rt.api;
  return {
    async register(r) {
      const res = (await api.auth.register(r)) as { emailVerificationRequired?: boolean } | undefined;
      return { verificationSent: res?.emailVerificationRequired !== false };
    },
    requestPasswordReset: (email) => api.auth.resetSend(email).then(noop),
    confirmPasswordReset: (r) =>
      api.auth.resetConfirm({ email: r.email, otp: r.code, newPassword: r.newPassword }).then(noop),
    sendVerification: (email) => api.auth.verifySend(email).then(noop),
    async checkVerification(r) {
      await api.auth.verifyCheck(r.code, r.email);
      if (rt.getState().status === 'authenticated') await rt.refreshMe();
    },
    lookupInvitation: (token) => api.invitations.lookup(token),
    async acceptInvitation(token, r) {
      await api.invitations.accept(token, r);
      await rt.reloadSession();
    },
    async createOrg(r) {
      const res = await api.orgs.create({ name: r.orgName, workspaceName: r.workspaceName });
      await rt.reloadSession(res.workspace.id);
      return { orgSlug: res.org.slug, workspaceId: res.workspace.id };
    },
    async updateProfile(r) {
      await api.auth.updateProfile(r);
      await rt.refreshMe();
    },
    changePassword: (r) => api.auth.changePassword(r).then(noop),
    async setTwoFactor(r) {
      await api.auth.setTwoFactor({ enabled: r.enabled, password: r.currentPassword });
      await rt.refreshMe();
    },
  };
}

export function buildOrgAdmin(rt: DataRuntime): OrgAdmin {
  const api = rt.api;
  return {
    async createWorkspace(name) {
      const ws = await api.orgs.createWorkspace(requireOrg(rt).id, name);
      await rt.refreshMe();
      return { id: ws.id };
    },
    async renameWorkspace(id, name) {
      await api.orgs.renameWorkspace(id, name);
      await rt.refreshMe();
    },
    async deleteWorkspace(id) {
      const name = rt.getState().me?.workspaces.find((w) => w.id === id)?.name ?? '';
      await api.orgs.deleteWorkspace(id, name);
      const wasActive = rt.getState().activeWorkspaceId === id;
      await rt.reloadSession(wasActive ? null : undefined);
    },
    async listInvitations() {
      const list = (await api.invitations.list(requireOrg(rt).id)) as Array<
        Partial<PendingInvitation> & { id: D.ID; email: string; expiresAt: string; createdAt?: string }
      >;
      return list.map((i) => ({
        id: i.id,
        email: i.email,
        orgRole: i.orgRole ?? 'MEMBER',
        workspaces: i.workspaces ?? [],
        invitedAt: i.invitedAt ?? i.createdAt ?? '',
        expiresAt: i.expiresAt,
        inviteUrl: i.inviteUrl ?? null,
      }));
    },
    resendInvitation: (id) => api.invitations.resend(requireOrg(rt).id, id).then(noop),
    revokeInvitation: (id) => api.invitations.revoke(requireOrg(rt).id, id).then(noop),
    startCheckout: (plan) => api.billing.checkout(plan, requireOrg(rt).slug),
  };
}

export function buildIntegrationSettings(rt: DataRuntime): IntegrationSettings {
  const api = rt.api;
  return {
    async get() {
      const c = await api.integrationSettings.config(requireWs(rt));
      return { jira: jiraFrom(rt, c.jira), planview: planviewFrom(rt, c.planview) };
    },
    async saveJira(r) {
      await api.integrationSettings.save(requireWs(rt), {
        jira: {
          ...(r.siteUrl !== undefined && { domain: domainOf(r.siteUrl) }),
          ...(r.email !== undefined && { email: r.email }),
          ...(r.projectKeys !== undefined && { projectKeys: r.projectKeys }),
          ...(r.boardIds !== undefined && { boardIds: r.boardIds }),
          ...(r.storyPointField !== undefined && { storyPointsFieldId: r.storyPointField ?? undefined }),
          ...(r.apiToken && { apiToken: r.apiToken }),
        },
      });
    },
    async testJira() {
      const t = tests(rt);
      t.jiraTestedAt = new Date().toISOString();
      try {
        const res = await api.integrationSettings.testJira(requireWs(rt));
        t.jiraOk = !!res.ok;
        return {
          ok: !!res.ok,
          storyPointField: res.storyPointsFieldId ?? null,
          message: res.storyPointsFieldId
            ? `Connected${res.displayName ? ` as ${res.displayName}` : ''}. Story points field detected.`
            : `Connected${res.displayName ? ` as ${res.displayName}` : ''}. No story points field found.`,
        };
      } catch (e) {
        t.jiraOk = false;
        return {
          ok: false,
          storyPointField: null,
          message: e instanceof ApiRequestError ? e.message : 'The connection test failed.',
        };
      }
    },
    async savePlanview(r) {
      await api.integrationSettings.save(requireWs(rt), {
        planview: {
          ...(r.adapter !== undefined && { flavour: r.adapter === 'odata' ? 'adaptivework' : 'generic' }),
          ...(r.baseUrl !== undefined && { baseUrl: r.baseUrl }),
          ...(r.username !== undefined && { username: r.username }),
          ...(r.secret && { secret: r.secret }),
          ...(r.fieldMap !== undefined && { generic: { fieldMap: r.fieldMap } }),
        },
      });
    },
    async testPlanview() {
      const t = tests(rt);
      try {
        const res = await api.integrationSettings.testPlanview(requireWs(rt));
        t.planviewOk = !!res.ok;
        return {
          ok: !!res.ok,
          message:
            res.projectCount !== undefined
              ? `Connected to Planview (${res.projectCount} projects).`
              : 'Connected to Planview.',
        };
      } catch (e) {
        t.planviewOk = false;
        return { ok: false, message: e instanceof ApiRequestError ? e.message : 'The connection test failed.' };
      }
    },
  };
}

export function buildPlatformAdmin(rt: DataRuntime): PlatformAdmin {
  return { overview: () => rt.api.platform.overview() };
}

/** Stable per-runtime instances. */
const cache = new WeakMap<DataRuntime, ClientGaps & { recordExport: RecordExport }>();
export type RecordExport = (r: { kind: string; format: 'pdf' | 'csv' }) => Promise<void>;

export function clientGapsFor(rt: DataRuntime): ClientGaps & { recordExport: RecordExport } {
  let c = cache.get(rt);
  if (!c) {
    const account = buildAccountActions(rt);
    c = {
      auth: account,
      account,
      org: buildOrgAdmin(rt),
      integrations: buildIntegrationSettings(rt),
      platform: buildPlatformAdmin(rt),
      // RP-04#AC4: the server records `export.pdf` / `export.csv` with the report name.
      recordExport: (r) => rt.api.workspace.exportAudit(requireWs(rt), { kind: r.format, report: r.kind }).then(noop),
    };
    cache.set(rt, c);
  }
  return c;
}
