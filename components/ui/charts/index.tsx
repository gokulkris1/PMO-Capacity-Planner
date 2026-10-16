/**
 * Chart kit (DS-05, DESIGN_SYSTEM §11). Import from 'components/ui/charts' (NOT the main barrel) so Recharts
 * stays in its own lazily loaded vendor chunk. Colours come only from CSS variables read at render time.
 */
import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartColumnStacked, Table2 } from 'lucide-react';
import { SegmentedControl } from '../Tabs';
import { DataTable, type Column } from '../DataTable';
import { cx } from '../internal/utils';
import './charts.css';

const TOKENS = [
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
  '--chart-6',
  '--chart-7',
  '--chart-8',
  '--chart-other',
  '--chart-target',
  '--chart-bench',
  '--chart-bench-hatch',
  '--chart-grid',
  '--chart-axis',
  '--color-surface',
  '--color-text',
  '--color-text-secondary',
] as const;
type ChartToken = (typeof TOKENS)[number];

function readTokens(): Record<ChartToken, string> {
  const out = {} as Record<ChartToken, string>;
  if (typeof document === 'undefined') return out;
  const cs = getComputedStyle(document.documentElement);
  for (const t of TOKENS) out[t] = cs.getPropertyValue(t).trim();
  return out;
}

let cached: Record<ChartToken, string> | null = null;
let cachedKey = '';
function snapshot(): Record<ChartToken, string> {
  const key = typeof document === 'undefined' ? '' : `${document.documentElement.dataset.theme ?? ''}|${document.documentElement.dataset.embedded ?? ''}`;
  if (!cached || key !== cachedKey) {
    cached = readTokens();
    cachedKey = key;
  }
  return cached;
}
function subscribe(cb: () => void): () => void {
  if (typeof MutationObserver === 'undefined') return () => undefined;
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-embedded'] });
  return () => mo.disconnect();
}

/** Chart colours resolved from tokens (re-read when the theme attribute changes). */
export function useChartColors(): Record<ChartToken, string> {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export interface LegendItem {
  label: string;
  /** Token name, e.g. '--chart-1'. */
  token: ChartToken;
  kind?: 'bar' | 'line' | 'dashed' | 'hatch' | 'marker';
}

function Legend({ items }: { items: LegendItem[] }) {
  const colors = useChartColors();
  return (
    <ul className="pcp-chart__legend">
      {items.map((i) => (
        <li key={i.label} className="pcp-chart__legend-item">
          <svg width="16" height="12" aria-hidden="true" focusable="false">
            {i.kind === 'line' ? (
              <line x1="0" y1="6" x2="16" y2="6" stroke={colors[i.token]} strokeWidth="2" />
            ) : i.kind === 'dashed' ? (
              <line x1="0" y1="6" x2="16" y2="6" stroke={colors[i.token]} strokeWidth="2" strokeDasharray="4 3" />
            ) : i.kind === 'marker' ? (
              <rect x="4" y="2" width="8" height="8" transform="rotate(45 8 6)" fill={colors[i.token]} />
            ) : i.kind === 'hatch' ? (
              <>
                <rect x="1" y="1" width="14" height="10" rx="2" fill={colors['--chart-bench']} />
                <path d="M3 11 L11 1 M8 11 L15 2" stroke={colors['--chart-bench-hatch']} strokeWidth="1" />
              </>
            ) : (
              <rect x="1" y="1" width="14" height="10" rx="2" fill={colors[i.token]} />
            )}
          </svg>
          <span>{i.label}</span>
        </li>
      ))}
    </ul>
  );
}

export interface ChartFrameProps {
  title: string;
  /** Time-basis caption, e.g. "QBR1–QBR4 · Q4 2026 – Q3 2027". */
  caption?: string;
  legend?: LegendItem[];
  /** The chart (rendered when "Chart" is selected). */
  chart: ReactNode;
  /** The accessible table equivalent (rendered when "Table" is selected). */
  table: ReactNode;
  /** Extra header actions (Export, pivot select). */
  actions?: ReactNode;
  defaultView?: 'chart' | 'table';
  className?: string;
}

/** Title, caption, legend and the mandatory Chart | Table switch (DESIGN_SYSTEM §11.4). */
export function ChartFrame({ title, caption, legend, chart, table, actions, defaultView = 'chart', className }: ChartFrameProps) {
  const [view, setView] = useState<'chart' | 'table'>(defaultView);
  return (
    <section className={cx('pcp-chart', className)} aria-label={title}>
      <header className="pcp-chart__header">
        <div className="pcp-chart__titles">
          <h3 className="pcp-chart__title">{title}</h3>
          {caption ? <p className="pcp-chart__caption">{caption}</p> : null}
        </div>
        <div className="pcp-chart__actions">
          {actions}
          <SegmentedControl<'chart' | 'table'>
            label={`${title} view`}
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: 'chart', label: 'Chart', icon: ChartColumnStacked },
              { value: 'table', label: 'Table', icon: Table2 },
            ]}
          />
        </div>
      </header>
      {view === 'chart' && legend && legend.length > 1 ? <Legend items={legend} /> : null}
      <div className="pcp-chart__body">{view === 'chart' ? chart : table}</div>
    </section>
  );
}

function TooltipCard({
  active,
  payload,
  label,
  unit,
  basis,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string; dataKey?: string | number }>;
  label?: string | number;
  unit: string;
  basis?: (label: string) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="pcp-chart__tooltip">
      <p className="pcp-chart__tooltip-title">
        {label}
        {basis ? <span className="pcp-chart__tooltip-basis"> · {basis(String(label))}</span> : null}
      </p>
      <ul>
        {payload
          .filter((p) => p.value !== undefined && p.value !== null)
          .map((p) => (
            <li key={String(p.dataKey)} className="pcp-chart__tooltip-row">
              <svg className="pcp-chart__swatch" width="8" height="8" aria-hidden="true" focusable="false">
                <rect width="8" height="8" rx="2" fill={p.color} />
              </svg>
              <span className="pcp-chart__tooltip-name">{p.name}</span>
              <span className="pcp-chart__tooltip-value">
                {typeof p.value === 'number' ? (unit === '%' ? `${Math.round(p.value)}%` : `${p.value.toFixed(1)} ${unit}`) : p.value}
              </span>
            </li>
          ))}
      </ul>
    </div>
  );
}

export interface CapacityDatum {
  /** "QBR1" */
  label: string;
  /** "Q4 2026" (tooltip/table basis). */
  detail?: string;
  above: number;
  below: number;
  undeclared: number;
  free: number;
  /** Demand marker (--chart-4). */
  demand?: number;
  /** Supply/target line (--chart-target dashed). */
  target?: number;
}

export interface StackedCapacityChartProps {
  title: string;
  caption?: string;
  data: CapacityDatum[];
  unit?: 'FTE' | '%';
  height?: number;
  actions?: ReactNode;
  className?: string;
}

const fmt = (v: number, unit: string) => (unit === '%' ? `${Math.round(v)}%` : `${v.toFixed(1)}`);

/**
 * Four-quarter stacked capacity chart: above (--chart-1), below (--chart-2), undeclared (--chart-3), free
 * hatched (--chart-bench), demand marker (--chart-4), dashed target (--chart-target), 2 px surface gaps.
 */
export function StackedCapacityChart({ title, caption, data, unit = 'FTE', height = 280, actions, className }: StackedCapacityChartProps) {
  const c = useChartColors();
  const hasDemand = data.some((d) => d.demand !== undefined);
  const hasTarget = data.some((d) => d.target !== undefined);
  const legend: LegendItem[] = [
    { label: 'Above the table', token: '--chart-1' },
    { label: 'Below the table', token: '--chart-2' },
    { label: 'Undeclared craft', token: '--chart-3' },
    { label: 'Free', token: '--chart-bench', kind: 'hatch' },
    ...(hasDemand ? [{ label: 'Demand', token: '--chart-4' as const, kind: 'marker' as const }] : []),
    ...(hasTarget ? [{ label: 'Supply', token: '--chart-target' as const, kind: 'dashed' as const }] : []),
  ];
  const summary = data
    .map((d) => `${d.label}: ${fmt(d.above + d.below + d.undeclared, unit)} ${unit} booked, ${fmt(d.free, unit)} free${d.demand !== undefined ? `, ${fmt(d.demand, unit)} demand` : ''}`)
    .join('; ');
  const columns = useMemo<Column<CapacityDatum>[]>(
    () => [
      { id: 'q', header: 'Quarter', cell: (d) => `${d.label}${d.detail ? ` · ${d.detail}` : ''}` },
      { id: 'above', header: 'Above the table', align: 'right', cell: (d) => fmt(d.above, unit), sortValue: (d) => d.above },
      { id: 'below', header: 'Below the table', align: 'right', cell: (d) => fmt(d.below, unit), sortValue: (d) => d.below },
      { id: 'und', header: 'Undeclared', align: 'right', cell: (d) => fmt(d.undeclared, unit), sortValue: (d) => d.undeclared },
      { id: 'free', header: 'Free', align: 'right', cell: (d) => fmt(d.free, unit), sortValue: (d) => d.free },
      ...(hasDemand
        ? [{ id: 'demand', header: 'Demand', align: 'right' as const, cell: (d: CapacityDatum) => (d.demand !== undefined ? fmt(d.demand, unit) : '—') }]
        : []),
      ...(hasTarget
        ? [{ id: 'target', header: 'Supply', align: 'right' as const, cell: (d: CapacityDatum) => (d.target !== undefined ? fmt(d.target, unit) : '—') }]
        : []),
    ],
    [unit, hasDemand, hasTarget],
  );
  const detailOf = (label: string) => data.find((d) => d.label === label)?.detail ?? '';
  const stroke = c['--color-surface'];
  return (
    <ChartFrame
      title={title}
      caption={caption}
      legend={legend}
      actions={actions}
      className={className}
      chart={
        <div role="img" aria-label={`${title}. ${summary}.`} style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
              <defs>
                <pattern id="pcp-bench-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                  <rect width="6" height="6" fill={c['--chart-bench']} />
                  <line x1="0" y1="0" x2="0" y2="6" stroke={c['--chart-bench-hatch']} strokeWidth="1" />
                </pattern>
              </defs>
              <CartesianGrid vertical={false} stroke={c['--chart-grid']} />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: c['--chart-grid'] }} tick={{ fill: c['--chart-axis'], fontSize: 12 }} />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={44}
                tick={{ fill: c['--chart-axis'], fontSize: 12 }}
                label={{ value: unit, angle: -90, position: 'insideLeft', fill: c['--chart-axis'], fontSize: 12, dx: 8 }}
              />
              <ChartTooltip
                cursor={{ fill: c['--chart-grid'], opacity: 0.4 }}
                content={<TooltipCard unit={unit} basis={detailOf} />}
              />
              <Bar dataKey="above" name="Above the table" stackId="s" fill={c['--chart-1']} stroke={stroke} strokeWidth={2} maxBarSize={32} isAnimationActive={false} />
              <Bar dataKey="below" name="Below the table" stackId="s" fill={c['--chart-2']} stroke={stroke} strokeWidth={2} maxBarSize={32} isAnimationActive={false} />
              <Bar dataKey="undeclared" name="Undeclared craft" stackId="s" fill={c['--chart-3']} stroke={stroke} strokeWidth={2} maxBarSize={32} isAnimationActive={false} />
              <Bar dataKey="free" name="Free" stackId="s" fill="url(#pcp-bench-hatch)" stroke={stroke} strokeWidth={2} maxBarSize={32} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              {hasTarget ? (
                <Line dataKey="target" name="Supply" stroke={c['--chart-target']} strokeWidth={2} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
              ) : null}
              {hasDemand ? (
                <Line
                  dataKey="demand"
                  name="Demand"
                  stroke="none"
                  legendType="diamond"
                  dot={{ r: 5, fill: c['--chart-4'], stroke: stroke, strokeWidth: 2 }}
                  activeDot={{ r: 6, fill: c['--chart-4'] }}
                  isAnimationActive={false}
                />
              ) : null}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      }
      table={<DataTable id={`chart-${title}`} caption={title} columns={columns} rows={data} getRowId={(d) => d.label} maxHeight="none" />}
    />
  );
}

export interface TrendDatum {
  label: string;
  detail?: string;
  planned: number;
  implied: number | null;
}

/** Planned vs Jira-implied FTE (--chart-1 vs --chart-2), table view included. */
export function TrendLine({
  title,
  caption,
  data,
  height = 240,
  unit = 'FTE',
  className,
}: {
  title: string;
  caption?: string;
  data: TrendDatum[];
  height?: number;
  unit?: 'FTE' | '%';
  className?: string;
}) {
  const c = useChartColors();
  const columns: Column<TrendDatum>[] = [
    { id: 'q', header: 'Period', cell: (d) => `${d.label}${d.detail ? ` · ${d.detail}` : ''}` },
    { id: 'p', header: 'Planned', align: 'right', cell: (d) => fmt(d.planned, unit), sortValue: (d) => d.planned },
    { id: 'i', header: 'Jira-implied', align: 'right', cell: (d) => (d.implied === null ? '—' : fmt(d.implied, unit)), sortValue: (d) => d.implied },
  ];
  const summary = data.map((d) => `${d.label}: planned ${fmt(d.planned, unit)}, implied ${d.implied === null ? 'none' : fmt(d.implied, unit)}`).join('; ');
  return (
    <ChartFrame
      title={title}
      caption={caption}
      className={className}
      legend={[
        { label: 'Planned', token: '--chart-1', kind: 'line' },
        { label: 'Jira-implied', token: '--chart-2', kind: 'line' },
      ]}
      chart={
        <div role="img" aria-label={`${title}. ${summary}.`} style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke={c['--chart-grid']} />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: c['--chart-grid'] }} tick={{ fill: c['--chart-axis'], fontSize: 12 }} />
              <YAxis tickLine={false} axisLine={false} width={44} tick={{ fill: c['--chart-axis'], fontSize: 12 }} />
              <ChartTooltip content={<TooltipCard unit={unit} />} cursor={{ stroke: c['--chart-grid'] }} />
              <Line dataKey="planned" name="Planned" stroke={c['--chart-1']} strokeWidth={2} dot={data.length <= 6 ? { r: 4 } : false} isAnimationActive={false} />
              <Line dataKey="implied" name="Jira-implied" stroke={c['--chart-2']} strokeWidth={2} dot={data.length <= 6 ? { r: 4 } : false} connectNulls isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      }
      table={<DataTable id={`chart-${title}`} caption={title} columns={columns} rows={data} getRowId={(d) => d.label} maxHeight="none" />}
    />
  );
}
