/** Bulk edit (PPL-03): set chapter, team, target or add a below-the-table craft for the selected people. */
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type * as D from '../../../../shared/contracts/dto';
import { useMutations, useUndo, useWorkspaceData } from '../../../../state';
import {
  Banner,
  Button,
  Dialog,
  errorMessage,
  fmt,
  FormField,
  NumberField,
  Select,
  useToast,
  numOrNull,
  numText,
} from '../../../../components/ui';

export type BulkKind = 'chapter' | 'team' | 'target' | 'craft';

const TITLES: Record<BulkKind, string> = {
  chapter: 'Set chapter',
  team: 'Set team',
  target: 'Set target utilisation',
  craft: 'Add below-the-table craft',
};

export function BulkEditDialog({
  snapshot: s,
  kind,
  ids,
  onClose,
}: {
  snapshot: D.WorkspaceSnapshot;
  kind: BulkKind | null;
  ids: string[];
  onClose(done: boolean): void;
}) {
  if (!kind) return null;
  return <Inner key={kind} s={s} kind={kind} ids={ids} onClose={onClose} />;
}

function Inner({
  s,
  kind,
  ids,
  onClose,
}: {
  s: D.WorkspaceSnapshot;
  kind: BulkKind;
  ids: string[];
  onClose(done: boolean): void;
}) {
  const toast = useToast();
  const m = useMutations();
  const undo = useUndo();
  const data = useWorkspaceData();
  const [value, setValue] = useState('');
  const [level, setLevel] = useState('2');
  const [cap, setCap] = useState('40');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; conflict: boolean } | null>(null);
  const [tried, setTried] = useState(false);

  const invalid =
    kind === 'target'
      ? !(Number(value) >= 0 && Number(value) <= 150) || value === ''
      : kind === 'craft'
        ? !value || !(Number(cap) >= 0 && Number(cap) <= 100)
        : false;

  const apply = async () => {
    setTried(true);
    if (invalid) return;
    const patch: {
      chapterId?: D.ID | null;
      teamId?: D.ID | null;
      targetUtil?: number;
      addSecondaryCraft?: D.SecondaryCraftDTO;
    } =
      kind === 'chapter'
        ? { chapterId: value || null }
        : kind === 'team'
          ? { teamId: value || null }
          : kind === 'target'
            ? { targetUtil: Number(value) }
            : {
                addSecondaryCraft: { craftId: value, proficiency: Number(level) as D.Proficiency, maxPct: Number(cap) },
              };
    setBusy(true);
    setError(null);
    try {
      await m.people.bulk({ ids, patch });
      toast.show({
        tone: 'success',
        title: `${ids.length} ${ids.length === 1 ? 'person' : 'people'} updated`,
        action: { label: 'Undo', onAction: () => void undo.undo() },
      });
      onClose(true);
    } catch (e) {
      const status = (e as { status?: number }).status;
      setError({
        text: status === 409 ? '1 person changed since you loaded the page. Reload and try again.' : errorMessage(e),
        conflict: status === 409,
      });
    } finally {
      setBusy(false);
    }
  };

  const crafts = s.crafts.filter((c) => !c.archived);
  const skippedAbove =
    kind === 'craft' && value ? s.people.filter((p) => ids.includes(p.id) && p.primaryCraft === value).length : 0;

  return (
    <Dialog
      open
      title={TITLES[kind]}
      onClose={() => onClose(false)}
      footer={
        <>
          <Button onClick={() => onClose(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void apply()}>
            Apply to {ids.length} {ids.length === 1 ? 'person' : 'people'}
          </Button>
        </>
      }
    >
      <div className="pcp-stack pcp-stack--md">
        {error && (
          <Banner
            tone="danger"
            actionNode={
              error.conflict ? (
                <Button size="sm" iconBefore={RefreshCw} onClick={() => void data.reload()}>
                  Reload
                </Button>
              ) : undefined
            }
          >
            {error.text}
          </Banner>
        )}
        {kind === 'chapter' && (
          <FormField label="Chapter" id="bulk-chapter">
            <Select
              id="bulk-chapter"
              value={value}
              placeholder="No chapter"
              onValueChange={setValue}
              options={s.chapters.filter((c) => !c.archived).map((c) => ({ value: c.id, label: c.name }))}
            />
          </FormField>
        )}
        {kind === 'team' && (
          <FormField label="Team" id="bulk-team">
            <Select
              id="bulk-team"
              value={value}
              placeholder="No team"
              onValueChange={setValue}
              options={s.teams.filter((c) => !c.archived).map((c) => ({ value: c.id, label: c.name }))}
            />
          </FormField>
        )}
        {kind === 'target' && (
          <FormField
            label="Target utilisation"
            id="bulk-target"
            error={tried && invalid ? 'Enter 0–150' : null}
            help="100% means fully planned."
          >
            <NumberField
              id="bulk-target"
              unit="%"
              value={numOrNull(value)}
              min={0}
              max={150}
              step={5}
              invalid={tried && invalid}
              onChange={(n) => setValue(numText(n))}
            />
          </FormField>
        )}
        {kind === 'craft' && (
          <div className="pcp-form-grid">
            <FormField
              label="Craft"
              id="bulk-craft"
              error={tried && !value ? 'Choose a craft' : null}
              className="pcp-form-grid__full"
            >
              <Select
                id="bulk-craft"
                value={value}
                placeholder="Choose a craft"
                invalid={tried && !value}
                onValueChange={setValue}
                options={crafts.map((c) => ({ value: c.id, label: `${c.name} (${c.short})` }))}
              />
            </FormField>
            <FormField label="Proficiency" id="bulk-level">
              <Select
                id="bulk-level"
                value={level}
                onValueChange={setLevel}
                options={([1, 2, 3] as D.Proficiency[]).map((l) => ({
                  value: String(l),
                  label: `L${l} · ${fmt.PROFICIENCY_LABEL[l]}`,
                }))}
              />
            </FormField>
            <FormField label="Cap" id="bulk-cap" help="Most of their week this craft may take.">
              <NumberField
                id="bulk-cap"
                unit="%"
                value={numOrNull(cap)}
                min={0}
                max={100}
                step={5}
                onChange={(n) => setCap(numText(n))}
              />
            </FormField>
            {skippedAbove > 0 && (
              <p className="pcp-caption pcp-text-tertiary pcp-form-grid__full">
                {skippedAbove} selected {skippedAbove === 1 ? 'person has' : 'people have'} this as their
                above-the-table craft and will be skipped.
              </p>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
