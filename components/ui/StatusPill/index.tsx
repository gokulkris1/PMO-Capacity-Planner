import type { ReactNode } from 'react';
import {
  CalendarRange,
  Circle,
  CircleArrowDown,
  CircleCheck,
  PencilLine,
  SquareKanban,
  Store,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react';
import { BAND_LABEL, type UtilBand } from '../../../shared/utilisation';
import { Icon } from '../Icon';
import { Tooltip } from '../Tooltip';
import { cx } from '../internal/utils';
import './pills.css';

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'brand';

export interface StatusPillProps {
  tone?: StatusTone;
  /** Short state word; rendered uppercase (e.g. "Confirmed", "Stale"). */
  children: ReactNode;
  icon?: LucideIcon;
  className?: string;
  title?: string;
}

/** Lozenge: 20 px, 11/16/600 uppercase, status colours by tone (DESIGN_SYSTEM §8.7). */
export function StatusPill({ tone = 'neutral', children, icon, className, title }: StatusPillProps) {
  return (
    <span className={cx('pcp-pill', `pcp-pill--${tone}`, className)} title={title}>
      {icon ? <Icon icon={icon} size={12} /> : null}
      <span className="pcp-pill__text">{children}</span>
    </span>
  );
}

export const BAND_ICON: Record<UtilBand, LucideIcon> = {
  bench: Circle,
  under: CircleArrowDown,
  'on-target': CircleCheck,
  over: TriangleAlert,
};

export interface BandPillProps {
  band: UtilBand;
  /** Optional value prefix, e.g. 112 renders "112% · Over capacity". */
  value?: number;
  /** Custom label (defaults to BAND_LABEL from shared/utilisation). */
  label?: string;
  className?: string;
}

/** StatusPill bound to a utilisation band: icon + label + band colours; never colour alone (DS-02#AC4). */
export function BandPill({ band, value, label, className }: BandPillProps) {
  const text = label ?? BAND_LABEL[band];
  return (
    <span className={cx('pcp-pill', `pcp-pill--band-${band}`, className)}>
      <Icon icon={BAND_ICON[band]} size={12} />
      <span className="pcp-pill__text">
        {value !== undefined ? <span className="pcp-tnum">{Math.round(value)}% · </span> : null}
        {text}
      </span>
    </span>
  );
}

export interface BandValueProps {
  band: UtilBand | null;
  /** Percentage to show (rounded). */
  pct: number;
  /** Context for the accessible name, e.g. "QBR1". */
  context?: string;
  className?: string;
  /** Fill the table cell (use inside a DataTable cell with `padding: none`). */
  fill?: boolean;
}

/**
 * Band cell tint for tables and grids: band background, band foreground 13/18/600 tnum, right-aligned,
 * with the icon for over/under; the band label is in the tooltip and aria-label (DESIGN_SYSTEM §8.7).
 */
export function BandValue({ band, pct, context, className, fill }: BandValueProps) {
  const rounded = Math.round(pct);
  const label = band ? BAND_LABEL[band] : '';
  const aria = `${context ? `${context}: ` : ''}${rounded}%${label ? `, ${label}` : ''}`;
  const showIcon = band === 'over' || band === 'under';
  return (
    <Tooltip content={label || null} disabled={!band}>
      <span
        className={cx('pcp-band-value', band && `pcp-band-value--${band}`, fill && 'pcp-band-value--fill', className)}
        aria-label={aria}
        role="img"
        tabIndex={-1}
      >
        {showIcon && band ? <Icon icon={BAND_ICON[band]} size={12} /> : null}
        <span className="pcp-tnum">{rounded}%</span>
      </span>
    </Tooltip>
  );
}

export interface CraftChipProps {
  /** The craft (CraftDTO or any { short, name }). */
  craft: { short: string; name: string };
  /** 'primary' = above the table (filled), 'secondary' = below the table (outlined, ·L{n}). */
  via?: 'primary' | 'secondary';
  proficiency?: 1 | 2 | 3;
  /** Max % cap shown in the tooltip for below-the-table crafts. */
  maxPct?: number;
  /** Booking on a craft the person has not declared: dashed border. */
  undeclared?: boolean;
  className?: string;
}

const PROFICIENCY_TEXT: Record<1 | 2 | 3, string> = {
  1: 'L1 can contribute with support',
  2: 'L2 can contribute independently',
  3: 'L3 can own independently',
};

/** Neutral craft chip; never status or series colours (DS-02#AC5). */
export function CraftChip({ craft, via = 'primary', proficiency, maxPct, undeclared, className }: CraftChipProps) {
  const text = via === 'secondary' && proficiency ? `${craft.short}·L${proficiency}` : craft.short;
  const tip =
    via === 'primary'
      ? `${craft.name} · above the table`
      : `${craft.name} · below the table${proficiency ? ` · ${PROFICIENCY_TEXT[proficiency]}` : ''}${
          maxPct !== undefined ? ` · up to ${maxPct}%` : ''
        }`;
  return (
    <Tooltip content={undeclared ? `${craft.name} · not declared on this person` : tip}>
      <span
        className={cx(
          'pcp-craft-chip',
          via === 'secondary' ? 'pcp-craft-chip--secondary' : 'pcp-craft-chip--primary',
          undeclared && 'pcp-craft-chip--undeclared',
          className,
        )}
        aria-label={undeclared ? `${craft.name}, undeclared craft` : tip}
        role="img"
        tabIndex={-1}
      >
        {text}
      </span>
    </Tooltip>
  );
}

export type ProvenanceSource = 'manual' | 'marketplace' | 'jira' | 'planview';

const PROVENANCE: Record<ProvenanceSource, { icon: LucideIcon; label: string }> = {
  manual: { icon: PencilLine, label: 'Manual' },
  marketplace: { icon: Store, label: 'Marketplace' },
  jira: { icon: SquareKanban, label: 'Jira' },
  planview: { icon: CalendarRange, label: 'Planview' },
};

/** Inline icon + caption showing where a booking came from (DESIGN_SYSTEM §8.7). */
export function ProvenanceTag({ source, className }: { source: ProvenanceSource; className?: string }) {
  const p = PROVENANCE[source];
  return (
    <span className={cx('pcp-provenance', className)}>
      <Icon icon={p.icon} size={12} />
      <span>{p.label}</span>
    </span>
  );
}

export interface TagProps {
  children: ReactNode;
  /** Shows a remove button with aria-label "Remove {children}". */
  onRemove?: () => void;
  removeLabel?: string;
  className?: string;
}

/** Sentence-case neutral tag for skills; removable in editors. */
export function Tag({ children, onRemove, removeLabel, className }: TagProps) {
  return (
    <span className={cx('pcp-tag', className)}>
      <span className="pcp-tag__text">{children}</span>
      {onRemove ? (
        <button
          type="button"
          className="pcp-tag__remove"
          aria-label={removeLabel ?? `Remove ${typeof children === 'string' ? children : 'tag'}`}
          onClick={onRemove}
        >
          <Icon icon={X} size={12} />
        </button>
      ) : null}
    </span>
  );
}

export interface BadgeProps {
  count: number;
  tone?: 'danger' | 'brand' | 'neutral';
  /** Accessible text, e.g. "3 pending approvals". Defaults to the number. */
  label?: string;
  className?: string;
}

/** Count badge: 16 px, radius full, "99+" above 99 (DESIGN_SYSTEM §8.7). */
export function Badge({ count, tone = 'brand', label, className }: BadgeProps) {
  return (
    <span className={cx('pcp-badge', `pcp-badge--${tone}`, 'pcp-tnum', className)} aria-label={label} role={label ? 'img' : undefined}>
      {count > 99 ? '99+' : count}
    </span>
  );
}

/** Keyboard key hint (DESIGN_SYSTEM §8.21). */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cx('pcp-kbd', className)}>{children}</kbd>;
}
