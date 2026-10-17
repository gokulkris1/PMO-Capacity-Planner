/**
 * Demand roadmap (DM-02) — route `/o/:org/w/:ws/plan/demand` (`?tab=craft`, `?stage=`, `?tribe=`, `?missing=1`,
 * `?project=<id>` opens that project's QBR1 editor). Projects × QBR1–QBR4 × craft FTE with status, staffed vs gap,
 * and supply vs demand by craft including below-the-table reach.
 */
import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Funnel, Map as MapIcon, Plus, Search, TriangleAlert, X } from 'lucide-react';
import type * as D from '../../../shared/contracts/dto';
import { useQuarters, useWorkspace } from '../../../state';
import {
  buildAllocationGrid,
  buildCapacityOutlook,
  buildCatalogue,
  buildDemandGrid,
  unstaffedByCraft,
} from '../../../utils/viewModels';
import {
  Button,
  Card,
  CraftChip,
  cx,
  EmptyState,
  fmt,
  indexSnapshot,
  PageHeader,
  SegmentedControl,
  Select,
  StatusPill,
  TabPanel,
  Tabs,
  TextField,
  useQueryParam,
  TableScroll,
} from '../../../components/ui';
import { PageBody } from '../../../components/shell/PageBody';
import { type BasisKey, useTimeBasis } from '../../../components/shell/TimeBasis';
import { useWsPath } from '../../../components/shell/workspacePath';
import { DemandCellDialog } from './DemandCellDialog';
import './demand.css';
import { useViewportCan } from '../../../components/shell/viewport';

export default function DemandPage() {
  const can = useViewportCan();
  const [, setEdit] = useQueryParam('edit');
  return (
    <div className="pcp-page pcp-page--dense">
      <PageHeader
        breadcrumbs={[{ label: 'Plan' }, { label: 'Demand' }]}
        title="Demand"
        description="Craft demand per project and quarter, with what is staffed and the gap, and supply against demand by craft."
        actions={
          can('demand.write') && (
            <Button variant="primary" iconBefore={Plus} onClick={() => setEdit('new')}>
              Add demand
            </Button>
          )
        }
      />
      <PageBody label="demand">{(s) => <DemandBody snapshot={s} />}</PageBody>
    </div>
  );
}

const NEEDS_DEMAND: D.ProjectStage[] = ['Initiated', 'Mobilising'];

function DemandBody({ snapshot: s }: { snapshot: D.WorkspaceSnapshot }) {
  const quarters = useQuarters();
  const [tab, setTab] = useQueryParam('tab', 'project');
  const grid = useMemo(() => buildDemandGrid(s, quarters), [s, quarters]);
  const missing = grid.filter(
    (d) =>
      d.project.stage &&
      NEEDS_DEMAND.includes(d.project.stage) &&
      d.cells.slice(0, 2).every((c) => c.lines.length === 0),
  );
  const [, setMissing] = useQueryParam('missing');
  return (
    <div className="pcp-stack pcp-stack--md">
      <div className="pcp-row dm-head">
        <Tabs
          idBase="demand"
          label="Demand views"
          value={tab === 'craft' ? 'craft' : 'project'}
          onChange={(v) => setTab(v === 'project' ? null : v)}
          tabs={[
            { id: 'project', label: 'By project' },
            { id: 'craft', label: 'By craft' },
          ]}
        />
        <span className="pcp-spacer" />
        {missing.length > 0 && (
          <Button
            size="sm"
            variant="subtle"
            iconBefore={TriangleAlert}
            onClick={() => {
              setTab(null);
              setMissing('1');
            }}
          >
            Initiated projects without QBR1–2 demand: {missing.length}
          </Button>
        )}
      </div>
      <TabPanel idBase="demand" tabId={tab === 'craft' ? 'craft' : 'project'}>
        {tab === 'craft' ? (
          <ByCraft snapshot={s} />
        ) : (
          <ByProject snapshot={s} grid={grid} missingIds={new Set(missing.map((m) => m.project.id))} />
        )}
      </TabPanel>
    </div>
  );
}

function ByProject({
  snapshot: s,
  grid,
  missingIds,
}: {
  snapshot: D.WorkspaceSnapshot;
  grid: ReturnType<typeof buildDemandGrid>;
  missingIds: Set<string>;
}) {
  const quarters = useQuarters();
  const can = useViewportCan();
  const wsPath = useWsPath();
  const idx = useMemo(() => indexSnapshot(s), [s]);
  const [stage, setStage] = useQueryParam('stage');
  const [tribe, setTribe] = useQueryParam('tribe');
  const [missingOnly, setMissing] = useQueryParam('missing');
  const [q, setQ] = useQueryParam('q');
  const [edit, setEdit] = useQueryParam('edit');
  const [projectParam, setProjectParam] = useQueryParam('project');
  const [cell, setCell] = useState<{ projectId: string; quarterKey: string } | null>(null);
  const canEdit = can('demand.write');

  const rows = grid.filter(
    (d) =>
      (!stage || d.project.stage === stage) &&
      (!tribe || d.project.tribeId === tribe) &&
      (!missingOnly || missingIds.has(d.project.id)) &&
      (!q || d.project.name.toLowerCase().includes(q.toLowerCase())) &&
      d.project.status !== 'Completed',
  );
  const groups = useMemo(() => {
    const map = new Map<string, { id: string; label: string; rows: typeof rows }>();
    for (const d of rows) {
      const id = d.tribe?.id ?? 'none';
      if (!map.has(id)) map.set(id, { id, label: d.tribe?.name ?? 'No tribe', rows: [] });
      map.get(id)?.rows.push(d);
    }
    for (const g of map.values())
      g.rows.sort(
        (a, z) =>
          fmt.STAGE_ORDER.indexOf(a.project.stage ?? 'Pipeline') -
            fmt.STAGE_ORDER.indexOf(z.project.stage ?? 'Pipeline') || a.project.name.localeCompare(z.project.name),
      );
    return [...map.values()].sort((a, z) => a.label.localeCompare(z.label));
  }, [rows]);

  // `?project=<id>` (from Home / Projects) opens that project's first quarter editor once.
  const openFromLink =
    projectParam && !cell && canEdit ? { projectId: projectParam, quarterKey: quarters[0]?.key ?? '' } : null;
  const dialogTarget =
    cell ?? openFromLink ?? (edit === 'new' ? { projectId: '', quarterKey: quarters[0]?.key ?? '' } : null);
  const filters = [stage, tribe, missingOnly, q].filter(Boolean).length;

  return (
    <Card flush>
      <div className="pcp-tbl-toolbar">
        <span className="dm-search">
          <TextField
            id="dm-q"
            leadingIcon={Search}
            size="sm"
            value={q}
            placeholder="Find a project"
            aria-label="Find a project"
            onValueChange={(v) => setQ(v)}
          />
        </span>
        <span className="dm-filter">
          <Select
            size="sm"
            aria-label="Filter by stage"
            value={stage}
            placeholder="Stage: all"
            onValueChange={setStage}
            options={fmt.STAGE_ORDER.map((x) => ({ value: x, label: `Stage: ${x}` }))}
          />
        </span>
        <span className="dm-filter">
          <Select
            size="sm"
            aria-label="Filter by tribe"
            value={tribe}
            placeholder="Tribe: all"
            onValueChange={setTribe}
            options={s.tribes.filter((t) => !t.archived).map((t) => ({ value: t.id, label: `Tribe: ${t.name}` }))}
          />
        </span>
        {missingOnly && (
          <StatusPill tone="warning" icon={TriangleAlert}>
            Without demand
          </StatusPill>
        )}
        {filters > 0 && (
          <Button
            size="sm"
            variant="subtle"
            iconBefore={X}
            onClick={() => {
              setStage(null);
              setTribe(null);
              setMissing(null);
              setQ(null);
            }}
          >
            Clear filters
          </Button>
        )}
        <span className="pcp-spacer" />
        <ul className="pcp-legend" aria-label="Legend">
          <li>
            <span className="pcp-craft-chip pcp-craft-chip--demand-confirmed dm-legend-chip">PM 1.0</span> Confirmed
          </li>
          <li>
            <span className="pcp-craft-chip pcp-craft-chip--demand-forecast dm-legend-chip">PM 1.0</span> Forecast
          </li>
        </ul>
      </div>
      {rows.length === 0 ? (
        filters ? (
          <EmptyState icon={Funnel} title="No projects match these filters." />
        ) : (
          <EmptyState
            icon={MapIcon}
            title="No projects yet"
            description="Add a project, then capture the crafts it needs per quarter."
          />
        )
      ) : (
        <TableScroll className="pcp-tbl-wrap--tall">
          <table className="pcp-tbl dm-table">
            <caption className="pcp-sr-only">Demand by project and quarter</caption>
            <thead>
              <tr>
                <th scope="col" className="pcp-tbl-sticky dm-col-project">
                  Project
                </th>
                {quarters.map((qq) => (
                  <th key={qq.key} scope="col" className="dm-col-q" title={fmt.quarterTooltip(qq)}>
                    {qq.label} <span className="dm-sub">{qq.calendarLabel}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.id}>
                  <tr className="pcp-tbl-group">
                    <th scope="rowgroup" className="pcp-tbl-sticky">
                      {g.label} <span className="pcp-caption pcp-text-tertiary">· {g.rows.length}</span>
                    </th>
                    {quarters.map((qq, i) => {
                      const demand = g.rows.reduce((x, d) => x + d.cells[i].demandFte, 0);
                      const gap = g.rows.reduce((x, d) => x + Math.max(0, d.cells[i].gapFte), 0);
                      return (
                        <td key={qq.key} className="dm-total">
                          <span className="pcp-tnum">{fmt.fte(demand)} FTE</span>
                          {gap > 0.04 && <span className="dm-gap"> · gap {fmt.fte(gap)}</span>}
                        </td>
                      );
                    })}
                  </tr>
                  {g.rows.map((d) => (
                    <tr key={d.project.id}>
                      <th scope="row" className="pcp-tbl-sticky dm-col-project">
                        <span className="dm-project">
                          <Link
                            className="pcp-link pcp-strong pcp-truncate"
                            to={`${wsPath('org/projects')}?project=${d.project.id}`}
                            title={d.project.name}
                          >
                            {d.project.name}
                          </Link>
                          <span className="dm-project__meta">
                            {d.project.stage && <StatusPill>{d.project.stage}</StatusPill>}
                            <span className="pcp-caption pcp-text-tertiary">
                              {d.project.initiatedOn
                                ? `Initiated ${fmt.date(d.project.initiatedOn)}`
                                : fmt.dateRange(d.project.startDate, d.project.endDate)}
                            </span>
                          </span>
                          {missingIds.has(d.project.id) && (
                            // UAT-07: the rule (DM-02#AC3) looks at QBR1–QBR2 only; later demand does not count.
                            <StatusPill
                              tone="warning"
                              icon={TriangleAlert}
                              title="Initiated or Mobilising, with no demand captured for the next two quarters"
                            >
                              No QBR1–2 demand
                            </StatusPill>
                          )}
                        </span>
                      </th>
                      {d.cells.map((c, i) => {
                        const content = (
                          <>
                            <span className="pcp-chips dm-lines">
                              {c.lines.length === 0 && (
                                <span className="pcp-text-tertiary">{canEdit ? 'Add' : '—'}</span>
                              )}
                              {c.lines.map((l) => (
                                <span
                                  key={l.id}
                                  className={cx(
                                    'pcp-craft-chip',
                                    l.status === 'Confirmed'
                                      ? 'pcp-craft-chip--demand-confirmed'
                                      : 'pcp-craft-chip--demand-forecast',
                                  )}
                                  title={`${idx.crafts.get(l.craftId)?.name ?? l.craftId} · ${fmt.fte(l.fte)} FTE · ${l.status}${l.note ? ` · ${l.note}` : ''}`}
                                >
                                  {idx.crafts.get(l.craftId)?.short ?? '?'} {fmt.fte(l.fte)}
                                </span>
                              ))}
                            </span>
                            {(c.demandFte > 0 || c.bookedFte > 0) && (
                              <StaffBar
                                demand={c.demandFte}
                                staffed={c.demandFte > 0 ? c.staffedFte : c.bookedFte}
                                proposed={c.demandFte > 0 ? c.proposedFte : 0}
                                gap={c.gapFte}
                              />
                            )}
                          </>
                        );
                        const label = `${d.project.name}, ${quarters[i].label}: demand ${fmt.fte(c.demandFte)} FTE, staffed ${fmt.fte(c.staffedFte)}, gap ${fmt.fte(Math.max(0, c.gapFte))}`;
                        return (
                          <td key={c.quarterKey} className="dm-cell">
                            {canEdit ? (
                              <button
                                type="button"
                                className="dm-cellbtn"
                                onClick={() => setCell({ projectId: d.project.id, quarterKey: c.quarterKey })}
                              >
                                <span className="pcp-sr-only">Edit demand. {label}. </span>
                                {content}
                              </button>
                            ) : (
                              <div className="dm-cellbtn dm-cellbtn--ro">
                                <span className="pcp-sr-only">{label}. </span>
                                {content}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
      <div className="pcp-card__footer">
        <span className="pcp-caption pcp-text-tertiary">
          Bar: confirmed bookings (blue) and proposals (outlined) against demand. Gap = demand not yet staffed by
          confirmed bookings.
        </span>
      </div>
      {dialogTarget && (
        <DemandCellDialog
          snapshot={s}
          projectId={dialogTarget.projectId}
          quarterKey={dialogTarget.quarterKey}
          onClose={() => {
            setCell(null);
            setEdit(null);
            setProjectParam(null);
          }}
        />
      )}
    </Card>
  );
}

function StaffBar({
  demand,
  staffed,
  proposed,
  gap,
}: {
  demand: number;
  staffed: number;
  proposed: number;
  /** Unstaffed demand (per craft, `utils/viewModels/unstaffed.ts`). */
  gap: number;
}) {
  const scale = Math.max(demand, staffed + proposed, 0.1);
  return (
    <span className="dm-staff">
      <span className="dm-staff__track" aria-hidden="true">
        <span className="dm-staff__fill" style={{ width: `${(Math.min(staffed, scale) / scale) * 100}%` }} />
        {proposed > 0 && (
          <span className="dm-staff__prop" style={{ width: `${(Math.min(proposed, scale) / scale) * 100}%` }} />
        )}
        {demand > 0 && <span className="dm-staff__demand" style={{ left: `${(demand / scale) * 100}%` }} />}
      </span>
      <span className="dm-staff__label pcp-tnum">
        {fmt.fte(staffed)}/{fmt.fte(demand)}
        {gap > 0.04 && <span className="dm-gap"> gap {fmt.fte(gap)}</span>}
      </span>
    </span>
  );
}

function ByCraft({ snapshot: s }: { snapshot: D.WorkspaceSnapshot }) {
  const quarters = useQuarters();
  const { thresholds } = useWorkspace();
  const wsPath = useWsPath();
  const b = useTimeBasis('qbr1');
  const qi = b.quarterIndex;
  const outlook = useMemo(
    () => buildCapacityOutlook(s, quarters, { pivot: 'craft', thresholds }),
    [s, quarters, thresholds],
  );
  const committed = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const g of buildAllocationGrid(s, quarters, {
      groupBy: 'none',
      pivot: 'person',
      includeTentative: false,
      thresholds,
    }).groups)
      for (const r of g.rows)
        if (r.kind === 'booking' && r.craftId)
          map.set(
            r.craftId,
            (map.get(r.craftId) ?? quarters.map(() => 0)).map((v, i) => v + (r.cells[i]?.pct ?? 0) / 100),
          );
    return map;
  }, [s, quarters, thresholds]);
  const reach = useMemo(() => {
    const map = new Map<string, number[]>();
    quarters.forEach((q, i) => {
      for (const e of buildCatalogue(s, quarters, q.key)) {
        const arr = map.get(e.craft.id) ?? quarters.map(() => 0);
        arr[i] = e.reachBelowFte;
        map.set(e.craft.id, arr);
      }
    });
    return map;
  }, [s, quarters]);
  // Gap = unstaffed demand per project × craft, the Marketplace's number (QA-004). Surplus = committed beyond demand.
  const unstaffed = useMemo(() => unstaffedByCraft(s, quarters), [s, quarters]);
  const rows = outlook.rows
    .map((r) => {
      const c = committed.get(r.id) ?? quarters.map(() => 0);
      const gaps = unstaffed.get(r.id) ?? quarters.map(() => 0);
      const surplus = r.points.map((p, i) => Math.max(0, c[i] - p.demandFte));
      return { ...r, committed: c, gaps, surplus, reach: reach.get(r.id) ?? quarters.map(() => 0) };
    })
    .filter((r) => r.points.some((p) => p.supplyFte > 0 || p.demandFte > 0) || r.committed.some((v) => v > 0));
  return (
    <Card
      flush
      title="Supply vs demand by craft"
      subtitle="FTE · supply = above-the-table holders; committed = confirmed bookings under the craft; reach = extra FTE below-the-table holders could add"
      actions={
        <SegmentedControl
          size="sm"
          label="Quarter for detail"
          value={(b.key === 'today' || b.key === 'window' ? 'qbr1' : b.key) as BasisKey}
          onChange={(v) => b.setKey(v)}
          options={quarters.map((q, i) => ({
            value: `qbr${i + 1}` as BasisKey,
            label: q.label,
            title: fmt.quarterTooltip(q),
          }))}
        />
      }
    >
      <TableScroll>
        <table className="pcp-tbl pcp-tbl--compact dm-craft">
          <caption className="pcp-sr-only">Supply and demand by craft</caption>
          <thead>
            <tr>
              <th scope="col" rowSpan={2} className="pcp-tbl-sticky">
                Craft
              </th>
              <th scope="colgroup" colSpan={quarters.length} className="dm-craft__group">
                Unstaffed demand
              </th>
              <th scope="colgroup" colSpan={6} className="dm-craft__group is-basis">
                {b.caption}
              </th>
            </tr>
            <tr>
              {quarters.map((q, i) => (
                <th key={q.key} scope="col" className={cx('pcp-num', i === 0 && 'dm-first', i === qi && 'is-basis')}>
                  {q.label}
                </th>
              ))}
              <th scope="col" className="pcp-num dm-first">
                Supply
              </th>
              <th scope="col" className="pcp-num">
                Committed
              </th>
              <th scope="col" className="pcp-num">
                Demand
              </th>
              <th scope="col" className="pcp-num">
                Gap
              </th>
              <th scope="col" className="pcp-num">
                Bench
              </th>
              <th scope="col" className="pcp-num">
                Reach below
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const craft = s.crafts.find((c) => c.id === r.id);
              const p = r.points[qi];
              return (
                <tr key={r.id}>
                  <th scope="row" className="pcp-tbl-sticky">
                    <span className="pcp-row">
                      <CraftChip craft={craft} />
                      <span className="pcp-truncate">{r.label}</span>
                    </span>
                  </th>
                  {r.gaps.map((g, i) => (
                    <td key={quarters[i].key} className={cx('pcp-num', i === 0 && 'dm-first')}>
                      {g > 0.04 ? (
                        <Link
                          className="dm-gaplink"
                          to={`${wsPath('plan/marketplace')}?craft=${r.id}&quarter=${quarters[i].key}`}
                          title={`Open demand for ${r.label} in ${quarters[i].label} on the Marketplace`}
                        >
                          {fmt.fte(g)}
                        </Link>
                      ) : (
                        <span className="pcp-text-tertiary">
                          {r.surplus[i] > 0.04 ? `+${fmt.fte(r.surplus[i])}` : '0.0'}
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="pcp-num dm-first">{fmt.fte(p.supplyFte)}</td>
                  <td className="pcp-num">{fmt.fte(r.committed[qi])}</td>
                  <td className="pcp-num">{fmt.fte(p.demandFte)}</td>
                  <td className="pcp-num">
                    {r.gaps[qi] > 0.04 ? (
                      <span className="dm-gap">{fmt.fte(r.gaps[qi])}</span>
                    ) : (
                      <span className="pcp-text-tertiary">0.0</span>
                    )}
                  </td>
                  <td className="pcp-num">{fmt.fte(p.freeFte)}</td>
                  <td className="pcp-num">{fmt.fte(r.reach[qi])}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>
      <div className="pcp-card__footer">
        <span className="pcp-caption pcp-text-tertiary">
          Unstaffed demand is counted per project and craft, as on the Marketplace, and links to it filtered to that
          craft and quarter. A “+” value means more is committed under the craft than demanded.
        </span>
      </div>
    </Card>
  );
}
