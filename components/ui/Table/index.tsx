/**
 * Helpers for hand-built semantic tables (`<table className="pcp-tbl">`): client-side sorting with `useSort` and
 * sortable column headers with `aria-sort` (`SortTh`). Use DataTable for standard lists; use these for grids with
 * multi-row headers, grouped rows or inline editors (Allocations, Demand, People).
 */
import { useMemo, useState, type ReactNode } from 'react';
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
