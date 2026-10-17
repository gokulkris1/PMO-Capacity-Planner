import { useCallback, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { Icon } from '../Icon';
import { cx } from '../internal/utils';
import './tabs.css';

export interface TabItem<T extends string = string> {
  id: T;
  label: string;
  /** Optional count badge after the label (primary-subtle). */
  count?: number;
  disabled?: boolean;
}

export interface TabsProps<T extends string = string> {
  tabs: TabItem<NoInfer<T>>[];
  value: T;
  onChange: (id: NoInfer<T>) => void;
  /** Accessible name of the tab list. */
  label: string;
  /** Prefix for tab/panel ids; pass it when you render <TabPanel idBase=… /> (sets aria-controls). */
  idBase?: string;
  className?: string;
}

/** Underline tabs, the only tab style in the app (DESIGN_SYSTEM §8.5). Arrow keys move, Home/End jump. */
export function Tabs<T extends string = string>({ tabs, value, onChange, label, idBase, className }: TabsProps<T>) {
  const gen = useId();
  const base = idBase ?? gen;
  const listRef = useRef<HTMLDivElement>(null);

  const focusTab = (id: T) => {
    const el = listRef.current?.querySelector<HTMLButtonElement>(`[data-tab-id="${CSS.escape(id)}"]`);
    el?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const enabled = tabs.filter((t) => !t.disabled);
    const index = enabled.findIndex((t) => t.id === value);
    let next: TabItem<T> | undefined;
    if (e.key === 'ArrowRight') next = enabled[(index + 1) % enabled.length];
    else if (e.key === 'ArrowLeft') next = enabled[(index - 1 + enabled.length) % enabled.length];
    else if (e.key === 'Home') next = enabled[0];
    else if (e.key === 'End') next = enabled[enabled.length - 1];
    if (!next) return;
    e.preventDefault();
    onChange(next.id);
    focusTab(next.id);
  };

  return (
    <div ref={listRef} role="tablist" aria-label={label} className={cx('pcp-tabs', className)}>
      {tabs.map((t) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${base}-tab-${t.id}`}
            aria-controls={idBase ? `${base}-panel-${t.id}` : undefined}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={t.disabled}
            data-tab-id={t.id}
            className={cx('pcp-tabs__tab', selected && 'pcp-tabs__tab--selected')}
            onClick={() => onChange(t.id)}
            onKeyDown={onKeyDown}
          >
            <span>{t.label}</span>
            {t.count !== undefined ? (
              <span className="pcp-tabs__count pcp-tnum">{t.count > 99 ? '99+' : t.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export interface TabPanelProps {
  /** Same idBase as the Tabs. */
  idBase: string;
  tabId: string;
  children: ReactNode;
  className?: string;
}

/** The panel for the selected tab (render only the active one). */
export function TabPanel({ idBase, tabId, children, className }: TabPanelProps) {
  return (
    <div
      role="tabpanel"
      id={`${idBase}-panel-${tabId}`}
      aria-labelledby={`${idBase}-tab-${tabId}`}
      tabIndex={0}
      className={cx('pcp-tab-panel', className)}
    >
      {children}
    </div>
  );
}

/** Keeps the selected tab in the URL (`?tab=`) as DESIGN_SYSTEM §8.5 requires. */
export function useTabParam<T extends string>(allowed: readonly T[], fallback: T, param = 'tab'): [T, (id: T) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get(param);
  const value = (allowed as readonly string[]).includes(raw ?? '') ? (raw as T) : fallback;
  const set = useCallback(
    (id: T) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id === fallback) next.delete(param);
          else next.set(param, id);
          return next;
        },
        { replace: true },
      );
    },
    [setParams, fallback, param],
  );
  return [value, set];
}

export interface SegmentOption<T extends string = string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  /** Tooltip-free extra description for screen readers. */
  title?: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string = string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the radiogroup. */
  label: string;
  size?: 'sm' | 'md';
  className?: string;
  /** Hide labels and show icons only (labels stay accessible). */
  iconOnly?: boolean;
}

/** Exclusive view switch (Chart | Table, Compact | Comfortable, time basis). role="radiogroup". */
export function SegmentedControl<T extends string = string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  className,
  iconOnly,
}: SegmentedControlProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const enabled = options.filter((o) => !o.disabled);
    const index = enabled.findIndex((o) => o.value === value);
    let next: SegmentOption<T> | undefined;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = enabled[(index + 1) % enabled.length];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      next = enabled[(index - 1 + enabled.length) % enabled.length];
    else if (e.key === 'Home') next = enabled[0];
    else if (e.key === 'End') next = enabled[enabled.length - 1];
    if (!next) return;
    e.preventDefault();
    onChange(next.value);
    ref.current?.querySelector<HTMLButtonElement>(`[data-value="${CSS.escape(next.value)}"]`)?.focus();
  };
  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={label}
      className={cx('pcp-segmented', `pcp-segmented--${size}`, className)}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={iconOnly ? o.label : undefined}
            title={o.title}
            tabIndex={selected ? 0 : -1}
            disabled={o.disabled}
            data-value={o.value}
            className={cx('pcp-segmented__item', selected && 'pcp-segmented__item--selected')}
            onClick={() => onChange(o.value)}
            onKeyDown={onKeyDown}
          >
            {o.icon ? <Icon icon={o.icon} size={16} /> : null}
            {iconOnly ? null : <span>{o.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
