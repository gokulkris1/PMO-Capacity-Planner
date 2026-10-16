/** Sprint and velocity per tribe (JI-05): last 6 sprints, committed vs done, implied vs planned FTE. */
import { useMemo } from 'react';
import { Activity } from 'lucide-react';
import type * as D from '../../../shared/contracts/dto';
import {
  Card,
  ChartFrame,
  EmptyState,
  GroupedBarChart,
  Select,
  StatusPill,
  TrendChart,
  fmt,
  useQueryParam,
} from '../../plan/_kit';
import { deliverySignalOf as deliverySignal, type DeliverySource } from '../../../state';

export function SprintsTab({ snapshot: s, delivery }: { snapshot: D.WorkspaceSnapshot; delivery: DeliverySource }) {
  const tribesWithData = useMemo(() => {
    const ids = new Set(delivery.sprintRows.map((r) => r.tribeId).filter((x): x is string => !!x));
    return s.tribes.filter((t) => ids.has(t.id));
  }, [delivery.sprintRows, s.tribes]);
  const [tribeParam, setTribe] = useQueryParam('tribe');
  const tribeId = tribeParam || tribesWithData[0]?.id || '';
  const rows = delivery.sprintRows
    .filter((r) => r.tribeId === tribeId)
    .sort((a, z) => a.from.localeCompare(z.from))
    .slice(-6);
  if (tribesWithData.length === 0)
    return (
      <Card>
        <EmptyState
          icon={Activity}
          title="No sprint data yet"
          body="Sprints appear once a mapped Jira board has synced."
        />
      </Card>
    );
  const tribeName = s.tribes.find((t) => t.id === tribeId)?.name ?? '';
  const cats = rows.map((r) => ({
    key: r.key,
    label: (r.sprintName ?? r.label).replace('Sprint ', 'S'),
    sublabel: fmt.dateShort(r.from),
  }));
  return (
    <div className="b2-stack">
      <div className="b2-row">
        <span className="dl-tribe-select">
          <Select
            ariaLabel="Tribe"
            value={tribeId}
            onChange={(v) => setTribe(v)}
            options={tribesWithData.map((t) => ({ value: t.id, label: t.name }))}
          />
        </span>
        <span className="b2-caption">Last {rows.length} sprints · the newest may still be running</span>
      </div>
      <div className="b2-grid-12">
        <div className="b2-col-6">
          <ChartFrame
            title={`Velocity · ${tribeName}`}
            caption="Story points committed and done per sprint"
            legend={[
              { swatch: 'other', label: 'Committed' },
              { swatch: '1', label: 'Done' },
            ]}
            table={<SprintTable rows={rows} />}
          >
            <GroupedBarChart
              ariaLabel={`Points committed and done per sprint for ${tribeName}`}
              unit="Points"
              categories={cats}
              series={[
                { name: 'Committed', kind: 'other', values: rows.map((r) => r.pointsTotal) },
                { name: 'Done', kind: '1', values: rows.map((r) => r.pointsDone) },
              ]}
            />
          </ChartFrame>
        </div>
        <div className="b2-col-6">
          <ChartFrame
            title="Implied vs planned FTE"
            caption="Points done ÷ calibration, against booked FTE · signal, not a timesheet"
            legend={[
              { swatch: '1', label: 'Planned FTE' },
              { swatch: '2', label: 'Jira-implied FTE' },
            ]}
            table={<SprintTable rows={rows} />}
          >
            <TrendChart
              ariaLabel={`Planned and implied FTE per sprint for ${tribeName}`}
              unit="FTE"
              height={244}
              categories={cats}
              series={[
                { name: 'Planned FTE', kind: '1', values: rows.map((r) => r.plannedFte) },
                { name: 'Jira-implied FTE', kind: '2', values: rows.map((r) => r.impliedFte) },
              ]}
              format={(v) => fmt.fte(v)}
            />
          </ChartFrame>
        </div>
      </div>
      <Card title="Sprints" subtitle={tribeName} flush>
        <SprintTable rows={rows} />
      </Card>
    </div>
  );
}

function SprintTable({ rows }: { rows: D.DeliveryRowDTO[] }) {
  return (
    <div className="b2-table-wrap">
      <table className="b2-table b2-table--compact">
        <caption className="b2-sr-only">Sprints</caption>
        <thead>
          <tr>
            <th scope="col">Sprint</th>
            <th scope="col">Dates</th>
            <th scope="col" className="b2-num">
              Committed
            </th>
            <th scope="col" className="b2-num">
              Done
            </th>
            <th scope="col" className="b2-num">
              Issues done
            </th>
            <th scope="col" className="b2-num">
              Implied FTE
            </th>
            <th scope="col" className="b2-num">
              Planned FTE
            </th>
            <th scope="col">Signal</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const sig = deliverySignal(r.plannedFte, r.impliedFte);
            return (
              <tr key={r.key}>
                <th scope="row">{r.sprintName}</th>
                <td className="b2-tnum">
                  {fmt.dateShort(r.from)} – {fmt.dateShort(r.to)}
                </td>
                <td className="b2-num">{r.pointsTotal}</td>
                <td className="b2-num">{r.pointsDone}</td>
                <td className="b2-num">{r.issuesDone}</td>
                <td className="b2-num">{fmt.fte(r.impliedFte)}</td>
                <td className="b2-num">{fmt.fte(r.plannedFte)}</td>
                <td>
                  <StatusPill tone={sig.kind === 'inline' ? 'success' : 'info'} title={sig.label}>
                    {sig.kind === 'inline' ? 'In line' : sig.kind === 'more' ? 'More effort' : 'Less effort'}
                  </StatusPill>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
