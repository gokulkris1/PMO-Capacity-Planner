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
import {
  buildCapacityOutlook,
  buildPeopleRows,
  unstaffedByCraft,
  unstaffedByTribe,
  type PersonRow,
} from '../../../utils/viewModels';
import {
  BandCell,
  Button,
  Card,
  Checkbox,
  cx,
  EmptyState,
  fmt,
  PageHeader,
  PersonLabel,
  SegmentedControl,
  Select,
  TrendChart,
  useQueryParam,
  LinkButton,
  TableScroll,
} from '../../../components/ui';
import { PageBody } from '../../../components/shell/PageBody';
import { useTimeBasis, TimeBasisControl } from '../../../components/shell/TimeBasis';
import { useWsPath } from '../../../components/shell/workspacePath';
import { CapacityOutlookChart } from '../_parts/CapacityOutlookChart';
import { useDelivery } from '../../../state';
import './capacity.css';

type Pivot = 'craft' | 'chapter' | 'tribe' | 'person';

export default function CapacityOutlookPage() {
  const basis = useTimeBasis('qbr1');
  return (
    <div className="pcp-page">
      <PageHeader
        breadcrumbs={[{ label: 'Plan' }, { label: 'Capacity Outlook' }]}
        title="Capacity Outlook"
        description="Supply against demand for the next four quarters, by craft, chapter, tribe or person."
        timeBasis={<TimeBasisControl state={basis} exclude={['today', 'window']} />}
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
  const b = useTimeBasis('qbr1');
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

  // Gap = unstaffed demand, per project × craft (utils/viewModels/unstaffed.ts): the same number as Demand, Home and
  // the Marketplace (QA-004). By craft for the craft and chapter pivots, by the projects' tribe for the tribe pivot.
  const unstaffed = useMemo(
    () => ({ byCraft: unstaffedByCraft(s, quarters), byTribe: unstaffedByTribe(s, quarters) }),
    [s, quarters],
  );

  const gapFor = (rowId: string): number[] | null => {
    const none = quarters.map(() => 0);
    if (pivot === 'craft') return unstaffed.byCraft.get(rowId) ?? none;
    if (pivot === 'tribe') return unstaffed.byTribe.get(rowId) ?? none;
    if (pivot === 'chapter') {
      const c = s.chapters.find((x) => x.id === rowId)?.craftId;
      return c ? (unstaffed.byCraft.get(c) ?? none) : null;
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
  // UAT-06 (as QA-023 on Home): "Under target" is the Under band only; the Available band has its own list.
  const under = people.filter((r) => at(r)?.band === 'under').sort((a, z) => at(a).relativePct - at(z).relativePct);
  const available = people.filter((r) => at(r)?.band === 'bench').sort((a, z) => at(a).relativePct - at(z).relativePct);
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
    <div className="pcp-stack">
      <div className="pcp-row pcp-row--wrap co-controls">
        <SegmentedControl
          label="Pivot"
          value={pivot}
          onChange={(v) => setPivot(v)}
          options={[
            { value: 'craft', label: 'Craft' },
            { value: 'chapter', label: 'Chapter' },
            { value: 'tribe', label: 'Tribe' },
            { value: 'person', label: 'Person' },
          ]}
        />
        <span className="co-filter">
          <Select
            size="sm"
            aria-label="Filter by craft"
            value={craft}
            placeholder="Craft: all"
            onValueChange={setCraft}
            options={s.crafts.filter((c) => !c.archived).map((c) => ({ value: c.id, label: `Craft: ${c.name}` }))}
          />
        </span>
        <span className="co-filter">
          <Select
            size="sm"
            aria-label="Filter by chapter"
            value={chapter}
            placeholder="Chapter: all"
            onValueChange={setChapter}
            options={s.chapters.filter((c) => !c.archived).map((c) => ({ value: c.id, label: `Chapter: ${c.name}` }))}
          />
        </span>
        <span className="co-filter">
          <Select
            size="sm"
            aria-label="Filter by tribe"
            value={tribe}
            placeholder="Tribe: all"
            onValueChange={setTribe}
            options={s.tribes.filter((c) => !c.archived).map((c) => ({ value: c.id, label: `Tribe: ${c.name}` }))}
          />
        </span>
        {filters > 0 && (
          <Button
            size="sm"
            variant="subtle"
            iconBefore={X}
            onClick={() => {
              setCraft(null);
              setChapter(null);
              setTribe(null);
            }}
          >
            Clear filters
          </Button>
        )}
        <span className="pcp-spacer" />
        {pivot === 'tribe' && (
          <Checkbox checked={signal === '1'} onChange={(v) => setSignal(v ? '1' : null)} label="Delivery signal" />
        )}
      </div>

      <div className="pcp-grid-xl">
        <div className="pcp-span-8">
          <CapacityOutlookChart
            title={scopeLabel ? `Supply vs demand · ${scopeLabel}` : 'Squad supply vs demand'}
            caption="FTE by kind of work per quarter; demand captured on projects; dashed line = supply at target"
            points={model.squad}
            quarters={quarters}
          />
        </div>
        <div className="pcp-span-4 pcp-stack">
          <Card title="Over capacity" subtitle={b.caption} flush>
            <SideList rows={over.slice(0, 5)} qi={qi} wsPath={wsPath} empty="Nobody is over capacity." />
          </Card>
          <Card title="Under target" subtitle={b.caption} flush>
            <SideList rows={under.slice(0, 5)} qi={qi} wsPath={wsPath} empty="Nobody is in the Under target band." />
          </Card>
          <Card title="Available" subtitle={`${b.caption} · below ${thresholds.benchBelow}% of target`} flush>
            <SideList rows={available.slice(0, 5)} qi={qi} wsPath={wsPath} empty="Nobody is in the Available band." />
          </Card>
        </div>
      </div>

      {pivot === 'tribe' && signal === '1' && (
        <DeliverySignal snapshot={s} tribeId={tribe || null} canSetUp={can('integrations.run')} wsPath={wsPath} />
      )}

      <Card
        title={`By ${pivot}`}
        subtitle="Load and supply in FTE; utilisation is load as a % of target; gap is unstaffed demand (per project and craft, as on the Marketplace)"
        flush
      >
        {rows.length === 0 ? (
          <EmptyState
            icon={filters ? Funnel : Gauge}
            title={filters ? 'Nothing matches these filters.' : 'No capacity to show yet'}
            description={filters ? undefined : 'Add people and bookings to see the outlook.'}
          />
        ) : (
          <TableScroll>
            <table className="pcp-tbl pcp-tbl--compact co-table">
              <caption className="pcp-sr-only">Capacity by {pivot} and quarter</caption>
              <thead>
                <tr>
                  <th scope="col" rowSpan={2} className="pcp-tbl-sticky co-col-name">
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
                      className={cx('pcp-num co-sub-h', i === 0 && 'co-first', i === qi && 'is-basis')}
                      title={fmt.quarterTooltip(q)}
                    >
                      {q.label}
                    </th>
                  ))}
                  <th scope="col" className="pcp-num co-sub-h co-first">
                    Supply
                  </th>
                  <th scope="col" className="pcp-num co-sub-h">
                    Load
                  </th>
                  <th scope="col" className="pcp-num co-sub-h">
                    Free
                  </th>
                  {pivot !== 'person' && (
                    <th scope="col" className="pcp-num co-sub-h">
                      Demand
                    </th>
                  )}
                  {pivot !== 'person' && (
                    <th scope="col" className="pcp-num co-sub-h">
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
                  const gaps = r.total ? null : gapFor(r.id);
                  const p = r.points[qi];
                  const load = p ? p.aboveFte + p.belowFte + p.undeclaredFte : 0;
                  const gap = gaps && p ? (gaps[qi] ?? 0) : null;
                  return (
                    <tr key={r.id} className={cx(r.total && 'pcp-tbl-total')}>
                      <th scope="row" className="pcp-tbl-sticky co-col-name">
                        {r.total ? (
                          r.label
                        ) : pivot === 'person' ? (
                          <Link className="pcp-link" to={`${wsPath('org/people')}?person=${r.id}`}>
                            {r.label}
                          </Link>
                        ) : pivot === 'tribe' ? (
                          <Link className="pcp-link" to={wsPath(`org/tribes/${r.id}`)}>
                            {r.label}
                          </Link>
                        ) : (
                          r.label
                        )}
                      </th>
                      {r.points.map((pt, i) => (
                        <td key={pt.quarterKey} className={cx('pcp-num co-util', i === 0 && 'co-first')}>
                          {pt.supplyFte > 0 ? (
                            <BandCell
                              value={pt.utilisationPct}
                              band={pt.band}
                              label={`${r.label} ${quarters[i]?.label}`}
                            />
                          ) : (
                            <span className="pcp-text-tertiary">—</span>
                          )}
                        </td>
                      ))}
                      <td className="pcp-num co-first">{fmt.fte(p?.supplyFte)}</td>
                      <td className="pcp-num">{fmt.fte(load)}</td>
                      <td className="pcp-num">{fmt.fte(p?.freeFte)}</td>
                      {pivot !== 'person' && <td className="pcp-num">{fmt.fte(p?.demandFte)}</td>}
                      {pivot !== 'person' && (
                        <td className="pcp-num">
                          {gap === null ? (
                            <span className="pcp-text-tertiary" title="Not defined for this grouping">
                              —
                            </span>
                          ) : gap > 0.04 ? (
                            <span className="co-gap">{fmt.fte(gap)}</span>
                          ) : (
                            <span className="pcp-text-tertiary">0.0</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
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
  if (rows.length === 0) return <p className="co-empty pcp-text-secondary">{empty}</p>;
  return (
    <ul className="pcp-list co-list">
      {rows.map((r) => (
        <li key={r.person.id}>
          <Link className="pcp-rowlink co-list__main" to={`${wsPath('org/people')}?person=${r.person.id}`}>
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
            description="Connect Jira and run a sync to see delivery."
            action={
              <LinkButton variant="secondary" to={`${wsPath('delivery/jira-planview')}?tab=health`}>
                Open Jira & Planview
              </LinkButton>
            }
          />
        ) : (
          <p className="pcp-text-secondary">No delivery data has been synced for this workspace.</p>
        )}
      </Card>
    );
  }
  return (
    <Card
      title={`Delivery signal · ${tribeName}`}
      subtitle="Planned FTE (bookings) vs FTE implied by Jira story points per sprint · signal, not a timesheet"
    >
      <div className="pcp-stack pcp-stack--md">
        <ul className="pcp-legend" aria-label="Legend">
          <li>
            <span className="pcp-swatch pcp-swatch--1" aria-hidden="true" />
            Planned FTE
          </li>
          <li>
            <span className="pcp-swatch pcp-swatch--2" aria-hidden="true" />
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
