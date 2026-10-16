/** Story points per tribe and quarter mapped to capacity: implied vs planned FTE with the delivery signal (JI-06). */
import { useMemo } from 'react';
import { useQuarters } from '../../../state';
import { Activity } from 'lucide-react';
import type * as D from '../../../shared/contracts/dto';
import { Card, ChartFrame, EmptyState, GroupedBarChart, StatusPill, fmt } from '../../plan/_kit';
import { deliverySignalOf as deliverySignal, type DeliverySource } from '../../../state';

export function OverviewTab({ snapshot: s, delivery }: { snapshot: D.WorkspaceSnapshot; delivery: DeliverySource }) {
  const tribes = useMemo(() => new Map(s.tribes.map((t) => [t.id, t.name])), [s.tribes]);
  const rows = [...delivery.quarterRows].sort(
    (a, z) =>
      (tribes.get(a.tribeId ?? '') ?? '').localeCompare(tribes.get(z.tribeId ?? '') ?? '') ||
      (a.quarterKey ?? '').localeCompare(z.quarterKey ?? ''),
  );
  const quarters = useQuarters();
  const keys = [...new Set(rows.map((r) => r.quarterKey ?? ''))].sort();
  // Default to the latest closed quarter: the current one only holds the running sprint.
  const latestQ = keys.filter((k) => k < (quarters[0]?.key ?? '')).pop() ?? keys[keys.length - 1];
  const latest = rows.filter((r) => r.quarterKey === latestQ);
  if (rows.length === 0)
    return (
      <Card>
        <EmptyState
          icon={Activity}
          title="No delivery data yet"
          body="Map Jira projects to planner projects and run a sync to see story points per tribe."
        />
      </Card>
    );
  return (
    <div className="b2-stack">
      <ChartFrame
        title={`Planned vs Jira-implied FTE · ${qLabel(latestQ)}`}
        caption="Average per sprint in the quarter; implied FTE = points done ÷ tribe calibration · signal, not a timesheet"
        legend={[
          { swatch: '1', label: 'Planned FTE' },
          { swatch: '2', label: 'Jira-implied FTE' },
        ]}
        table={<QuarterTable rows={latest} tribes={tribes} />}
      >
        <GroupedBarChart
          ariaLabel="Planned vs Jira-implied FTE per tribe"
          unit="FTE"
          categories={latest.map((r) => ({ key: r.key, label: tribes.get(r.tribeId ?? '') ?? 'Unmapped' }))}
          series={[
            { name: 'Planned FTE', kind: '1', values: latest.map((r) => r.plannedFte) },
            { name: 'Jira-implied FTE', kind: '2', values: latest.map((r) => r.impliedFte) },
          ]}
          format={(v) => fmt.fte(v)}
        />
      </ChartFrame>
      <Card title="Story points by tribe and quarter" subtitle="From stored sync snapshots; no live Jira call" flush>
        <QuarterTable rows={rows} tribes={tribes} />
      </Card>
    </div>
  );
}

function QuarterTable({ rows, tribes }: { rows: D.DeliveryRowDTO[]; tribes: Map<string, string> }) {
  return (
    <div className="b2-table-wrap">
      <table className="b2-table b2-table--compact">
        <caption className="b2-sr-only">Story points and implied FTE by tribe and quarter</caption>
        <thead>
          <tr>
            <th scope="col">Tribe</th>
            <th scope="col">Quarter</th>
            <th scope="col" className="b2-num">
              Points committed
            </th>
            <th scope="col" className="b2-num">
              Points done
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
                <th scope="row">{tribes.get(r.tribeId ?? '') ?? 'Unmapped'}</th>
                <td className="b2-tnum">{qLabel(r.quarterKey)}</td>
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

function qLabel(key: string | null | undefined): string {
  const m = /^(\d{4})-Q([1-4])$/.exec(key ?? '');
  return m ? `Q${m[2]} ${m[1]}` : (key ?? '');
}
