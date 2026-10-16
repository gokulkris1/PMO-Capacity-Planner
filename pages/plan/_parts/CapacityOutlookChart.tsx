/** Four-quarter stacked capacity chart with demand marker and target line, plus its table view (RP-01, RP-02). */
import type { ReactNode } from 'react';
import type { OutlookPoint } from '../../../utils/viewModels';
import type { QuarterView } from '../../../state';
import { BandCell, ChartFrame, StackedBarChart, fmt } from '../_kit';

export function CapacityOutlookChart({
  title,
  caption,
  points,
  quarters,
  actions,
}: {
  title: string;
  caption?: ReactNode;
  points: OutlookPoint[];
  quarters: QuarterView[];
  actions?: ReactNode;
}) {
  const qLabel = (key: string) => quarters.find((q) => q.key === key);
  const columns = points.map((p) => {
    const q = qLabel(p.quarterKey);
    return {
      key: p.quarterKey,
      label: q?.label ?? p.quarterKey,
      sublabel: q?.calendarLabel,
      segments: [
        { kind: '1' as const, label: 'Above the table', value: p.aboveFte },
        { kind: '2' as const, label: 'Below the table', value: p.belowFte },
        { kind: '3' as const, label: 'Undeclared craft', value: p.undeclaredFte },
        { kind: 'bench' as const, label: 'Free capacity', value: p.freeFte },
      ],
      marker: { label: 'Demand', value: p.demandFte },
      target: { label: 'Supply at target', value: p.supplyFte },
      extra: [{ label: 'Utilisation', value: `${fmt.pct(p.utilisationPct)} of target` }],
    };
  });
  const table = (
    <div className="b2-table-wrap">
      <table className="b2-table b2-table--compact">
        <caption className="b2-sr-only">{title}</caption>
        <thead>
          <tr>
            <th scope="col">Quarter</th>
            <th scope="col" className="b2-num">
              Supply
            </th>
            <th scope="col" className="b2-num">
              Above
            </th>
            <th scope="col" className="b2-num">
              Below
            </th>
            <th scope="col" className="b2-num">
              Undeclared
            </th>
            <th scope="col" className="b2-num">
              Free
            </th>
            <th scope="col" className="b2-num">
              Demand
            </th>
            <th scope="col" className="b2-num">
              Utilisation
            </th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => {
            const q = qLabel(p.quarterKey);
            return (
              <tr key={p.quarterKey}>
                <th scope="row">
                  {q?.label} <span className="b2-caption">{q?.calendarLabel}</span>
                </th>
                <td className="b2-num">{fmt.fte(p.supplyFte)}</td>
                <td className="b2-num">{fmt.fte(p.aboveFte)}</td>
                <td className="b2-num">{fmt.fte(p.belowFte)}</td>
                <td className="b2-num">{fmt.fte(p.undeclaredFte)}</td>
                <td className="b2-num">{fmt.fte(p.freeFte)}</td>
                <td className="b2-num">{fmt.fte(p.demandFte)}</td>
                <td className="b2-num">
                  <BandCell value={p.utilisationPct} band={p.band} label={q?.label} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="b2-caption">All values in FTE except utilisation (load as a % of target).</p>
    </div>
  );
  return (
    <ChartFrame
      title={title}
      caption={caption}
      actions={actions}
      legend={[
        { swatch: '1', label: 'Above the table' },
        { swatch: '2', label: 'Below the table' },
        { swatch: '3', label: 'Undeclared craft' },
        { swatch: 'bench', label: 'Free capacity' },
        { swatch: 'demand', label: 'Demand' },
        { swatch: 'target', label: 'Supply at target' },
      ]}
      table={table}
    >
      <StackedBarChart
        columns={columns}
        unit="FTE"
        wide
        ariaLabel={`${title}. ${points
          .map(
            (p) =>
              `${qLabel(p.quarterKey)?.label}: ${fmt.fte(p.aboveFte + p.belowFte + p.undeclaredFte)} of ${fmt.fte(p.supplyFte)} FTE booked, demand ${fmt.fte(p.demandFte)} FTE`,
          )
          .join('. ')}`}
        format={(v) => fmt.fte(v)}
      />
    </ChartFrame>
  );
}
