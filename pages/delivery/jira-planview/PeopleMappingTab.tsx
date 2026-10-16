/** Assignee ↔ person identity mapping (JI-03): suggested person, method, override, "Confirm all exact matches". */
import { useMemo, useState } from 'react';
import { Check, CheckCheck } from 'lucide-react';
import type * as D from '../../../shared/contracts/dto';
import { useWorkspace } from '../../../state';
import { Button, Card, PersonLabel, Select, StatusPill, cx, fmt, useAction } from '../../plan/_kit';
import type { DeliverySource } from '../_parts/deliverySource';

const METHOD: Record<D.IdentityMappingDTO['matchMethod'], string> = {
  accountId: 'Account id',
  email: 'Email',
  name: 'Name',
  manual: 'Manual',
  none: 'No match',
};

export function PeopleMappingTab({
  snapshot: s,
  delivery,
}: {
  snapshot: D.WorkspaceSnapshot;
  delivery: DeliverySource;
}) {
  const { can } = useWorkspace();
  const canRun = can('integrations.run');
  const { run, busy } = useAction();
  const [edits, setEdits] = useState<Record<string, D.ID | null>>({});
  const rows = useMemo(
    () =>
      delivery.identities.map((m) =>
        m.externalId in edits
          ? { ...m, personId: edits[m.externalId], matchMethod: 'manual' as const, confirmed: false }
          : m,
      ),
    [delivery.identities, edits],
  );
  const exact = rows.filter(
    (r) => !r.confirmed && r.personId && (r.matchMethod === 'email' || r.matchMethod === 'accountId'),
  );
  const changed = rows.filter((r) => r.externalId in edits);
  return (
    <Card
      flush
      title="Jira assignees"
      subtitle="Assignees seen in the last 90 days. Account id matches first, then email, then exact name. Manual choices are kept by later syncs."
      actions={
        canRun && (
          <>
            <Button
              size="sm"
              icon={CheckCheck}
              disabled={exact.length === 0}
              loading={busy === 'exact'}
              onClick={() =>
                void run('exact', () => delivery.savePeopleMappings(exact.map((r) => ({ ...r, confirmed: true }))), {
                  success: `${exact.length} exact matches confirmed`,
                })
              }
            >
              Confirm all exact matches{exact.length ? ` (${exact.length})` : ''}
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={Check}
              disabled={changed.length === 0}
              loading={busy === 'save'}
              onClick={async () => {
                const res = await run(
                  'save',
                  () => delivery.savePeopleMappings(changed.map((r) => ({ ...r, confirmed: !!r.personId }))),
                  { success: 'People mapping saved' },
                );
                if (res.ok) setEdits({});
              }}
            >
              Save changes{changed.length ? ` (${changed.length})` : ''}
            </Button>
          </>
        )
      }
    >
      <div className="b2-table-wrap">
        <table className="b2-table dl-map">
          <caption className="b2-sr-only">Jira assignee mapping</caption>
          <thead>
            <tr>
              <th scope="col">Jira assignee</th>
              <th scope="col">Email</th>
              <th scope="col">Person</th>
              <th scope="col">Matched by</th>
              <th scope="col">Status</th>
              <th scope="col">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.externalId} className={cx(!r.confirmed && 'dl-row--proposed')}>
                <th scope="row">
                  <PersonLabel name={r.displayName} sub={<span className="b2-tnum">{r.externalId.slice(-8)}</span>} />
                </th>
                <td>{r.email ?? <span className="b2-subtle">Hidden by Jira</span>}</td>
                <td className="dl-map__select">
                  <Select
                    size="sm"
                    ariaLabel={`Person for ${r.displayName}`}
                    value={r.personId ?? ''}
                    placeholder="Not a squad member"
                    disabled={!canRun}
                    onChange={(v) => setEdits((e) => ({ ...e, [r.externalId]: v || null }))}
                    options={s.people.map((p) => ({ value: p.id, label: p.name }))}
                  />
                </td>
                <td>
                  <StatusPill tone={r.matchMethod === 'none' ? 'warning' : 'neutral'}>
                    {METHOD[r.matchMethod]}
                  </StatusPill>
                </td>
                <td>
                  {r.confirmed ? (
                    <StatusPill tone="success">Confirmed</StatusPill>
                  ) : (
                    <StatusPill tone="outline">Suggested</StatusPill>
                  )}
                </td>
                <td className="b2-caption">{fmt.relative(r.lastSeenAt, s.serverTime)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
