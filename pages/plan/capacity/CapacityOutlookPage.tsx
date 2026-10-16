/**
 * Capacity Outlook (RP-02, JI-06#AC2) — route `/o/:org/w/:ws/plan/capacity`
 * (`?pivot=craft|chapter|tribe|person`, `?craft=`, `?chapter=`, `?tribe=`, `?basis=`, `?signal=1`).
 * Four-quarter supply vs demand chart, pivot table with utilisation bands, under/over side lists and the
 * planned vs Jira-implied delivery signal by tribe.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Activity, Funnel, Gauge, X } from 'lucide-react';
import type * as D from '../../../shared/contracts/dto';
import { useQuarters, useWorkspace } from '../../../state';
import { buildAllocationGrid, buildCapacityOutlook, buildPeopleRows, type PersonRow } from '../../../utils/viewModels';
import {
  BandCell,
  Button,
  Card,
  Checkbox,
  EmptyState,
  PageBody,
  PageHeader,
  PersonLabel,
  SegmentedControl,
  Select,
  TrendChart,
  cx,
  fmt,
  useBasis,
  useQueryParam,
  useWsPath,
} from '../_kit';
import { CapacityOutlookChart } from '../_parts/CapacityOutlookChart';
import { useDelivery } from '../../../state';
import './capacity.css';

type Pivot = 'craft' | 'chapter' | 'tribe' | 'person';

export default function CapacityOutlookPage() {
  return (
    <div className="b2-page">
      <PageHeader
        crumbs={[{ label: 'Plan' }, { label: 'Capacity Outlook' }]}
        title="Capacity Outlook"
        description="Supply against demand for the next four quarters, by craft, chapter, tribe or person."
        basis
        basisExclude={['today', 'window']}
      />
      <PageBody skeleton="kpi" label="the capacity outlook">
        {(s) => <OutlookBody snapshot={s} />}
      </PageBody>
    </div>
  );
}

function OutlookBody({ snapshot: s }: { snapshot: D.WorkspaceSnapshot }) {
  const { thresholds, can } = useWorkspace();
  const quarters = useQuarters();
  const b = useBasis();
  const wsPath = useWsPath();
  const [pivotRaw, setPivot] = useQueryParam('pivot', 'craft');
  const [craft, setCraft] = useQueryParam('craft');
  const [chapter, setChapter] = useQueryParam('chapter');
  const [tribe, setTribe] = useQueryParam('tribe');
  const [signal, setSignal] = useQueryParam('signal', '0');
  const pivot = (['craft', 'chapter', 'tribe', 'person'].includes(pivotRaw) ? pivotRaw : 'craft') as Pivot;
  const qi = b.quarterIndex;

  const model = useMemo(
    () =>
      buildCapacityOutlook(s, quarters, {
        pivot,
        craftId: craft || undefined,
        chapterId: chapter || undefined,
        tribeId: tribe || undefined,
        thresholds,
      }),
    [s, quarters, pivot, craft, chapter, tribe, thresholds],
  );

  // Staffed FTE used for the gap: by craft (confirmed bookings under that craft) and by tribe (bookings on its projects).
  const staffed = useMemo(() => {
    const opts = { includeTentative: false, thresholds } as const;
    const byCraft = new Map<string, number[]>();
    for (const g of buildAllocationGrid(s, quarters, { ...opts, groupBy: 'none', pivot: 'person' }).groups)
      for (const r of g.rows)
        if (r.kind === 'booking' && r.craftId) {
          const cur = byCraft.get(r.craftId) ?? quarters.map(() => 0);
          byCraft.set(
            r.craftId,
            cur.map((v, i) => v + (r.cells[i]?.pct ?? 0) / 100),
          );
        }
    const byTribe = new Map<string, number[]>();
    for (const g of buildAllocationGrid(s, quarters, { ...opts, groupBy: 'tribe', pivot: 'project' }).groups)
      byTribe.set(
        g.id,
        g.totals.map((c) => c.pct / 100),
      );
    return { byCraft, byTribe };
  }, [s, quarters, thresholds]);

  const staffedFor = (rowId: string): number[] | null => {
    if (pivot === 'craft') return staffed.byCraft.get(rowId) ?? quarters.map(() => 0);
    if (pivot === 'tribe') return staffed.byTribe.get(rowId) ?? quarters.map(() => 0);
    if (pivot === 'chapter') {
      const c = s.chapters.find((x) => x.id === rowId)?.craftId;
      return c ? (staffed.byCraft.get(c) ?? quarters.map(() => 0)) : null;
    }
    return null;
  };

  const people = useMemo(() => {
    const rows = buildPeopleRows(s, quarters, thresholds);
    return rows.filter(
      (r) =>
        (!craft || r.person.primaryCraft === craft) &&
        (!chapter || r.person.chapterId === chapter) &&
        (!tribe || r.person.homeTribeId === tribe),
    );
  }, [s, quarters, thresholds, craft, chapter, tribe]);
  const at = (r: PersonRow) => r.quarters[qi];
  const under = people
    .filter((r) => at(r)?.band === 'under' || at(r)?.band === 'bench')
    .sort((a, z) => at(a).relativePct - at(z).relativePct);
  const over = people.filter((r) => at(r)?.band === 'over').sort((a, z) => at(z).relativePct - at(a).relativePct);

  const filters = [craft, chapter, tribe].filter(Boolean).length;
  const scopeLabel = [
    craft && s.crafts.find((c) => c.id === craft)?.name,
    chapter && s.chapters.find((c) => c.id === chapter)?.name,
    tribe && s.tribes.find((c) => c.id === tribe)?.name,
  ]
    .filter(Boolean)
    .join(' · ');
  const rows = model.rows.filter((r) => r.points.some((p) => p.supplyFte > 0 || p.demandFte > 0));

  return (
    <div className="b2-stack">
      <div className="b2-row b2-row--wrap co-controls">
        <SegmentedControl
          label="Pivot"
          value={pivot}
          onChange={(v) => setPivot(v)}
          items={[
            { id: 'craft', label: 'Craft' },
            { id: 'chapter', label: 'Chapter' },
            { id: 'tribe', label: 'Tribe' },
            { id: 'person', label: 'Person' },
          ]}
        />
        <span className="co-filter">
          <Select
            size="sm"
            ariaLabel="Filter by craft"
            value={craft}
            placeholder="Craft: all"
            onChange={setCraft}
            options={s.crafts.filter((c) => !c.archived).map((c) => ({ value: c.id, label: `Craft: ${c.name}` }))}
          />
        </span>
        <span className="co-filter">
          <Select
            size="sm"
            ariaLabel="Filter by chapter"
            value={chapter}
            placeholder="Chapter: all"
            onChange={setChapter}
            options={s.chapters.filter((c) => !c.archived).map((c) => ({ value: c.id, label: `Chapter: ${c.name}` }))}
          />
        </span>
        <span className="co-filter">
          <Select
            size="sm"
            ariaLabel="Filter by tribe"
            value={tribe}
            placeholder="Tribe: all"
            onChange={setTribe}
            options={s.tribes.filter((c) => !c.archived).map((c) => ({ value: c.id, label: `Tribe: ${c.name}` }))}
          />
        </span>
        {filters > 0 && (
          <Button
            size="sm"
            variant="subtle"
            icon={X}
            onClick={() => {
              setCraft(null);
              setChapter(null);
              setTribe(null);
            }}
          >
            Clear filters
          </Button>
        )}
        <span className="b2-spacer" />
        {pivot === 'tribe' && (
          <Checkbox checked={signal === '1'} onChange={(v) => setSignal(v ? '1' : null)} label="Delivery signal" />
        )}
      </div>

      <div className="b2-grid-12">
        <div className="b2-col-8">
          <CapacityOutlookChart
            title={scopeLabel ? `Supply vs demand · ${scopeLabel}` : 'Squad supply vs demand'}
            caption="FTE by kind of work per quarter; demand captured on projects; dashed line = supply at target"
            points={model.squad}
            quarters={quarters}
          />
        </div>
        <div className="b2-col-4 b2-stack">
          <Card title="Over capacity" subtitle={b.caption} flush>
            <SideList rows={over.slice(0, 5)} qi={qi} wsPath={wsPath} empty="Nobody is over capacity." />
          </Card>
          <Card title="Under target" subtitle={b.caption} flush>
            <SideList rows={under.slice(0, 5)} qi={qi} wsPath={wsPath} empty="Everyone is at or above target." />
          </Card>
        </div>
      </div>

      {pivot === 'tribe' && signal === '1' && (
        <DeliverySignal snapshot={s} tribeId={tribe || null} canSetUp={can('integrations.run')} wsPath={wsPath} />
      )}

      <Card
        title={`By ${pivot}`}
        subtitle="Load and supply in FTE; utilisation is load as a % of target; gap is demand not covered by confirmed bookings"
        flush
      >
        {rows.length === 0 ? (
          <EmptyState
            icon={filters ? Funnel : Gauge}
            title={filters ? 'Nothing matches these filters.' : 'No capacity to show yet'}
            body={filters ? undefined : 'Add people and bookings to see the outlook.'}
          />
        ) : (
          <div className="b2-table-wrap">
            <table className="b2-table b2-table--compact co-table">
              <caption className="b2-sr-only">Capacity by {pivot} and quarter</caption>
              <thead>
                <tr>
                  <th scope="col" rowSpan={2} className="b2-sticky-col co-col-name">
                    {pivot[0].toUpperCase() + pivot.slice(1)}
                  </th>
                  <th scope="colgroup" colSpan={quarters.length} className="co-qgroup">
                    Utilisation (% of target)
                  </th>
                  <th scope="colgroup" colSpan={pivot === 'person' ? 3 : 5} className="co-qgroup is-basis">
                    {b.caption} · FTE
                  </th>
                </tr>
                <tr>
                  {quarters.map((q, i) => (
                    <th
                      key={q.key}
                      scope="col"
                      className={cx('b2-num co-sub-h', i === 0 && 'co-first', i === qi && 'is-basis')}
                      title={fmt.quarterTooltip(q)}
                    >
                      {q.label}
                    </th>
                  ))}
                  <th scope="col" className="b2-num co-sub-h co-first">
                    Supply
                  </th>
                  <th scope="col" className="b2-num co-sub-h">
                    Load
                  </th>
                  <th scope="col" className="b2-num co-sub-h">
                    Free
                  </th>
                  {pivot !== 'person' && (
                    <th scope="col" className="b2-num co-sub-h">
                      Demand
                    </th>
                  )}
                  {pivot !== 'person' && (
                    <th scope="col" className="b2-num co-sub-h">
                      Gap
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {[
                  { id: '__squad', label: scopeLabel || 'Squad', points: model.squad, total: true },
                  ...rows.map((r) => ({ ...r, total: false })),
                ].map((r) => {
                  const st = r.total ? null : staffedFor(r.id);
                  const p = r.points[qi];
                  const load = p ? p.aboveFte + p.belowFte + p.undeclaredFte : 0;
                  const gap = st && p ? Math.max(0, p.demandFte - (st[qi] ?? 0)) : null;
                  return (
                    <tr key={r.id} className={cx(r.total && 'b2-total')}>
                      <th scope="row" className="b2-sticky-col co-col-name">
                        {r.total ? (
                          r.label
                        ) : pivot === 'person' ? (
                          <Link className="b2-link" to={`${wsPath('org/people')}?person=${r.id}`}>
                            {r.label}
                          </Link>
                        ) : pivot === 'tribe' ? (
                          <Link className="b2-link" to={wsPath(`org/tribes/${r.id}`)}>
                            {r.label}
                          </Link>
                        ) : (
                          r.label
                        )}
                      </th>
                      {r.points.map((pt, i) => (
                        <td key={pt.quarterKey} className={cx('b2-num co-util', i === 0 && 'co-first')}>
                          {pt.supplyFte > 0 ? (
                            <BandCell
                              value={pt.utilisationPct}
                              band={pt.band}
                              label={`${r.label} ${quarters[i]?.label}`}
                            />
                          ) : (
                            <span className="b2-subtle">—</span>
                          )}
                        </td>
                      ))}
                      <td className="b2-num co-first">{fmt.fte(p?.supplyFte)}</td>
                      <td className="b2-num">{fmt.fte(load)}</td>
                      <td className="b2-num">{fmt.fte(p?.freeFte)}</td>
                      {pivot !== 'person' && <td className="b2-num">{fmt.fte(p?.demandFte)}</td>}
                      {pivot !== 'person' && (
                        <td className="b2-num">
                          {gap === null ? (
                            <span className="b2-subtle" title="Not defined for this grouping">
                              —
                            </span>
                          ) : gap > 0.04 ? (
                            <span className="co-gap">{fmt.fte(gap)}</span>
                          ) : (
                            <span className="b2-subtle">0.0</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function SideList({
  rows,
  qi,
  wsPath,
  empty,
}: {
  rows: PersonRow[];
  qi: number;
  wsPath(p: string): string;
  empty: string;
}) {
  if (rows.length === 0) return <p className="co-empty b2-muted">{empty}</p>;
  return (
    <ul className="b2-list co-list">
      {rows.map((r) => (
        <li key={r.person.id}>
          <Link className="b2-rowlink co-list__main" to={`${wsPath('org/people')}?person=${r.person.id}`}>
            <PersonLabel name={r.person.name} sub={r.primary?.name ?? r.person.role} />
          </Link>
          <span className="co-list__band">
            <BandCell value={r.quarters[qi].relativePct} band={r.quarters[qi].band} label={r.person.name} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function DeliverySignal({
  snapshot: s,
  tribeId,
  canSetUp,
  wsPath,
}: {
  snapshot: D.WorkspaceSnapshot;
  tribeId: string | null;
  canSetUp: boolean;
  wsPath(p: string): string;
}) {
  const delivery = useDelivery(s);
  const series = useMemo(() => {
    const rows = delivery.sprintRows.filter((r) => !tribeId || r.tribeId === tribeId);
    const bySprint = new Map<string, { label: string; from: string; planned: number; implied: number }>();
    for (const r of rows) {
      const k = r.sprintName ?? r.key;
      const cur = bySprint.get(k) ?? { label: k, from: r.from, planned: 0, implied: 0 };
      cur.planned += r.plannedFte;
      cur.implied += r.impliedFte;
      bySprint.set(k, cur);
    }
    return [...bySprint.values()].sort((a, z) => a.from.localeCompare(z.from));
  }, [delivery.sprintRows, tribeId]);
  const tribeName = tribeId ? s.tribes.find((t) => t.id === tribeId)?.name : 'All tribes';
  if (series.length < 2) {
    return (
      <Card title="Delivery signal" subtitle="Planned vs Jira-implied FTE · signal, not a timesheet">
        {canSetUp ? (
          <EmptyState
            compact
            icon={Activity}
            title="No delivery data yet"
            body="Connect Jira and run a sync to see delivery."
            action={
              <Link className="b2-btn b2-btn--secondary" to={`${wsPath('delivery/jira-planview')}?tab=health`}>
                Open Jira & Planview
              </Link>
            }
          />
        ) : (
          <p className="b2-muted">No delivery data has been synced for this workspace.</p>
        )}
      </Card>
    );
  }
  return (
    <Card
      title={`Delivery signal · ${tribeName}`}
      subtitle="Planned FTE (bookings) vs FTE implied by Jira story points per sprint · signal, not a timesheet"
    >
      <div className="b2-stack b2-stack--sm">
        <ul className="b2-legend" aria-label="Legend">
          <li>
            <span className="b2-swatch b2-swatch--1" aria-hidden="true" />
            Planned FTE
          </li>
          <li>
            <span className="b2-swatch b2-swatch--2" aria-hidden="true" />
            Jira-implied FTE
          </li>
        </ul>
        <TrendChart
          ariaLabel={`Planned vs implied FTE per sprint for ${tribeName}`}
          unit="FTE"
          categories={series.map((x) => ({ key: x.label, label: x.label.replace('Sprint ', 'S') }))}
          series={[
            { name: 'Planned FTE', kind: '1', values: series.map((x) => x.planned) },
            { name: 'Jira-implied FTE', kind: '2', values: series.map((x) => x.implied) },
          ]}
        />
      </div>
    </Card>
  );
}
