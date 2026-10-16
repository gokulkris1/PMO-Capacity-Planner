/**
 * B2 interim primitives. Names and props mirror the planned components/ui kit (DESIGN_SYSTEM §8) so the
 * swap to B1's kit is an import change. Styling lives in kit.css (tokens only).
 */
import {
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  ArrowDown,
  ArrowDownRight,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  CalendarRange,
  ChevronDown,
  Circle,
  CircleAlert,
  CircleArrowDown,
  CircleCheck,
  Info,
  LoaderCircle,
  PencilLine,
  SquareKanban,
  Store,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { BAND_LABEL, type UtilBand } from '../../../shared/utilisation';
import type * as D from '../../../shared/contracts/dto';
import { compare, initials, pct as fmtPct, PROFICIENCY_LABEL } from './format';

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');
export { cx };

/* ── Button / IconButton ─────────────────────────────────────────────────────────── */

export type ButtonVariant = 'primary' | 'secondary' | 'subtle' | 'danger' | 'link';
export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  loading?: boolean;
  type?: 'button' | 'submit';
}
export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  iconRight: IconRight,
  loading,
  className,
  children,
  disabled,
  onClick,
  type = 'button',
  ...rest
}: ButtonProps) {
  const LeadIcon = loading ? LoaderCircle : Icon;
  return (
    <button
      type={type}
      className={cx('b2-btn', `b2-btn--${variant}`, size === 'sm' && 'b2-btn--sm', className)}
      disabled={disabled}
      aria-busy={loading || undefined}
      onClick={loading ? undefined : onClick}
      {...rest}
    >
      {LeadIcon && (
        <LeadIcon size={16} strokeWidth={1.75} aria-hidden="true" className={loading ? 'b2-spin' : undefined} />
      )}
      {children}
      {IconRight && <IconRight size={16} strokeWidth={1.75} aria-hidden="true" />}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'children'> {
  icon: LucideIcon;
  label: string;
  variant?: 'subtle' | 'secondary';
  size?: 'sm' | 'md';
}
export function IconButton({
  icon: Icon,
  label,
  variant = 'subtle',
  size = 'md',
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx('b2-btn', 'b2-btn--icon', `b2-btn--${variant}`, size === 'sm' && 'b2-btn--sm', className)}
      {...rest}
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}

/* ── Card ────────────────────────────────────────────────────────────────────────── */

export function Card({
  title,
  subtitle,
  actions,
  children,
  dense,
  flush,
  className,
  id,
  footer,
  as: Tag = 'section',
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  dense?: boolean;
  flush?: boolean;
  className?: string;
  id?: string;
  footer?: ReactNode;
  as?: 'section' | 'div';
}) {
  const headingId = useId();
  return (
    <Tag
      className={cx('b2-card', dense && 'b2-card--dense', flush && 'b2-card--flush', className)}
      aria-labelledby={title ? headingId : undefined}
      id={id}
    >
      {(title || actions) && (
        <div className="b2-card__head">
          <div className="b2-card__titles">
            {title && (
              <h2 className="b2-card__title" id={headingId}>
                {title}
              </h2>
            )}
            {subtitle && <p className="b2-card__sub">{subtitle}</p>}
          </div>
          {actions && <div className="b2-card__actions">{actions}</div>}
        </div>
      )}
      {children}
      {footer && <div className="b2-card__foot">{footer}</div>}
    </Tag>
  );
}

/* ── KPI tile ────────────────────────────────────────────────────────────────────── */

export function KpiTile({
  label,
  value,
  unit,
  pill,
  delta,
  deltaDirection,
  basis,
  help,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  pill?: ReactNode;
  delta?: string;
  deltaDirection?: 'up' | 'down' | null;
  basis: string;
  help?: string;
}) {
  const DeltaIcon = deltaDirection === 'up' ? ArrowUpRight : deltaDirection === 'down' ? ArrowDownRight : null;
  return (
    <div className="b2-kpi">
      <div className="b2-kpi__label" title={help}>
        {label}
      </div>
      <div className="b2-kpi__value-row">
        <span className="b2-kpi__value">
          {value}
          {unit && <span className="b2-kpi__unit">{unit}</span>}
        </span>
        {pill}
      </div>
      {delta && (
        <div className="b2-kpi__delta">
          {DeltaIcon && <DeltaIcon size={12} strokeWidth={1.75} aria-hidden="true" />}
          {delta}
        </div>
      )}
      <div className="b2-kpi__basis">{basis}</div>
    </div>
  );
}

/* ── Pills, chips, tags ──────────────────────────────────────────────────────────── */

export type PillTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'brand' | 'outline';
export function StatusPill({
  tone = 'neutral',
  icon: Icon,
  children,
  title,
}: {
  tone?: PillTone;
  icon?: LucideIcon;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={cx('b2-pill', tone !== 'neutral' && `b2-pill--${tone}`)} title={title}>
      {Icon && <Icon size={12} strokeWidth={2} aria-hidden="true" />}
      {children}
    </span>
  );
}

export const BAND_ICON: Record<UtilBand, LucideIcon> = {
  bench: Circle,
  under: CircleArrowDown,
  'on-target': CircleCheck,
  over: TriangleAlert,
};

export function BandPill({ band, value }: { band: UtilBand; value?: number }) {
  const Icon = BAND_ICON[band];
  return (
    <span className={cx('b2-pill', `b2-pill--${band}`)}>
      <Icon size={12} strokeWidth={2} aria-hidden="true" />
      {value !== undefined && `${fmtPct(value)} · `}
      {BAND_LABEL[band]}
    </span>
  );
}

/** Band-tinted numeric cell (DESIGN_SYSTEM §8.7 "Band cell tint"). */
export function BandCell({
  value,
  band,
  label,
  suffix = '%',
  partial,
  dashed,
}: {
  value: number;
  band: UtilBand | null;
  label?: string;
  suffix?: string;
  partial?: boolean;
  dashed?: boolean;
}) {
  const Icon = band === 'over' ? TriangleAlert : band === 'under' ? CircleArrowDown : null;
  const text = suffix === '%' ? fmtPct(value) : `${value}${suffix}`;
  const aria = `${label ? `${label}, ` : ''}${text}${band ? `, ${BAND_LABEL[band]}` : ''}${partial ? ', partial quarter' : ''}`;
  return (
    <span
      className={cx('b2-band', band ? `b2-band--${band}` : 'b2-band--plain', dashed && 'b2-band--dashed')}
      title={aria}
      aria-label={aria}
      role="img"
    >
      {partial && <CalendarRange size={12} strokeWidth={2} aria-hidden="true" />}
      {Icon && <Icon size={12} strokeWidth={2} aria-hidden="true" />}
      {text}
    </span>
  );
}

export function CraftChip({
  craft,
  via = 'above',
  proficiency,
  maxPct,
  suffix,
}: {
  craft: Pick<D.CraftDTO, 'short' | 'name'> | null | undefined;
  via?: 'above' | 'below' | 'undeclared';
  proficiency?: D.Proficiency | null;
  maxPct?: number;
  suffix?: string;
}) {
  if (!craft) return <span className="b2-subtle">—</span>;
  const tip =
    via === 'above'
      ? `${craft.name} · above the table`
      : via === 'below'
        ? `${craft.name} · below the table${proficiency ? ` · L${proficiency} ${PROFICIENCY_LABEL[proficiency].toLowerCase()}` : ''}${maxPct ? ` · up to ${maxPct}%` : ''}`
        : `${craft.name} · not declared on this person`;
  return (
    <span className={cx('b2-chip', `b2-chip--${via}`)} title={tip} aria-label={tip}>
      {craft.short}
      {via === 'below' && proficiency ? `·L${proficiency}` : ''}
      {suffix ? ` ${suffix}` : ''}
    </span>
  );
}

const PROVENANCE: Record<D.AllocationSource, { icon: LucideIcon; label: string }> = {
  manual: { icon: PencilLine, label: 'Manual' },
  marketplace: { icon: Store, label: 'Marketplace' },
  jira: { icon: SquareKanban, label: 'Jira' },
  planview: { icon: CalendarRange, label: 'Planview' },
};
export function ProvenanceTag({ source }: { source: D.AllocationSource | 'mixed' | null }) {
  if (!source) return null;
  if (source === 'mixed') return <span className="b2-prov">Mixed</span>;
  const { icon: Icon, label } = PROVENANCE[source];
  return (
    <span className="b2-prov">
      <Icon size={12} strokeWidth={1.75} aria-hidden="true" />
      {label}
    </span>
  );
}

export function BookingStatePill({ state }: { state: D.AllocationState | 'mixed' | null }) {
  if (state === 'tentative') return <StatusPill tone="outline">Tentative</StatusPill>;
  if (state === 'declined') return <StatusPill tone="neutral">Declined</StatusPill>;
  if (state === 'mixed') return <StatusPill tone="neutral">Mixed</StatusPill>;
  if (state === 'confirmed') return <StatusPill tone="success">Confirmed</StatusPill>;
  return null;
}

export function Avatar({ name, size = 24 }: { name: string; size?: 24 | 32 | 40 }) {
  return (
    <span
      className={cx('b2-avatar', size === 32 && 'b2-avatar--32', size === 40 && 'b2-avatar--40')}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export function PersonLabel({ name, sub, size = 24 }: { name: string; sub?: ReactNode; size?: 24 | 32 | 40 }) {
  return (
    <span className="b2-person">
      <Avatar name={name} size={size} />
      <span className="b2-person__text">
        <span className="b2-person__name" title={name}>
          {name}
        </span>
        {sub && <span className="b2-person__sub">{sub}</span>}
      </span>
    </span>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="b2-tag">{children}</span>;
}
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="b2-kbd">{children}</kbd>;
}
export function CountBadge({ n }: { n: number }) {
  return <span className="b2-count">{n > 99 ? '99+' : n}</span>;
}

/* ── Banner ──────────────────────────────────────────────────────────────────────── */

const BANNER_ICON: Record<'info' | 'success' | 'warning' | 'danger' | 'neutral', LucideIcon> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
  neutral: Info,
};
export function Banner({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger' | 'neutral';
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const Icon = BANNER_ICON[tone];
  return (
    <div className={cx('b2-banner', `b2-banner--${tone}`)} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon className="b2-banner__icon" size={16} strokeWidth={1.75} aria-hidden="true" />
      <div className="b2-banner__body">
        {title && <div className="b2-banner__title">{title}</div>}
        {children && <div>{children}</div>}
      </div>
      {action}
    </div>
  );
}

/* ── Empty state & skeleton ──────────────────────────────────────────────────────── */

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  compact,
}: {
  icon: LucideIcon;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cx('b2-empty', compact && 'b2-empty--compact')}>
      <Icon className="b2-empty__icon" size={compact ? 24 : 32} strokeWidth={1.5} aria-hidden="true" />
      <h3 className="b2-empty__title">{title}</h3>
      {body && <p className="b2-empty__body">{body}</p>}
      {action && <div className="b2-empty__actions">{action}</div>}
    </div>
  );
}

export function Skeleton({
  variant,
  rows = 5,
  label,
}: {
  variant: 'text' | 'kpi' | 'table' | 'chart';
  rows?: number;
  label: string;
}) {
  let body: ReactNode;
  if (variant === 'kpi') {
    body = (
      <div className="b2-kpis">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="b2-kpi">
            <span className="b2-skel" style={{ width: '50%', height: 12 }} />
            <span className="b2-skel" style={{ width: '40%', height: 28, marginTop: 4 }} />
            <span className="b2-skel" style={{ width: '60%', height: 12, marginTop: 4 }} />
          </div>
        ))}
      </div>
    );
  } else if (variant === 'table') {
    body = (
      <div className="b2-card b2-card--flush">
        <div className="b2-skel b2-skel--head" />
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="b2-row b2-skel-row">
            <span className="b2-skel b2-skel--round" style={{ width: 24, height: 24 }} />
            <span className="b2-skel" style={{ width: `${30 + ((i * 13) % 30)}%`, height: 12 }} />
            <span className="b2-spacer" />
            <span className="b2-skel" style={{ width: 48, height: 12 }} />
            <span className="b2-skel" style={{ width: 48, height: 12 }} />
          </div>
        ))}
      </div>
    );
  } else if (variant === 'chart') {
    body = (
      <div className="b2-card">
        <div className="b2-row b2-skel-chart">
          {[60, 85, 70, 45].map((h, i) => (
            <span key={i} className="b2-skel" style={{ flex: 1, height: `${h}%` }} />
          ))}
        </div>
      </div>
    );
  } else {
    body = (
      <div className="b2-stack b2-stack--sm">
        {[100, 80, 60].slice(0, rows).map((w, i) => (
          <span key={i} className="b2-skel" style={{ width: `${w}%`, height: 12 }} />
        ))}
      </div>
    );
  }
  return (
    <div aria-busy="true">
      <span className="b2-sr-only">Loading {label}</span>
      {body}
    </div>
  );
}

/* ── Tabs & segmented control ────────────────────────────────────────────────────── */

export interface TabItem<T extends string> {
  id: T;
  label: string;
  count?: number;
}
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  idPrefix,
}: {
  items: Array<TabItem<NoInfer<T>>>;
  value: T;
  onChange(v: NoInfer<T>): void;
  label: string;
  idPrefix: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % items.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next >= 0) {
      e.preventDefault();
      onChange(items[next].id);
      refs.current[next]?.focus();
    }
  };
  return (
    <div className="b2-tabs" role="tablist" aria-label={label}>
      {items.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${t.id}`}
          aria-controls={`${idPrefix}-panel`}
          aria-selected={t.id === value}
          tabIndex={t.id === value ? 0 : -1}
          className="b2-tab"
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && <CountBadge n={t.count} />}
        </button>
      ))}
    </div>
  );
}
export function TabPanel({ idPrefix, value, children }: { idPrefix: string; value: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`${idPrefix}-panel`} aria-labelledby={`${idPrefix}-tab-${value}`}>
      {children}
    </div>
  );
}

export function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  label,
  size = 'md',
}: {
  items: Array<{ id: NoInfer<T>; label: string; title?: string; icon?: LucideIcon }>;
  value: T;
  onChange(v: NoInfer<T>): void;
  label: string;
  size?: 'sm' | 'md';
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % items.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + items.length) % items.length;
    if (next >= 0) {
      e.preventDefault();
      onChange(items[next].id);
      refs.current[next]?.focus();
    }
  };
  return (
    <div className={cx('b2-seg', size === 'sm' && 'b2-seg--sm')} role="radiogroup" aria-label={label}>
      {items.map((it, i) => {
        const Icon = it.icon;
        return (
          <button
            key={it.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={it.id === value}
            tabIndex={it.id === value ? 0 : -1}
            className="b2-seg__item"
            title={it.title}
            onClick={() => onChange(it.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {Icon && <Icon size={14} strokeWidth={1.75} aria-hidden="true" />}
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Form controls ───────────────────────────────────────────────────────────────── */

export function FormField({
  label,
  htmlFor,
  optional,
  help,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  optional?: boolean;
  help?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('b2-field', className)}>
      <label className="b2-field__label" htmlFor={htmlFor}>
        {label}
        {optional && <span className="b2-field__opt"> (optional)</span>}
      </label>
      {children}
      {error ? (
        <span className="b2-field__error" id={`${htmlFor}-error`}>
          <CircleAlert size={12} strokeWidth={2} aria-hidden="true" />
          {error}
        </span>
      ) : (
        help && (
          <span className="b2-field__help" id={`${htmlFor}-help`}>
            {help}
          </span>
        )
      )}
    </div>
  );
}

export function TextField({
  id,
  value,
  onChange,
  placeholder,
  invalid,
  readOnly,
  disabled,
  size = 'md',
  type = 'text',
  icon: Icon,
  ariaLabel,
  describedBy,
  multiline,
}: {
  id: string;
  value: string;
  onChange(v: string): void;
  placeholder?: string;
  invalid?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md';
  type?: 'text' | 'email' | 'date' | 'url' | 'search';
  icon?: LucideIcon;
  ariaLabel?: string;
  describedBy?: string;
  multiline?: boolean;
}) {
  const common = {
    id,
    value,
    placeholder,
    readOnly,
    disabled,
    'aria-invalid': invalid || undefined,
    'aria-label': ariaLabel,
    'aria-describedby': describedBy ?? (invalid ? `${id}-error` : undefined),
    className: cx('b2-input', size === 'sm' && 'b2-input--sm'),
  };
  if (multiline) {
    return (
      <textarea {...common} rows={3} onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)} />
    );
  }
  const input = (
    <input {...common} type={type} onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)} />
  );
  if (!Icon) return input;
  return (
    <span className="b2-input-wrap">
      <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
      {input}
    </span>
  );
}

export function NumberField({
  id,
  value,
  onChange,
  unit,
  step = 1,
  min,
  max,
  invalid,
  disabled,
  size = 'md',
  ariaLabel,
}: {
  id: string;
  value: string;
  onChange(v: string): void;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  invalid?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md';
  ariaLabel?: string;
}) {
  const bump = (dir: 1 | -1) => {
    const n = Number(value || 0) + dir * step;
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
    onChange(String(Math.round(clamped * 100) / 100));
  };
  return (
    <span className={cx('b2-input-wrap', unit && 'b2-input-wrap--suffix')}>
      <input
        id={id}
        inputMode="decimal"
        className={cx('b2-input', 'b2-input--num', size === 'sm' && 'b2-input--sm')}
        value={value}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-label={ariaLabel}
        aria-describedby={invalid ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.-]/g, ''))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            bump(1);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            bump(-1);
          }
        }}
      />
      {unit && <span className="b2-input-wrap__suffix">{unit}</span>}
    </span>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  group?: string;
  disabled?: boolean;
}
export function Select({
  id,
  value,
  onChange,
  options,
  size = 'md',
  disabled,
  ariaLabel,
  placeholder,
  invalid,
}: {
  id?: string;
  value: string;
  onChange(v: string): void;
  options: SelectOption[];
  size?: 'sm' | 'md';
  disabled?: boolean;
  ariaLabel?: string;
  placeholder?: string;
  invalid?: boolean;
}) {
  const groups = useMemo(() => {
    const out: Array<{ group: string | undefined; items: SelectOption[] }> = [];
    for (const o of options) {
      const last = out[out.length - 1];
      if (last && last.group === o.group) last.items.push(o);
      else out.push({ group: o.group, items: [o] });
    }
    return out;
  }, [options]);
  return (
    <span className="b2-select-wrap">
      <select
        id={id}
        className={cx('b2-select', size === 'sm' && 'b2-select--sm')}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid && id ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.target.value)}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {groups.map((g, gi) =>
          g.group ? (
            <optgroup key={`${g.group}-${gi}`} label={g.group}>
              {g.items.map((o) => (
                <option key={o.value} value={o.value} disabled={o.disabled}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ) : (
            g.items.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))
          ),
        )}
      </select>
      <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
    </span>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  hideLabel,
  indeterminate,
  disabled,
}: {
  checked: boolean;
  onChange(v: boolean): void;
  label: string;
  hideLabel?: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className="b2-check">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        ref={(el) => {
          if (el) el.indeterminate = !!indeterminate;
        }}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={hideLabel ? label : undefined}
      />
      {!hideLabel && <span>{label}</span>}
    </label>
  );
}

/* ── Quarter load bar (§8.10) ────────────────────────────────────────────────────── */

export function QuarterLoadBar({
  above,
  below,
  undeclared,
  target = 100,
  label,
  size = 'sm',
  showLabel = true,
}: {
  above: number;
  below: number;
  undeclared: number;
  target?: number;
  label: string;
  size?: 'sm' | 'lg';
  showLabel?: boolean;
}) {
  const scale = Math.max(target, 1) * 1.25;
  const load = above + below + undeclared;
  const free = Math.max(0, target - load);
  const w = (v: number) => `${Math.max(0, Math.min(100, (v / scale) * 100))}%`;
  const relative = Math.round((100 * load) / Math.max(target, 1));
  const aria = `${label}: ${Math.round(above)}% above the table, ${Math.round(below)}% below, ${Math.round(undeclared)}% undeclared, ${Math.round(free)}% free; ${relative}% of target`;
  return (
    <div className={cx('b2-qbar', size === 'lg' && 'b2-qbar--lg')}>
      <div className="b2-qbar__track" role="img" aria-label={aria} title={aria}>
        {above > 0 && <span className="b2-qbar__seg b2-qbar__seg--above" style={{ width: w(above) }} />}
        {below > 0 && <span className="b2-qbar__seg b2-qbar__seg--below" style={{ width: w(below) }} />}
        {undeclared > 0 && <span className="b2-qbar__seg b2-qbar__seg--undeclared" style={{ width: w(undeclared) }} />}
        {free > 0 && <span className="b2-qbar__seg b2-qbar__seg--free" style={{ width: w(free) }} />}
        <span className="b2-qbar__target" style={{ left: `${(target / scale) * 100}%` }} />
        {load > scale && <span className="b2-qbar__cap" />}
      </div>
      {showLabel && (
        <span className="b2-qbar__label">
          {fmtPct(load)} of {fmtPct(target)}
        </span>
      )}
    </div>
  );
}

/* ── Legend ──────────────────────────────────────────────────────────────────────── */

export type SwatchKind = '1' | '2' | '3' | '4' | 'other' | 'bench' | 'target' | 'demand' | 'dashed';
export function Legend({ items }: { items: Array<{ swatch: SwatchKind; label: string }> }) {
  return (
    <ul className="b2-legend" aria-label="Legend">
      {items.map((i) => (
        <li key={i.label}>
          <span className={`b2-swatch b2-swatch--${i.swatch}`} aria-hidden="true" />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/* ── Sorting ─────────────────────────────────────────────────────────────────────── */

export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}
export function useSort<T>(
  rows: T[],
  accessors: Record<string, (r: T) => string | number | null | undefined>,
  initial: SortState,
): { rows: T[]; sort: SortState; toggle(key: string): void } {
  const [sort, setSort] = useState<SortState>(initial);
  const sorted = useMemo(() => {
    const get = accessors[sort.key];
    if (!get) return rows;
    const out = [...rows].sort((a, b) => compare(get(a), get(b)));
    return sort.dir === 'desc' ? out.reverse() : out;
  }, [rows, accessors, sort]);
  const toggle = (key: string) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  return { rows: sorted, sort, toggle };
}

export function SortTh({
  label,
  sortKey,
  sort,
  onSort,
  numeric,
  className,
  title,
  children,
}: {
  label: string;
  sortKey: string;
  sort: SortState;
  onSort(k: string): void;
  numeric?: boolean;
  className?: string;
  title?: string;
  children?: ReactNode;
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      className={cx(numeric && 'b2-num', className)}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      title={title}
    >
      <button type="button" className="b2-sort" data-sorted={active} onClick={() => onSort(sortKey)}>
        {children ?? label}
        <Icon className="b2-sort__icon" size={12} strokeWidth={2} aria-hidden="true" />
      </button>
    </th>
  );
}
