import { BAND_LABEL, type UtilBand } from '../../../shared/utilisation';
import { Tooltip } from '../Tooltip';
import { cx } from '../internal/utils';
import './load-bar.css';

export interface QuarterLoadBarProps {
  /** Context label for screen readers, e.g. "QBR1". */
  quarterLabel: string;
  /** Load split as % of the person's target (from PersonRow.quarters[i]). */
  above: number;
  below: number;
  undeclared: number;
  /** Free capacity % of target (hatched). */
  free: number;
  /** Target utilisation in % (default 100) for the "of" text. */
  target?: number;
  size?: 'sm' | 'md';
  /** Show the "112% of 100%" text to the right (otherwise it is in the tooltip). */
  showLabel?: boolean;
  className?: string;
}

const SCALE = 125;
const r = (n: number) => Math.max(0, Math.round(n));

/**
 * Horizontal stacked bar 0–125 % of target: above (--chart-1), below (--chart-2), undeclared (--chart-3),
 * free hatched (--chart-bench), dashed 100 % tick, danger cap when clipped (DESIGN_SYSTEM §8.10).
 */
export function QuarterLoadBar({
  quarterLabel,
  above,
  below,
  undeclared,
  free,
  target = 100,
  size = 'sm',
  showLabel = true,
  className,
}: QuarterLoadBarProps) {
  const load = above + below + undeclared;
  const clipped = load > SCALE;
  const pct = (v: number) => `${(Math.max(0, v) / SCALE) * 100}%`;
  // Clip the stacked segments to the 0–125 % scale in order: above, below, undeclared, free.
  const clip = (v: number, used: number) => Math.min(Math.max(0, v), Math.max(0, SCALE - used));
  const segAbove = clip(above, 0);
  const segBelow = clip(below, segAbove);
  const segUndeclared = clip(undeclared, segAbove + segBelow);
  const segFree = clip(free, segAbove + segBelow + segUndeclared);
  const aria = `${quarterLabel}: ${r(above)}% above the table, ${r(below)}% below, ${r(undeclared)}% undeclared, ${r(free)}% free`;
  const text = `${r(load)}% of ${r(target)}%`;
  return (
    <div className={cx('pcp-load', `pcp-load--${size}`, className)}>
      <Tooltip content={`${aria}. ${text}.`}>
        <div className="pcp-load__track" role="img" aria-label={aria} tabIndex={-1}>
          {segAbove > 0 ? <span className="pcp-load__seg pcp-load__seg--above" style={{ width: pct(segAbove) }} /> : null}
          {segBelow > 0 ? <span className="pcp-load__seg pcp-load__seg--below" style={{ width: pct(segBelow) }} /> : null}
          {segUndeclared > 0 ? (
            <span className="pcp-load__seg pcp-load__seg--undeclared" style={{ width: pct(segUndeclared) }} />
          ) : null}
          {segFree > 0 ? <span className="pcp-load__seg pcp-load__seg--free" style={{ width: pct(segFree) }} /> : null}
          <span className="pcp-load__target" style={{ left: pct(100) }} aria-hidden="true" />
          {clipped ? <span className="pcp-load__cap" aria-hidden="true" /> : null}
        </div>
      </Tooltip>
      {showLabel ? <span className="pcp-load__text pcp-tnum">{text}</span> : null}
    </div>
  );
}

export interface HeatStripCell {
  /** "QBR1" … "QBR4" */
  label: string;
  pct: number;
  band: UtilBand;
  /** Extra tooltip line, e.g. "Q4 2026". */
  detail?: string;
}

/** Four band-tinted cells 48×24 with the % value (DESIGN_SYSTEM §8.10). */
export function HeatStrip({ cells, className, label }: { cells: HeatStripCell[]; className?: string; label?: string }) {
  return (
    <div className={cx('pcp-heat', className)} role="group" aria-label={label ?? 'Utilisation by quarter'}>
      {cells.map((c) => (
        <Tooltip key={c.label} content={`${c.label}${c.detail ? ` · ${c.detail}` : ''}: ${Math.round(c.pct)}%, ${BAND_LABEL[c.band]}`}>
          <span
            role="img"
            tabIndex={-1}
            className={cx('pcp-heat__cell', `pcp-heat__cell--${c.band}`)}
            aria-label={`${c.label}, ${Math.round(c.pct)}%, ${BAND_LABEL[c.band]}`}
          >
            {Math.round(c.pct)}%
          </span>
        </Tooltip>
      ))}
    </div>
  );
}
