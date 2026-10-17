/** "Add booking" (AL-02#AC3): person, project, craft (above / below ·L / undeclared), quarter and %. */
import { useMemo, useState } from 'react';
import type * as D from '../../../shared/contracts/dto';
import { useMutations, useQuarters } from '../../../state';
import {
  Button,
  Dialog,
  FormField,
  NumberField,
  Select,
  type SelectOption,
  useAction,
  numOrNull,
  numText,
} from '../../../components/ui';

export function AddBookingDialog({
  snapshot: s,
  open,
  onClose,
  onAdded,
  initial,
}: {
  snapshot: D.WorkspaceSnapshot;
  open: boolean;
  onClose(): void;
  onAdded?(personRowKey: string): void;
  initial?: { personId?: string; projectId?: string; craftId?: string; quarterKey?: string; pct?: number };
}) {
  if (!open) return null;
  return <Inner s={s} onClose={onClose} onAdded={onAdded} initial={initial} />;
}

function Inner({
  s,
  onClose,
  onAdded,
  initial,
}: {
  s: D.WorkspaceSnapshot;
  onClose(): void;
  onAdded?(personRowKey: string): void;
  initial?: { personId?: string; projectId?: string; craftId?: string; quarterKey?: string; pct?: number };
}) {
  const quarters = useQuarters();
  const m = useMutations();
  const { busy, run } = useAction();
  const [personId, setPersonId] = useState(initial?.personId ?? '');
  const [projectId, setProjectId] = useState(initial?.projectId ?? '');
  const [craftId, setCraftId] = useState(initial?.craftId ?? '');
  const [quarterKey, setQuarterKey] = useState(initial?.quarterKey ?? quarters[0]?.key ?? '');
  const [pct, setPct] = useState(String(initial?.pct ?? 20));
  const [tried, setTried] = useState(false);
  const person = s.people.find((p) => p.id === personId);

  const craftOptions = useMemo((): SelectOption[] => {
    const active = s.crafts.filter((c) => !c.archived);
    if (!person) return active.map((c) => ({ value: c.id, label: `${c.name} (${c.short})` }));
    const above = active.filter((c) => c.id === person.primaryCraft);
    const below = person.secondaryCrafts
      .map((x) => ({ x, c: active.find((c) => c.id === x.craftId) }))
      .filter((y): y is { x: D.SecondaryCraftDTO; c: D.CraftDTO } => !!y.c);
    const rest = active.filter(
      (c) => c.id !== person.primaryCraft && !person.secondaryCrafts.some((x) => x.craftId === c.id),
    );
    return [
      ...above.map((c) => ({ value: c.id, label: `${c.name} (${c.short})`, group: 'Above the table' })),
      ...below.map(({ x, c }) => ({
        value: c.id,
        label: `${c.name} (${c.short}·L${x.proficiency}, up to ${x.maxPct}%)`,
        group: 'Below the table',
      })),
      ...rest.map((c) => ({ value: c.id, label: `${c.name} (${c.short})`, group: 'Undeclared' })),
    ];
  }, [s.crafts, person]);

  const n = Number(pct);
  const errors = {
    person: !personId ? 'Choose a person' : null,
    project: !projectId ? 'Choose a project' : null,
    pct: !(n > 0 && n <= 200) ? 'Enter 1–200' : null,
  };
  const project = s.projects.find((p) => p.id === projectId);
  const q = quarters.find((x) => x.key === quarterKey);
  const outside =
    project &&
    q &&
    ((project.endDate && project.endDate < q.start) || (project.startDate && project.startDate > q.end));

  const save = async () => {
    setTried(true);
    if (errors.person || errors.project || errors.pct) return;
    const res = await run(
      'add',
      () =>
        m.allocations.setQuarterCell({
          resourceId: personId,
          projectId,
          craftId: craftId || person?.primaryCraft || null,
          quarterKey,
          pct: n,
        }),
      { success: `Booked ${person?.name ?? ''} on ${project?.name ?? ''}`, body: `${n}% in ${q?.label}`, undo: true },
    );
    if (res.ok) {
      onAdded?.(`person:${personId}`);
      onClose();
    }
  };

  return (
    <Dialog
      open
      title="Add booking"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy === 'add'} onClick={() => void save()}>
            Add booking
          </Button>
        </>
      }
    >
      <div className="pcp-form-grid">
        <FormField label="Person" id="ab-person" error={tried ? errors.person : null} className="pcp-form-grid__full">
          <Select
            id="ab-person"
            value={personId}
            placeholder="Choose a person"
            invalid={tried && !!errors.person}
            onValueChange={(v) => {
              setPersonId(v);
              setCraftId(s.people.find((p) => p.id === v)?.primaryCraft ?? '');
            }}
            options={[...s.people]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((p) => ({ value: p.id, label: `${p.name} · ${p.role}` }))}
          />
        </FormField>
        <FormField
          label="Project"
          id="ab-project"
          error={tried ? errors.project : null}
          className="pcp-form-grid__full"
        >
          <Select
            id="ab-project"
            value={projectId}
            placeholder="Choose a project"
            invalid={tried && !!errors.project}
            onValueChange={setProjectId}
            options={s.projects
              .filter((p) => p.status !== 'Completed')
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((p) => ({
                value: p.id,
                label: p.name,
                group: s.tribes.find((t) => t.id === p.tribeId)?.name ?? 'No tribe',
              }))
              .sort((a, b) => a.group.localeCompare(b.group))}
          />
        </FormField>
        <FormField
          label="Craft"
          id="ab-craft"
          help="Defaults to their above-the-table craft."
          className="pcp-form-grid__full"
        >
          <Select
            id="ab-craft"
            value={craftId}
            placeholder="Their above-the-table craft"
            onValueChange={setCraftId}
            options={craftOptions}
          />
        </FormField>
        <FormField
          label="Quarter"
          id="ab-quarter"
          help={outside ? 'The project does not run in this quarter, so nothing will be booked.' : undefined}
        >
          <Select
            id="ab-quarter"
            value={quarterKey}
            onValueChange={setQuarterKey}
            options={quarters.map((x) => ({ value: x.key, label: `${x.label} · ${x.calendarLabel}` }))}
          />
        </FormField>
        <FormField label="Allocation" id="ab-pct" error={tried ? errors.pct : null}>
          <NumberField
            id="ab-pct"
            unit="%"
            value={numOrNull(pct)}
            min={0}
            max={200}
            step={5}
            invalid={tried && !!errors.pct}
            onChange={(n) => setPct(numText(n))}
          />
        </FormField>
      </div>
    </Dialog>
  );
}
