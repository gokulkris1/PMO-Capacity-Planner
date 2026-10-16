import { cx } from '../internal/utils';
import './skeleton.css';

export interface SkeletonProps {
  /** Preset shape (DESIGN_SYSTEM §8.16). 'block' is a plain rectangle sized by width/height. */
  variant?: 'text' | 'kpi' | 'table' | 'chart' | 'block' | 'page';
  /** Visually hidden "Loading {label}" for screen readers. */
  label?: string;
  /** Number of text lines (text) or rows (table). */
  lines?: number;
  width?: number | string;
  height?: number | string;
  density?: 'compact' | 'comfortable';
  className?: string;
}

function Bar({ width, height, className }: { width?: number | string; height?: number | string; className?: string }) {
  return <span className={cx('pcp-skeleton', className)} style={{ width, height }} />;
}

/** Loading placeholders with a shimmer (off with reduced motion). Pages use these, not spinners. */
export function Skeleton({ variant = 'text', label, lines, width, height, density = 'compact', className }: SkeletonProps) {
  const sr = label ? <span className="pcp-sr-only">Loading {label}</span> : null;
  if (variant === 'block') {
    return (
      <div className={cx('pcp-skeleton-wrap', className)} aria-busy="true">
        {sr}
        <Bar width={width ?? '100%'} height={height ?? 16} />
      </div>
    );
  }
  if (variant === 'kpi') {
    return (
      <div className={cx('pcp-skeleton-kpi', className)} aria-busy="true">
        {sr}
        <Bar width="45%" height={12} />
        <Bar width="35%" height={28} />
        <Bar width="60%" height={12} />
      </div>
    );
  }
  if (variant === 'table') {
    const rows = lines ?? 5;
    return (
      <div className={cx('pcp-skeleton-table', `pcp-skeleton-table--${density}`, className)} aria-busy="true">
        {sr}
        <div className="pcp-skeleton-table__head">
          <Bar width="18%" height={10} />
          <Bar width="12%" height={10} />
          <Bar width="12%" height={10} />
          <Bar width="10%" height={10} />
        </div>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="pcp-skeleton-table__row">
            <Bar width={`${24 - (i % 3) * 4}%`} height={12} />
            <Bar width="14%" height={12} />
            <Bar width="10%" height={12} />
            <Bar width="8%" height={12} />
          </div>
        ))}
      </div>
    );
  }
  if (variant === 'chart') {
    return (
      <div className={cx('pcp-skeleton-chart', className)} aria-busy="true" style={{ height: height ?? 240 }}>
        {sr}
        {[62, 78, 54, 70].map((h, i) => (
          <Bar key={i} className="pcp-skeleton-chart__bar" height={`${h}%`} />
        ))}
      </div>
    );
  }
  if (variant === 'page') {
    return (
      <div className={cx('pcp-skeleton-page', className)} aria-busy="true">
        {sr}
        <Bar width={220} height={12} />
        <Bar width={320} height={24} />
        <div className="pcp-skeleton-page__kpis">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="pcp-skeleton-kpi">
              <Bar width="45%" height={12} />
              <Bar width="35%" height={28} />
              <Bar width="60%" height={12} />
            </div>
          ))}
        </div>
        <div className="pcp-skeleton-page__card">
          <Bar width="30%" height={14} />
          <Bar width="100%" height={12} />
          <Bar width="92%" height={12} />
          <Bar width="84%" height={12} />
          <Bar width="96%" height={12} />
        </div>
      </div>
    );
  }
  const n = lines ?? 3;
  const widths = ['100%', '80%', '60%'];
  return (
    <div className={cx('pcp-skeleton-text', className)} aria-busy="true">
      {sr}
      {Array.from({ length: n }, (_, i) => (
        <Bar key={i} width={width ?? widths[i % 3]} height={12} />
      ))}
    </div>
  );
}
