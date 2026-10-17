/** Demand cell editor (DM-02#AC2): add/edit/remove craft lines for one project and quarter; copy to later quarters. */
import { useMemo, useState } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import type * as D from '../../../shared/contracts/dto';
import { useMutations, useQuarters, useSession } from '../../../state';
import {
  Button,
  Dialog,
  errorMessage,
  fmt,
  FormField,
  IconButton,
  NumberField,
  SegmentedControl,
  Select,
  TextField,
  useToast,
  numOrNull,
  numText,
} from '../../../components/ui';

interface LineDraft {
  key: string;
  id: string | null;
  version: number;
  craftId: string;
  fte: string;
  status: D.DemandStatus;
  ownerUserId: string;
  note: string;
}

export function DemandCellDialog({
  snapshot: s,
  projectId: initialProject,
  quarterKey: initialQuarter,
  onClose,
}: {
  snapshot: D.WorkspaceSnapshot;
  projectId: string;
  quarterKey: string;
  onClose(): void;
}) {
  const toast = useToast();
  const quarters = useQuarters();
  const m = useMutations();
  const { me } = useSession();
  const [projectId, setProjectId] = useState(initialProject);
  const [quarterKey, setQuarterKey] = useState(initialQuarter);
  const linesFor = (pid: string, qk: string): LineDraft[] =>
    s.demand
      .filter((l) => l.projectId === pid && l.quarterKey === qk)
      .map((l) => ({
        key: l.id,
        id: l.id,
        version: l.version,
        craftId: l.craftId,
        fte: fmt.fte(l.fte),
        status: l.status,
        ownerUserId: l.ownerUserId ?? '',
        note: l.note ?? '',
      }));
  const [lines, setLines] = useState<LineDraft[]>(() => linesFor(initialProject, initialQuarter));
  const [removed, setRemoved] = useState<LineDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const project = s.projects.find((p) => p.id === projectId);
  const quarter = quarters.find((q) => q.key === quarterKey);
  const later = quarters.filter((q) => q.key > quarterKey);

  const owners = useMemo(() => {
    const out = new Map<string, string>();
    if (me?.user) out.set(me.user.id, `${me.user.name} (you)`);
    for (const l of s.demand)
      if (l.ownerUserId && !out.has(l.ownerUserId))
        out.set(l.ownerUserId, l.updatedBy?.id === l.ownerUserId ? l.updatedBy.name : 'Another member');
    return [...out.entries()].map(([value, label]) => ({ value, label }));
  }, [me, s.demand]);

  const switchTo = (pid: string, qk: string) => {
    setProjectId(pid);
    setQuarterKey(qk);
    setLines(linesFor(pid, qk));
    setRemoved([]);
  };

  const errors = lines.map((l, i) => {
    if (!l.craftId) return 'Choose a craft';
    const n = Number(l.fte);
    if (!(n > 0 && n <= 50)) return 'FTE must be above 0 and at most 50';
    if (lines.findIndex((x) => x.craftId === l.craftId) !== i) return 'This craft is listed twice';
    return null;
  });

  const save = async () => {
    setTried(true);
    if (!projectId || errors.some(Boolean)) return;
    setBusy(true);
    try {
      for (const r of removed) if (r.id) await m.demand.remove(r.id);
      for (const l of lines) {
        const patch = {
          craftId: l.craftId,
          fte: Math.round(Number(l.fte) * 10) / 10,
          status: l.status,
          ownerUserId: l.ownerUserId || null,
          note: l.note.trim() || null,
        };
        if (!l.id) await m.demand.create({ projectId, quarterKey, ...patch });
        else {
          const cur = s.demand.find((x) => x.id === l.id);
          if (
            cur &&
            (cur.craftId !== patch.craftId ||
              cur.fte !== patch.fte ||
              cur.status !== patch.status ||
              (cur.ownerUserId ?? null) !== patch.ownerUserId ||
              (cur.note ?? null) !== patch.note)
          )
            await m.demand.update(l.id, { ...patch, version: l.version });
        }
      }
      toast.show({ tone: 'success', title: 'Demand saved', body: `${project?.name ?? ''} · ${quarter?.label ?? ''}` });
      onClose();
    } catch (e) {
      toast.show({ tone: 'error', title: 'Demand not saved', body: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const copyForward = async (l: LineDraft) => {
    if (!l.id || later.length === 0) return;
    try {
      await m.demand.copyForward(
        l.id,
        later.map((q) => q.key),
      );
      toast.show({
        tone: 'success',
        title: `Copied to ${later[0].label}${later.length > 1 ? `–${later[later.length - 1].label}` : ''}`,
      });
    } catch (e) {
      toast.show({ tone: 'error', title: 'Not copied', body: errorMessage(e) });
    }
  };

  const crafts = s.crafts.filter((c) => !c.archived);
  return (
    <Dialog
      open
      size="lg"
      title={project ? `Demand · ${project.name}` : 'Add demand'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!projectId} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="pcp-stack pcp-stack--md">
        <div className="pcp-form-grid">
          <FormField label="Project" id="dc-project" error={tried && !projectId ? 'Choose a project' : null}>
            <Select
              id="dc-project"
              value={projectId}
              placeholder="Choose a project"
              invalid={tried && !projectId}
              onValueChange={(v) => switchTo(v, quarterKey)}
              options={s.projects
                .filter((p) => p.status !== 'Completed')
                .map((p) => ({
                  value: p.id,
                  label: p.name,
                  group: s.tribes.find((t) => t.id === p.tribeId)?.name ?? 'No tribe',
                }))
                .sort((a, z) => a.group.localeCompare(z.group) || a.label.localeCompare(z.label))}
            />
          </FormField>
          <FormField label="Quarter" id="dc-quarter">
            <Select
              id="dc-quarter"
              value={quarterKey}
              onValueChange={(v) => switchTo(projectId, v)}
              options={quarters.map((q) => ({ value: q.key, label: `${q.label} · ${q.calendarLabel}` }))}
            />
          </FormField>
        </div>
        <div className="dc-lines" role="list" aria-label="Craft lines">
          {lines.length === 0 && <p className="pcp-text-secondary">No demand captured for this quarter yet.</p>}
          {lines.map((l, i) => (
            <div key={l.key} className="dc-line" role="listitem">
              <Select
                aria-label={`Craft for line ${i + 1}`}
                value={l.craftId}
                placeholder="Craft"
                invalid={tried && !!errors[i]}
                onValueChange={(v) => setLines(lines.map((x) => (x.key === l.key ? { ...x, craftId: v } : x)))}
                options={crafts.map((c) => ({ value: c.id, label: `${c.short} · ${c.name}` }))}
              />
              <NumberField
                id={`dc-fte-${l.key}`}
                aria-label={`FTE for line ${i + 1}`}
                unit="FTE"
                step={0.1}
                min={0}
                max={50}
                value={numOrNull(l.fte)}
                onChange={(n) => setLines(lines.map((x) => (x.key === l.key ? { ...x, fte: numText(n) } : x)))}
              />
              <SegmentedControl
                size="sm"
                label={`Status for line ${i + 1}`}
                value={l.status}
                onChange={(v) => setLines(lines.map((x) => (x.key === l.key ? { ...x, status: v } : x)))}
                options={[
                  { value: 'Forecast', label: 'Forecast' },
                  { value: 'Confirmed', label: 'Confirmed' },
                ]}
              />
              <Select
                aria-label={`Owner for line ${i + 1}`}
                value={l.ownerUserId}
                placeholder="No owner"
                onValueChange={(v) => setLines(lines.map((x) => (x.key === l.key ? { ...x, ownerUserId: v } : x)))}
                options={owners}
              />
              <span className="dc-line__actions">
                {l.id && later.length > 0 && (
                  <IconButton
                    icon={Copy}
                    label={`Copy line ${i + 1} to later quarters`}
                    onClick={() => void copyForward(l)}
                  />
                )}
                <IconButton
                  icon={Trash2}
                  label={`Remove line ${i + 1}`}
                  onClick={() => {
                    setLines(lines.filter((x) => x.key !== l.key));
                    if (l.id) setRemoved([...removed, l]);
                  }}
                />
              </span>
              <span className="dc-line__note">
                <TextField
                  id={`dc-note-${l.key}`}
                  size="sm"
                  value={l.note}
                  placeholder="Note (optional)"
                  aria-label={`Note for line ${i + 1}`}
                  onValueChange={(v) => setLines(lines.map((x) => (x.key === l.key ? { ...x, note: v } : x)))}
                />
              </span>
              {tried && errors[i] && <span className="pcp-field__error dc-line__err">{errors[i]}</span>}
            </div>
          ))}
        </div>
        <div>
          <Button
            size="sm"
            iconBefore={Plus}
            onClick={() =>
              setLines([
                ...lines,
                {
                  key: `new-${lines.length}-${removed.length}`,
                  id: null,
                  version: 0,
                  craftId: '',
                  fte: '1.0',
                  status: project?.stage === 'Pipeline' ? 'Forecast' : 'Confirmed',
                  ownerUserId: me?.user.id ?? '',
                  note: '',
                },
              ])
            }
          >
            Add craft line
          </Button>
        </div>
        <p className="pcp-caption pcp-text-tertiary">
          Forecast lines are shown dashed on the roadmap; Confirmed lines are solid. Copy to later quarters applies
          after saving.
        </p>
      </div>
    </Dialog>
  );
}
