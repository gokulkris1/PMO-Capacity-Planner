/**
 * Helpers for hand-built semantic tables (`<table className="pcp-tbl">`): client-side sorting with `useSort` and
 * sortable column headers with `aria-sort` (`SortTh`). Use DataTable for standard lists; use these for grids with
 * multi-row headers, grouped rows or inline editors (Allocations, Demand, People).
 */
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { compare } from '../format';
import { cx } from '../internal/utils';
import './table.css';

export interface TableSort {
  key: string;
  dir: 'asc' | 'desc';
}

export function useSort<T>(
  rows: T[],
  accessors: Record<string, (r: T) => string | number | null | undefined>,
  initial: TableSort,
): { rows: T[]; sort: TableSort; toggle(key: string): void } {
  const [sort, setSort] = useState<TableSort>(initial);
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
  sort: TableSort;
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
      className={cx(numeric && 'pcp-num', className)}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      title={title}
    >
      <button type="button" className="pcp-sort" data-sorted={active} onClick={() => onSort(sortKey)}>
        {children ?? label}
        <Icon className="pcp-sort__icon" size={12} strokeWidth={2} aria-hidden="true" />
      </button>
    </th>
  );
}

/**
 * The scroll container of a hand-built table (`.pcp-tbl-wrap`). When its table is wider or taller than the space
 * (e.g. at 768 px) it becomes a keyboard-reachable, named scroll region: `tabIndex=0`, `role="region"` and an
 * accessible name from `label` or the table's caption (WCAG 2.1.1, axe `scrollable-region-focusable`; QA-007).
 * When nothing overflows it stays a plain div, so it adds no tab stop.
 */
export function TableScroll({
  label,
  className,
  children,
}: {
  /** Accessible name of the scroll region; defaults to the table caption or aria-label. */
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [region, setRegion] = useState<{ scrollable: boolean; name: string }>({ scrollable: false, name: '' });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const check = () => {
      const scrollable = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
      const table = el.querySelector('table');
      const name =
        label ?? (table?.querySelector('caption')?.textContent?.trim() || table?.getAttribute('aria-label') || 'Table');
      setRegion((r) => (r.scrollable === scrollable && r.name === name ? r : { scrollable, name }));
    };
    check();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [label]);
  return (
    <div
      ref={ref}
      className={cx('pcp-tbl-wrap', className)}
      {...(region.scrollable ? { tabIndex: 0, role: 'region', 'aria-label': region.name } : {})}
    >
      {children}
    </div>
  );
}
