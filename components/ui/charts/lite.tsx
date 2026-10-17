/**
 * Lightweight chart kit (DESIGN_SYSTEM §11): bars drawn to scale in HTML/CSS, lines in SVG; colours come only from
 * --chart-* tokens via classes. No Recharts, so pages that use these stay small (SH-08). Every chart has a legend,
 * hover and keyboard tooltips, and a table view through ChartPanel.
 */
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ChartColumnStacked, Table2 } from 'lucide-react';
import { Card } from '../Card';
import { SegmentedControl } from '../Tabs';
import { useElementWidth } from '../hooks';
import { cx } from '../internal/utils';
import './lite.css';

/** "Nice" axis maximum and ticks (1, 2, 2.5, 5 × 10ⁿ steps). */
export function niceScale(max: number, targetTicks = 5): { max: number; ticks: number[] } {
  if (!(max > 0)) return { max: 1, ticks: [0, 0.25, 0.5, 0.75, 1] };
  const raw = max / targetTicks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { max: top, ticks };
}
const fmtTick = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/* ── Legend ──────────────────────────────────────────────────────────────────────── */

export type SwatchKind = '1' | '2' | '3' | '4' | 'other' | 'bench' | 'target' | 'demand' | 'dashed';

/** Chart legend: swatch + label per series (never colour alone: labels are always shown). */
export function Legend({ items }: { items: Array<{ swatch: SwatchKind; label: string }> }) {
  return (
    <ul className="pcp-legend" aria-label="Legend">
      {items.map((i) => (
        <li key={i.label}>
          <span className={`pcp-swatch pcp-swatch--${i.swatch}`} aria-hidden="true" />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/* ── ChartPanel ──────────────────────────────────────────────────────────────────── */

/** A Card with a Chart | Table switch, optional legend and actions (DESIGN_SYSTEM §11: every chart has a table). */
export function ChartPanel({
  title,
  caption,
  legend,
  table,
  children,
  actions,
  initialView = 'chart',
}: {
  title: string;
  caption?: ReactNode;
  legend?: Array<{ swatch: SwatchKind; label: string }>;
  table: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  initialView?: 'chart' | 'table';
}) {
  const [view, setView] = useState<'chart' | 'table'>(initialView);
  return (
    <Card
      title={title}
      subtitle={caption}
      actions={
        <>
          {actions}
          <SegmentedControl<'chart' | 'table'>
            size="sm"
            label={`${title}: view`}
            value={view}
            onChange={setView}
            options={[
              { value: 'chart', label: 'Chart', icon: ChartColumnStacked },
              { value: 'table', label: 'Table', icon: Table2 },
            ]}
          />
        </>
      }
      flush={view === 'table'}
    >
      {view === 'chart' ? (
        <div className="pcp-stack pcp-stack--md">
          {legend && <Legend items={legend} />}
          {children}
        </div>
      ) : (
        table
      )}
    </Card>
  );
}

/* ── Stacked bar chart (capacity) ────────────────────────────────────────────────── */

export interface StackSegment {
  kind: '1' | '2' | '3' | '4' | 'other' | 'bench';
  label: string;
  value: number;
}
export interface StackColumn {
  key: string;
  label: string;
  sublabel?: string;
  segments: StackSegment[];
  marker?: { label: string; value: number };
  target?: { label: string; value: number };
  extra?: Array<{ label: string; value: string }>;
}

export function StackedBarChart({
  columns,
  unit,
  height = 240,
  ariaLabel,
  format = (v: number) => v.toFixed(1),
  showTotals = true,
  wide,
}: {
  columns: StackColumn[];
  unit: string;
  height?: number;
  ariaLabel: string;
  format?: (v: number) => string;
  showTotals?: boolean;
  wide?: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const scale = useMemo(() => {
    const max = Math.max(
      0,
      ...columns.map((c) =>
        Math.max(
          c.segments.reduce((s, x) => s + Math.max(0, x.value), 0),
          c.marker?.value ?? 0,
          c.target?.value ?? 0,
        ),
      ),
    );
    return niceScale(max * 1.08);
  }, [columns]);
  const y = (v: number) => `${(Math.max(0, v) / scale.max) * 100}%`;
  const tip = active !== null ? columns[active] : null;
  return (
    <div className="pcp-lchart" role="group" aria-label={ariaLabel}>
      <div className="pcp-lchart__yaxis" style={{ height }}>
        <span className="pcp-lchart__ytitle">{unit}</span>
        {scale.ticks.map((t) => (
          <span key={t} className="pcp-lchart__ytick" style={{ bottom: y(t) }}>
            {fmtTick(t)}
          </span>
        ))}
      </div>
      <div className="pcp-lchart__plot" style={{ height }}>
        {scale.ticks.slice(1).map((t) => (
          <span key={t} className="pcp-lchart__grid" style={{ bottom: y(t) }} />
        ))}
        <div className="pcp-lchart__cols">
          {columns.map((c, i) => {
            const total = c.segments.reduce((s, x) => s + Math.max(0, x.value), 0);
            const summary = [
              `${c.label}${c.sublabel ? ` (${c.sublabel})` : ''}`,
              ...(showTotals ? [`total ${format(total)} ${unit}`] : []),
              ...c.segments.map((s) => `${s.label} ${format(s.value)} ${unit}`),
              ...(c.marker ? [`${c.marker.label} ${format(c.marker.value)} ${unit}`] : []),
              ...(c.target ? [`${c.target.label} ${format(c.target.value)} ${unit}`] : []),
              ...(c.extra ?? []).map((e) => `${e.label} ${e.value}`),
            ].join('; ');
            return (
              <button
                key={c.key}
                type="button"
                className={cx('pcp-lchart__col', active === i && 'is-active')}
                aria-label={summary}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
              >
                <span
                  className={cx('pcp-lchart__stack', wide && 'pcp-lchart__stack--wide')}
                  style={{ height: y(total) }}
                >
                  {c.segments
                    .filter((s) => s.value > 0)
                    .map((s) => (
                      <span
                        key={s.label}
                        className={`pcp-lchart__seg pcp-lchart__seg--${s.kind}`}
                        style={{ height: `calc(${(s.value / Math.max(total, 1e-9)) * 100}% - 2px)` }}
                      />
                    ))}
                  {showTotals && (
                    <span className="pcp-lchart__value" style={{ bottom: '100%' }}>
                      {format(total)}
                    </span>
                  )}
                </span>
                {c.target && <span className="pcp-lchart__target" style={{ bottom: y(c.target.value) }} />}
                {c.marker && (
                  <span
                    className="pcp-lchart__marker"
                    style={{ bottom: y(c.marker.value), left: 'calc(50% - 30px)', right: 'calc(50% - 30px)' }}
                  />
                )}
              </button>
            );
          })}
        </div>
        {tip && active !== null && (
          <div
            className="pcp-lchart-tip"
            style={{
              left: `${((active + 0.5) / columns.length) * 100}%`,
              top: 8,
              transform: active >= columns.length / 2 ? 'translateX(calc(-100% - 40px))' : 'translateX(40px)',
            }}
            aria-hidden="true"
          >
            <div className="pcp-lchart-tip__title">
              {tip.label}
              {tip.sublabel ? ` · ${tip.sublabel}` : ''}
            </div>
            {tip.segments.map((s) => (
              <div className="pcp-lchart-tip__row" key={s.label}>
                <span className={`pcp-swatch pcp-swatch--${s.kind}`} />
                <span>{s.label}</span>
                <b>
                  {format(s.value)} {unit}
                </b>
              </div>
            ))}
            {tip.marker && (
              <div className="pcp-lchart-tip__row">
                <span className="pcp-swatch pcp-swatch--demand" />
                <span>{tip.marker.label}</span>
                <b>
                  {format(tip.marker.value)} {unit}
                </b>
              </div>
            )}
            {tip.target && (
              <div className="pcp-lchart-tip__row">
                <span className="pcp-swatch pcp-swatch--target" />
                <span>{tip.target.label}</span>
                <b>
                  {format(tip.target.value)} {unit}
                </b>
              </div>
            )}
            {(tip.extra ?? []).map((e) => (
              <div className="pcp-lchart-tip__row" key={e.label}>
                <span className="pcp-swatch" />
                <span>{e.label}</span>
                <b>{e.value}</b>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="pcp-lchart__xaxis" aria-hidden="true">
        {columns.map((c) => (
          <span key={c.key} className="pcp-lchart__xlabel">
            <strong>{c.label}</strong>
            {c.sublabel}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── Grouped bars (e.g. points committed vs done per sprint) ─────────────────────── */

export function GroupedBarChart({
  categories,
  series,
  unit,
  height = 220,
  ariaLabel,
  format = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1)),
}: {
  categories: Array<{ key: string; label: string; sublabel?: string }>;
  series: Array<{ name: string; kind: '1' | '2' | '3' | '4' | 'other'; values: number[] }>;
  unit: string;
  height?: number;
  ariaLabel: string;
  format?: (v: number) => string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const scale = useMemo(() => niceScale(Math.max(0, ...series.flatMap((s) => s.values)) * 1.08), [series]);
  const y = (v: number) => `${(Math.max(0, v) / scale.max) * 100}%`;
  return (
    <div className="pcp-lchart" role="group" aria-label={ariaLabel}>
      <div className="pcp-lchart__yaxis" style={{ height }}>
        <span className="pcp-lchart__ytitle">{unit}</span>
        {scale.ticks.map((t) => (
          <span key={t} className="pcp-lchart__ytick" style={{ bottom: y(t) }}>
            {fmtTick(t)}
          </span>
        ))}
      </div>
      <div className="pcp-lchart__plot" style={{ height }}>
        {scale.ticks.slice(1).map((t) => (
          <span key={t} className="pcp-lchart__grid" style={{ bottom: y(t) }} />
        ))}
        <div className="pcp-lchart__cols">
          {categories.map((c, i) => (
            <button
              key={c.key}
              type="button"
              className={cx('pcp-lchart__col', active === i && 'is-active')}
              aria-label={`${c.label}: ${series.map((s) => `${s.name} ${format(s.values[i] ?? 0)} ${unit}`).join('; ')}`}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            >
              <span className="pcp-lchart__bars">
                {series.map((s) => (
                  <span key={s.name} className="pcp-lchart__stack" style={{ height: y(s.values[i] ?? 0), width: 20 }}>
                    <span className={`pcp-lchart__seg pcp-lchart__seg--${s.kind}`} style={{ height: '100%' }} />
                  </span>
                ))}
              </span>
            </button>
          ))}
        </div>
        {active !== null && (
          <div
            className="pcp-lchart-tip"
            style={{
              left: `${((active + 0.5) / categories.length) * 100}%`,
              top: 8,
              transform: active >= categories.length / 2 ? 'translateX(calc(-100% - 32px))' : 'translateX(32px)',
            }}
            aria-hidden="true"
          >
            <div className="pcp-lchart-tip__title">
              {categories[active].label}
              {categories[active].sublabel ? ` · ${categories[active].sublabel}` : ''}
            </div>
            {series.map((s) => (
              <div className="pcp-lchart-tip__row" key={s.name}>
                <span className={`pcp-swatch pcp-swatch--${s.kind}`} />
                <span>{s.name}</span>
                <b>
                  {format(s.values[active] ?? 0)} {unit}
                </b>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="pcp-lchart__xaxis" aria-hidden="true">
        {categories.map((c) => (
          <span key={c.key} className="pcp-lchart__xlabel">
            <strong>{c.label}</strong>
            {c.sublabel}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── Trend line (SVG, measured width so text is never distorted) ─────────────────── */

export function TrendChart({
  categories,
  series,
  unit,
  height = 200,
  ariaLabel,
  format = (v: number) => v.toFixed(1),
}: {
  categories: Array<{ key: string; label: string }>;
  series: Array<{ name: string; kind: '1' | '2'; values: number[] }>;
  unit: string;
  height?: number;
  ariaLabel: string;
  format?: (v: number) => string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const width = useElementWidth(wrap);
  const [active, setActive] = useState<number | null>(null);
  const pad = { l: 44, r: 16, t: 16, b: 28 };
  const scale = useMemo(() => niceScale(Math.max(0, ...series.flatMap((s) => s.values)) * 1.1), [series]);
  const iw = Math.max(10, width - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const n = categories.length;
  const x = (i: number) => pad.l + (n <= 1 ? iw / 2 : (i * iw) / (n - 1));
  const yv = (v: number) => pad.t + ih - (Math.max(0, v) / scale.max) * ih;
  const band = n <= 1 ? iw : iw / (n - 1);
  return (
    <div ref={wrap} className="pcp-lchart-trend">
      <svg className="pcp-lchart-svg" width={width} height={height} role="group" aria-label={ariaLabel}>
        <text x={4} y={10}>
          {unit}
        </text>
        {scale.ticks.map((t) => (
          <g key={t}>
            <line className={t === 0 ? 'axis' : 'grid'} x1={pad.l} x2={pad.l + iw} y1={yv(t)} y2={yv(t)} />
            <text x={pad.l - 8} y={yv(t) + 4} textAnchor="end">
              {fmtTick(t)}
            </text>
          </g>
        ))}
        {categories.map((c, i) => (
          <g key={c.key}>
            <rect
              className={cx('hit', active === i && 'is-active')}
              x={x(i) - band / 2}
              y={pad.t}
              width={band}
              height={ih}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
            />
            <text x={x(i)} y={height - 8} textAnchor="middle">
              {c.label}
            </text>
          </g>
        ))}
        {series.map((s) => (
          <g key={s.name}>
            <polyline className={`line-${s.kind}`} points={s.values.map((v, i) => `${x(i)},${yv(v)}`).join(' ')} />
            {s.values.map((v, i) => (
              <circle key={i} className={`dot-${s.kind}`} cx={x(i)} cy={yv(v)} r={n <= 6 || active === i ? 4 : 0} />
            ))}
          </g>
        ))}
      </svg>
      <div className="pcp-sr-only">
        {categories.map((c, i) => (
          <button
            key={c.key}
            type="button"
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
            aria-label={`${c.label}: ${series.map((s) => `${s.name} ${format(s.values[i] ?? 0)} ${unit}`).join('; ')}`}
          />
        ))}
      </div>
      {active !== null && (
        <div
          className="pcp-lchart-tip"
          aria-hidden="true"
          style={{
            left: x(active),
            top: 8,
            transform: active >= n / 2 ? 'translateX(calc(-100% - 16px))' : 'translateX(16px)',
          }}
        >
          <div className="pcp-lchart-tip__title">{categories[active].label}</div>
          {series.map((s) => (
            <div className="pcp-lchart-tip__row" key={s.name}>
              <span className={`pcp-swatch pcp-swatch--${s.kind}`} />
              <span>{s.name}</span>
              <b>
                {format(s.values[active] ?? 0)} {unit}
              </b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
