/**
 * Home (RP-01) — route `/o/:org/w/:ws/home`.
 * QBR KPI tiles, four-quarter capacity vs demand outlook, action lists and recent activity.
 */
import { useMemo } from 'react';
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
  Users,
} from 'lucide-react';
import type * as D from '../../shared/contracts/dto';
import { useQuarters, useWorkspace } from '../../state';
import { buildDemandGrid, buildHome, buildPeopleRows, type PersonRow } from '../../utils/viewModels';
import {
  Banner,
  BandCell,
  BandPill,
  Card,
  CraftChip,
  EmptyState,
  KpiTile,
  PageBody,
  PageHeader,
  PersonLabel,
  fmt,
  indexSnapshot,
  useBasis,
  useWsPath,
} from '../plan/_kit';
import { CapacityOutlookChart } from '../plan/_parts/CapacityOutlookChart';
import { useDelivery } from '../delivery/_parts/deliverySource';
import './home.css';

export default function HomePage() {
  const { can, workspace } = useWorkspace();
  const wsPath = useWsPath();
  const isContributor = workspace?.role === 'CONTRIBUTOR';
  return (
    <div className="b2-page">
      <PageHeader
        crumbs={[{ label: 'Home' }]}
        title="Home"
        description="Squad utilisation against the 100% target, open demand and what needs attention next."
        basis
        actions={
          <>
            {(isContributor || workspace?.linkedPersonId) && (
              <Link className="b2-btn b2-btn--secondary" to={wsPath('me')}>
                <CircleUserRound size={16} strokeWidth={1.75} aria-hidden="true" />
                My plan
              </Link>
            )}
            {can('export') && (
              <Link className="b2-btn b2-btn--secondary" to={wsPath('reports')}>
                <FileChartColumn size={16} strokeWidth={1.75} aria-hidden="true" />
                QBR pack
              </Link>
            )}
            {can('allocations.write') && (
              <Link className="b2-btn b2-btn--primary" to={wsPath('plan/allocations')}>
                <Grid3x3 size={16} strokeWidth={1.75} aria-hidden="true" />
                Plan allocations
              </Link>
            )}
          </>
        }
      />
      <PageBody skeleton="kpi" label="home">
        {(s) => <HomeBody snapshot={s} />}
      </PageBody>
    </div>
  );
}

function HomeBody({ snapshot: s }: { snapshot: D.WorkspaceSnapshot }) {
  const { thresholds, workspace, can } = useWorkspace();
  const quarters = useQuarters();
  const b = useBasis();
  const wsPath = useWsPath();
  const delivery = useDelivery(s);
  const idx = useMemo(() => indexSnapshot(s), [s]);
  const home = useMemo(
    () => buildHome(s, quarters, b.basis, thresholds, workspace),
    [s, quarters, b.basis, thresholds, workspace],
  );
  const rows = useMemo(() => buildPeopleRows(s, quarters, thresholds), [s, quarters, thresholds]);
  const demand = useMemo(() => buildDemandGrid(s, quarters), [s, quarters]);
  const qi = b.quarterIndex;
  const nextQ = quarters[qi + 1];

  const at = (r: PersonRow) => r.quarters[qi];
  const strained = rows.filter((r) => at(r)?.band === 'over').sort((a, z) => at(z).relativePct - at(a).relativePct);
  const underUsed = rows
    .filter((r) => at(r)?.band === 'bench' || at(r)?.band === 'under')
    .sort((a, z) => at(a).relativePct - at(z).relativePct);
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
    <div className="b2-stack">
      {health && (health.state === 'failed' || health.state === 'stale') && (
        <Banner
          tone="warning"
          title={
            health.state === 'failed'
              ? `Jira sync failed ${fmt.relative(health.lastJob?.finishedAt ?? null, s.serverTime)}: ${health.lastJob?.error ?? 'unknown reason'}`
              : `Jira data is stale: last successful sync ${fmt.relative(health.lastSuccessAt, s.serverTime)}`
          }
          action={
            <Link className="b2-btn b2-btn--link" to={`${wsPath('delivery/jira-planview')}?tab=health`}>
              View sync health
            </Link>
          }
        />
      )}

      <div className="b2-kpis" role="list" aria-label="Key figures">
        <div role="listitem">
          <KpiTile
            label="Squad utilisation"
            value={fmt.pct(k.utilisationPct)}
            pill={<BandPill band={k.band} />}
            delta={nextQ ? `${nextQ.label}: ${fmt.pct(k.nextQuarterPct)}` : undefined}
            deltaDirection={nextQ ? dir(k.nextQuarterPct, k.utilisationPct) : null}
            basis={`${basisLabel} · target 100%`}
            help="Σ load ÷ Σ target across the squad"
          />
        </div>
        <div role="listitem">
          <KpiTile
            label="Unstaffed demand"
            value={fmt.fte(k.unstaffedFte)}
            unit="FTE"
            delta={`${unstaffed.length} project${unstaffed.length === 1 ? '' : 's'} with a gap`}
            basis={basisLabel}
          />
        </div>
        <div role="listitem">
          <KpiTile
            label="Over capacity"
            value={k.overCount}
            unit={k.overCount === 1 ? 'person' : 'people'}
            delta={`Above ${thresholds.onTargetTo}% of target`}
            basis={basisLabel}
          />
        </div>
        <div role="listitem">
          <KpiTile
            label="Available"
            value={k.availableCount}
            unit={k.availableCount === 1 ? 'person' : 'people'}
            delta={`Below ${thresholds.benchBelow}% of target`}
            basis={basisLabel}
          />
        </div>
      </div>

      <div className="b2-grid-12">
        <div className="b2-col-8">
          <CapacityOutlookChart
            title="Capacity vs demand, next four quarters"
            caption="Squad FTE by kind of work, with captured demand and the 100% target"
            points={home.outlook}
            quarters={quarters}
          />
        </div>
        <div className="b2-col-4">
          <Card
            title="Over capacity"
            subtitle={basisLabel}
            flush
            actions={
              <Link className="b2-btn b2-btn--subtle b2-btn--sm" to={`${wsPath('org/people')}?band=over`}>
                View all
              </Link>
            }
          >
            <PeopleList rows={strained.slice(0, 5)} qi={qi} href={personHref} empty="Nobody is over capacity." />
          </Card>
          <div className="b2-gap" />
          <Card
            title="Under target"
            subtitle={`${basisLabel} · offer spare capacity on the Marketplace`}
            flush
            actions={
              <Link className="b2-btn b2-btn--subtle b2-btn--sm" to={`${wsPath('plan/marketplace')}?tab=under`}>
                Marketplace
              </Link>
            }
          >
            <PeopleList
              rows={underUsed.slice(0, 5)}
              qi={qi}
              href={personHref}
              empty="Everyone is at or above target."
            />
          </Card>
        </div>
      </div>

      <div className="b2-grid-12">
        <div className="b2-col-6">
          <Card
            title="Unstaffed demand"
            subtitle={`${basisLabel} · demand not yet covered by confirmed bookings`}
            flush
            actions={
              <Link
                className="b2-btn b2-btn--subtle b2-btn--sm"
                to={`${wsPath('plan/marketplace')}?quarter=${b.quarter?.key ?? ''}`}
              >
                <Store size={16} strokeWidth={1.75} aria-hidden="true" />
                Staff it
              </Link>
            }
          >
            {unstaffed.length === 0 ? (
              <EmptyState
                compact
                icon={ListChecks}
                title="No open demand"
                body="Every captured demand line is staffed."
              />
            ) : (
              <ul className="b2-list home-list">
                {unstaffed.slice(0, 6).map((d) => (
                  <li key={d.project.id}>
                    <div className="home-list__main">
                      <Link className="b2-link b2-strong" to={`${wsPath('org/projects')}?project=${d.project.id}`}>
                        {d.project.name}
                      </Link>
                      <span className="b2-caption">{d.tribe?.name ?? 'No tribe'}</span>
                    </div>
                    <span className="b2-chips home-list__chips">
                      {d.cell.lines.slice(0, 3).map((l) => (
                        <CraftChip key={l.id} craft={idx.crafts.get(l.craftId)} suffix={fmt.fte(l.fte)} />
                      ))}
                    </span>
                    <span className="b2-num home-list__value">
                      <span className="b2-strong">{fmt.fte(d.cell.gapFte)}</span>
                      <span className="b2-caption"> FTE gap</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="b2-col-6">
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
    <ul className="b2-list home-list">
      {rows.map((r) => {
        const q = r.quarters[qi];
        return (
          <li key={r.person.id}>
            <Link className="b2-rowlink home-list__main" to={href(r.person.id)}>
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
      text: `${p.name} is ${p.stage?.toLowerCase() ?? 'initiated'} with no demand captured`,
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
        body="No approvals, proposals or gaps in demand capture."
      />
    );
  return (
    <ul className="b2-list home-list">
      {items.map((it) => {
        const Icon = it.warn ? TriangleAlert : it.icon;
        return (
          <li key={it.key}>
            <Icon
              size={16}
              strokeWidth={1.75}
              aria-hidden="true"
              className={it.warn ? 'b2-icon-status--warning' : 'b2-icon-status--info'}
            />
            <span className="home-list__main">{it.text}</span>
            <Link className="b2-btn b2-btn--secondary b2-btn--sm" to={it.to}>
              {it.cta}
              <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
            </Link>
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
          body="Edits, proposals and approvals will show here."
        />
      ) : (
        <ul className="b2-list home-list">
          {events.map((e) => (
            <li key={e.key}>
              <PersonLabel name={e.who} />
              <span className="home-list__main b2-muted">{e.text}</span>
              <time className="b2-caption" dateTime={e.at} title={fmt.dateTime(e.at)}>
                {fmt.relative(e.at, s.serverTime)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
