import { useCallback, useEffect, useMemo, useState } from 'react';
import { CircleQuestionMark, Copy, Ellipsis, Mail, RefreshCw, Trash2, UserMinus, UserPlus, Users } from 'lucide-react';
import { ROLE_LABEL, WORKSPACE_ROLE_RANK } from '../../shared/permissions';
import type { MemberDTO } from '../../shared/contracts/api';
import type { OrgRole, WorkspaceRole } from '../../shared/contracts/dto';
import { useMutations, useSession, useWorkspace, useWorkspaceData } from '../../state';
import {
  Avatar,
  Banner,
  Button,
  CellButton,
  Checkbox,
  DataTable,
  Dialog,
  EmptyState,
  FormField,
  IconButton,
  Menu,
  SearchField,
  Select,
  StatusPill,
  Textarea,
  Tooltip,
  formatDate,
  useConfirm,
  useToast,
  type Column,
} from '../../components/ui';
import { rememberDemoInvitation, useClientGaps, type PendingInvitation } from '../../components/shell/clientGaps';
import { SectionBody, SectionHeader, errorText } from './common';

const WS_ROLES: WorkspaceRole[] = ['WORKSPACE_ADMIN', 'PLANNER', 'CONTRIBUTOR', 'VIEWER'];

export const ROLE_SUMMARY: Record<WorkspaceRole | 'ORG_ADMIN', string> = {
  ORG_ADMIN: 'Everything in every workspace, plus organisation settings, members, features and billing.',
  WORKSPACE_ADMIN: 'Everything in the workspace: members, integrations and secrets, structure and all data.',
  PLANNER: 'Edits people, projects, demand and allocations; runs syncs, imports and calibration.',
  CONTRIBUTOR: 'Reads everything; updates their own below-the-table crafts and answers bookings proposed to them.',
  VIEWER: 'Read-only access, the Marketplace catalogue and exports.',
};

type Row = { kind: 'member'; member: MemberDTO } | { kind: 'invite'; invite: PendingInvitation };

/** Settings › Members and roles (ST-02, AC-05, AC-06). */
export default function MembersSettings() {
  const { me } = useSession();
  const { can, workspace, workspaces } = useWorkspace();
  const { snapshot } = useWorkspaceData();
  const m = useMutations();
  const gaps = useClientGaps();
  const toast = useToast();
  const confirm = useConfirm();
  const isOrgAdmin = can('org.members.manage');
  const [members, setMembers] = useState<MemberDTO[] | null>(null);
  const [invites, setInvites] = useState<PendingInvitation[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [query, setQuery] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [rolesOpen, setRolesOpen] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const [list, pending] = await Promise.all([m.admin.members(), gaps.org.listInvitations()]);
      setMembers(list);
      setInvites(pending);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [m, gaps]);

  useEffect(() => {
    // Initial load; the async setState happens after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const people = useMemo(() => new Map((snapshot?.people ?? []).map((p) => [p.id, p.name])), [snapshot]);
  // PMO Admins see only their workspace's members (ST-02#AC3).
  const visibleWs = isOrgAdmin ? workspaces : workspaces.filter((w) => w.id === workspace?.id);

  const rows: Row[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const inScope = (members ?? []).filter(
      (mem) => isOrgAdmin || mem.workspaces.some((w) => w.workspaceId === workspace?.id),
    );
    const ms: Row[] = inScope
      .filter((mem) => !q || mem.name.toLowerCase().includes(q) || mem.email.toLowerCase().includes(q))
      .map((member) => ({ kind: 'member', member }));
    const is: Row[] = invites
      .filter((i) => !q || i.email.toLowerCase().includes(q))
      .map((invite) => ({ kind: 'invite', invite }));
    return [...is, ...ms];
  }, [members, invites, query, isOrgAdmin, workspace]);

  const changeWsRole = async (mem: MemberDTO, workspaceId: string, role: WorkspaceRole | null) => {
    try {
      await m.admin.updateMember(mem.userId, { workspaces: [{ workspaceId, role }] });
      setMembers((list) =>
        (list ?? []).map((x) =>
          x.userId !== mem.userId
            ? x
            : {
                ...x,
                workspaces: role
                  ? [...x.workspaces.filter((w) => w.workspaceId !== workspaceId), { workspaceId, role }]
                  : x.workspaces.filter((w) => w.workspaceId !== workspaceId),
              },
        ),
      );
      toast.success(`${mem.name} is now ${role ? ROLE_LABEL[role] : 'removed from the workspace'}`);
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const changeOrgRole = async (mem: MemberDTO, orgRole: OrgRole) => {
    try {
      await m.admin.updateMember(mem.userId, { orgRole });
      setMembers((list) => (list ?? []).map((x) => (x.userId === mem.userId ? { ...x, orgRole } : x)));
      toast.success(`${mem.name} is now ${orgRole === 'ORG_ADMIN' ? 'an Org Admin' : 'a member'}`);
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const remove = async (mem: MemberDTO) => {
    const ok = await confirm({
      title: `Remove ${mem.name}?`,
      body: 'They lose access to this organisation immediately. Their person record and bookings stay, and you can invite them again later.',
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await m.admin.removeMember(mem.userId);
      setMembers((list) => (list ?? []).filter((x) => x.userId !== mem.userId));
      toast.success(`${mem.name} removed`);
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const revoke = async (inv: PendingInvitation) => {
    const ok = await confirm({
      title: `Revoke the invitation to ${inv.email}?`,
      body: 'The link stops working straight away.',
      confirmLabel: 'Revoke',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await gaps.org.revokeInvitation(inv.id);
      setInvites((list) => list.filter((x) => x.id !== inv.id));
      toast.success('Invitation revoked');
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const resend = async (inv: PendingInvitation) => {
    try {
      await gaps.org.resendInvitation(inv.id);
      toast.success(`Invitation sent again to ${inv.email}`);
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const roleOptions = (max: WorkspaceRole) =>
    WS_ROLES.filter((r) => WORKSPACE_ROLE_RANK[r] <= WORKSPACE_ROLE_RANK[max]).map((r) => ({
      value: r,
      label: ROLE_LABEL[r],
    }));
  const maxRole: WorkspaceRole = 'WORKSPACE_ADMIN';

  const columns: Column<Row>[] = [
    {
      id: 'member',
      header: 'Member',
      width: 280,
      sortValue: (r) => (r.kind === 'member' ? r.member.name : r.invite.email),
      csvValue: (r) => (r.kind === 'member' ? `${r.member.name} <${r.member.email}>` : r.invite.email),
      cell: (r) =>
        r.kind === 'member' ? (
          <span className="pcp-cell-main">
            <Avatar name={r.member.name} size={24} />
            <span className="pcp-cell-main__text">
              <strong className="pcp-truncate">
                {r.member.name}
                {r.member.userId === me?.user.id ? <span className="pcp-settings__muted"> (you)</span> : null}
              </strong>
              <span className="pcp-cell-main__sub">{r.member.email}</span>
            </span>
          </span>
        ) : (
          <CellButton
            leading={<Avatar name={r.invite.email} size={24} />}
            sublabel={`Invited ${formatDate(r.invite.invitedAt)}`}
            onClick={() => void resend(r.invite)}
            aria-label={`Resend invitation to ${r.invite.email}`}
          >
            {r.invite.email}
          </CellButton>
        ),
    },
    {
      id: 'org',
      header: 'Org role',
      width: 180,
      sortValue: (r) => (r.kind === 'member' ? r.member.orgRole : r.invite.orgRole),
      cell: (r) => {
        if (r.kind === 'invite') return r.invite.orgRole === 'ORG_ADMIN' ? ROLE_LABEL.ORG_ADMIN : 'Member';
        const mem = r.member;
        if (!isOrgAdmin || mem.userId === me?.user.id)
          return mem.orgRole === 'ORG_ADMIN' ? ROLE_LABEL.ORG_ADMIN : 'Member';
        return (
          <Select
            size="sm"
            aria-label={`Org role for ${mem.name}`}
            className="pcp-settings__select-cell"
            value={mem.orgRole}
            onChange={(e) => void changeOrgRole(mem, e.target.value as OrgRole)}
            options={[
              { value: 'MEMBER', label: 'Member' },
              { value: 'ORG_ADMIN', label: ROLE_LABEL.ORG_ADMIN },
            ]}
          />
        );
      },
    },
    ...visibleWs.map<Column<Row>>((w) => ({
      id: `ws-${w.id}`,
      header: (
        <Tooltip content="Roles: Org Admin, PMO Admin, Planner, Squad member, Viewer. Open “About roles” for details.">
          <span tabIndex={-1}>{visibleWs.length > 1 ? w.name : 'Workspace role'}</span>
        </Tooltip>
      ),
      headerText: visibleWs.length > 1 ? w.name : 'Workspace role',
      width: 200,
      sortValue: (r) => {
        const role =
          r.kind === 'member'
            ? r.member.workspaces.find((x) => x.workspaceId === w.id)?.role
            : r.invite.workspaces.find((x) => x.workspaceId === w.id)?.role;
        return role ? WORKSPACE_ROLE_RANK[role] : 0;
      },
      cell: (r) => {
        if (r.kind === 'invite') {
          const role = r.invite.workspaces.find((x) => x.workspaceId === w.id)?.role;
          return role ? ROLE_LABEL[role] : <span className="pcp-settings__muted">No access</span>;
        }
        const mem = r.member;
        const role = mem.workspaces.find((x) => x.workspaceId === w.id)?.role ?? null;
        if (mem.orgRole === 'ORG_ADMIN') return <span className="pcp-settings__muted">PMO Admin (via Org Admin)</span>;
        if (mem.userId === me?.user.id) return role ? ROLE_LABEL[role] : '—';
        return (
          <Select
            size="sm"
            aria-label={`Role in ${w.name} for ${mem.name}`}
            className="pcp-settings__select-cell"
            value={role ?? ''}
            onChange={(e) => void changeWsRole(mem, w.id, (e.target.value || null) as WorkspaceRole | null)}
            options={[{ value: '', label: 'No access' }, ...roleOptions(maxRole)]}
          />
        );
      },
    })),
    {
      id: 'person',
      header: 'Linked person',
      hideable: true,
      cell: (r) =>
        r.kind === 'member' && r.member.linkedPersonIds.length ? (
          r.member.linkedPersonIds.map((id) => people.get(id) ?? id).join(', ')
        ) : (
          <span className="pcp-settings__muted">—</span>
        ),
    },
    {
      id: 'last',
      header: 'Last sign-in',
      hideable: true,
      sortValue: (r) => (r.kind === 'member' ? (r.member.lastSignInAt ?? '') : ''),
      cell: (r) =>
        r.kind === 'invite' ? (
          <StatusPill tone="warning" icon={Mail}>
            Invited
          </StatusPill>
        ) : r.member.lastSignInAt ? (
          formatDate(r.member.lastSignInAt)
        ) : (
          <span className="pcp-settings__muted">Never</span>
        ),
    },
    {
      id: 'actions',
      header: <span className="pcp-sr-only">Actions</span>,
      headerText: 'Actions',
      align: 'right',
      width: 56,
      cell: (r) =>
        r.kind === 'invite' ? (
          <Menu
            trigger={<IconButton icon={Ellipsis} label={`Actions for ${r.invite.email}`} size="sm" />}
            items={[
              { id: 'resend', label: 'Resend', icon: RefreshCw, onSelect: () => void resend(r.invite) },
              ...(r.invite.inviteUrl
                ? [
                    {
                      id: 'copy',
                      label: 'Copy link',
                      icon: Copy,
                      onSelect: () => void copyText(r.invite.inviteUrl ?? '', toast),
                    },
                  ]
                : []),
              { id: 'revoke', label: 'Revoke', icon: Trash2, danger: true, onSelect: () => void revoke(r.invite) },
            ]}
          />
        ) : r.member.userId === me?.user.id ? null : (
          <Menu
            trigger={<IconButton icon={Ellipsis} label={`Actions for ${r.member.name}`} size="sm" />}
            items={[
              {
                id: 'remove',
                label: 'Remove from organisation',
                icon: UserMinus,
                danger: true,
                onSelect: () => void remove(r.member),
              },
            ]}
          />
        ),
    },
  ];

  return (
    <>
      <SectionHeader
        id="members"
        actions={
          <>
            <Button iconBefore={CircleQuestionMark} variant="subtle" onClick={() => setRolesOpen(true)}>
              About roles
            </Button>
            <Button variant="primary" iconBefore={UserPlus} onClick={() => setInviteOpen(true)}>
              Invite people
            </Button>
          </>
        }
      />
      <SectionBody wide>
        {!isOrgAdmin ? (
          <Banner tone="info">
            You can manage members of {workspace?.name} and give roles up to PMO Admin. Org roles are managed by an Org
            Admin.
          </Banner>
        ) : null}
        <DataTable
          id="settings-members"
          caption="Members and pending invitations"
          columns={columns}
          rows={rows}
          getRowId={(r) => (r.kind === 'member' ? `m-${r.member.userId}` : `i-${r.invite.id}`)}
          status={status}
          onRetry={() => void load()}
          errorMessage="We couldn't load the members."
          columnToggle
          toolbar={<SearchField value={query} onChange={setQuery} placeholder="Search members" size="sm" />}
          empty={
            query ? (
              <EmptyState icon={Users} title="No members match your search." compact />
            ) : (
              <EmptyState
                icon={Users}
                title="No members yet"
                description="Invite colleagues to plan capacity with you."
                action={
                  <Button variant="primary" iconBefore={UserPlus} onClick={() => setInviteOpen(true)}>
                    Invite people
                  </Button>
                }
                compact
              />
            )
          }
          maxHeight="none"
        />
      </SectionBody>

      {inviteOpen ? (
        <InviteDialog
          isOrgAdmin={isOrgAdmin}
          workspaces={visibleWs}
          defaultWorkspaceId={workspace?.id ?? null}
          onClose={() => setInviteOpen(false)}
          onInvited={(created) => setInvites((list) => [...created, ...list])}
        />
      ) : null}

      <Dialog
        open={rolesOpen}
        onClose={() => setRolesOpen(false)}
        title="About roles"
        footer={
          <Button variant="primary" onClick={() => setRolesOpen(false)}>
            Done
          </Button>
        }
      >
        <dl className="pcp-settings__roles">
          {(['ORG_ADMIN', ...WS_ROLES] as const).map((r) => (
            <div key={r} className="pcp-settings__roles-entry" style={{ display: 'contents' }}>
              <dt>{ROLE_LABEL[r]}</dt>
              <dd>{ROLE_SUMMARY[r]}</dd>
            </div>
          ))}
        </dl>
      </Dialog>
    </>
  );
}

async function copyText(text: string, toast: ReturnType<typeof useToast>) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Link copied');
  } catch {
    toast.warning('Copy the link manually', { body: text });
  }
}

function InviteDialog({
  isOrgAdmin,
  workspaces,
  defaultWorkspaceId,
  onClose,
  onInvited,
}: {
  isOrgAdmin: boolean;
  workspaces: Array<{ id: string; name: string }>;
  defaultWorkspaceId: string | null;
  onClose: () => void;
  onInvited: (created: PendingInvitation[]) => void;
}) {
  const m = useMutations();
  const { mode } = useSession();
  const toast = useToast();
  const [emails, setEmails] = useState('');
  const [orgRole, setOrgRole] = useState<OrgRole>('MEMBER');
  const [wsRoles, setWsRoles] = useState<Record<string, WorkspaceRole | null>>(() =>
    Object.fromEntries(workspaces.map((w) => [w.id, w.id === defaultWorkspaceId ? 'PLANNER' : null])),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<PendingInvitation[] | null>(null);

  const list = emails
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter(Boolean);
  const invalid = list.filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

  const submit = async () => {
    if (list.length === 0) {
      setError('Enter at least one email address.');
      return;
    }
    if (invalid.length) {
      setError(`Check these addresses: ${invalid.join(', ')}`);
      return;
    }
    const wsList = Object.entries(wsRoles)
      .filter((e): e is [string, WorkspaceRole] => !!e[1])
      .map(([workspaceId, role]) => ({ workspaceId, role }));
    if (orgRole !== 'ORG_ADMIN' && wsList.length === 0) {
      setError('Choose at least one workspace.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created: PendingInvitation[] = [];
      for (const email of list) {
        const res = await m.admin.invite({ email, orgRole, workspaces: wsList });
        const inv: PendingInvitation = {
          id: res.invitation.id,
          email: res.invitation.email,
          orgRole,
          workspaces: wsList,
          invitedAt: new Date().toISOString(),
          expiresAt: res.invitation.expiresAt,
          inviteUrl: res.inviteUrl,
        };
        if (mode === 'demo') rememberDemoInvitation(inv);
        created.push(inv);
      }
      onInvited(created);
      setResults(created);
      toast.success(`${created.length} invitation${created.length === 1 ? '' : 's'} created`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (results) {
    return (
      <Dialog
        open
        onClose={onClose}
        title="Invitations created"
        footer={
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        }
      >
        <div className="pcp-settings__form">
          <Banner tone="neutral">
            {mode === 'demo'
              ? "Email isn't set up. Send this link yourself; it works once and expires in 7 days."
              : "If email isn't set up, send each link yourself; it works once and expires in 7 days."}
          </Banner>
          <ul className="pcp-settings__invite-links">
            {results.map((r) => (
              <li key={r.id} className="pcp-settings__invite-link">
                <span className="pcp-settings__invite-email">{r.email}</span>
                {r.inviteUrl ? (
                  <Button size="sm" iconBefore={Copy} onClick={() => void copyText(r.inviteUrl ?? '', toast)}>
                    Copy link
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Invite people"
      subtitle="Invitations are single-use links that expire in 7 days."
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" iconBefore={UserPlus} loading={busy} onClick={() => void submit()}>
            {list.length > 1 ? `Invite ${list.length} people` : 'Send invitation'}
          </Button>
        </>
      }
    >
      <div className="pcp-settings__form">
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <FormField label="Email addresses" help="Separate several addresses with commas or new lines.">
          <Textarea
            rows={3}
            value={emails}
            placeholder="maria.kelly@example.com"
            onChange={(e) => setEmails(e.target.value)}
            data-autofocus=""
          />
        </FormField>
        {isOrgAdmin ? (
          <FormField label="Organisation role">
            <Select
              value={orgRole}
              onChange={(e) => setOrgRole(e.target.value as OrgRole)}
              options={[
                { value: 'MEMBER', label: 'Member: access to the workspaces below' },
                { value: 'ORG_ADMIN', label: 'Org Admin: everything in every workspace' },
              ]}
            />
          </FormField>
        ) : null}
        {orgRole !== 'ORG_ADMIN' ? (
          <fieldset className="pcp-fieldset">
            <legend className="pcp-field__label">Workspace roles</legend>
            <div className="pcp-settings__ws-roles">
              {workspaces.map((w) => (
                <div key={w.id} className="pcp-settings__ws-role">
                  <Checkbox
                    checked={!!wsRoles[w.id]}
                    onChange={(on) => setWsRoles({ ...wsRoles, [w.id]: on ? 'PLANNER' : null })}
                    label={w.name}
                  />
                  <Select
                    size="sm"
                    aria-label={`Role in ${w.name}`}
                    disabled={!wsRoles[w.id]}
                    value={wsRoles[w.id] ?? 'PLANNER'}
                    onChange={(e) => setWsRoles({ ...wsRoles, [w.id]: e.target.value as WorkspaceRole })}
                    options={WS_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
                  />
                </div>
              ))}
            </div>
          </fieldset>
        ) : null}
      </div>
    </Dialog>
  );
}
