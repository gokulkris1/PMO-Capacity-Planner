/**
 * Home (RP-01) — route `/o/:org/w/:ws/home`.
 * QBR KPI tiles, four-quarter capacity vs demand outlook, action lists and recent activity.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CircleUserRound,
  FileChartColumn,
  FolderKanban,
  Grid3x3,
  History,
  ListChecks,
  Store,
  TriangleAlert,
  Plus,
  Sparkles,
  Upload,
  Users,
} from 'lucide-react';
import type * as D from '../../shared/contracts/dto';
import { useApi, useEntitlements, useQuarters, useWorkspace } from '../../state';
import { buildDemandGrid, buildHome, type PersonRow } from '../../utils/viewModels';
import {
  BandCell,
  BandPill,
  Banner,
  Button,
  Card,
  CraftChip,
  EmptyState,
  fmt,
  indexSnapshot,
  KpiTile,
  PageHeader,
  PersonLabel,
  LinkButton,
  errorMessage,
  useToast,
} from '../../components/ui';
import { PageBody } from '../../components/shell/PageBody';
import { useTimeBasis, TimeBasisControl } from '../../components/shell/TimeBasis';
import { useWsPath } from '../../components/shell/workspacePath';
import { CapacityOutlookChart } from '../plan/_parts/CapacityOutlookChart';
import { useDelivery } from '../../state';
import './home.css';

export default function HomePage() {
  const basis = useTimeBasis('qbr1');
  const { can, workspace } = useWorkspace();
  const wsPath = useWsPath();
  const isContributor = workspace?.role === 'CONTRIBUTOR';
  return (
    <div className="pcp-page">
      <PageHeader
        breadcrumbs={[{ label: 'Home' }]}
        title="Home"
        description="Squad utilisation against the 100% target, open demand and what needs attention next."
        timeBasis={<TimeBasisControl state={basis} />}
        actions={
          <>
            {(isContributor || workspace?.linkedPersonId) && (
              <LinkButton variant="secondary" iconBefore={CircleUserRound} to={wsPath('me')}>
                My plan
              </LinkButton>
            )}
            {can('export') && (
              <LinkButton variant="secondary" iconBefore={FileChartColumn} to={wsPath('reports')}>
                QBR pack
              </LinkButton>
            )}
            {can('allocations.write') && (
              <LinkButton variant="primary" iconBefore={Grid3x3} to={wsPath('plan/allocations')}>
                Plan allocations
              </LinkButton>
            )}
          </>
        }
      />
      <PageBody skeleton="kpi" label="home">
        {(s) => (s.people.length === 0 && s.projects.length === 0 ? <FirstRun /> : <HomeBody snapshot={s} />)}
      </PageBody>
    </div>
  );
}

/**
 * ST-08#AC1 (QA-038): a workspace with no people and no projects shows how to start instead of a zeroed dashboard.
 */
function FirstRun() {
  const { can } = useWorkspace();
  const ent = useEntitlements();
  const { api, workspaceId, reload } = useApi();
  const wsPath = useWsPath();
  const toast = useToast();
  const [installing, setInstalling] = useState(false);
  const canWrite = can('people.write');
  const install = async () => {
    if (!workspaceId) return;
    setInstalling(true);
    try {
      await api.workspace.installSampleData(workspaceId);
      await reload();
      toast.success('Sample data installed');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setInstalling(false);
    }
  };
  return (
    <Card>
      <EmptyState
        icon={Users}
        title="Start your plan"
        description={
          canWrite
            ? 'Add the people in your squad and the projects they work on, import them from a CSV, or install sample data to look around first.'
            : 'Nothing has been planned in this workspace yet. A Planner or PMO Admin adds the people and projects.'
        }
        action={
          canWrite ? (
            <span className="home-firstrun__actions">
              <LinkButton variant="primary" iconBefore={Plus} to={`${wsPath('org/people')}?person=new`}>
                Add people
              </LinkButton>
              {can('import.csv') && ent.has('csvImport') ? (
                <LinkButton variant="secondary" iconBefore={Upload} to={`${wsPath('org/people')}?import=1`}>
                  Import CSV
                </LinkButton>
              ) : null}
              <Button variant="secondary" iconBefore={Sparkles} loading={installing} onClick={() => void install()}>
                Install sample data
              </Button>
            </span>
          ) : undefined
        }
      />
    </Card>
  );
}

function HomeBody({ snapshot: s }: { snapshot: D.WorkspaceSnapshot }) {
  const { thresholds, workspace, can } = useWorkspace();
  const quarters = useQuarters();
  const b = useTimeBasis('qbr1');
  const wsPath = useWsPath();
  const delivery = useDelivery(s);
  const idx = useMemo(() => indexSnapshot(s), [s]);
  const home = useMemo(
    () => buildHome(s, quarters, b.basis, thresholds, workspace),
    [s, quarters, b.basis, thresholds, workspace],
  );
  const demand = useMemo(() => buildDemandGrid(s, quarters), [s, quarters]);
  const qi = b.quarterIndex;
  const nextQ = quarters[qi + 1];

  // RP-01#AC3 (QA-023): the lists are the people behind the "Over capacity" and "Available" tiles, for the same
  // basis, so their counts match the tiles and the People band filter.
  const strained = home.over;
  const available = home.available;
  const unstaffed = demand
    .map((d) => ({ ...d, cell: d.cells[qi] }))
    .filter((d) => d.cell && d.cell.gapFte > 0.04)
    .sort((a, z) => z.cell.gapFte - a.cell.gapFte);
  const pendingCraft = s.craftRequests.filter((r) => r.status === 'pending');
  const myProposals = workspace?.linkedPersonId
    ? s.allocations.filter((a) => a.state === 'tentative' && a.resourceId === workspace.linkedPersonId)
    : [];
  const health = delivery.health;
  const personHref = (id: string) => `${wsPath('org/people')}?person=${encodeURIComponent(id)}`;
  const basisLabel = b.caption;
  const k = home.kpis;
  const dir = (a: number, z: number) => (a > z ? 'up' : a < z ? 'down' : null);

  return (
    <div className="pcp-stack">
      {health && (health.state === 'failed' || health.state === 'stale') && (
        <Banner
          tone="warning"
          title={
            health.state === 'failed'
              ? `Jira sync failed ${fmt.relative(health.lastJob?.finishedAt ?? null, s.serverTime)}: ${health.lastJob?.error ?? 'unknown reason'}`
              : `Jira data is stale: last successful sync ${fmt.relative(health.lastSuccessAt, s.serverTime)}`
          }
          actionNode={
            <LinkButton variant="link" to={`${wsPath('delivery/jira-planview')}?tab=health`}>
              View sync health
            </LinkButton>
          }
        />
      )}

      <div className="pcp-kpi-grid" role="list" aria-label="Key figures">
        <div role="listitem">
          <KpiTile
            label="Squad utilisation"
            value={fmt.pct(k.utilisationPct)}
            pill={<BandPill band={k.band} />}
            delta={
              nextQ
                ? {
                    direction: dir(k.nextQuarterPct, k.utilisationPct) ?? 'flat',
                    text: `${nextQ.label}: ${fmt.pct(k.nextQuarterPct)}`,
                  }
                : undefined
            }
            caption={`${basisLabel} · target 100%`}
            help="Σ load ÷ Σ target across the squad"
          />
        </div>
        <div role="listitem">
          <KpiTile
            label="Unstaffed demand"
            value={fmt.fte(k.unstaffedFte)}
            unit="FTE"
            delta={`${unstaffed.length} project${unstaffed.length === 1 ? '' : 's'} with a gap`}
            caption={basisLabel}
          />
        </div>
        <div role="listitem">
          <KpiTile
            label="Over capacity"
            value={k.overCount}
            unit={k.overCount === 1 ? 'person' : 'people'}
            delta={`Above ${thresholds.onTargetTo}% of target`}
            caption={basisLabel}
          />
        </div>
        <div role="listitem">
          <KpiTile
            label="Available"
            value={k.availableCount}
            unit={k.availableCount === 1 ? 'person' : 'people'}
            delta={`Below ${thresholds.benchBelow}% of target`}
            caption={basisLabel}
          />
        </div>
      </div>

      <div className="pcp-grid-xl">
        <div className="pcp-span-8">
          <CapacityOutlookChart
            title="Capacity vs demand, next four quarters"
            caption="Squad FTE by kind of work, with captured demand and the 100% target"
            points={home.outlook}
            quarters={quarters}
          />
        </div>
        <div className="pcp-span-4">
          <Card
            title="Over capacity"
            subtitle={basisLabel}
            className="home-sidecard"
            flush
            actions={
              <LinkButton variant="subtle" size="sm" to={`${wsPath('org/people')}?band=over`}>
                View all
              </LinkButton>
            }
          >
            <PeopleList rows={strained.slice(0, 5)} qi={qi} href={personHref} empty="Nobody is over capacity." />
          </Card>
          <div className="home-gap" />
          <Card
            title="Available"
            subtitle={`${basisLabel} · below ${thresholds.benchBelow}% of target`}
            className="home-sidecard"
            flush
            actions={
              <LinkButton variant="subtle" size="sm" to={`${wsPath('plan/marketplace')}?tab=under`}>
                Marketplace
              </LinkButton>
            }
          >
            <PeopleList
              rows={available.slice(0, 5)}
              qi={qi}
              href={personHref}
              empty="Nobody is in the Available band."
            />
          </Card>
        </div>
      </div>

      <div className="pcp-grid-xl">
        <div className="pcp-span-6">
          <Card
            title="Unstaffed demand"
            subtitle={`${basisLabel} · demand not yet covered by confirmed bookings`}
            className="home-sidecard"
            flush
            actions={
              <LinkButton
                variant="subtle"
                size="sm"
                iconBefore={Store}
                to={`${wsPath('plan/marketplace')}?quarter=${b.quarter?.key ?? ''}`}
              >
                Staff it
              </LinkButton>
            }
          >
            {unstaffed.length === 0 ? (
              <EmptyState
                compact
                icon={ListChecks}
                title="No open demand"
                description="Every captured demand line is staffed."
              />
            ) : (
              <ul className="pcp-list home-list">
                {unstaffed.slice(0, 6).map((d) => (
                  <li key={d.project.id}>
                    <div className="home-list__main">
                      <Link className="pcp-link pcp-strong" to={`${wsPath('org/projects')}?project=${d.project.id}`}>
                        {d.project.name}
                      </Link>
                      <span className="pcp-caption pcp-text-tertiary">{d.tribe?.name ?? 'No tribe'}</span>
                    </div>
                    <span className="pcp-chips home-list__chips">
                      {d.cell.lines.slice(0, 3).map((l) => (
                        <CraftChip key={l.id} craft={idx.crafts.get(l.craftId)} suffix={fmt.fte(l.fte)} />
                      ))}
                    </span>
                    <span className="pcp-num home-list__value">
                      <span className="pcp-strong">{fmt.fte(d.cell.gapFte)}</span>
                      <span className="pcp-caption pcp-text-tertiary"> FTE gap</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="pcp-span-6">
          <Card title="Needs a decision" subtitle="Approvals, proposals and projects without demand" flush>
            <ActionItems
              pendingCraft={pendingCraft.length}
              canApprove={can('craftProfile.approve')}
              myProposals={myProposals.length}
              projectsWithoutDemand={home.projectsWithoutDemand}
              wsPath={wsPath}
            />
          </Card>
        </div>
      </div>

      <RecentActivity snapshot={s} />
    </div>
  );
}

function PeopleList({
  rows,
  qi,
  href,
  empty,
}: {
  rows: PersonRow[];
  qi: number;
  href(id: string): string;
  empty: string;
}) {
  if (rows.length === 0) return <EmptyState compact icon={Users} title={empty} />;
  return (
    <ul className="pcp-list home-list">
      {rows.map((r) => {
        const q = r.quarters[qi];
        return (
          <li key={r.person.id}>
            <Link className="pcp-rowlink home-list__main" to={href(r.person.id)}>
              <PersonLabel name={r.person.name} sub={r.person.role} />
            </Link>
            <span className="home-list__band">
              <BandCell value={q.relativePct} band={q.band} label={r.person.name} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function ActionItems({
  pendingCraft,
  canApprove,
  myProposals,
  projectsWithoutDemand,
  wsPath,
}: {
  pendingCraft: number;
  canApprove: boolean;
  myProposals: number;
  projectsWithoutDemand: D.ProjectDTO[];
  wsPath(p: string): string;
}) {
  const items: Array<{ key: string; icon: typeof Users; text: string; to: string; cta: string; warn?: boolean }> = [];
  if (canApprove && pendingCraft > 0)
    items.push({
      key: 'craft',
      icon: ListChecks,
      text: `${pendingCraft} craft change${pendingCraft === 1 ? '' : 's'} waiting for approval`,
      to: `${wsPath('org/people')}?tab=requests`,
      cta: 'Review',
    });
  if (myProposals > 0)
    items.push({
      key: 'proposals',
      icon: CircleUserRound,
      text: `${myProposals} booking${myProposals === 1 ? '' : 's'} proposed to you`,
      to: wsPath('me'),
      cta: 'Respond',
    });
  for (const p of projectsWithoutDemand.slice(0, 4))
    items.push({
      key: `p-${p.id}`,
      icon: FolderKanban,
      text: `${p.name} is ${p.stage?.toLowerCase() ?? 'initiated'} with no demand captured for QBR1–2`,
      to: `${wsPath('plan/demand')}?project=${p.id}`,
      cta: 'Add demand',
      warn: true,
    });
  if (items.length === 0)
    return (
      <EmptyState
        compact
        icon={ListChecks}
        title="Nothing waiting"
        description="No approvals, proposals or gaps in demand capture."
      />
    );
  return (
    <ul className="pcp-list home-list">
      {items.map((it) => {
        const Icon = it.warn ? TriangleAlert : it.icon;
        return (
          <li key={it.key}>
            <Icon
              size={16}
              strokeWidth={1.75}
              aria-hidden="true"
              className={it.warn ? 'pcp-icon-status--warning' : 'pcp-icon-status--info'}
            />
            <span className="home-list__main">{it.text}</span>
            <LinkButton variant="secondary" size="sm" iconAfter={ArrowRight} to={it.to}>
              {it.cta}
            </LinkButton>
          </li>
        );
      })}
    </ul>
  );
}

function RecentActivity({ snapshot: s }: { snapshot: D.WorkspaceSnapshot }) {
  const idx = useMemo(() => indexSnapshot(s), [s]);
  const events = useMemo(() => {
    const out: Array<{ at: string; who: string; text: string; key: string }> = [];
    for (const a of s.allocations) {
      const person = idx.people.get(a.resourceId)?.name ?? 'Someone';
      const project = idx.projects.get(a.projectId)?.name ?? 'a project';
      if (a.proposedAt && a.state === 'tentative')
        out.push({
          key: `p${a.id}`,
          at: a.proposedAt,
          who: a.proposedBy?.name ?? 'A planner',
          text: `proposed ${person} for ${project} at ${a.percentage}%`,
        });
      else if (a.respondedAt)
        out.push({
          key: `r${a.id}`,
          at: a.respondedAt,
          who: person,
          text: `${a.state === 'confirmed' ? 'accepted' : 'declined'} ${project}`,
        });
      else if (a.updatedBy)
        out.push({
          key: `a${a.id}`,
          at: a.updatedAt,
          who: a.updatedBy.name,
          text: `changed ${person}'s booking on ${project}`,
        });
    }
    for (const l of s.demand)
      if (l.updatedBy)
        out.push({
          key: `d${l.id}`,
          at: l.updatedAt,
          who: l.updatedBy.name,
          text: `updated demand on ${idx.projects.get(l.projectId)?.name ?? 'a project'}`,
        });
    for (const p of s.people)
      if (p.updatedBy)
        out.push({ key: `u${p.id}`, at: p.updatedAt, who: p.updatedBy.name, text: `updated ${p.name}'s profile` });
    for (const r of s.craftRequests)
      out.push({
        key: `c${r.id}`,
        at: r.decidedAt ?? r.submittedAt,
        who: r.decidedBy?.name ?? r.submittedBy.name,
        text:
          r.status === 'pending'
            ? `asked to change ${idx.people.get(r.personId)?.name ?? 'a person'}'s crafts`
            : `${r.status} a craft change for ${idx.people.get(r.personId)?.name ?? 'a person'}`,
      });
    for (const o of s.offers)
      out.push({
        key: `o${o.personId}${o.quarterKey}`,
        at: o.createdAt,
        who: o.createdBy.name,
        text: `offered ${idx.people.get(o.personId)?.name ?? 'someone'} at ${o.pct}% on the Marketplace`,
      });
    return out.sort((a, z) => z.at.localeCompare(a.at)).slice(0, 6);
  }, [s, idx]);
  return (
    <Card title="Recent activity" subtitle="Latest changes in this workspace" flush>
      {events.length === 0 ? (
        <EmptyState
          compact
          icon={History}
          title="No recent changes"
          description="Edits, proposals and approvals will show here."
        />
      ) : (
        <ul className="pcp-list home-list">
          {events.map((e) => (
            <li key={e.key}>
              <PersonLabel name={e.who} />
              <span className="home-list__main pcp-text-secondary">{e.text}</span>
              <time className="pcp-caption pcp-text-tertiary" dateTime={e.at} title={fmt.dateTime(e.at)}>
                {fmt.relative(e.at, s.serverTime)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
