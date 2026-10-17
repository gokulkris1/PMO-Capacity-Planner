/**
 * Quarter-first allocation grid (AL-01…AL-05, AL-07): `role="grid"` with roving tabindex, arrow-key
 * navigation, Enter/typing to edit, Enter/Tab to commit, Escape to cancel, Ctrl/⌘+Z undo,
 * Ctrl/⌘+Shift+→ copy forward, and paste of a tab-separated block. Pure rendering + keyboard; mutations
 * are delegated to the page through callbacks.
 */
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { CalendarRange, ChevronDown, ChevronRight, Lock, TriangleAlert, Ellipsis } from 'lucide-react';
import type * as D from '../../../shared/contracts/dto';
import { BAND_LABEL, type UtilBand } from '../../../shared/utilisation';
import type { GridCell, GridModel, GridRow } from '../../../utils/viewModels';
import {
  BandCell,
  BookingStatePill,
  Checkbox,
  CraftChip,
  cx,
  fmt,
  Menu,
  type MenuItem,
  ProvenanceTag,
  IconButton,
} from '../../../components/ui';

export interface FlatRow {
  kind: 'group' | 'person' | 'project' | 'booking';
  key: string;
  groupId: string;
  label: string;
  row: GridRow | null;
  cells: GridCell[];
}

export interface CellAddress {
  personId: D.ID;
  projectId: D.ID;
  craftId: D.ID | null;
  quarterKey: D.QuarterKey;
}

export function AllocationGrid({
  model,
  pivot,
  snapshot: s,
  canEdit,
  collapsed,
  onToggle,
  selected,
  onSelect,
  onCommit,
  onCopyForward,
  onUndo,
  onPaste,
  rowMenu,
  demandByProject,
  overInfo,
}: {
  model: GridModel;
  pivot: 'person' | 'project';
  snapshot: D.WorkspaceSnapshot;
  canEdit: boolean;
  collapsed: Set<string>;
  onToggle(key: string): void;
  selected: Set<string>;
  onSelect(key: string, on: boolean): void;
  onCommit(a: CellAddress, pct: number): Promise<boolean>;
  onCopyForward(a: Omit<CellAddress, 'quarterKey'> & { fromQuarterKey: D.QuarterKey }): void;
  onUndo(): void;
  onPaste(start: { rowKey: string; col: number }, block: string[][], rows: FlatRow[]): void;
  rowMenu(row: GridRow): MenuItem[];
  demandByProject: Map<D.ID, number[]>;
  overInfo(personId: D.ID, qi: number): { pct: number; band: UtilBand } | null;
}) {
  const quarters = model.quarters;
  const idx = useMemo(
    () => ({
      people: new Map(s.people.map((p) => [p.id, p])),
      crafts: new Map(s.crafts.map((c) => [c.id, c])),
      allocations: new Map(s.allocations.map((a) => [a.id, a])),
      projects: new Map(s.projects.map((p) => [p.id, p])),
    }),
    [s],
  );

  // Flatten groups → visible rows (group header, parent row, booking sub-rows unless collapsed).
  const rows = useMemo(() => {
    const out: FlatRow[] = [];
    for (const g of model.groups) {
      if (model.groups.length > 1 || g.id !== 'all')
        out.push({ kind: 'group', key: `g:${g.id}`, groupId: g.id, label: g.label, row: null, cells: g.totals });
      let parentKey = '';
      for (const r of g.rows) {
        if (r.depth === 0) {
          parentKey = r.key;
          out.push({
            kind: r.kind === 'project' ? 'project' : 'person',
            key: r.key,
            groupId: g.id,
            label: r.label,
            row: r,
            cells: r.cells,
          });
        } else if (!collapsed.has(parentKey)) {
          out.push({ kind: 'booking', key: r.key, groupId: g.id, label: r.label, row: r, cells: r.cells });
        }
      }
    }
    return out;
  }, [model, collapsed]);

  const [active, setActive] = useState<{ key: string; col: number }>({ key: '', col: 1 });
  const [editing, setEditing] = useState<{
    key: string;
    col: number;
    value: string;
    error: string | null;
    typed?: boolean;
  } | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const focusAfterRender = useRef(false);
  const committed = useRef(false);
  const beginEdit = (next: { key: string; col: number; value: string; error: string | null; typed?: boolean }) => {
    committed.current = false;
    setEditing(next);
  };

  const activeIndex = Math.max(
    0,
    rows.findIndex((r) => r.key === active.key),
  );
  const activeRow = rows[activeIndex];
  const activeCol = Math.min(Math.max(active.col, 0), quarters.length);

  useEffect(() => {
    if (!focusAfterRender.current) return;
    focusAfterRender.current = false;
    const el = tableRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    el?.focus();
  });

  const isEditable = (r: FlatRow | undefined, col: number) =>
    !!r && canEdit && r.kind === 'booking' && col >= 1 && !r.cells[col - 1]?.locked;

  const addressOf = (r: FlatRow, col: number): CellAddress | null => {
    if (!r.row || col < 1) return null;
    const personId = r.row.personId;
    const projectId = r.row.projectId;
    if (!personId || !projectId) return null;
    return { personId, projectId, craftId: r.row.craftId, quarterKey: quarters[col - 1].key };
  };

  const move = (dRow: number, dCol: number) => {
    const ri = Math.min(rows.length - 1, Math.max(0, activeIndex + dRow));
    const col = Math.min(quarters.length, Math.max(0, activeCol + dCol));
    focusAfterRender.current = true;
    setActive({ key: rows[ri]?.key ?? '', col });
  };

  const startEdit = (initial?: string) => {
    if (!isEditable(activeRow, activeCol)) return;
    const cell = activeRow.cells[activeCol - 1];
    const current = pivot === 'project' ? fmt.fte(cell.pct / 100) : String(Math.round(cell.pct));
    beginEdit({
      key: activeRow.key,
      col: activeCol,
      value: initial ?? current,
      error: null,
      typed: initial !== undefined,
    });
  };

  const commit = async (then?: { dRow: number; dCol: number }) => {
    if (!editing || committed.current) return;
    const r = rows.find((x) => x.key === editing.key);
    const addr = r ? addressOf(r, editing.col) : null;
    const raw = editing.value.trim() === '' ? '0' : editing.value.trim();
    const n = Number(raw);
    const pct = pivot === 'project' ? Math.round(n * 1000) / 10 : n;
    if (!Number.isFinite(n) || pct < 0 || pct > 200) {
      setEditing({ ...editing, error: pivot === 'project' ? 'Enter 0–2.0 FTE' : 'Enter 0–200' });
      return;
    }
    const before = r?.cells[editing.col - 1]?.pct ?? 0;
    committed.current = true;
    setEditing(null);
    focusAfterRender.current = true;
    if (then) move(then.dRow, then.dCol);
    if (addr && Math.abs(before - pct) > 0.05) await onCommit(addr, pct);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    if (editing) {
      if (e.key === 'Escape') {
        e.preventDefault();
        committed.current = true;
        setEditing(null);
        focusAfterRender.current = true;
        setActive({ ...active });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        void commit({ dRow: 1, dCol: 0 });
      } else if (e.key === 'Tab') {
        e.preventDefault();
        void commit({ dRow: 0, dCol: e.shiftKey ? -1 : 1 });
      }
      return;
    }
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      onUndo();
      return;
    }
    if (mod && e.shiftKey && e.key === 'ArrowRight') {
      e.preventDefault();
      const addr = activeRow && addressOf(activeRow, activeCol);
      if (addr && isEditable(activeRow, activeCol))
        onCopyForward({
          personId: addr.personId,
          projectId: addr.projectId,
          craftId: addr.craftId,
          fromQuarterKey: addr.quarterKey,
        });
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(1, 0);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(-1, 0);
        break;
      case 'ArrowRight':
        e.preventDefault();
        move(0, 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        move(0, -1);
        break;
      case 'Home':
        e.preventDefault();
        if (mod) {
          focusAfterRender.current = true;
          setActive({ key: rows[0]?.key ?? '', col: 0 });
        } else move(0, -quarters.length);
        break;
      case 'End':
        e.preventDefault();
        if (mod) {
          focusAfterRender.current = true;
          setActive({ key: rows[rows.length - 1]?.key ?? '', col: quarters.length });
        } else move(0, quarters.length);
        break;
      case 'Enter':
      case 'F2':
        e.preventDefault();
        if (activeCol === 0 && activeRow && activeRow.kind !== 'booking' && activeRow.kind !== 'group')
          onToggle(activeRow.key);
        else startEdit();
        break;
      case 'Delete':
      case 'Backspace':
        if (isEditable(activeRow, activeCol)) {
          e.preventDefault();
          beginEdit({ key: activeRow.key, col: activeCol, value: '', error: null });
        }
        break;
      default:
        if (/^[0-9.]$/.test(e.key) && !mod) {
          e.preventDefault();
          startEdit(e.key);
        }
    }
  };

  const onPasteBlock = (e: ClipboardEvent<HTMLTableElement>) => {
    if (editing || !canEdit) return;
    const text = e.clipboardData.getData('text/plain');
    if (!text || (!/[\t\n]/.test(text.trim()) && !/^\s*[\d.]+\s*$/.test(text))) return;
    e.preventDefault();
    const block = text
      .replace(/\r/g, '')
      .split('\n')
      .filter((l, i, all) => l !== '' || i < all.length - 1)
      .map((l) => l.split('\t'));
    onPaste({ rowKey: activeRow?.key ?? '', col: activeCol }, block, rows);
  };

  const cellKey = (r: FlatRow, col: number) => r.key === activeRow?.key && col === activeCol;
  const nCols = quarters.length + 2;

  return (
    <table
      ref={tableRef}
      className={cx('pcp-tbl', 'pcp-tbl--compact', 'al-grid', pivot === 'project' && 'al-grid--project')}
      role="grid"
      aria-label={pivot === 'person' ? 'Allocations by person and quarter' : 'Allocations by project and quarter'}
      aria-rowcount={rows.length + 1}
      aria-colcount={nCols}
      onKeyDown={onKeyDown}
      onPaste={onPasteBlock}
    >
      <thead>
        <tr role="row" aria-rowindex={1}>
          <th scope="col" role="columnheader" aria-colindex={1} className="pcp-tbl-sticky al-col-name">
            {pivot === 'person' ? 'Person · project' : 'Project · person'}
          </th>
          {quarters.map((q, i) => (
            <th
              key={q.key}
              scope="col"
              role="columnheader"
              aria-colindex={i + 2}
              className="pcp-num al-col-q"
              title={fmt.quarterTooltip(q)}
            >
              <span className="al-qhead">
                {q.label}
                <span className="al-qhead__sub">{q.calendarLabel}</span>
              </span>
            </th>
          ))}
          <th scope="col" role="columnheader" aria-colindex={nCols} className="pcp-tbl-menu">
            <span className="pcp-sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => {
          const rowIndex = ri + 2;
          if (r.kind === 'group') {
            return (
              <tr key={r.key} role="row" aria-rowindex={rowIndex} className="pcp-tbl-group al-row--group">
                <th
                  scope="rowgroup"
                  role="rowheader"
                  aria-colindex={1}
                  className="pcp-tbl-sticky"
                  tabIndex={cellKey(r, 0) ? 0 : -1}
                  data-active={cellKey(r, 0)}
                  onFocus={() => setActive({ key: r.key, col: 0 })}
                >
                  {r.label}
                </th>
                {r.cells.map((c, i) => (
                  <td
                    key={c.quarterKey}
                    role="gridcell"
                    aria-colindex={i + 2}
                    aria-readonly="true"
                    className="pcp-num"
                    tabIndex={cellKey(r, i + 1) ? 0 : -1}
                    data-active={cellKey(r, i + 1)}
                    onFocus={() => setActive({ key: r.key, col: i + 1 })}
                  >
                    <ValueCell cell={c} pivot={pivot} total label={`${r.label} total, ${quarters[i].label}`} />
                  </td>
                ))}
                <td role="gridcell" aria-colindex={nCols} />
              </tr>
            );
          }
          const parent = r.kind === 'person' || r.kind === 'project';
          const isCollapsed = collapsed.has(r.key);
          const person = r.row?.personId ? idx.people.get(r.row.personId) : undefined;
          const craft = r.row?.craftId ? idx.crafts.get(r.row.craftId) : null;
          const via: 'above' | 'below' | 'undeclared' =
            !person || !r.row?.craftId
              ? 'above'
              : person.primaryCraft === r.row.craftId
                ? 'above'
                : person.secondaryCrafts.some((x) => x.craftId === r.row?.craftId)
                  ? 'below'
                  : 'undeclared';
          const prof = person?.secondaryCrafts.find((x) => x.craftId === r.row?.craftId)?.proficiency;
          const states = new Set(r.cells.map((c) => c.state).filter(Boolean));
          const sources = new Set(r.cells.map((c) => c.source).filter(Boolean));
          const state = states.size === 1 ? [...states][0] : states.size > 1 ? 'mixed' : null;
          const source = sources.size === 1 ? [...sources][0] : sources.size > 1 ? 'mixed' : null;
          const tentative = r.kind === 'booking' && state === 'tentative';
          const project = r.row?.projectId ? idx.projects.get(r.row.projectId) : undefined;
          const demand = r.kind === 'project' && r.row?.projectId ? demandByProject.get(r.row.projectId) : undefined;
          return (
            <tr
              key={r.key}
              role="row"
              aria-rowindex={rowIndex}
              className={cx(
                parent ? 'al-row--parent' : 'al-row--booking',
                tentative && 'is-tentative',
                selected.has(r.key) && 'is-selected',
              )}
            >
              <th
                scope="row"
                role="rowheader"
                aria-colindex={1}
                className="pcp-tbl-sticky al-col-name"
                tabIndex={cellKey(r, 0) ? 0 : -1}
                data-active={cellKey(r, 0)}
                onFocus={() => setActive({ key: r.key, col: 0 })}
              >
                {parent ? (
                  <span className="al-name">
                    <button
                      type="button"
                      className="al-toggle"
                      tabIndex={-1}
                      aria-label={isCollapsed ? `Expand ${r.label}` : `Collapse ${r.label}`}
                      aria-expanded={!isCollapsed}
                      onClick={() => onToggle(r.key)}
                    >
                      {isCollapsed ? (
                        <ChevronRight size={16} aria-hidden="true" />
                      ) : (
                        <ChevronDown size={16} aria-hidden="true" />
                      )}
                    </button>
                    <span className="al-name__text">
                      <span className="pcp-strong pcp-truncate" title={r.label}>
                        {r.label}
                      </span>
                      <span className="pcp-caption pcp-text-tertiary pcp-truncate">
                        {r.kind === 'person'
                          ? (person?.role ?? '')
                          : [project?.stage, project ? fmt.dateRange(project.startDate, project.endDate) : null]
                              .filter(Boolean)
                              .join(' · ')}
                      </span>
                    </span>
                  </span>
                ) : (
                  <span className="al-name al-name--sub">
                    {canEdit && (
                      <Checkbox
                        aria-label={`Select ${r.label}`}
                        checked={selected.has(r.key)}
                        onChange={(v) => onSelect(r.key, v)}
                      />
                    )}
                    <span className="pcp-truncate al-name__label" title={r.label}>
                      {r.label}
                    </span>
                    <CraftChip craft={craft} via={via} proficiency={prof} />
                    {tentative && <BookingStatePill state="tentative" />}
                    {source && source !== 'manual' && <ProvenanceTag source={source} />}
                  </span>
                )}
              </th>
              {r.cells.map((c, i) => {
                const col = i + 1;
                const isActive = cellKey(r, col);
                const isEditing = editing && editing.key === r.key && editing.col === col;
                const editable = isEditable(r, col);
                const over = r.kind === 'booking' && r.row?.personId && c.pct > 0 ? overInfo(r.row.personId, i) : null;
                const partialText = c.partial
                  ? c.allocationIds
                      .map((id) => idx.allocations.get(id))
                      .filter((a): a is D.AllocationDTO => !!a)
                      .map((a) => {
                        const p = idx.projects.get(a.projectId);
                        const from =
                          (a.startDate ?? p?.startDate ?? quarters[i].start) < quarters[i].start
                            ? quarters[i].start
                            : (a.startDate ?? p?.startDate ?? quarters[i].start);
                        const to =
                          (a.endDate ?? p?.endDate ?? quarters[i].end) > quarters[i].end
                            ? quarters[i].end
                            : (a.endDate ?? p?.endDate ?? quarters[i].end);
                        return `${fmt.dateShort(from)} – ${fmt.dateShort(to)} at ${a.percentage}%`;
                      })
                      .join('; ')
                  : '';
                const label = `${r.label}${craft ? `, ${craft.name}` : ''}, ${quarters[i].label}, ${pivot === 'project' && r.kind !== 'person' ? `${fmt.fte(c.pct / 100)} FTE` : fmt.pct(c.pct)}${c.band ? `, ${BAND_LABEL[c.band]}` : ''}${c.locked ? ', locked: imported from Planview' : ''}${tentative ? ', tentative' : ''}${partialText ? `, partial quarter ${partialText}` : ''}`;
                return (
                  <td
                    key={c.quarterKey}
                    role="gridcell"
                    aria-colindex={col + 1}
                    aria-readonly={!editable}
                    aria-label={label}
                    aria-selected={isActive}
                    className={cx(
                      'pcp-num al-cell',
                      editable && 'is-editable',
                      isActive && 'is-active',
                      c.locked && 'is-locked',
                    )}
                    tabIndex={isActive && !isEditing ? 0 : -1}
                    data-active={isActive && !isEditing}
                    title={
                      c.locked
                        ? 'Imported from Planview. Change it in Planview or ask a PMO Admin to allow overrides.'
                        : partialText
                          ? `Partial quarter: ${partialText}`
                          : undefined
                    }
                    onFocus={() => {
                      if (!isEditing) setActive({ key: r.key, col });
                    }}
                    onDoubleClick={() => {
                      if (!editable) return;
                      setActive({ key: r.key, col });
                      beginEdit({
                        key: r.key,
                        col,
                        value: pivot === 'project' ? fmt.fte(c.pct / 100) : String(Math.round(c.pct)),
                        error: null,
                      });
                    }}
                  >
                    {isEditing ? (
                      <span
                        className={cx(
                          'al-edit pcp-control pcp-control--sm pcp-control--number',
                          editing.error && 'pcp-control--invalid',
                        )}
                      >
                        <input
                          className="pcp-control__input al-edit__input"
                          // eslint-disable-next-line jsx-a11y/no-autofocus -- grid edit mode starts in the cell input
                          autoFocus
                          inputMode="decimal"
                          aria-label={`Edit ${label}`}
                          aria-invalid={!!editing.error || undefined}
                          value={editing.value}
                          onChange={(e) =>
                            setEditing({ ...editing, value: e.target.value.replace(/[^\d.]/g, ''), error: null })
                          }
                          onBlur={() => void commit()}
                          onFocus={(e) => {
                            const el = e.currentTarget;
                            if (editing.typed) el.setSelectionRange(el.value.length, el.value.length);
                            else el.select();
                          }}
                        />
                        {editing.error && (
                          <span className="al-edit__error" role="alert">
                            {editing.error}
                          </span>
                        )}
                      </span>
                    ) : r.kind === 'booking' ? (
                      <span className={cx('al-val', tentative && c.pct > 0 && 'al-val--tentative')}>
                        {c.locked && (
                          <Lock size={12} strokeWidth={2} aria-hidden="true" className="pcp-text-tertiary" />
                        )}
                        {c.partial && (
                          <CalendarRange size={12} strokeWidth={2} aria-hidden="true" className="pcp-text-tertiary" />
                        )}
                        {over && over.band === 'over' && (
                          <TriangleAlert
                            size={12}
                            strokeWidth={2}
                            aria-hidden="true"
                            className="pcp-icon-status--danger"
                            aria-label={`Takes ${person?.name ?? 'them'} to ${fmt.pct(over.pct)} in ${quarters[i].label}`}
                          />
                        )}
                        {c.pct > 0 ? (
                          pivot === 'project' ? (
                            fmt.fte(c.pct / 100)
                          ) : (
                            fmt.pct(c.pct)
                          )
                        ) : (
                          <span className="al-val--empty">{editable ? '–' : ''}</span>
                        )}
                      </span>
                    ) : r.kind === 'project' ? (
                      <ProjectCell pct={c.pct} demand={demand?.[i] ?? 0} />
                    ) : (
                      <ValueCell cell={c} pivot={pivot} label={label} />
                    )}
                    {over && over.band === 'over' && !isEditing && (
                      <span className="pcp-sr-only">
                        Takes {person?.name} to {fmt.pct(over.pct)} in {quarters[i].label}
                      </span>
                    )}
                  </td>
                );
              })}
              <td role="gridcell" aria-colindex={nCols} className="pcp-tbl-menu">
                {r.row && r.kind === 'booking' && (canEdit || r.cells.some((c) => c.state === 'tentative')) && (
                  <Menu
                    trigger={<IconButton icon={Ellipsis} label={`Actions for ${r.label}`} size="sm" />}
                    items={rowMenu(r.row)}
                  />
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ValueCell({
  cell,
  pivot,
  total,
  label,
}: {
  cell: GridCell;
  pivot: 'person' | 'project';
  total?: boolean;
  label: string;
}) {
  if (pivot === 'project' || cell.band === null) {
    return (
      <span className={cx('al-val', total && 'pcp-strong')} aria-label={label}>
        {pivot === 'project' ? `${fmt.fte(cell.pct / 100)}` : fmt.pct(cell.pct)}
      </span>
    );
  }
  return <BandCell value={cell.pct} band={cell.band} label={label} />;
}

function ProjectCell({ pct, demand }: { pct: number; demand: number }) {
  const staffed = pct / 100;
  const gap = Math.round((demand - staffed) * 10) / 10;
  return (
    <span className="al-proj" title={`Staffed ${fmt.fte(staffed)} of ${fmt.fte(demand)} FTE demand`}>
      <span className="pcp-strong">{fmt.fte(staffed)}</span>
      <span className="pcp-caption pcp-text-tertiary"> / {fmt.fte(demand)}</span>
      {gap > 0.04 && (
        <span className="al-gap" aria-label={`Gap ${fmt.fte(gap)} FTE`}>
          −{fmt.fte(gap)}
        </span>
      )}
    </span>
  );
}
