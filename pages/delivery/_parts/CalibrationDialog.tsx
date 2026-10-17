/** Edit a tribe's points-per-sprint-per-FTE calibration (JI-04#AC2): note required, "Use suggested" shortcut. */
import { useState } from 'react';
import type * as D from '../../../shared/contracts/dto';
import { Button, Dialog, FormField, NumberField, useAction, Textarea } from '../../../components/ui';
import { useDelivery } from '../../../state';

export function CalibrationDialog({
  snapshot: s,
  calibration,
  onClose,
}: {
  snapshot: D.WorkspaceSnapshot;
  calibration: D.TribeCalibrationDTO;
  onClose(): void;
}) {
  const delivery = useDelivery(s);
  const { run, busy } = useAction();
  const tribe = s.tribes.find((t) => t.id === calibration.tribeId);
  const [value, setValue] = useState<number | null>(calibration.pointsPerSprintPerFte);
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const n = value ?? Number.NaN;
  const valueError = !(n > 0 && n <= 100) ? 'Enter a value above 0 and at most 100' : null;
  const noteError = !note.trim() ? 'Say why you are changing it; the note is kept in the history.' : null;
  const save = async () => {
    setTried(true);
    if (valueError || noteError) return;
    const res = await run('cal', () => delivery.saveCalibration(calibration.tribeId, n, note.trim()), {
      success: 'Calibration saved',
      body: `${tribe?.name ?? 'Tribe'}: ${n} points per sprint per FTE`,
    });
    if (res.ok) onClose();
  };
  return (
    <Dialog
      open
      title={`Calibration · ${tribe?.name ?? ''}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy === 'cal'} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="pcp-stack pcp-stack--md">
        <FormField
          label="Points per sprint per FTE"
          id="cal-value"
          error={tried ? valueError : null}
          help={`Sprint length ${calibration.sprintLengthDays} days. Completed points of the last 3 closed sprints ÷ mapped FTE.`}
        >
          <NumberField
            id="cal-value"
            value={value}
            step={0.5}
            min={0}
            max={100}
            invalid={tried && !!valueError}
            onChange={setValue}
          />
        </FormField>
        {calibration.suggestedValue !== null && (
          <div className="pcp-row">
            <span className="pcp-caption pcp-text-tertiary">
              Suggested {calibration.suggestedValue}
              {calibration.suggestedBasis
                ? ` (based on ${calibration.suggestedBasis.sprintNames.join(', ')}: ${calibration.suggestedBasis.points} pts, ${calibration.suggestedBasis.fte} FTE)`
                : ''}
            </span>
            <Button size="sm" variant="link" onClick={() => setValue(calibration.suggestedValue)}>
              Use suggested
            </Button>
          </div>
        )}
        <FormField label="Why are you changing this?" id="cal-note" error={tried ? noteError : null}>
          <Textarea id="cal-note" rows={3} value={note} invalid={tried && !!noteError} onValueChange={setNote} />
        </FormField>
      </div>
    </Dialog>
  );
}
