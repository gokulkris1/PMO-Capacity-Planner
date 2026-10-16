import { useMemo, useState } from 'react';
import { validateThresholds, type UtilisationThresholds } from '../../shared/utilisation';
import type { PlanningSettings as Planning } from '../../shared/contracts/dto';
import { useMutations, useQuarters, useWorkspace, useWorkspaceData } from '../../state';
import {
  Banner,
  BandPill,
  Button,
  Card,
  FormField,
  NumberField,
  RadioGroup,
  Select,
  useToast,
} from '../../components/ui';
import { MONTHS, SectionBody, SectionHeader, errorText } from './common';

const FY_MONTHS = [1, 4, 7, 10] as const;
const MONTH_SHORT = MONTHS.map((m) => m.slice(0, 3));

/** Fiscal label for a calendar quarter (A-1: labels only; keys stay calendar quarters). */
function fiscalLabel(year: number, q: number, start: 1 | 4 | 7 | 10): string {
  const startMonth = (q - 1) * 3 + 1;
  const fq = Math.floor(((startMonth - start + 12) % 12) / 3) + 1;
  const fy = start === 1 || startMonth < start ? year : year + 1;
  return `FY${String(fy).slice(2)} Q${fq}`;
}

/** Settings › Planning (ST-03). Org Admins edit; Planners and PMO Admins read. */
export default function PlanningSettings() {
  const { can } = useWorkspace();
  const { snapshot } = useWorkspaceData();
  const quarters = useQuarters();
  const m = useMutations();
  const toast = useToast();
  const editable = can('org.manage');
  const current = snapshot?.org.planning;
  const [draft, setDraft] = useState<Planning | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const p = draft ?? current ?? null;

  const preview = useMemo(() => {
    const q1 = quarters[0];
    if (!q1 || !p) return '';
    const [y, q] = q1.key.split('-Q').map(Number);
    const startMonth = (q - 1) * 3;
    return `QBR1 = ${fiscalLabel(y, q, p.fiscalYearStartMonth)} (${MONTH_SHORT[startMonth]}–${MONTH_SHORT[startMonth + 2]} ${y})`;
  }, [quarters, p]);

  if (!p || !current) return null;

  const set = (patch: Partial<Planning>) => setDraft({ ...p, ...patch });
  const setT = (patch: Partial<UtilisationThresholds>) => set({ thresholds: { ...p.thresholds, ...patch } });
  const dirty = JSON.stringify(p) !== JSON.stringify(current);
  const t = p.thresholds;

  const save = async () => {
    const msg = validateThresholds(t);
    if (msg) {
      setError(msg);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await m.admin.updateOrg({ planning: p });
      setDraft(null);
      toast.success('Planning settings saved', { body: 'Bands and labels update everywhere straight away.' });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const footer = editable ? (
    <div className="pcp-settings__savebar" role="region" aria-label="Save planning settings">
      <span className="pcp-settings__footer-note">{dirty ? 'You have unsaved changes.' : 'All changes saved.'}</span>
      {dirty ? (
        <Button variant="subtle" onClick={() => setDraft(null)} disabled={saving}>
          Discard changes
        </Button>
      ) : null}
      <Button variant="primary" disabled={!dirty} loading={saving} onClick={() => void save()}>
        Save changes
      </Button>
    </div>
  ) : undefined;

  return (
    <>
      <SectionHeader id="planning" />
      <SectionBody>
        {!editable ? <Banner tone="info">Only an Org Admin can change planning settings.</Banner> : null}
        {error ? <Banner tone="danger">{error}</Banner> : null}

        <Card title="Fiscal calendar" subtitle="Changes quarter labels only. Data stays keyed by calendar quarter.">
          <div className="pcp-settings__form">
            <FormField label="Fiscal year starts in" help={preview}>
              <Select
                value={String(p.fiscalYearStartMonth)}
                disabled={!editable}
                onChange={(e) =>
                  set({ fiscalYearStartMonth: Number(e.target.value) as Planning['fiscalYearStartMonth'] })
                }
                options={FY_MONTHS.map((mo) => ({ value: String(mo), label: MONTHS[mo - 1] }))}
              />
            </FormField>
          </div>
        </Card>

        <Card title="Utilisation bands" subtitle="Load as a percentage of each person's target.">
          <div className="pcp-settings__form">
            <div className="pcp-settings__inline">
              <FormField label="Available below">
                <NumberField
                  value={t.benchBelow}
                  onChange={(v) => setT({ benchBelow: v ?? 0 })}
                  min={1}
                  max={200}
                  unit="%"
                  readOnly={!editable}
                />
              </FormField>
              <FormField label="On target from">
                <NumberField
                  value={t.onTargetFrom}
                  onChange={(v) => setT({ onTargetFrom: v ?? 0 })}
                  min={1}
                  max={200}
                  unit="%"
                  readOnly={!editable}
                />
              </FormField>
              <span className="pcp-settings__sep">to</span>
              <FormField label="On target to">
                <NumberField
                  value={t.onTargetTo}
                  onChange={(v) => setT({ onTargetTo: v ?? 0 })}
                  min={1}
                  max={200}
                  unit="%"
                  readOnly={!editable}
                />
              </FormField>
            </div>
            <div className="pcp-settings__preview" aria-label="Band preview">
              <span className="pcp-settings__preview-item">
                <BandPill band="bench" /> below {t.benchBelow}%
              </span>
              <span className="pcp-settings__preview-item">
                <BandPill band="under" /> {t.benchBelow}–{t.onTargetFrom - 1}%
              </span>
              <span className="pcp-settings__preview-item">
                <BandPill band="on-target" /> {t.onTargetFrom}–{t.onTargetTo}%
              </span>
              <span className="pcp-settings__preview-item">
                <BandPill band="over" /> above {t.onTargetTo}%
              </span>
            </div>
          </div>
        </Card>

        <Card title="Defaults">
          <div className="pcp-settings__form">
            <div className="pcp-settings__grid-2">
              <FormField
                label="Default target utilisation"
                help="Used for new people. Part-time people can have a lower target."
              >
                <NumberField
                  value={p.defaultTargetUtil}
                  onChange={(v) => set({ defaultTargetUtil: v ?? 100 })}
                  min={1}
                  max={200}
                  unit="%"
                  readOnly={!editable}
                />
              </FormField>
              <FormField label="Default sprint length" help="Used when a tribe has no calibration of its own.">
                <NumberField
                  value={p.sprintLengthDays}
                  onChange={(v) => set({ sprintLengthDays: v ?? 14 })}
                  min={1}
                  max={60}
                  unit="days"
                  readOnly={!editable}
                />
              </FormField>
            </div>
            <RadioGroup
              label="Planview bookings"
              value={p.planviewOwnership}
              onChange={(v) => editable && set({ planviewOwnership: v as Planning['planviewOwnership'] })}
              options={[
                {
                  value: 'locked',
                  label: 'Locked: change them in Planview',
                  description: 'Imported bookings cannot be edited here.',
                  disabled: !editable,
                },
                {
                  value: 'overridable',
                  label: 'Overridable by Planners',
                  description: 'Planners can adjust imported bookings; the next import shows the difference.',
                  disabled: !editable,
                },
              ]}
            />
          </div>
        </Card>
        {footer}
      </SectionBody>
    </>
  );
}
