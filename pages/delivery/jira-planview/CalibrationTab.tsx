/** Per-tribe calibration (JI-04#AC2/3): current vs suggested points per sprint per FTE, "Use suggested" / "Edit". */
import { useState } from 'react';
import { Pencil, Sparkles } from 'lucide-react';
import type * as D from '../../../shared/contracts/dto';
import { useWorkspace } from '../../../state';
import { Button, Card, fmt, StatusPill } from '../../../components/ui';
import { CalibrationDialog } from '../_parts/CalibrationDialog';
import type { DeliverySource } from '../../../state';

export function CalibrationTab({ snapshot: s, delivery }: { snapshot: D.WorkspaceSnapshot; delivery: DeliverySource }) {
  const { can } = useWorkspace();
  const [editing, setEditing] = useState<{ cal: D.TribeCalibrationDTO; value?: number } | null>(null);
  const tribes = new Map(s.tribes.map((t) => [t.id, t.name]));
  const rows = [...delivery.calibrations].sort((a, z) =>
    (tribes.get(a.tribeId) ?? '').localeCompare(tribes.get(z.tribeId) ?? ''),
  );
  return (
    <div className="pcp-stack">
      <Card
        flush
        title="Story points per sprint per FTE"
        subtitle="How to calibrate: take a tribe's last three closed sprints and divide the completed points by the full-time people on its boards. Re-check every QBR."
      >
        <div className="pcp-tbl-wrap">
          <table className="pcp-tbl">
            <caption className="pcp-sr-only">Calibration by tribe</caption>
            <thead>
              <tr>
                <th scope="col">Tribe</th>
                <th scope="col" className="pcp-num">
                  Current
                </th>
                <th scope="col" className="pcp-num">
                  Suggested
                </th>
                <th scope="col">Basis</th>
                <th scope="col" className="pcp-num">
                  Sprint length
                </th>
                <th scope="col">Last changed</th>
                <th scope="col">
                  <span className="pcp-sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const differs = c.suggestedValue !== null && c.suggestedValue !== c.pointsPerSprintPerFte;
                return (
                  <tr key={c.tribeId}>
                    <th scope="row" className="pcp-strong">
                      {tribes.get(c.tribeId) ?? c.tribeId}
                    </th>
                    <td className="pcp-num">
                      <span className="pcp-row dl-cal-cur">
                        {c.isDefault && <StatusPill>Default</StatusPill>}
                        <span className="pcp-strong">{c.pointsPerSprintPerFte}</span>
                      </span>
                    </td>
                    <td className="pcp-num">{c.suggestedValue ?? <span className="pcp-text-tertiary">—</span>}</td>
                    <td className="pcp-caption pcp-text-tertiary">
                      {c.suggestedBasis
                        ? `Based on ${c.suggestedBasis.sprintNames[0]}–${c.suggestedBasis.sprintNames[c.suggestedBasis.sprintNames.length - 1]?.replace('Sprint ', '')}: ${c.suggestedBasis.points} pts, ${fmt.fte(c.suggestedBasis.fte)} FTE`
                        : 'No closed sprints on mapped boards yet'}
                    </td>
                    <td className="pcp-num">{c.sprintLengthDays} days</td>
                    <td className="pcp-caption pcp-text-tertiary">
                      {c.updatedBy ? `${c.updatedBy.name} · ${fmt.date(c.updatedAt)}` : 'Never'}
                    </td>
                    <td className="pcp-num">
                      {can('integrations.run') && (
                        <span className="pcp-row dl-actions">
                          {differs && (
                            <Button
                              size="sm"
                              iconBefore={Sparkles}
                              onClick={() => setEditing({ cal: c, value: c.suggestedValue ?? undefined })}
                            >
                              Use suggested
                            </Button>
                          )}
                          <Button size="sm" variant="subtle" iconBefore={Pencil} onClick={() => setEditing({ cal: c })}>
                            Edit
                          </Button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="pcp-card__footer">
          <span className="pcp-caption pcp-text-tertiary">
            Tribes without calibration use the workspace default: 10 points per 14-day sprint per FTE. Changes are
            audited with your note.
          </span>
        </div>
      </Card>
      {editing && (
        <CalibrationDialog
          key={editing.cal.tribeId + String(editing.value)}
          snapshot={s}
          calibration={
            editing.value !== undefined ? { ...editing.cal, pointsPerSprintPerFte: editing.value } : editing.cal
          }
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
