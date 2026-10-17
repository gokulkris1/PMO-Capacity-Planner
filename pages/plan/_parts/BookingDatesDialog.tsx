/** Date-precise booking editor (AL-06): edit the dated slices of one person × project × craft booking. */
import { useMemo, useState } from 'react';
import { Plus, Trash2, TriangleAlert } from 'lucide-react';
import type * as D from '../../../shared/contracts/dto';
import type { AllocationOp } from '../../../shared/contracts/api';
import { useMutations } from '../../../state';
import {
  Banner,
  BookingStatePill,
  Button,
  CraftChip,
  Dialog,
  fmt,
  IconButton,
  indexSnapshot,
  NumberField,
  ProvenanceTag,
  TextField,
  useAction,
  numOrNull,
  numText,
} from '../../../components/ui';

interface Slice {
  key: string;
  id: string | null;
  version: number;
  pct: string;
  start: string;
  end: string;
  notes: string;
  state: D.AllocationState;
  source: D.AllocationSource;
}

export function BookingDatesDialog({
  snapshot: s,
  booking,
  onClose,
}: {
  snapshot: D.WorkspaceSnapshot;
  booking: { resourceId: D.ID; projectId: D.ID; craftId: D.ID | null } | null;
  onClose(): void;
}) {
  if (!booking) return null;
  return (
    <Editor
      key={`${booking.resourceId}:${booking.projectId}:${booking.craftId}`}
      s={s}
      booking={booking}
      onClose={onClose}
    />
  );
}

function Editor({
  s,
  booking,
  onClose,
}: {
  s: D.WorkspaceSnapshot;
  booking: { resourceId: D.ID; projectId: D.ID; craftId: D.ID | null };
  onClose(): void;
}) {
  const m = useMutations();
  const { busy, run } = useAction();
  const idx = useMemo(() => indexSnapshot(s), [s]);
  const person = idx.people.get(booking.resourceId);
  const project = idx.projects.get(booking.projectId);
  const craft = booking.craftId ? idx.crafts.get(booking.craftId) : null;
  const original = useMemo(
    () =>
      s.allocations.filter(
        (a) =>
          a.resourceId === booking.resourceId &&
          a.projectId === booking.projectId &&
          a.state !== 'declined' &&
          (a.craftId ?? person?.primaryCraft ?? null) === booking.craftId,
      ),
    [s.allocations, booking, person],
  );
  const [slices, setSlices] = useState<Slice[]>(() =>
    original.map((a) => ({
      key: a.id,
      id: a.id,
      version: a.version,
      pct: String(a.percentage),
      start: a.startDate ?? project?.startDate ?? '',
      end: a.endDate ?? project?.endDate ?? '',
      notes: a.notes ?? '',
      state: a.state,
      source: a.source,
    })),
  );
  const [tried, setTried] = useState(false);
  const errors = slices.map((x) => {
    const p = Number(x.pct);
    if (!x.pct || !Number.isFinite(p) || p < 0 || p > 200) return 'Enter 0–200';
    if (x.start && x.end && x.end < x.start) return 'End date must be on or after the start date';
    return null;
  });
  const warnings = slices.map((x) =>
    project &&
    ((project.startDate && x.start && x.start < project.startDate) ||
      (project.endDate && x.end && x.end > project.endDate))
      ? 'Outside the project dates. It will only count while the project runs.'
      : null,
  );
  const update = (key: string, patch: Partial<Slice>) =>
    setSlices((list) => list.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const save = async () => {
    setTried(true);
    if (errors.some(Boolean)) return;
    const ops: AllocationOp[] = [];
    const kept = new Set(slices.filter((x) => x.id).map((x) => x.id));
    for (const a of original) if (!kept.has(a.id)) ops.push({ op: 'delete', id: a.id, version: a.version });
    for (const x of slices) {
      const patch = {
        percentage: Number(x.pct),
        startDate: x.start || null,
        endDate: x.end || null,
        notes: x.notes || null,
      };
      if (x.id) {
        const a = original.find((o) => o.id === x.id);
        if (
          a &&
          (a.percentage !== patch.percentage ||
            (a.startDate ?? project?.startDate ?? null) !== patch.startDate ||
            (a.endDate ?? project?.endDate ?? null) !== patch.endDate ||
            (a.notes ?? null) !== patch.notes)
        )
          ops.push({ op: 'update', id: x.id, version: x.version, patch });
      } else {
        ops.push({
          op: 'create',
          allocation: {
            resourceId: booking.resourceId,
            projectId: booking.projectId,
            craftId: booking.craftId,
            source: 'manual',
            state: 'confirmed',
            ...patch,
          },
        });
      }
    }
    if (ops.length === 0) {
      onClose();
      return;
    }
    const res = await run('save', () => m.allocations.batch(ops, 'Edit booking dates'), {
      success: 'Booking dates saved',
      undo: true,
    });
    if (res.ok) onClose();
  };

  return (
    <Dialog
      open
      size="lg"
      title="Edit booking dates"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy === 'save'} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="pcp-stack pcp-stack--md">
        <dl className="pcp-dl">
          <dt>Person</dt>
          <dd>{person?.name ?? booking.resourceId}</dd>
          <dt>Project</dt>
          <dd>
            {project?.name ?? booking.projectId}{' '}
            <span className="pcp-caption pcp-text-tertiary">
              Project runs {fmt.dateRange(project?.startDate, project?.endDate)}
            </span>
          </dd>
          <dt>Craft</dt>
          <dd>
            <CraftChip craft={craft} via={craft?.id === person?.primaryCraft ? 'above' : 'below'} />
          </dd>
        </dl>
        <div className="pcp-tbl-wrap">
          <table className="pcp-tbl pcp-tbl--compact al-slices">
            <caption className="pcp-sr-only">Booking slices</caption>
            <thead>
              <tr>
                <th scope="col" className="pcp-num">
                  Allocation
                </th>
                <th scope="col">Start</th>
                <th scope="col">End</th>
                <th scope="col">Notes</th>
                <th scope="col">State</th>
                <th scope="col">
                  <span className="pcp-sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {slices.map((x, i) => (
                <tr key={x.key}>
                  <td className="al-slices__pct">
                    <NumberField
                      id={`slice-${x.key}-pct`}
                      size="sm"
                      unit="%"
                      value={numOrNull(x.pct)}
                      min={0}
                      max={200}
                      step={5}
                      invalid={tried && errors[i] === 'Enter 0–200'}
                      aria-label={`Slice ${i + 1} allocation`}
                      onChange={(n) => update(x.key, { pct: numText(n) })}
                    />
                  </td>
                  <td>
                    <TextField
                      id={`slice-${x.key}-start`}
                      type="date"
                      size="sm"
                      value={x.start}
                      aria-label={`Slice ${i + 1} start date`}
                      onValueChange={(v) => update(x.key, { start: v })}
                    />
                  </td>
                  <td>
                    <TextField
                      id={`slice-${x.key}-end`}
                      type="date"
                      size="sm"
                      value={x.end}
                      invalid={tried && !!errors[i] && errors[i] !== 'Enter 0–200'}
                      aria-label={`Slice ${i + 1} end date`}
                      onValueChange={(v) => update(x.key, { end: v })}
                    />
                  </td>
                  <td>
                    <TextField
                      id={`slice-${x.key}-notes`}
                      size="sm"
                      value={x.notes}
                      placeholder="Optional"
                      aria-label={`Slice ${i + 1} notes`}
                      onValueChange={(v) => update(x.key, { notes: v })}
                    />
                  </td>
                  <td>
                    <span className="pcp-row">
                      <BookingStatePill state={x.state} />
                      <ProvenanceTag source={x.source} />
                    </span>
                  </td>
                  <td className="pcp-tbl-menu">
                    <IconButton
                      icon={Trash2}
                      size="sm"
                      label={`Remove slice ${i + 1}`}
                      onClick={() => setSlices((list) => list.filter((y) => y.key !== x.key))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {slices.length === 0 && <p className="pcp-text-secondary">No slices. Saving removes this booking.</p>}
        {tried &&
          errors.map((e, i) =>
            e ? (
              <Banner key={`e${i}`} tone="danger">
                Slice {i + 1}: {e}
              </Banner>
            ) : null,
          )}
        {warnings.map((w, i) =>
          w ? (
            <p key={`w${i}`} className="pcp-field__help">
              <TriangleAlert size={12} strokeWidth={2} aria-hidden="true" className="pcp-icon-status--warning" /> Slice{' '}
              {i + 1}: {w}
            </p>
          ) : null,
        )}
        <div>
          <Button
            size="sm"
            iconBefore={Plus}
            onClick={() =>
              setSlices((list) => [
                ...list,
                {
                  key: `new-${list.length}-${Date.now()}`,
                  id: null,
                  version: 0,
                  pct: '20',
                  start: list[list.length - 1]?.end ?? project?.startDate ?? '',
                  end: project?.endDate ?? '',
                  notes: '',
                  state: 'confirmed',
                  source: 'manual',
                },
              ])
            }
          >
            Add slice
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
