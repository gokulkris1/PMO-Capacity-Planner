/** Sprint and velocity per tribe (JI-05): last 6 sprints, committed vs done, implied vs planned FTE. */
import { useMemo } from 'react';
import { Activity } from 'lucide-react';
import type * as D from '../../../shared/contracts/dto';
import {
  Card,
  ChartPanel,
  EmptyState,
  fmt,
  GroupedBarChart,
  Select,
  StatusPill,
  TrendChart,
  useQueryParam,
  TableScroll,
} from '../../../components/ui';
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
          description="Sprints appear once a mapped Jira board has synced."
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
    <div className="pcp-stack">
      <div className="pcp-row">
        <span className="dl-tribe-select">
          <Select
            aria-label="Tribe"
            value={tribeId}
            onValueChange={(v) => setTribe(v)}
            options={tribesWithData.map((t) => ({ value: t.id, label: t.name }))}
          />
        </span>
        <span className="pcp-caption pcp-text-tertiary">
          Last {rows.length} sprints · the newest may still be running
        </span>
      </div>
      <div className="pcp-grid-xl">
        <div className="pcp-span-6">
          <ChartPanel
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
          </ChartPanel>
        </div>
        <div className="pcp-span-6">
          <ChartPanel
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
          </ChartPanel>
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
    <TableScroll>
      <table className="pcp-tbl pcp-tbl--compact">
        <caption className="pcp-sr-only">Sprints</caption>
        <thead>
          <tr>
            <th scope="col">Sprint</th>
            <th scope="col">Dates</th>
            <th scope="col" className="pcp-num">
              Committed
            </th>
            <th scope="col" className="pcp-num">
              Done
            </th>
            <th scope="col" className="pcp-num">
              Issues done
            </th>
            <th scope="col" className="pcp-num">
              Implied FTE
            </th>
            <th scope="col" className="pcp-num">
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
                <td className="pcp-tnum">
                  {fmt.dateShort(r.from)} – {fmt.dateShort(r.to)}
                </td>
                <td className="pcp-num">{r.pointsTotal}</td>
                <td className="pcp-num">{r.pointsDone}</td>
                <td className="pcp-num">{r.issuesDone}</td>
                <td className="pcp-num">{fmt.fte(r.impliedFte)}</td>
                <td className="pcp-num">{fmt.fte(r.plannedFte)}</td>
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
    </TableScroll>
  );
}
