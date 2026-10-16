/**
 * Allocations (AL-01…AL-07) — route `/o/:org/w/:ws/plan/allocations` (`?pivot=project`, `?group=`, `?tentative=0`).
 * People × QBR1–QBR4 quarter cells with tentative/confirmed state, inline edit via setQuarterCell,
 * copy-forward, undo, bulk edit, paste from Excel, provenance and the Planview lock.
 */
import { useCallback, useMemo, useState } from 'react';
import { CalendarRange, Check, Copy, Grid3x3, Lock, Plus, Search, Trash2, Undo2, X } from 'lucide-react';
import type * as D from '../../../shared/contracts/dto';
import type { AllocationOp } from '../../../shared/contracts/api';
import { useMutations, useQuarters, useUndo, useWorkspace } from '../../../state';
import {
  buildAllocationGrid,
  buildDemandGrid,
  buildPeopleRows,
  copyForward as copyForwardOps,
  setQuarterCell as setQuarterCellOps,
  type GridRow,
} from '../../../utils/viewModels';
import {
  Button,
  Card,
  Checkbox,
  Dialog,
  EmptyState,
  FormField,
  Kbd,
  NumberField,
  PageBody,
  PageHeader,
  SegmentedControl,
  Select,
  TextField,
  toast,
  useAction,
  useQueryParam,
  type MenuItem,
} from '../_kit';
import { BookingDatesDialog } from '../_parts/BookingDatesDialog';
import { AllocationGrid, type CellAddress, type FlatRow } from './AllocationGrid';
import { AddBookingDialog } from './AddBookingDialog';
import './allocations.css';

export default function AllocationsPage() {
  const { can } = useWorkspace();
  const undo = useUndo();
  const [adding, setAdding] = useState(false);
  return (
    <div className="b2-page b2-page--dense">
      <PageHeader
        crumbs={[{ label: 'Plan' }, { label: 'Allocations' }]}
        title="Allocations"
        description="Plan each person across QBR1–QBR4. Type into a cell; Enter or Tab saves, Escape cancels, Ctrl+Z undoes."
        actions={
          <>
            {can('allocations.write') && (
              <Button icon={Undo2} disabled={!undo.canUndo} onClick={() => void undo.undo()} title={undo.label ? `Undo: ${undo.label}` : 'Nothing to undo'}>
                Undo
              </Button>
            )}
            {can('allocations.write') && (
              <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
                Add booking
              </Button>
            )}
          </>
        }
      />
      <PageBody label="allocations">{(s) => <AllocationsBody snapshot={s} adding={adding} onAddClose={() => setAdding(false)} />}</PageBody>
    </div>
  );
}

function AllocationsBody({ snapshot: s, adding, onAddClose }: { snapshot: D.WorkspaceSnapshot; adding: boolean; onAddClose(): void }) {
  const { can, thresholds } = useWorkspace();
  const quarters = useQuarters();
  const m = useMutations();
  const undo = useUndo();
  const { run } = useAction();
  const [pivot, setPivot] = useQueryParam('pivot', 'person');
  const [groupBy, setGroupBy] = useQueryParam('group', 'team');
  const [tentativeParam, setTentative] = useQueryParam('tentative', '1');
  const [q, setQ] = useQueryParam('q');
  const includeTentative = tentativeParam !== '0';
  const pv = pivot === 'project' ? 'project' : 'person';
  const group = (
    pv === 'project' && (groupBy === 'team' || groupBy === 'chapter') ? 'tribe' : ['team', 'chapter', 'tribe', 'none'].includes(groupBy) ? groupBy : 'team'
  ) as 'team' | 'chapter' | 'tribe' | 'none';
  const canEdit = can('allocations.write');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dates, setDates] = useState<{ resourceId: string; projectId: string; craftId: string | null } | null>(null);
  const [bulk, setBulk] = useState<'set' | 'copy' | null>(null);

  const model = useMemo(() => {
    const full = buildAllocationGrid(s, quarters, {
      groupBy: group,
      pivot: pv,
      includeTentative,
      thresholds,
    });
    const needle = q.trim().toLowerCase();
    if (!needle) return full;
    // Keep a parent row (and its bookings) when the parent or any of its bookings match.
    return {
      ...full,
      groups: full.groups
        .map((g) => {
          const out: GridRow[] = [];
          let block: GridRow[] = [];
          const flush = () => {
            if (block.some((r) => r.label.toLowerCase().includes(needle))) out.push(...block);
            block = [];
          };
          for (const r of g.rows) {
            if (r.depth === 0) flush();
            block.push(r);
          }
          flush();
          return { ...g, rows: out };
        })
        .filter((g) => g.rows.length > 0),
    };
  }, [s, quarters, group, pv, includeTentative, thresholds, q]);

  const peopleRows = useMemo(() => buildPeopleRows(s, quarters, thresholds), [s, quarters, thresholds]);
  const overInfo = useCallback(
    (personId: D.ID, qi: number) => {
      const r = peopleRows.find((x) => x.person.id === personId)?.quarters[qi];
      return r ? { pct: r.relativePct, band: r.band } : null;
    },
    [peopleRows],
  );
  const demandByProject = useMemo(() => {
    const map = new Map<D.ID, number[]>();
    for (const d of buildDemandGrid(s, quarters)) map.set(d.project.id, d.cells.map((c) => c.demandFte));
    return map;
  }, [s, quarters]);

  const allRows = useMemo(() => model.groups.flatMap((g) => g.rows), [model]);
  const selectedRows = allRows.filter((r) => r.kind === 'booking' && selected.has(r.key));

  const commit = async (a: CellAddress, pct: number) => {
    const res = await run('cell', () =>
      m.allocations.setQuarterCell({ resourceId: a.personId, projectId: a.projectId, craftId: a.craftId, quarterKey: a.quarterKey, pct }),
    );
    return res.ok;
  };

  const copyForward = (a: { personId: D.ID; projectId: D.ID; craftId: D.ID | null; fromQuarterKey: D.QuarterKey }) => {
    const i = quarters.findIndex((x) => x.key === a.fromQuarterKey);
    const later = quarters.slice(i + 1);
    if (later.length === 0) {
      toast({ tone: 'info', title: 'Nothing to copy to', body: `${quarters[i]?.label} is the last quarter in the window.` });
      return;
    }
    void run(
      'copy',
      () => m.allocations.copyForward({ resourceId: a.personId, projectId: a.projectId, craftId: a.craftId, fromQuarterKey: a.fromQuarterKey }),
      { success: `Copied to ${later[0].label}${later.length > 1 ? `–${later[later.length - 1].label}` : ''}`, undo: true },
    );
  };

  const onUndo = () => {
    if (!undo.canUndo) return;
    const label = undo.label;
    void undo.undo().then(() => toast({ tone: 'info', title: 'Undone', body: label ?? undefined }));
  };

  const onPaste = async (start: { rowKey: string; col: number }, block: string[][], rows: FlatRow[]) => {
    const r0 = rows.findIndex((r) => r.key === start.rowKey);
    if (r0 < 0) return;
    const values = block.map((line) => line.map((v) => v.trim().replace('%', '')));
    const bad = values.flat().filter((v) => v !== '' && !Number.isFinite(Number(v)));
    if (bad.length) {
      toast({ tone: 'error', title: 'Paste cancelled', body: `Only numbers can be pasted. Found "${bad.slice(0, 3).join('", "')}".` });
      return;
    }
    const cells: Array<CellAddress & { pct: number }> = [];
    let skipped = 0;
    values.forEach((line, dr) => {
      const r = rows[r0 + dr];
      line.forEach((v, dc) => {
        const col = Math.max(1, start.col) + dc;
        if (v === '') return;
        if (!r || r.kind !== 'booking' || col > quarters.length || r.cells[col - 1]?.locked || !r.row?.personId || !r.row.projectId) {
          skipped++;
          return;
        }
        const n = Number(v);
        const pct = pv === 'project' ? n * 100 : n;
        if (pct < 0 || pct > 200) {
          skipped++;
          return;
        }
        cells.push({ personId: r.row.personId, projectId: r.row.projectId, craftId: r.row.craftId, quarterKey: quarters[col - 1].key, pct });
      });
    });
    let done = 0;
    for (const c of cells) {
      try {
        await m.allocations.setQuarterCell({ resourceId: c.personId, projectId: c.projectId, craftId: c.craftId, quarterKey: c.quarterKey, pct: c.pct });
        done++;
      } catch {
        skipped++;
      }
    }
    toast({
      tone: skipped ? 'warning' : 'success',
      title: `${done} cell${done === 1 ? '' : 's'} updated, ${skipped} skipped`,
      action: done ? { label: 'Undo', onClick: () => void (async () => { for (let i = 0; i < done; i++) await undo.undo(); })() } : undefined,
    });
  };

  const rowMenu = (row: GridRow): MenuItem[] => {
    const items: MenuItem[] = [];
    if (!row.personId || !row.projectId) return items;
    const tentativeIds = row.cells.filter((c) => c.state === 'tentative').flatMap((c) => c.allocationIds);
    const uniq = [...new Set(tentativeIds)];
    if (canEdit) {
      quarters.slice(0, -1).forEach((qq, i) => {
        if (row.cells[i]?.pct > 0)
          items.push({
            label: `Copy ${qq.label} to later quarters`,
            icon: Copy,
            onSelect: () => copyForward({ personId: row.personId as string, projectId: row.projectId as string, craftId: row.craftId, fromQuarterKey: qq.key }),
          });
      });
      items.push({ label: 'Edit dates', icon: CalendarRange, onSelect: () => setDates({ resourceId: row.personId as string, projectId: row.projectId as string, craftId: row.craftId }) });
    }
    if (uniq.length && (canEdit || can('allocations.respond.own'))) {
      items.push({
        label: 'Confirm',
        icon: Check,
        separatorBefore: true,
        onSelect: () => void run('confirm', async () => { for (const id of uniq) await m.allocations.respond(id, { decision: 'accept' }); }, { success: 'Booking confirmed', undo: true }),
      });
      items.push({
        label: 'Decline',
        icon: X,
        onSelect: () => void run('decline', async () => { for (const id of uniq) await m.allocations.respond(id, { decision: 'decline' }); }, { success: 'Booking declined', undo: true }),
      });
    }
    if (canEdit) {
      const ops: AllocationOp[] = [...new Set(row.cells.flatMap((c) => c.allocationIds))]
        .map((id) => s.allocations.find((a) => a.id === id))
        .filter((a): a is D.AllocationDTO => !!a && a.source !== 'planview')
        .map((a) => ({ op: 'delete' as const, id: a.id, version: a.version }));
      if (ops.length)
        items.push({
          label: 'Remove booking',
          icon: Trash2,
          danger: true,
          separatorBefore: true,
          onSelect: () => void run('remove', () => m.allocations.batch(ops, `Remove ${row.label} booking`), { success: 'Booking removed', undo: true }),
        });
    }
    return items;
  };

  const tentativeCount = s.allocations.filter((a) => a.state === 'tentative').length;
  const lockedRule = s.org.planning.planviewOwnership === 'locked';
  const empty = allRows.length === 0;

  return (
    <>
      <Card flush>
        {selectedRows.length > 0 && canEdit ? (
          <div className="b2-toolbar b2-toolbar--bulk" role="region" aria-label="Bulk actions">
            <span className="b2-toolbar__count">{selectedRows.length} booking{selectedRows.length === 1 ? '' : 's'} selected</span>
            <Button size="sm" onClick={() => setBulk('set')}>Set % in a quarter</Button>
            <Button size="sm" icon={Copy} onClick={() => setBulk('copy')}>Copy to later quarters</Button>
            <span className="b2-spacer" />
            <Button variant="link" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        ) : (
          <div className="b2-toolbar al-toolbar">
            <SegmentedControl
              label="Pivot"
              value={pv}
              onChange={(v) => setPivot(v)}
              items={[
                { id: 'person', label: 'By person' },
                { id: 'project', label: 'By project' },
              ]}
            />
            <span className="al-toolbar__group">
              <Select
                size="sm"
                ariaLabel="Group by"
                value={group}
                onChange={setGroupBy}
                options={[
                  ...(pv === 'person'
                    ? [
                        { value: 'team', label: 'Group: team' },
                        { value: 'chapter', label: 'Group: chapter' },
                      ]
                    : []),
                  { value: 'tribe', label: pv === 'person' ? 'Group: home tribe' : 'Group: tribe' },
                  { value: 'none', label: 'Group: none' },
                ]}
              />
            </span>
            <span className="al-toolbar__search">
              <TextField id="al-q" icon={Search} size="sm" value={q} placeholder={pv === 'person' ? 'Find person or project' : 'Find project or person'} ariaLabel="Find in grid" onChange={(v) => setQ(v)} />
            </span>
            <Checkbox checked={includeTentative} onChange={(v) => setTentative(v ? '1' : '0')} label={`Show tentative (${tentativeCount})`} />
            <span className="b2-spacer" />
            <ul className="b2-legend" aria-label="Legend">
              <li>
                <span className="b2-swatch b2-swatch--dashed al-swatch-tentative" aria-hidden="true" />
                Tentative
              </li>
              <li>
                <CalendarRange size={12} strokeWidth={2} aria-hidden="true" />
                Partial quarter
              </li>
              <li>
                <Lock size={12} strokeWidth={2} aria-hidden="true" />
                Locked (Planview)
              </li>
            </ul>
          </div>
        )}
        {empty ? (
          <EmptyState icon={Grid3x3} title={q ? 'Nothing matches that search.' : 'No bookings yet'} body={q ? undefined : 'Add a booking to start planning the next four quarters.'} />
        ) : (
          <div className="b2-table-wrap b2-table-wrap--tall al-wrap">
            <AllocationGrid
              model={model}
              pivot={pv}
              snapshot={s}
              canEdit={canEdit}
              collapsed={collapsed}
              onToggle={(key) =>
                setCollapsed((c) => {
                  const n = new Set(c);
                  if (n.has(key)) n.delete(key);
                  else n.add(key);
                  return n;
                })
              }
              selected={selected}
              onSelect={(key, on) =>
                setSelected((c) => {
                  const n = new Set(c);
                  if (on) n.add(key);
                  else n.delete(key);
                  return n;
                })
              }
              onCommit={commit}
              onCopyForward={copyForward}
              onUndo={onUndo}
              onPaste={(start, block, rows) => void onPaste(start, block, rows)}
              rowMenu={rowMenu}
              demandByProject={demandByProject}
              overInfo={overInfo}
            />
          </div>
        )}
        <div className="b2-card__foot al-foot">
          <span className="b2-caption">
            {pv === 'person' ? 'Person rows: total load as % of target. Booking rows: % of a full-time week.' : 'Project rows: staffed / demand FTE. Person rows: FTE.'}
          </span>
          <span className="b2-spacer" />
          {lockedRule && (
            <span className="b2-caption al-foot__hint">
              <Lock size={12} aria-hidden="true" /> Planview bookings are locked
            </span>
          )}
          {canEdit && (
            <span className="b2-caption al-foot__hint">
              <Kbd>Enter</Kbd> edit · <Kbd>Tab</Kbd> save and move · <Kbd>Ctrl</Kbd>+<Kbd>Shift</Kbd>+<Kbd>→</Kbd> copy forward · <Kbd>Ctrl</Kbd>+<Kbd>Z</Kbd> undo · paste from Excel
            </span>
          )}
        </div>
      </Card>
      <AddBookingDialog
        snapshot={s}
        open={adding}
        onClose={onAddClose}
        onAdded={(personKey) =>
          setCollapsed((c) => {
            const n = new Set(c);
            n.delete(personKey);
            return n;
          })
        }
      />
      <BookingDatesDialog snapshot={s} booking={dates} onClose={() => setDates(null)} />
      <BulkDialog
        kind={bulk}
        rows={selectedRows}
        onClose={() => setBulk(null)}
        onApply={async (kind, quarterKey, pct) => {
          let ops: AllocationOp[] = [];
          for (const r of selectedRows) {
            if (!r.personId || !r.projectId) continue;
            const a = { resourceId: r.personId, projectId: r.projectId, craftId: r.craftId };
            ops = ops.concat(
              kind === 'set' ? setQuarterCellOps(s, quarters, { ...a, quarterKey, pct }) : copyForwardOps(s, quarters, { ...a, fromQuarterKey: quarterKey }),
            );
          }
          const label = kind === 'set' ? `Set ${pct}% in ${quarters.find((x) => x.key === quarterKey)?.label}` : 'Copy to later quarters';
          const res = await run('bulk', () => m.allocations.batch(ops, label), {
            success: `${selectedRows.length} booking${selectedRows.length === 1 ? '' : 's'} updated`,
            body: label,
            undo: true,
          });
          if (res.ok) {
            setBulk(null);
            setSelected(new Set());
          }
        }}
      />
    </>
  );
}

function BulkDialog({
  kind,
  rows,
  onClose,
  onApply,
}: {
  kind: 'set' | 'copy' | null;
  rows: GridRow[];
  onClose(): void;
  onApply(kind: 'set' | 'copy', quarterKey: string, pct: number): Promise<void>;
}) {
  const quarters = useQuarters();
  const [quarterKey, setQuarterKey] = useState(quarters[0]?.key ?? '');
  const [pct, setPct] = useState('0');
  const [busy, setBusy] = useState(false);
  if (!kind) return null;
  const n = Number(pct);
  const invalid = kind === 'set' && !(n >= 0 && n <= 200);
  const options = (kind === 'copy' ? quarters.slice(0, -1) : quarters).map((x) => ({ value: x.key, label: `${x.label} · ${x.calendarLabel}` }));
  return (
    <Dialog
      open
      title={kind === 'set' ? 'Set % in a quarter' : 'Copy to later quarters'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={invalid}
            onClick={async () => {
              setBusy(true);
              await onApply(kind, quarterKey, n);
              setBusy(false);
            }}
          >
            Apply to {rows.length} booking{rows.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="b2-form">
        <FormField label={kind === 'set' ? 'Quarter' : 'Copy from'} htmlFor="bulk-q">
          <Select id="bulk-q" value={quarterKey} onChange={setQuarterKey} options={options} />
        </FormField>
        {kind === 'set' && (
          <FormField label="Allocation" htmlFor="bulk-pct" help="0 removes that quarter only." error={invalid ? 'Enter 0–200' : null}>
            <NumberField id="bulk-pct" unit="%" value={pct} min={0} max={200} step={5} invalid={invalid} onChange={setPct} />
          </FormField>
        )}
        <p className="b2-caption b2-form__full">Applied in one change, so a single Undo restores everything.</p>
      </div>
    </Dialog>
  );
}
