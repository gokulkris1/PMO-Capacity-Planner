import { useMemo, useRef, useState, type ReactNode, type UIEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, Columns3, Inbox } from 'lucide-react';
import { Icon } from '../Icon';
import { Button } from '../Button';
import { Checkbox } from '../Checkbox';
import { SegmentedControl } from '../Tabs';
import { Banner } from '../Banner';
import { EmptyState } from '../EmptyState';
import { Skeleton } from '../Skeleton';
import { Popover } from '../Menu';
import { cx, useUiPref } from '../internal/utils';
import './data-table.css';

export type SortDirection = 'asc' | 'desc';
export interface SortState {
  columnId: string;
  direction: SortDirection;
}
export type Density = 'compact' | 'comfortable';

export interface Column<T> {
  id: string;
  /** Header label. Keep it a string where possible (used for CSV, aria and the column menu). */
  header: ReactNode;
  /** Plain-text header when `header` is not a string. */
  headerText?: string;
  cell: (row: T) => ReactNode;
  /** Enables sorting on this column. */
  sortValue?: (row: T) => string | number | null | undefined;
  /** Value written to CSV (defaults to sortValue). */
  csvValue?: (row: T) => string | number | null | undefined;
  /** Numbers are right-aligned (tnum is applied automatically). */
  align?: 'left' | 'right' | 'center';
  /** Fixed/min width in px or CSS length. */
  width?: number | string;
  /** Can be hidden from the column menu. */
  hideable?: boolean;
  /** Initially hidden (only for hideable columns). */
  defaultHidden?: boolean;
  /** Remove cell padding (e.g. full-bleed BandValue). */
  flush?: boolean;
  /** Group-row content for this column (totals). */
  groupCell?: (rows: T[], groupId: string) => ReactNode;
}

export interface DataTableProps<T> {
  /** Stable id: persists density and column visibility per table per browser (pcp.ui.table.{id}.*). */
  id: string;
  /** Table caption (visually hidden unless `showCaption`). */
  caption: string;
  showCaption?: boolean;
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  status?: 'ready' | 'loading' | 'error';
  /** Error state: "Retry" calls this. */
  onRetry?: () => void;
  errorMessage?: string;
  /** Page-provided EmptyState (or FilteredEmptyState). */
  empty?: ReactNode;
  defaultDensity?: Density;
  /** Shows the Compact/Comfortable control in the toolbar. */
  densityToggle?: boolean;
  /** Shows the column-visibility control when some columns are hideable. */
  columnToggle?: boolean;
  /** Controlled sort (use with applySort/toCsvMatrix for exports). */
  sort?: SortState | null;
  onSortChange?: (sort: SortState | null) => void;
  defaultSort?: SortState | null;
  /** Row selection with a 40 px checkbox column and a bulk-action bar. */
  selectable?: boolean;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  /** Bulk actions (sm secondary Buttons) shown in the bulk bar. */
  bulkActions?: (selectedIds: string[]) => ReactNode;
  /** Left side of the toolbar: search field, filter chips, group-by select. */
  toolbar?: ReactNode;
  /** Right side of the toolbar (before the column and density controls). */
  toolbarEnd?: ReactNode;
  /** Max height of the scroll area (header stays sticky inside it). Default: calc(100vh - 280px). */
  maxHeight?: number | string;
  /** Group rows by a key (sunken group rows with toggle and totals). */
  groupBy?: (row: T) => { id: string; label: string };
  /** Highlight one row (e.g. the row whose drawer is open). */
  activeRowId?: string | null;
  /** Virtualise rows: 'auto' (default) above 200 rows. */
  virtualize?: boolean | 'auto';
  /** First column becomes a sticky row header (default true). */
  stickyFirstColumn?: boolean;
  className?: string;
}

/** Sorts rows by a column's sortValue (nulls last). Pure; exported for CSV exports of the current view. */
export function applySort<T>(rows: T[], columns: Column<T>[], sort: SortState | null | undefined): T[] {
  if (!sort) return rows;
  const col = columns.find((c) => c.id === sort.columnId);
  if (!col?.sortValue) return rows;
  const dir = sort.direction === 'asc' ? 1 : -1;
  const get = col.sortValue;
  return [...rows].sort((a, b) => {
    const va = get(a);
    const vb = get(b);
    if (va === vb) return 0;
    if (va === null || va === undefined || va === '') return 1;
    if (vb === null || vb === undefined || vb === '') return -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
    return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' }) * dir;
  });
}

/** Header + rows of the current view as plain values, for C's `toCsv()` (DS-04#AC7). */
export function toCsvMatrix<T>(columns: Column<T>[], rows: T[]): Array<Array<string | number>> {
  const header = columns.map((c) => c.headerText ?? (typeof c.header === 'string' ? c.header : c.id));
  const body = rows.map((r) =>
    columns.map((c) => {
      const v = (c.csvValue ?? c.sortValue)?.(r);
      return v === null || v === undefined ? '' : v;
    }),
  );
  return [header, ...body];
}

type Item<T> = { kind: 'group'; id: string; label: string; rows: T[] } | { kind: 'row'; id: string; row: T };

const VIRTUAL_THRESHOLD = 200;

/**
 * Data table (DESIGN_SYSTEM §8.9, DS-04): card container with internal scroll, sticky header and first
 * column, tri-state sort with aria-sort, density, selection + bulk bar, grouping, virtualisation above
 * 200 rows, and loading/error/empty states. Semantic <table> with caption and scoped headers.
 */
export function DataTable<T>({
  id,
  caption,
  showCaption,
  columns,
  rows,
  getRowId,
  status = 'ready',
  onRetry,
  errorMessage,
  empty,
  defaultDensity = 'comfortable',
  densityToggle,
  columnToggle,
  sort: sortProp,
  onSortChange,
  defaultSort = null,
  selectable,
  selectedIds,
  onSelectionChange,
  bulkActions,
  toolbar,
  toolbarEnd,
  maxHeight,
  groupBy,
  activeRowId,
  virtualize = 'auto',
  stickyFirstColumn = true,
  className,
}: DataTableProps<T>) {
  const [density, setDensity] = useUiPref<Density>(`table.${id}.density`, defaultDensity);
  const [hiddenCols, setHiddenCols] = useUiPref<string[]>(
    `table.${id}.hidden`,
    columns.filter((c) => c.hideable && c.defaultHidden).map((c) => c.id),
  );
  const [innerSort, setInnerSort] = useState<SortState | null>(defaultSort);
  const sort = sortProp !== undefined ? sortProp : innerSort;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [scrolled, setScrolled] = useState({ top: false, left: false });
  const [colsOpen, setColsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const visibleColumns = useMemo(
    () => columns.filter((c) => !(c.hideable && hiddenCols.includes(c.id))),
    [columns, hiddenCols],
  );
  const sorted = useMemo(() => applySort(rows, columns, sort), [rows, columns, sort]);

  const items = useMemo<Item<T>[]>(() => {
    if (!groupBy) return sorted.map((row) => ({ kind: 'row' as const, id: getRowId(row), row }));
    const groups = new Map<string, { label: string; rows: T[] }>();
    for (const row of sorted) {
      const g = groupBy(row);
      const entry = groups.get(g.id) ?? { label: g.label, rows: [] };
      entry.rows.push(row);
      groups.set(g.id, entry);
    }
    const out: Item<T>[] = [];
    for (const [gid, g] of groups) {
      out.push({ kind: 'group', id: gid, label: g.label, rows: g.rows });
      if (!collapsed.has(gid)) for (const row of g.rows) out.push({ kind: 'row', id: getRowId(row), row });
    }
    return out;
  }, [sorted, groupBy, collapsed, getRowId]);

  const selected = useMemo(() => new Set(selectedIds ?? []), [selectedIds]);
  const allIds = useMemo(() => rows.map(getRowId), [rows, getRowId]);
  const allSelected = allIds.length > 0 && allIds.every((rid) => selected.has(rid));
  const someSelected = !allSelected && allIds.some((rid) => selected.has(rid));

  const rowHeight = density === 'compact' ? 32 : 40;
  const useVirtual = virtualize === true || (virtualize === 'auto' && items.length > VIRTUAL_THRESHOLD);
  // TanStack Virtual returns non-memoisable functions; the React Compiler skips this component (expected).
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: useVirtual ? items.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight + 1,
    overscan: 10,
  });

  const toggleSort = (colId: string) => {
    let next: SortState | null;
    if (!sort || sort.columnId !== colId) next = { columnId: colId, direction: 'asc' };
    else if (sort.direction === 'asc') next = { columnId: colId, direction: 'desc' };
    else next = null;
    if (sortProp === undefined) setInnerSort(next);
    onSortChange?.(next);
  };

  const toggleRow = (rowId: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(rowId);
    else next.delete(rowId);
    onSelectionChange?.([...next]);
  };

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const top = el.scrollTop > 0;
    const left = el.scrollLeft > 0;
    if (top !== scrolled.top || left !== scrolled.left) setScrolled({ top, left });
  };

  const hideableCols = columns.filter((c) => c.hideable);
  const showToolbar = !!(toolbar || toolbarEnd || densityToggle || (columnToggle && hideableCols.length > 0));
  const selectionCount = selected.size;
  const colCount = visibleColumns.length + (selectable ? 1 : 0);

  const renderRow = (item: Extract<Item<T>, { kind: 'row' }>) => {
    const isSelected = selected.has(item.id);
    return (
      <tr
        key={item.id}
        className={cx(
          'pcp-table__row',
          isSelected && 'pcp-table__row--selected',
          activeRowId === item.id && 'pcp-table__row--active',
        )}
        aria-selected={selectable ? isSelected : undefined}
      >
        {selectable ? (
          <td className="pcp-table__cell pcp-table__cell--check pcp-table__sticky-check">
            <Checkbox
              checked={isSelected}
              onChange={(on) => toggleRow(item.id, on)}
              aria-label={`Select row ${item.id}`}
            />
          </td>
        ) : null}
        {visibleColumns.map((c, ci) => {
          const first = ci === 0 && stickyFirstColumn;
          const props = {
            className: cx(
              'pcp-table__cell',
              c.align === 'right' && 'pcp-table__cell--num',
              c.align === 'center' && 'pcp-table__cell--center',
              c.flush && 'pcp-table__cell--flush',
              first && 'pcp-table__sticky',
              first && selectable && 'pcp-table__sticky--after-check',
            ),
            style: c.width !== undefined ? { width: c.width, minWidth: c.width } : undefined,
          };
          return first ? (
            <th key={c.id} scope="row" {...props}>
              {c.cell(item.row)}
            </th>
          ) : (
            <td key={c.id} {...props}>
              {c.cell(item.row)}
            </td>
          );
        })}
      </tr>
    );
  };

  const renderGroup = (item: Extract<Item<T>, { kind: 'group' }>) => {
    const isCollapsed = collapsed.has(item.id);
    return (
      <tr key={`g-${item.id}`} className="pcp-table__group">
        {selectable ? <td className="pcp-table__cell pcp-table__cell--check pcp-table__sticky-check" /> : null}
        {visibleColumns.map((c, ci) =>
          ci === 0 ? (
            <th
              key={c.id}
              scope="rowgroup"
              className={cx('pcp-table__cell', stickyFirstColumn && 'pcp-table__sticky', selectable && 'pcp-table__sticky--after-check')}
            >
              <button
                type="button"
                className="pcp-table__group-toggle"
                aria-expanded={!isCollapsed}
                onClick={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(item.id)) next.delete(item.id);
                    else next.add(item.id);
                    return next;
                  })
                }
              >
                <Icon icon={isCollapsed ? ChevronRight : ChevronDown} size={16} />
                <span className="pcp-truncate">{item.label}</span>
                <span className="pcp-table__group-count pcp-tnum">{item.rows.length}</span>
              </button>
            </th>
          ) : (
            <td key={c.id} className={cx('pcp-table__cell', c.align === 'right' && 'pcp-table__cell--num', c.flush && 'pcp-table__cell--flush')}>
              {c.groupCell ? c.groupCell(item.rows, item.id) : null}
            </td>
          ),
        )}
      </tr>
    );
  };

  let body: ReactNode;
  if (status === 'loading') body = null;
  else if (useVirtual) {
    const virtualItems = virtualizer.getVirtualItems();
    const total = virtualizer.getTotalSize();
    const padTop = virtualItems.length ? virtualItems[0].start : 0;
    const padBottom = virtualItems.length ? total - virtualItems[virtualItems.length - 1].end : 0;
    body = (
      <>
        {padTop > 0 ? (
          <tr aria-hidden="true" className="pcp-table__spacer">
            <td colSpan={colCount} style={{ height: padTop }} />
          </tr>
        ) : null}
        {virtualItems.map((v) => {
          const item = items[v.index];
          return item.kind === 'group' ? renderGroup(item) : renderRow(item);
        })}
        {padBottom > 0 ? (
          <tr aria-hidden="true" className="pcp-table__spacer">
            <td colSpan={colCount} style={{ height: padBottom }} />
          </tr>
        ) : null}
      </>
    );
  } else body = items.map((item) => (item.kind === 'group' ? renderGroup(item) : renderRow(item)));

  const isEmpty = status === 'ready' && rows.length === 0;

  return (
    <div className={cx('pcp-table-card', `pcp-table-card--${density}`, className)}>
      {selectable && selectionCount > 0 ? (
        <div className="pcp-table__bulk" role="region" aria-label="Bulk actions">
          <span className="pcp-table__bulk-count">
            <span className="pcp-tnum">{selectionCount}</span> selected
          </span>
          <div className="pcp-table__bulk-actions">{bulkActions?.([...selected])}</div>
          <Button variant="link" onClick={() => onSelectionChange?.([])}>
            Clear
          </Button>
        </div>
      ) : showToolbar ? (
        <div className="pcp-table__toolbar">
          <div className="pcp-table__toolbar-start">{toolbar}</div>
          <div className="pcp-table__toolbar-end">
            {toolbarEnd}
            {columnToggle && hideableCols.length > 0 ? (
              <Popover
                label="Columns"
                open={colsOpen}
                onOpenChange={setColsOpen}
                width={240}
                trigger={
                  <Button variant="secondary" size="sm" iconBefore={Columns3}>
                    Columns
                  </Button>
                }
              >
                <div className="pcp-table__colmenu">
                  <p className="pcp-table__colmenu-title">Show columns</p>
                  {hideableCols.map((c) => (
                    <Checkbox
                      key={c.id}
                      label={c.headerText ?? (typeof c.header === 'string' ? c.header : c.id)}
                      checked={!hiddenCols.includes(c.id)}
                      onChange={(on) =>
                        setHiddenCols(on ? hiddenCols.filter((h) => h !== c.id) : [...hiddenCols, c.id])
                      }
                    />
                  ))}
                </div>
              </Popover>
            ) : null}
            {densityToggle ? (
              <SegmentedControl<Density>
                label="Row density"
                size="sm"
                value={density}
                onChange={setDensity}
                options={[
                  { value: 'compact', label: 'Compact' },
                  { value: 'comfortable', label: 'Comfortable' },
                ]}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="pcp-table__error">
          <Banner tone="danger" action={onRetry ? { label: 'Retry', onClick: onRetry } : undefined}>
            {errorMessage ?? "We couldn't load this table."}
          </Banner>
        </div>
      ) : (
        <div
          ref={scrollRef}
          className={cx(
            'pcp-table__scroll',
            scrolled.top && 'pcp-table__scroll--top',
            scrolled.left && 'pcp-table__scroll--left',
          )}
          style={{ maxHeight: maxHeight ?? 'max(320px, calc(100vh - 280px))' }}
          onScroll={onScroll}
          // Scrollable region must be keyboard reachable (axe: scrollable-region-focusable).
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          role="region"
          aria-label={caption}
        >
          <table className="pcp-table" aria-rowcount={useVirtual ? items.length + 1 : undefined} aria-busy={status === 'loading' || undefined}>
            <caption className={showCaption ? 'pcp-table__caption' : 'pcp-sr-only'}>{caption}</caption>
            <thead>
              <tr>
                {selectable ? (
                  <th scope="col" className="pcp-table__head pcp-table__cell--check pcp-table__sticky-check">
                    <Checkbox
                      checked={allSelected}
                      indeterminate={someSelected}
                      onChange={(on) => onSelectionChange?.(on ? allIds : [])}
                      aria-label="Select all rows"
                    />
                  </th>
                ) : null}
                {visibleColumns.map((c, ci) => {
                  const sorted = sort?.columnId === c.id ? sort.direction : null;
                  const first = ci === 0 && stickyFirstColumn;
                  return (
                    <th
                      key={c.id}
                      scope="col"
                      aria-sort={c.sortValue ? (sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none') : undefined}
                      className={cx(
                        'pcp-table__head',
                        c.align === 'right' && 'pcp-table__cell--num',
                        c.align === 'center' && 'pcp-table__cell--center',
                        first && 'pcp-table__sticky',
                        first && selectable && 'pcp-table__sticky--after-check',
                      )}
                      style={c.width !== undefined ? { width: c.width, minWidth: c.width } : undefined}
                    >
                      {c.sortValue ? (
                        <button type="button" className="pcp-table__sort" onClick={() => toggleSort(c.id)}>
                          <span>{c.header}</span>
                          <Icon
                            icon={sorted === 'asc' ? ArrowUp : sorted === 'desc' ? ArrowDown : ArrowUpDown}
                            size={12}
                            className={cx('pcp-table__sort-icon', sorted && 'pcp-table__sort-icon--active')}
                          />
                        </button>
                      ) : (
                        c.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>{body}</tbody>
          </table>
          {status === 'loading' ? <Skeleton variant="table" density={density} label={caption} className="pcp-table__skeleton" /> : null}
          {isEmpty ? (
            <div className="pcp-table__empty">
              {empty ?? <EmptyState icon={Inbox} title="Nothing to show yet" compact />}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export interface CellButtonProps {
  children: ReactNode;
  onClick: () => void;
  /** Secondary line under the label (e.g. job title). */
  sublabel?: ReactNode;
  /** Leading content, e.g. an Avatar 24. */
  leading?: ReactNode;
  'aria-label'?: string;
}

/** Primary label in a row header that opens the row's drawer (keyboard-accessible row action). */
export function CellButton({ children, onClick, sublabel, leading, 'aria-label': ariaLabel }: CellButtonProps) {
  return (
    <span className="pcp-cell-main">
      {leading}
      <span className="pcp-cell-main__text">
        <button type="button" className="pcp-cell-button" onClick={onClick} aria-label={ariaLabel}>
          {children}
        </button>
        {sublabel ? <span className="pcp-cell-main__sub">{sublabel}</span> : null}
      </span>
    </span>
  );
}
