import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, CircleQuestionMark } from 'lucide-react';
import type { UtilBand } from '../../../shared/utilisation';
import { BandPill } from '../StatusPill';
import { IconButton } from '../Button';
import { Icon } from '../Icon';
import { cx } from '../internal/utils';
import './kpi.css';

export interface KpiDelta {
  direction: 'up' | 'down' | 'flat';
  /** e.g. "+6 pts vs QBR2" */
  text: string;
}

export interface KpiTileProps {
  /** Sentence case, e.g. "Squad utilisation". */
  label: string;
  /** Formatted value, e.g. "94%" or "3.5 FTE". */
  value: ReactNode;
  /** Optional band pill to the right of the value. */
  band?: UtilBand;
  delta?: KpiDelta;
  /** Time-basis caption, e.g. "QBR1 · Q4 2026" (every metric states its basis). */
  caption: string;
  /** Optional sparkline values (24 px, --chart-1, no axes). */
  sparkline?: number[];
  /** Optional help button (glossary). */
  onHelp?: () => void;
  helpLabel?: string;
  className?: string;
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 96;
  const h = 24;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map(
      (v, i) =>
        `${((i / (values.length - 1)) * (w - 2) + 1).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`,
    )
    .join(' ');
  return (
    <svg className="pcp-kpi__spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true" focusable="false">
      <polyline points={points} fill="none" className="pcp-kpi__spark-line" />
    </svg>
  );
}

const DELTA_ICON = { up: ArrowUpRight, down: ArrowDownRight, flat: ArrowRight } as const;

/** KPI tile: label, tnum value, optional band, delta, time-basis caption (DESIGN_SYSTEM §8.8). */
export function KpiTile({ label, value, band, delta, caption, sparkline, onHelp, helpLabel, className }: KpiTileProps) {
  return (
    <div className={cx('pcp-kpi', className)}>
      <div className="pcp-kpi__label-row">
        <span className="pcp-kpi__label">{label}</span>
        {onHelp ? (
          <IconButton icon={CircleQuestionMark} label={helpLabel ?? `About ${label}`} size="sm" onClick={onHelp} />
        ) : null}
      </div>
      <div className="pcp-kpi__value-row">
        <span className="pcp-kpi__value">{value}</span>
        {band ? <BandPill band={band} /> : null}
      </div>
      {delta ? (
        <span className="pcp-kpi__delta">
          <Icon icon={DELTA_ICON[delta.direction]} size={12} />
          <span>{delta.text}</span>
        </span>
      ) : null}
      <div className="pcp-kpi__foot">
        <span className="pcp-kpi__caption">{caption}</span>
        {sparkline ? <Sparkline values={sparkline} /> : null}
      </div>
    </div>
  );
}

/** Responsive KPI grid: 4 per row ≥ 1024, 2 per row 640–1023, 1 below. Supply 4 or 8 tiles. */
export function KpiGrid({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <div className={cx('pcp-kpi-grid', className)} role={label ? 'group' : undefined} aria-label={label}>
      {children}
    </div>
  );
}
