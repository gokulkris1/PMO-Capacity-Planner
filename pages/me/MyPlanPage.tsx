/**
 * My plan (PPL-05, PPL-06#AC4, DM-05#AC3) — route `/o/:org/w/:ws/me`.
 * My profile, above/below-the-table crafts with change requests, my four-quarter load, proposals to accept
 * or decline, my bookings and my Marketplace offers.
 */
import { useMemo, useState } from 'react';
import { Check, CircleUserRound, Inbox, Pencil, Send, Store, X } from 'lucide-react';
import type * as D from '../../shared/contracts/dto';
import { useMutations, useQuarters, useWorkspace, type QuarterView } from '../../state';
import { buildPeopleRows } from '../../utils/viewModels';
import {
  Avatar,
  BandPill,
  Banner,
  BookingStatePill,
  Button,
  Card,
  CraftChip,
  Dialog,
  EmptyState,
  fmt,
  FormField,
  indexSnapshot,
  KpiTile,
  PageHeader,
  ProvenanceTag,
  QuarterLoadBar,
  relativeLoadSplit,
  StatusPill,
  useAction,
  Textarea,
  TableScroll,
} from '../../components/ui';
import { PageBody } from '../../components/shell/PageBody';
import { PersonDrawer } from '../org/people/PersonDrawer';
import { OfferDialog } from '../plan/marketplace/MarketplacePage';
import './me.css';

export default function MyPlanPage() {
  return (
    <div className="pcp-page">
      <PageBody skeleton="kpi" label="your plan">
        {(s) => <MyPlanBody snapshot={s} />}
      </PageBody>
    </div>
  );
}

function MyPlanBody({ snapshot: s }: { snapshot: D.WorkspaceSnapshot }) {
  const { workspace, thresholds, can } = useWorkspace();
  const quarters = useQuarters();
  const idx = useMemo(() => indexSnapshot(s), [s]);
  const person = workspace?.linkedPersonId ? idx.people.get(workspace.linkedPersonId) : undefined;
  const [drawer, setDrawer] = useState<'profile' | 'crafts' | null>(null);
  const [offerQ, setOfferQ] = useState<QuarterView | null>(null);
  const row = useMemo(
    () => (person ? buildPeopleRows(s, quarters, thresholds).find((r) => r.person.id === person.id) : undefined),
    [s, quarters, thresholds, person],
  );

  if (!person || !row) {
    return (
      <>
        <PageHeader breadcrumbs={[{ label: 'My plan' }]} title="My plan" />
        <Card>
          <EmptyState
            icon={CircleUserRound}
            title="Your login isn't linked to a person"
            description="Your login isn't linked to a person in this workspace. Ask a Planner to link you."
          />
        </Card>
      </>
    );
  }

  const canOffer = can('offers.write.own') || can('offers.write');
  const chapter = person.chapterId ? idx.chapters.get(person.chapterId) : undefined;
  const lead = chapter?.leadPersonId ? idx.people.get(chapter.leadPersonId) : undefined;
  const requests = s.craftRequests
    .filter((r) => r.personId === person.id)
    .sort((a, z) => z.submittedAt.localeCompare(a.submittedAt));
  const pending = requests.find((r) => r.status === 'pending');
  const lastDecided = requests.find((r) => r.status !== 'pending');
  const proposals = s.allocations.filter((a) => a.resourceId === person.id && a.state === 'tentative');
  const bookings = s.allocations
    .filter((a) => a.resourceId === person.id && a.state === 'confirmed')
    .sort((a, z) => (a.startDate ?? '').localeCompare(z.startDate ?? ''));
  const offers = s.offers.filter((o) => o.personId === person.id);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'My plan' }]}
        title="My plan"
        description={`${person.name} · ${person.role}${chapter ? ` · ${chapter.name}` : ''} · target ${person.targetUtil}%`}
        actions={
          canOffer && (
            <Button variant="primary" iconBefore={Store} onClick={() => setOfferQ(quarters[0] ?? null)}>
              Offer my capacity
            </Button>
          )
        }
      />
      <div className="pcp-stack">
        <div className="pcp-kpi-grid" role="list" aria-label="My load by quarter">
          {row.quarters.map((q, i) => (
            <div role="listitem" key={q.key}>
              <KpiTile
                label={`My load ${quarters[i]?.label}`}
                value={fmt.pct(q.relativePct)}
                pill={<BandPill band={q.band} />}
                delta={`${fmt.pct(q.loadPct)} booked of ${fmt.pct(person.targetUtil)} target`}
                caption={fmt.quarterCaption(quarters[i])}
              />
            </div>
          ))}
        </div>

        <div className="pcp-grid-xl">
          <div className="pcp-span-8 pcp-stack">
            <Card
              title="Proposed to you"
              subtitle="Accept to confirm the booking; decline with an optional reason"
              flush
            >
              <Proposals snapshot={s} proposals={proposals} />
            </Card>
            <Card title="My bookings" subtitle="Confirmed bookings, all dates" flush>
              {bookings.length === 0 ? (
                <EmptyState
                  compact
                  icon={Inbox}
                  title="No confirmed bookings"
                  description="Accepted proposals and planned work will show here."
                />
              ) : (
                <TableScroll>
                  <table className="pcp-tbl pcp-tbl--compact">
                    <caption className="pcp-sr-only">My confirmed bookings</caption>
                    <thead>
                      <tr>
                        <th scope="col">Project</th>
                        <th scope="col">Craft</th>
                        <th scope="col" className="pcp-num">
                          %
                        </th>
                        <th scope="col">Dates</th>
                        <th scope="col">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bookings.map((a) => {
                        const p = idx.projects.get(a.projectId);
                        const craftId = a.craftId ?? person.primaryCraft;
                        const sec = person.secondaryCrafts.find((x) => x.craftId === craftId);
                        return (
                          <tr key={a.id}>
                            <th scope="row">
                              <span className="pcp-strong">{p?.name}</span>{' '}
                              <span className="pcp-caption pcp-text-tertiary">
                                {idx.tribes.get(p?.tribeId ?? '')?.name}
                              </span>
                            </th>
                            <td>
                              <CraftChip
                                craft={craftId ? idx.crafts.get(craftId) : null}
                                via={craftId === person.primaryCraft ? 'above' : sec ? 'below' : 'undeclared'}
                                proficiency={sec?.proficiency}
                              />
                            </td>
                            <td className="pcp-num">{a.percentage}%</td>
                            <td className="pcp-tnum">
                              {fmt.dateRange(a.startDate ?? p?.startDate, a.endDate ?? p?.endDate)}
                            </td>
                            <td>
                              <ProvenanceTag source={a.source} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TableScroll>
              )}
            </Card>
          </div>
          <div className="pcp-span-4 pcp-stack">
            <Card
              title="My crafts"
              actions={
                (can('people.write.own') || can('people.write')) && (
                  <Button
                    size="sm"
                    variant="subtle"
                    iconBefore={Pencil}
                    disabled={!!pending}
                    onClick={() => setDrawer('crafts')}
                  >
                    Suggest changes
                  </Button>
                )
              }
            >
              <div className="pcp-stack pcp-stack--md">
                <div className="me-crafts">
                  <span className="pcp-field__label">Above the table</span>
                  <span className="pcp-row">
                    <CraftChip craft={person.primaryCraft ? idx.crafts.get(person.primaryCraft) : null} />
                    <span>{person.primaryCraft ? idx.crafts.get(person.primaryCraft)?.name : 'Not set'}</span>
                  </span>
                </div>
                <div className="me-crafts">
                  <span className="pcp-field__label">Below the table</span>
                  {person.secondaryCrafts.length === 0 && <span className="pcp-text-secondary">None yet</span>}
                  <ul className="me-craftlist">
                    {person.secondaryCrafts.map((c) => (
                      <li key={c.craftId}>
                        <CraftChip
                          craft={idx.crafts.get(c.craftId)}
                          via="below"
                          proficiency={c.proficiency}
                          maxPct={c.maxPct}
                        />
                        <span className="pcp-truncate">{idx.crafts.get(c.craftId)?.name}</span>
                        <span className="pcp-caption pcp-text-tertiary pcp-tnum">up to {c.maxPct}%</span>
                      </li>
                    ))}
                  </ul>
                </div>
                {pending && (
                  <Banner tone="info" title="Change waiting for approval">
                    Pending approval by {lead?.name ?? 'a Planner'} · sent{' '}
                    {fmt.relative(pending.submittedAt, s.serverTime)}
                  </Banner>
                )}
                {!pending && lastDecided && (
                  <Banner tone={lastDecided.status === 'approved' ? 'success' : 'warning'}>
                    {lastDecided.status === 'approved'
                      ? `Approved by ${lastDecided.decidedBy?.name ?? 'a Planner'}`
                      : `Rejected: ${lastDecided.reason ?? 'no reason given'}`}
                  </Banner>
                )}
              </div>
            </Card>
            <Card title="My four quarters" subtitle="Above the table · below · undeclared · free">
              <ul className="me-load">
                {row.quarters.map((q, i) => (
                  <li key={q.key}>
                    <span className="me-load__q">{quarters[i]?.label}</span>
                    <QuarterLoadBar
                      quarterLabel={quarters[i]?.label ?? q.key}
                      {...relativeLoadSplit(q, person.targetUtil)}
                    />
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="My offers" subtitle="Spare capacity shown to tribes in the catalogue">
              <ul className="me-offers">
                {quarters.map((q) => {
                  const o = offers.find((x) => x.quarterKey === q.key);
                  return (
                    <li key={q.key}>
                      <span className="me-load__q">{q.label}</span>
                      {o ? (
                        <StatusPill tone="brand">Offered {o.pct}%</StatusPill>
                      ) : (
                        <span className="pcp-text-tertiary">Not offered</span>
                      )}
                      <span className="pcp-spacer" />
                      {canOffer && (
                        <Button size="sm" variant="subtle" onClick={() => setOfferQ(q)}>
                          {o ? 'Change' : 'Offer'}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>
        </div>
      </div>
      <PersonDrawer
        snapshot={s}
        personId={drawer ? person.id : null}
        initialTab={drawer ?? 'profile'}
        onClose={() => setDrawer(null)}
      />
      {offerQ && (
        <OfferDialog
          snapshot={s}
          person={person}
          quarter={offerQ}
          defaultPct={Math.max(
            5,
            Math.round(Math.max(0, person.targetUtil - (row.quarters[offerQ.index]?.loadPct ?? 0)) / 5) * 5,
          )}
          onClose={() => setOfferQ(null)}
        />
      )}
    </>
  );
}

function Proposals({ snapshot: s, proposals }: { snapshot: D.WorkspaceSnapshot; proposals: D.AllocationDTO[] }) {
  const m = useMutations();
  const { run, busy } = useAction();
  const idx = useMemo(() => indexSnapshot(s), [s]);
  const [declining, setDeclining] = useState<D.AllocationDTO | null>(null);
  const [reason, setReason] = useState('');
  if (proposals.length === 0)
    return (
      <EmptyState
        compact
        icon={Send}
        title="Nothing proposed to you"
        description="When a Planner proposes you for a project, you can accept or decline it here."
      />
    );
  return (
    <>
      <ul className="pcp-list me-proposals">
        {proposals.map((a) => {
          const p = idx.projects.get(a.projectId);
          const person = idx.people.get(a.resourceId);
          const craftId = a.craftId ?? person?.primaryCraft ?? null;
          const sec = person?.secondaryCrafts.find((x) => x.craftId === craftId);
          return (
            <li key={a.id}>
              <Avatar name={p?.name ?? '?'} size={32} />
              <div className="me-proposals__main">
                <span className="pcp-row">
                  <span className="pcp-strong">{p?.name}</span>
                  <BookingStatePill state="tentative" />
                </span>
                <span className="pcp-caption pcp-text-tertiary">
                  {idx.tribes.get(p?.tribeId ?? '')?.name ?? 'No tribe'} · {fmt.dateRange(a.startDate, a.endDate)} ·
                  proposed by {a.proposedBy?.name ?? 'a Planner'} {fmt.relative(a.proposedAt, s.serverTime)}
                </span>
              </div>
              <CraftChip
                craft={craftId ? idx.crafts.get(craftId) : null}
                via={craftId === person?.primaryCraft ? 'above' : sec ? 'below' : 'undeclared'}
                proficiency={sec?.proficiency}
              />
              <span className="pcp-strong pcp-tnum me-proposals__pct">{a.percentage}%</span>
              <Button
                size="sm"
                iconBefore={X}
                disabled={busy !== null}
                onClick={() => {
                  setReason('');
                  setDeclining(a);
                }}
              >
                Decline
              </Button>
              <Button
                size="sm"
                variant="primary"
                iconBefore={Check}
                loading={busy === `a${a.id}`}
                onClick={() =>
                  void run(`a${a.id}`, () => m.allocations.respond(a.id, { decision: 'accept' }), {
                    success: 'Booking accepted',
                    body: `${p?.name ?? ''} is now confirmed.`,
                  })
                }
              >
                Accept
              </Button>
            </li>
          );
        })}
      </ul>
      <Dialog
        open={!!declining}
        title="Decline this booking?"
        onClose={() => setDeclining(null)}
        footer={
          <>
            <Button onClick={() => setDeclining(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={busy === 'decline'}
              onClick={async () => {
                if (!declining) return;
                const res = await run(
                  'decline',
                  () =>
                    m.allocations.respond(declining.id, { decision: 'decline', reason: reason.trim() || undefined }),
                  {
                    success: 'Booking declined',
                    body: 'The Planner who proposed it will see your reason.',
                  },
                );
                if (res.ok) setDeclining(null);
              }}
            >
              Decline
            </Button>
          </>
        }
      >
        <FormField label="Reason" id="me-reason" optional help="For example: already committed elsewhere that quarter.">
          <Textarea id="me-reason" rows={3} value={reason} onValueChange={setReason} />
        </FormField>
      </Dialog>
    </>
  );
}
