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
import { buildAllocationGrid, buildCapacityOutlook, buildCatalogue, buildDemandGrid } from '../../../utils/viewModels';
import {
  Button,
  Card,
  CraftChip,
  EmptyState,
  PageBody,
  PageHeader,
  SegmentedControl,
  Select,
  StatusPill,
  TabPanel,
  Tabs,
  TextField,
  cx,
  fmt,
  indexSnapshot,
  useBasis,
  useQueryParam,
  useWsPath,
  type BasisId,
} from '../_kit';
import { DemandCellDialog } from './DemandCellDialog';
import './demand.css';

export default function DemandPage() {
  const { can } = useWorkspace();
  const [, setEdit] = useQueryParam('edit');
  return (
    <div className="b2-page b2-page--dense">
      <PageHeader
        crumbs={[{ label: 'Plan' }, { label: 'Demand' }]}
        title="Demand"
        description="Craft demand per project and quarter, with what is staffed and the gap, and supply against demand by craft."
        actions={
          can('demand.write') && (
            <Button variant="primary" icon={Plus} onClick={() => setEdit('new')}>
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
    <div className="b2-stack b2-stack--sm">
      <div className="b2-row dm-head">
        <Tabs
          idPrefix="demand"
          label="Demand views"
          value={tab === 'craft' ? 'craft' : 'project'}
          onChange={(v) => setTab(v === 'project' ? null : v)}
          items={[
            { id: 'project', label: 'By project' },
            { id: 'craft', label: 'By craft' },
          ]}
        />
        <span className="b2-spacer" />
        {missing.length > 0 && (
          <Button
            size="sm"
            variant="subtle"
            icon={TriangleAlert}
            onClick={() => {
              setTab(null);
              setMissing('1');
            }}
          >
            Initiated projects without demand: {missing.length}
          </Button>
        )}
      </div>
      <TabPanel idPrefix="demand" value={tab === 'craft' ? 'craft' : 'project'}>
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
  const { can } = useWorkspace();
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
      <div className="b2-toolbar">
        <span className="dm-search">
          <TextField
            id="dm-q"
            icon={Search}
            size="sm"
            value={q}
            placeholder="Find a project"
            ariaLabel="Find a project"
            onChange={(v) => setQ(v)}
          />
        </span>
        <span className="dm-filter">
          <Select
            size="sm"
            ariaLabel="Filter by stage"
            value={stage}
            placeholder="Stage: all"
            onChange={setStage}
            options={fmt.STAGE_ORDER.map((x) => ({ value: x, label: `Stage: ${x}` }))}
          />
        </span>
        <span className="dm-filter">
          <Select
            size="sm"
            ariaLabel="Filter by tribe"
            value={tribe}
            placeholder="Tribe: all"
            onChange={setTribe}
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
            icon={X}
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
        <span className="b2-spacer" />
        <ul className="b2-legend" aria-label="Legend">
          <li>
            <span className="b2-chip b2-chip--demand-confirmed dm-legend-chip">PM 1.0</span> Confirmed
          </li>
          <li>
            <span className="b2-chip b2-chip--demand-forecast dm-legend-chip">PM 1.0</span> Forecast
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
            body="Add a project, then capture the crafts it needs per quarter."
          />
        )
      ) : (
        <div className="b2-table-wrap b2-table-wrap--tall">
          <table className="b2-table dm-table">
            <caption className="b2-sr-only">Demand by project and quarter</caption>
            <thead>
              <tr>
                <th scope="col" className="b2-sticky-col dm-col-project">
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
                  <tr className="b2-group">
                    <th scope="rowgroup" className="b2-sticky-col">
                      {g.label} <span className="b2-caption">· {g.rows.length}</span>
                    </th>
                    {quarters.map((qq, i) => {
                      const demand = g.rows.reduce((x, d) => x + d.cells[i].demandFte, 0);
                      const gap = g.rows.reduce((x, d) => x + Math.max(0, d.cells[i].gapFte), 0);
                      return (
                        <td key={qq.key} className="dm-total">
                          <span className="b2-tnum">{fmt.fte(demand)} FTE</span>
                          {gap > 0.04 && <span className="dm-gap"> · gap {fmt.fte(gap)}</span>}
                        </td>
                      );
                    })}
                  </tr>
                  {g.rows.map((d) => (
                    <tr key={d.project.id}>
                      <th scope="row" className="b2-sticky-col dm-col-project">
                        <span className="dm-project">
                          <Link
                            className="b2-link b2-strong b2-ellipsis"
                            to={`${wsPath('org/projects')}?project=${d.project.id}`}
                            title={d.project.name}
                          >
                            {d.project.name}
                          </Link>
                          <span className="dm-project__meta">
                            {d.project.stage && <StatusPill>{d.project.stage}</StatusPill>}
                            <span className="b2-caption">
                              {d.project.initiatedOn
                                ? `Initiated ${fmt.date(d.project.initiatedOn)}`
                                : fmt.dateRange(d.project.startDate, d.project.endDate)}
                            </span>
                          </span>
                          {missingIds.has(d.project.id) && (
                            <StatusPill tone="warning" icon={TriangleAlert}>
                              No demand captured
                            </StatusPill>
                          )}
                        </span>
                      </th>
                      {d.cells.map((c, i) => {
                        const content = (
                          <>
                            <span className="b2-chips dm-lines">
                              {c.lines.length === 0 && <span className="b2-subtle">{canEdit ? 'Add' : '—'}</span>}
                              {c.lines.map((l) => (
                                <span
                                  key={l.id}
                                  className={cx(
                                    'b2-chip',
                                    l.status === 'Confirmed' ? 'b2-chip--demand-confirmed' : 'b2-chip--demand-forecast',
                                  )}
                                  title={`${idx.crafts.get(l.craftId)?.name ?? l.craftId} · ${fmt.fte(l.fte)} FTE · ${l.status}${l.note ? ` · ${l.note}` : ''}`}
                                >
                                  {idx.crafts.get(l.craftId)?.short ?? '?'} {fmt.fte(l.fte)}
                                </span>
                              ))}
                            </span>
                            {(c.demandFte > 0 || c.staffedFte > 0) && (
                              <StaffBar demand={c.demandFte} staffed={c.staffedFte} proposed={c.proposedFte} />
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
                                aria-label={`Edit demand. ${label}`}
                                onClick={() => setCell({ projectId: d.project.id, quarterKey: c.quarterKey })}
                              >
                                {content}
                              </button>
                            ) : (
                              <div className="dm-cellbtn dm-cellbtn--ro" aria-label={label}>
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
        </div>
      )}
      <div className="b2-card__foot">
        <span className="b2-caption">
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

function StaffBar({ demand, staffed, proposed }: { demand: number; staffed: number; proposed: number }) {
  const scale = Math.max(demand, staffed + proposed, 0.1);
  const gap = Math.max(0, demand - staffed);
  return (
    <span className="dm-staff">
      <span className="dm-staff__track" aria-hidden="true">
        <span className="dm-staff__fill" style={{ width: `${(Math.min(staffed, scale) / scale) * 100}%` }} />
        {proposed > 0 && (
          <span className="dm-staff__prop" style={{ width: `${(Math.min(proposed, scale) / scale) * 100}%` }} />
        )}
        {demand > 0 && <span className="dm-staff__demand" style={{ left: `${(demand / scale) * 100}%` }} />}
      </span>
      <span className="dm-staff__label b2-tnum">
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
  const b = useBasis();
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
  const rows = outlook.rows
    .map((r) => {
      const c = committed.get(r.id) ?? quarters.map(() => 0);
      const gaps = r.points.map((p, i) => p.demandFte - c[i]);
      return { ...r, committed: c, gaps, reach: reach.get(r.id) ?? quarters.map(() => 0) };
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
          value={(b.id === 'today' || b.id === 'window' ? 'qbr1' : b.id) as BasisId}
          onChange={(v) => b.set(v)}
          items={quarters.map((q, i) => ({
            id: `qbr${i + 1}` as BasisId,
            label: q.label,
            title: fmt.quarterTooltip(q),
          }))}
        />
      }
    >
      <div className="b2-table-wrap">
        <table className="b2-table b2-table--compact dm-craft">
          <caption className="b2-sr-only">Supply and demand by craft</caption>
          <thead>
            <tr>
              <th scope="col" rowSpan={2} className="b2-sticky-col">
                Craft
              </th>
              <th scope="colgroup" colSpan={quarters.length} className="dm-craft__group">
                Gap (demand − committed)
              </th>
              <th scope="colgroup" colSpan={6} className="dm-craft__group is-basis">
                {b.caption}
              </th>
            </tr>
            <tr>
              {quarters.map((q, i) => (
                <th key={q.key} scope="col" className={cx('b2-num', i === 0 && 'dm-first', i === qi && 'is-basis')}>
                  {q.label}
                </th>
              ))}
              <th scope="col" className="b2-num dm-first">
                Supply
              </th>
              <th scope="col" className="b2-num">
                Committed
              </th>
              <th scope="col" className="b2-num">
                Demand
              </th>
              <th scope="col" className="b2-num">
                Gap
              </th>
              <th scope="col" className="b2-num">
                Bench
              </th>
              <th scope="col" className="b2-num">
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
                  <th scope="row" className="b2-sticky-col">
                    <span className="b2-row">
                      <CraftChip craft={craft} />
                      <span className="b2-ellipsis">{r.label}</span>
                    </span>
                  </th>
                  {r.gaps.map((g, i) => (
                    <td key={quarters[i].key} className={cx('b2-num', i === 0 && 'dm-first')}>
                      {g > 0.04 ? (
                        <Link
                          className="dm-gaplink"
                          to={`${wsPath('plan/marketplace')}?craft=${r.id}&quarter=${quarters[i].key}`}
                          title={`Open demand for ${r.label} in ${quarters[i].label} on the Marketplace`}
                        >
                          {fmt.fte(g)}
                        </Link>
                      ) : (
                        <span className="b2-subtle">{g < -0.04 ? `+${fmt.fte(-g)}` : '0.0'}</span>
                      )}
                    </td>
                  ))}
                  <td className="b2-num dm-first">{fmt.fte(p.supplyFte)}</td>
                  <td className="b2-num">{fmt.fte(r.committed[qi])}</td>
                  <td className="b2-num">{fmt.fte(p.demandFte)}</td>
                  <td className="b2-num">
                    {r.gaps[qi] > 0.04 ? (
                      <span className="dm-gap">{fmt.fte(r.gaps[qi])}</span>
                    ) : (
                      <span className="b2-subtle">0.0</span>
                    )}
                  </td>
                  <td className="b2-num">{fmt.fte(p.freeFte)}</td>
                  <td className="b2-num">{fmt.fte(r.reach[qi])}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="b2-card__foot">
        <span className="b2-caption">
          A positive gap links to the Marketplace filtered to that craft and quarter. A “+” value means more is
          committed than demanded.
        </span>
      </div>
    </Card>
  );
}
