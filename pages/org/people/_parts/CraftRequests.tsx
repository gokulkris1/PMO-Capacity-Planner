/** Craft-change approvals (PPL-06#AC2/3): pending requests, own-chapter first, with a current → proposed diff. */
import { useMemo, useState } from 'react';
import { Check, ListChecks, X } from 'lucide-react';
import type * as D from '../../../../shared/contracts/dto';
import { useMutations, useWorkspace } from '../../../../state';
import {
  Button,
  Card,
  CraftChip,
  Dialog,
  EmptyState,
  fmt,
  FormField,
  indexSnapshot,
  PersonLabel,
  StatusPill,
  useAction,
  Textarea,
  TableScroll,
} from '../../../../components/ui';

export function CraftRequests({ snapshot: s }: { snapshot: D.WorkspaceSnapshot }) {
  const { workspace } = useWorkspace();
  const m = useMutations();
  const { busy, run } = useAction();
  const idx = useMemo(() => indexSnapshot(s), [s]);
  const [rejecting, setRejecting] = useState<D.CraftChangeRequestDTO | null>(null);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const myChapters = new Set(
    s.chapters.filter((c) => c.leadPersonId && c.leadPersonId === workspace?.linkedPersonId).map((c) => c.id),
  );
  const pending = s.craftRequests
    .filter((r) => r.status === 'pending')
    .map((r) => ({ r, mine: myChapters.has(idx.people.get(r.personId)?.chapterId ?? '') }))
    .sort((a, b) => Number(b.mine) - Number(a.mine) || a.r.submittedAt.localeCompare(b.r.submittedAt));
  const decided = s.craftRequests
    .filter((r) => r.status !== 'pending')
    .slice(-5)
    .reverse();

  const chip = (c: D.SecondaryCraftDTO) => (
    <CraftChip
      key={c.craftId}
      craft={idx.crafts.get(c.craftId)}
      via="below"
      proficiency={c.proficiency}
      maxPct={c.maxPct}
    />
  );
  const diff = (r: D.CraftChangeRequestDTO) => {
    const cur = new Map(r.current.map((c) => [c.craftId, c]));
    const next = new Map(r.proposed.map((c) => [c.craftId, c]));
    const added = r.proposed.filter((c) => !cur.has(c.craftId));
    const removed = r.current.filter((c) => !next.has(c.craftId));
    const changed = r.proposed.filter((c) => {
      const o = cur.get(c.craftId);
      return o && (o.proficiency !== c.proficiency || o.maxPct !== c.maxPct);
    });
    return { added, removed, changed };
  };

  return (
    <div className="pcp-stack">
      <Card title="Craft changes waiting for approval" subtitle="Requests for chapters you lead are listed first" flush>
        {pending.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="No requests waiting"
            description="Squad members' craft suggestions will appear here."
          />
        ) : (
          <TableScroll>
            <table className="pcp-tbl">
              <caption className="pcp-sr-only">Pending craft change requests</caption>
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Current below the table</th>
                  <th scope="col">Proposed change</th>
                  <th scope="col">Submitted</th>
                  <th scope="col" className="pcp-num">
                    <span className="pcp-sr-only">Decision</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pending.map(({ r, mine }) => {
                  const p = idx.people.get(r.personId);
                  const d = diff(r);
                  return (
                    <tr key={r.id}>
                      <th scope="row">
                        <span className="pcp-row">
                          <PersonLabel name={p?.name ?? r.personId} sub={p?.role} />
                          {mine && <StatusPill tone="brand">Your chapter</StatusPill>}
                        </span>
                      </th>
                      <td>
                        <span className="pcp-chips">
                          {r.current.length ? r.current.map(chip) : <span className="pcp-text-tertiary">None</span>}
                        </span>
                      </td>
                      <td>
                        <span className="cr-diff">
                          {d.added.map((c) => (
                            <span key={`a${c.craftId}`} className="cr-diff__item">
                              <span className="cr-diff__sign" aria-label="Add">
                                +
                              </span>
                              {chip(c)}
                            </span>
                          ))}
                          {d.changed.map((c) => (
                            <span key={`c${c.craftId}`} className="cr-diff__item">
                              <span className="cr-diff__sign" aria-label="Change">
                                ~
                              </span>
                              {chip(c)}
                            </span>
                          ))}
                          {d.removed.map((c) => (
                            <span key={`r${c.craftId}`} className="cr-diff__item cr-diff__item--removed">
                              <span className="cr-diff__sign" aria-label="Remove">
                                −
                              </span>
                              {chip(c)}
                            </span>
                          ))}
                        </span>
                      </td>
                      <td>
                        <span className="pcp-caption pcp-text-tertiary" title={fmt.dateTime(r.submittedAt)}>
                          {r.submittedBy.name} · {fmt.relative(r.submittedAt, s.serverTime)}
                        </span>
                      </td>
                      <td className="pcp-num">
                        <span className="pcp-row cr-actions">
                          <Button
                            size="sm"
                            iconBefore={X}
                            disabled={busy !== null}
                            onClick={() => {
                              setReason('');
                              setTried(false);
                              setRejecting(r);
                            }}
                          >
                            Reject
                          </Button>
                          <Button
                            size="sm"
                            variant="primary"
                            iconBefore={Check}
                            loading={busy === `a${r.id}`}
                            onClick={() =>
                              void run(`a${r.id}`, () => m.people.decideCraftChange(r.id, 'approve'), {
                                success: `Approved ${p?.name ?? ''}'s craft change`,
                              })
                            }
                          >
                            Approve
                          </Button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>
      {decided.length > 0 && (
        <Card title="Recently decided" flush>
          <ul className="pcp-list cr-decided">
            {decided.map((r) => (
              <li key={r.id}>
                <PersonLabel name={idx.people.get(r.personId)?.name ?? r.personId} />
                <span className="pcp-spacer" />
                {r.status === 'approved' ? (
                  <StatusPill tone="success">Approved by {r.decidedBy?.name ?? 'a Planner'}</StatusPill>
                ) : (
                  <StatusPill tone="danger" title={r.reason ?? undefined}>
                    Rejected
                  </StatusPill>
                )}
                {r.reason && <span className="pcp-caption pcp-text-tertiary">{r.reason}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Dialog
        open={!!rejecting}
        title="Reject craft change?"
        onClose={() => setRejecting(null)}
        footer={
          <>
            <Button onClick={() => setRejecting(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={busy === 'reject'}
              onClick={async () => {
                setTried(true);
                if (!rejecting || !reason.trim()) return;
                const res = await run(
                  'reject',
                  () => m.people.decideCraftChange(rejecting.id, 'reject', reason.trim()),
                  {
                    success: 'Request rejected',
                  },
                );
                if (res.ok) setRejecting(null);
              }}
            >
              Reject
            </Button>
          </>
        }
      >
        <FormField
          label="Reason"
          id="cr-reason"
          error={tried && !reason.trim() ? 'Give a reason; the person will see it.' : null}
        >
          <Textarea
            id="cr-reason"
            rows={3}
            value={reason}
            invalid={tried && !reason.trim()}
            onValueChange={setReason}
          />
        </FormField>
      </Dialog>
    </div>
  );
}
