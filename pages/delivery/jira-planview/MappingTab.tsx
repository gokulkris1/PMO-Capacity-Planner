/** Jira project ↔ planner project and tribe mapping (JI-02): auto-match, edit, confirm selected in one call. */
import { useMemo, useState } from 'react';
import { Check, WandSparkles } from 'lucide-react';
import type * as D from '../../../shared/contracts/dto';
import { useWorkspace } from '../../../state';
import { Button, Card, Checkbox, Select, StatusPill, cx, useAction } from '../../plan/_kit';
import type { DeliverySource } from '../_parts/deliverySource';

const METHOD: Record<
  D.JiraProjectMappingDTO['matchMethod'],
  { label: string; tone: 'success' | 'info' | 'neutral' | 'warning' }
> = {
  key: { label: 'Exact key', tone: 'success' },
  name: { label: 'Name', tone: 'info' },
  manual: { label: 'Manual', tone: 'neutral' },
  none: { label: 'None', tone: 'warning' },
};

export function MappingTab({ snapshot: s, delivery }: { snapshot: D.WorkspaceSnapshot; delivery: DeliverySource }) {
  const { can } = useWorkspace();
  const canRun = can('integrations.run');
  const { run, busy } = useAction();
  const [edits, setEdits] = useState<Record<string, Partial<D.JiraProjectMappingDTO>>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const rows = useMemo(
    () => delivery.mappings.map((m) => ({ ...m, ...(edits[m.jiraKey] ?? {}) })),
    [delivery.mappings, edits],
  );
  const projects = s.projects.map((p) => ({ value: p.id, label: p.name }));
  const tribes = s.tribes.filter((t) => !t.archived).map((t) => ({ value: t.id, label: t.name }));
  const edit = (key: string, patch: Partial<D.JiraProjectMappingDTO>) => {
    setEdits((e) => ({ ...e, [key]: { ...e[key], ...patch, matchMethod: 'manual', confirmed: false } }));
    setSelected((cur) => new Set(cur).add(key));
  };
  const confirmSelected = async () => {
    const chosen = rows.filter((r) => selected.has(r.jiraKey) && r.projectId).map((r) => ({ ...r, confirmed: true }));
    const res = await run('confirm', () => delivery.saveProjectMappings(chosen), {
      success: `${chosen.length} mapping${chosen.length === 1 ? '' : 's'} confirmed`,
      body: 'Unconfirmed mappings are ignored by the sync.',
    });
    if (res.ok) {
      setEdits({});
      setSelected(new Set());
    }
  };
  const selectable = rows.filter((r) => !r.confirmed || edits[r.jiraKey]);
  return (
    <Card
      flush
      title="Jira projects"
      subtitle="Map each Jira project to a planner project and tribe. Auto-match proposes by key, then by name; proposals stay unconfirmed until you confirm them."
      actions={
        canRun && (
          <>
            <Button
              size="sm"
              icon={WandSparkles}
              loading={busy === 'auto'}
              onClick={() =>
                void run('auto', () => delivery.autoMatch(), {
                  success: 'Auto-match finished',
                  body: 'Review the highlighted rows, then confirm them.',
                })
              }
            >
              Auto-match
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={Check}
              disabled={selected.size === 0}
              loading={busy === 'confirm'}
              onClick={() => void confirmSelected()}
            >
              Confirm selected{selected.size ? ` (${selected.size})` : ''}
            </Button>
          </>
        )
      }
    >
      <div className="b2-table-wrap">
        <table className="b2-table dl-map">
          <caption className="b2-sr-only">Jira project mapping</caption>
          <thead>
            <tr>
              {canRun && (
                <th scope="col" className="b2-cell-check">
                  <Checkbox
                    label="Select all unconfirmed"
                    hideLabel
                    checked={selectable.length > 0 && selectable.every((r) => selected.has(r.jiraKey))}
                    onChange={(v) => setSelected(v ? new Set(selectable.map((r) => r.jiraKey)) : new Set())}
                  />
                </th>
              )}
              <th scope="col">Jira project</th>
              <th scope="col">Boards</th>
              <th scope="col">Planner project</th>
              <th scope="col">Tribe</th>
              <th scope="col">Match</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.jiraKey}
                className={cx(!r.confirmed && 'dl-row--proposed', selected.has(r.jiraKey) && 'is-selected')}
              >
                {canRun && (
                  <td className="b2-cell-check">
                    <Checkbox
                      label={`Select ${r.jiraKey}`}
                      hideLabel
                      checked={selected.has(r.jiraKey)}
                      onChange={(v) =>
                        setSelected((cur) => {
                          const n = new Set(cur);
                          if (v) n.add(r.jiraKey);
                          else n.delete(r.jiraKey);
                          return n;
                        })
                      }
                    />
                  </td>
                )}
                <th scope="row">
                  <span className="b2-strong b2-tnum">{r.jiraKey}</span>{' '}
                  <span className="b2-caption">{r.jiraName}</span>
                </th>
                <td className="b2-tnum">{r.boardIds.join(', ') || '—'}</td>
                <td className="dl-map__select">
                  <Select
                    size="sm"
                    ariaLabel={`Planner project for ${r.jiraKey}`}
                    value={r.projectId ?? ''}
                    placeholder="Not mapped"
                    disabled={!canRun}
                    onChange={(v) =>
                      edit(r.jiraKey, {
                        projectId: v || null,
                        tribeId: s.projects.find((p) => p.id === v)?.tribeId ?? r.tribeId,
                      })
                    }
                    options={projects}
                  />
                </td>
                <td className="dl-map__select">
                  <Select
                    size="sm"
                    ariaLabel={`Tribe for ${r.jiraKey}`}
                    value={r.tribeId ?? ''}
                    placeholder="No tribe"
                    disabled={!canRun}
                    onChange={(v) => edit(r.jiraKey, { tribeId: v || null })}
                    options={tribes}
                  />
                </td>
                <td>
                  <StatusPill tone={METHOD[r.matchMethod].tone}>{METHOD[r.matchMethod].label}</StatusPill>
                </td>
                <td>
                  {r.confirmed ? (
                    <StatusPill tone="success">Confirmed</StatusPill>
                  ) : (
                    <StatusPill tone="outline">Proposed</StatusPill>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
