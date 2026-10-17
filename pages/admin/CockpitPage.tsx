import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, History, LogOut, ShieldCheck } from 'lucide-react';
import type { Plan } from '../../shared/entitlements';
import { useSession, useWorkspace } from '../../state';
import {
  Avatar,
  Banner,
  Button,
  Card,
  DataTable,
  EmptyState,
  KpiGrid,
  KpiTile,
  PageHeader,
  SearchField,
  Skeleton,
  StatusPill,
  formatDate,
  useConfirm,
  type Column,
} from '../../components/ui';
import { Wordmark } from '../../components/shell/ProductMark';
import { useClientGaps, type PlatformOverview } from '../../state';
import { NotFoundPage } from '../system/SystemPages';
import './cockpit.css';

type OrgRow = PlatformOverview['organisations'][number];
type EventRow = PlatformOverview['events'][number];
const PLAN_TONE: Record<Plan, 'neutral' | 'brand' | 'info' | 'success'> = {
  BASIC: 'neutral',
  PRO: 'brand',
  MAX: 'info',
  ENTERPRISE: 'success',
};

/** `/cockpit` (ST-09): platform administration, gated by the platform-admin flag (404 otherwise). */
export default function CockpitPage() {
  const { can } = useWorkspace();
  const { me, logout } = useSession();
  const gaps = useClientGaps();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [data, setData] = useState<PlatformOverview | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [query, setQuery] = useState('');
  const allowed = can('platform.admin');

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      setData(await gaps.platform.overview());
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [gaps]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load; state is set after the request resolves
    if (allowed) void load();
  }, [allowed, load]);

  if (!allowed) return <NotFoundPage fullPage />;

  const openOrg = async (o: OrgRow) => {
    const ok = await confirm({
      title: `Open ${o.name}?`,
      body: 'You will see this organisation read-only. The access is recorded in its audit log as support access.',
      confirmLabel: 'Open organisation',
      tone: 'primary',
    });
    if (ok) navigate(`/o/${encodeURIComponent(o.slug)}`);
  };

  const orgColumns: Column<OrgRow>[] = [
    {
      id: 'name',
      header: 'Organisation',
      width: 260,
      sortValue: (o) => o.name,
      cell: (o) => (
        <span className="pcp-cell-main">
          <Avatar name={o.name} size={24} />
          <span className="pcp-cell-main__text">
            <strong className="pcp-truncate">{o.name}</strong>
            <span className="pcp-cell-main__sub">/{o.slug}</span>
          </span>
        </span>
      ),
    },
    {
      id: 'plan',
      header: 'Plan',
      sortValue: (o) => o.plan,
      cell: (o) => <StatusPill tone={PLAN_TONE[o.plan]}>{o.plan}</StatusPill>,
    },
    { id: 'members', header: 'Members', align: 'right', sortValue: (o) => o.members, cell: (o) => o.members },
    {
      id: 'workspaces',
      header: 'Workspaces',
      align: 'right',
      sortValue: (o) => o.workspaces,
      cell: (o) => o.workspaces,
    },
    {
      id: 'last',
      header: 'Last activity',
      sortValue: (o) => o.lastActivityAt ?? '',
      cell: (o) => formatDate(o.lastActivityAt),
    },
    {
      id: 'open',
      header: <span className="pcp-sr-only">Open</span>,
      headerText: 'Open',
      align: 'right',
      width: 120,
      cell: (o) => (
        <Button size="sm" variant="subtle" iconBefore={ExternalLink} onClick={() => void openOrg(o)}>
          Open org
        </Button>
      ),
    },
  ];

  const eventColumns: Column<EventRow>[] = [
    {
      id: 'at',
      header: 'Time',
      width: 160,
      sortValue: (e) => e.at,
      cell: (e) =>
        `${formatDate(e.at)} ${new Date(e.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`,
    },
    { id: 'actor', header: 'Actor', sortValue: (e) => e.actor, cell: (e) => e.actor },
    {
      id: 'action',
      header: 'Action',
      sortValue: (e) => e.action,
      cell: (e) => <code className="pcp-cockpit__code">{e.action}</code>,
    },
    { id: 'org', header: 'Organisation', sortValue: (e) => e.org ?? '', cell: (e) => e.org ?? '—' },
  ];

  const orgs = (data?.organisations ?? []).filter(
    (o) => !query || o.name.toLowerCase().includes(query.toLowerCase()) || o.slug.includes(query.toLowerCase()),
  );

  return (
    <div className="pcp-cockpit">
      <a href="#main" className="pcp-skip-link">
        Skip to content
      </a>
      <header className="pcp-cockpit__bar">
        <Wordmark tone="inverse" />
        <StatusPill tone="info" icon={ShieldCheck}>
          Platform admin
        </StatusPill>
        <span className="pcp-spacer" />
        <span className="pcp-cockpit__user">{me?.user.email}</span>
        <Button
          variant="subtle"
          size="sm"
          iconBefore={LogOut}
          className="pcp-cockpit__signout"
          onClick={() => void logout().then(() => navigate('/login', { replace: true }))}
        >
          Sign out
        </Button>
      </header>
      <main id="main" tabIndex={-1} className="pcp-cockpit__main">
        <PageHeader
          title="Platform cockpit"
          description="Organisations, usage and platform-level audit events. Opening an organisation is audited."
          actions={me?.org ? <Button onClick={() => navigate('/')}>Back to my workspace</Button> : undefined}
        />
        <div className="pcp-page pcp-stack">
          {status === 'error' ? (
            <Banner tone="danger" action={{ label: 'Retry', onClick: () => void load() }}>
              {"We couldn't load platform data."}
            </Banner>
          ) : null}
          {status === 'loading' ? (
            <KpiGrid>
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} variant="kpi" />
              ))}
            </KpiGrid>
          ) : data ? (
            <KpiGrid label="Platform figures">
              <KpiTile label="Organisations" value={data.orgs} caption="All time" />
              <KpiTile label="Users" value={data.users} caption={`${data.unverifiedUsers} unverified`} />
              <KpiTile
                label="Workspaces"
                value={data.workspaces}
                caption={`${data.syncHealth.workspacesWithJira} with Jira`}
              />
              <KpiTile label="Active users" value={data.activeSessions} caption="Signed in, last 7 days" />
            </KpiGrid>
          ) : null}
          <DataTable
            id="cockpit-orgs"
            caption="Organisations"
            columns={orgColumns}
            rows={orgs}
            getRowId={(o) => o.id}
            status={status}
            onRetry={() => void load()}
            toolbar={<SearchField value={query} onChange={setQuery} placeholder="Search organisations" size="sm" />}
            maxHeight="none"
          />
          <Card title="Platform audit" subtitle="Most recent first" flush>
            <DataTable
              id="cockpit-audit"
              caption="Platform audit events"
              columns={eventColumns}
              rows={data?.events ?? []}
              getRowId={(e) => e.id}
              status={status}
              className="pcp-table-card--plain"
              maxHeight={360}
              empty={<EmptyState icon={History} title="No events yet" compact />}
            />
          </Card>
        </div>
      </main>
    </div>
  );
}
