/**
 * Marketplace (DM-03, DM-04, DM-05, AL-05#AC3) — route `/o/:org/w/:ws/plan/marketplace`
 * (`?tab=open|catalogue|under|proposals`, `?view=catalogue`, `?quarter=YYYY-Qn`, `?craft=`, `?tribe=`).
 * Open demand with ranked matches and "Propose" (tentative booking), the shareable squad catalogue for tribe
 * leads, under-target people with "Offer to marketplace", and proposals awaiting a response.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, ChevronRight, Download, Funnel, Link2, Send, Store, Users, X } from 'lucide-react';
import type * as D from '../../../shared/contracts/dto';
import { useMutations, useQuarters, useRecordExport, useWorkspace, type QuarterView } from '../../../state';
import { buildAllocationGrid, buildCatalogue, buildPeopleRows } from '../../../utils/viewModels';
import {
  BandCell,
  Button,
  Card,
  Checkbox,
  CraftChip,
  Dialog,
  downloadText,
  EmptyState,
  fmt,
  FormField,
  indexSnapshot,
  NumberField,
  PageHeader,
  PersonLabel,
  SegmentedControl,
  Select,
  StatusPill,
  TabPanel,
  Tabs,
  TextField,
  toCsv,
  useAction,
  useConfirm,
  useQueryParam,
  useToast,
  numOrNull,
  numText,
  TableScroll,
} from '../../../components/ui';
import { PageBody } from '../../../components/shell/PageBody';
import { useWsPath } from '../../../components/shell/workspacePath';
import { rankMatches, type Match } from '../../../utils/viewModels';
import './marketplace.css';
import { useViewportCan } from '../../../components/shell/viewport';
import { csvFileName } from '../../../utils/csv';
import { today } from '../../../utils/clock';

type Tab = 'open' | 'catalogue' | 'under' | 'proposals';

export default function MarketplacePage() {
  return (
    <div className="pcp-page">
      <PageHeader
        breadcrumbs={[{ label: 'Plan' }, { label: 'Marketplace' }]}
        title="Marketplace"
        description="Match open demand to the squad, and show tribes what the PMO squad can offer each quarter."
      />
      <PageBody label="the marketplace">{(s) => <MarketBody snapshot={s} />}</PageBody>
    </div>
  );
}

function MarketBody({ snapshot: s }: { snapshot: D.WorkspaceSnapshot }) {
  const can = useViewportCan();
  const quarters = useQuarters();
  const planner = can('allocations.propose');
  const [tabRaw, setTab] = useQueryParam('tab');
  const [view] = useQueryParam('view');
  const [quarterKey, setQuarter] = useQueryParam('quarter', quarters[0]?.key ?? '');
  const [craft, setCraft] = useQueryParam('craft');
  const [tribe, setTribe] = useQueryParam('tribe');
  const valid = (['open', 'catalogue', 'under', 'proposals'] as Tab[]).find((t) => t === tabRaw);
  // Viewers (tribe leads) only see the catalogue; `?view=catalogue` is the shareable deep link (DM-04#AC2).
  const tab: Tab = !planner ? 'catalogue' : (valid ?? (view === 'catalogue' ? 'catalogue' : 'open'));
  const quarter = quarters.find((q) => q.key === quarterKey) ?? quarters[0];
  const tentative = s.allocations.filter((a) => a.state === 'tentative');

  return (
    <div className="pcp-stack pcp-stack--md">
      {planner && (
        <Tabs
          idBase="mkt"
          label="Marketplace views"
          value={tab}
          onChange={(v) => setTab(v)}
          tabs={[
            { id: 'open', label: 'Open demand' },
            { id: 'catalogue', label: 'Squad catalogue' },
            { id: 'under', label: 'Under target' },
            { id: 'proposals', label: 'Proposals', count: tentative.length },
          ]}
        />
      )}
      {tab !== 'proposals' && (
        <div className="pcp-row pcp-row--wrap mk-controls">
          <SegmentedControl
            label="Quarter"
            value={quarter?.key ?? ''}
            onChange={(v) => setQuarter(v)}
            options={quarters.map((q) => ({ value: q.key, label: q.label, title: fmt.quarterTooltip(q) }))}
          />
          <span className="pcp-caption pcp-text-tertiary">{quarter?.calendarLabel}</span>
          {
            <>
              <span className="mk-filter">
                <Select
                  size="sm"
                  aria-label="Filter by craft"
                  value={craft}
                  placeholder="Craft: all"
                  onValueChange={setCraft}
                  options={s.crafts.filter((c) => !c.archived).map((c) => ({ value: c.id, label: `Craft: ${c.name}` }))}
                />
              </span>
              <span className="mk-filter">
                <Select
                  size="sm"
                  aria-label="Filter by tribe"
                  value={tribe}
                  placeholder="Tribe: all"
                  onValueChange={setTribe}
                  options={s.tribes.filter((t) => !t.archived).map((t) => ({ value: t.id, label: `Tribe: ${t.name}` }))}
                />
              </span>
            </>
          }
        </div>
      )}
      <TabPanel idBase="mkt" tabId={tab}>
        {quarter && tab === 'open' && <OpenDemand snapshot={s} quarter={quarter} craft={craft} tribe={tribe} />}
        {quarter && tab === 'catalogue' && <Catalogue snapshot={s} quarter={quarter} craft={craft} tribe={tribe} />}
        {quarter && tab === 'under' && <UnderTarget snapshot={s} quarter={quarter} craft={craft} tribe={tribe} />}
        {tab === 'proposals' && <Proposals snapshot={s} />}
      </TabPanel>
    </div>
  );
}

/* ── open demand (DM-03) ─────────────────────────────────────────────────────────── */

function OpenDemand({
  snapshot: s,
  quarter,
  craft,
  tribe,
}: {
  snapshot: D.WorkspaceSnapshot;
  quarter: QuarterView;
  craft: string;
  tribe: string;
}) {
  const quarters = useQuarters();
  const { thresholds } = useWorkspace();
  const m = useMutations();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const wsPath = useWsPath();
  const idx = useMemo(() => indexSnapshot(s), [s]);
  const qi = quarters.findIndex((q) => q.key === quarter.key);
  const [open, setOpen] = useState<Set<string>>(new Set());

  // Booked FTE per project × craft in this quarter: confirmed, and confirmed + tentative.
  const booked = useMemo(() => {
    const collect = (includeTentative: boolean) => {
      const map = new Map<string, number>();
      for (const g of buildAllocationGrid(s, quarters, {
        groupBy: 'none',
        pivot: 'person',
        includeTentative,
        thresholds,
      }).groups)
        for (const r of g.rows)
          if (r.kind === 'booking' && r.projectId) {
            const k = `${r.projectId}|${r.craftId ?? ''}`;
            map.set(k, (map.get(k) ?? 0) + (r.cells[qi]?.pct ?? 0) / 100);
          }
      return map;
    };
    return { confirmed: collect(false), all: collect(true) };
  }, [s, quarters, thresholds, qi]);
  const catalogue = useMemo(() => buildCatalogue(s, quarters, quarter.key), [s, quarters, quarter.key]);

  const lines = s.demand
    .filter((l) => l.quarterKey === quarter.key)
    .filter((l) => !craft || l.craftId === craft)
    .filter((l) => !tribe || idx.projects.get(l.projectId)?.tribeId === tribe)
    .map((l) => {
      const k = `${l.projectId}|${l.craftId}`;
      const staffed = booked.confirmed.get(k) ?? 0;
      const proposed = Math.max(0, (booked.all.get(k) ?? 0) - staffed);
      const open = Math.max(0, l.fte - staffed - proposed);
      return { line: l, project: idx.projects.get(l.projectId), staffed, proposed, open };
    })
    .filter((x) => x.open > 0.04 || x.proposed > 0.04)
    .sort((a, z) => z.open - a.open);
  const totalOpen = lines.reduce((x, l) => x + l.open, 0);

  const propose = async (x: (typeof lines)[number], mt: Match) => {
    const craftName = idx.crafts.get(x.line.craftId)?.name ?? 'the craft';
    const ok = await confirm({
      title: 'Propose this booking?',
      body: `Propose ${mt.person.name} at ${mt.suggestedPct}% on ${x.project?.name ?? 'the project'} for ${quarter.label} as ${craftName}? It is added as tentative until they accept.`,
      confirmLabel: 'Propose',
      tone: 'primary',
    });
    if (!ok) return;
    const start = x.project?.startDate && x.project.startDate > quarter.start ? x.project.startDate : quarter.start;
    const end = x.project?.endDate && x.project.endDate < quarter.end ? x.project.endDate : quarter.end;
    await run(
      `p${mt.person.id}${x.line.id}`,
      () =>
        m.marketplace.propose({
          demandLineId: x.line.id,
          projectId: x.line.projectId,
          resourceId: mt.person.id,
          craftId: x.line.craftId,
          quarterKey: quarter.key,
          percentage: mt.suggestedPct,
          startDate: start,
          endDate: end,
        }),
      {
        success: `Proposed ${mt.person.name}`,
        body: `${mt.suggestedPct}% on ${x.project?.name ?? ''}, ${quarter.label}. They have been notified.`,
        undo: true,
      },
    );
  };

  return (
    <Card
      flush
      title={`Open demand · ${quarter.label}`}
      subtitle={`${fmt.fte(totalOpen)} FTE not yet staffed across ${lines.length} demand line${lines.length === 1 ? '' : 's'} · expand a line to see ranked matches`}
    >
      {lines.length === 0 ? (
        <EmptyState
          icon={Store}
          title="No open demand"
          description={`Every demand line in ${quarter.label} is staffed or proposed.`}
        />
      ) : (
        <ul className="mk-lines">
          {lines.map((x) => {
            const isOpen = open.has(x.line.id);
            const proposedHere = new Set(
              s.allocations
                .filter((a) => a.state === 'tentative' && a.projectId === x.line.projectId)
                .map((a) => a.resourceId),
            );
            const matches = isOpen
              ? rankMatches(
                  catalogue.find((c) => c.craft.id === x.line.craftId),
                  x.project,
                  x.open,
                  proposedHere,
                ).slice(0, 5)
              : [];
            const craftDto = idx.crafts.get(x.line.craftId);
            return (
              <li key={x.line.id} className="mk-line">
                <button
                  type="button"
                  className="mk-line__head"
                  aria-expanded={isOpen}
                  onClick={() =>
                    setOpen((cur) => {
                      const n = new Set(cur);
                      if (n.has(x.line.id)) n.delete(x.line.id);
                      else n.add(x.line.id);
                      return n;
                    })
                  }
                >
                  {isOpen ? (
                    <ChevronDown size={16} aria-hidden="true" />
                  ) : (
                    <ChevronRight size={16} aria-hidden="true" />
                  )}
                  <CraftChip craft={craftDto} />
                  <span className="mk-line__title">
                    <span className="pcp-strong">{x.project?.name}</span>
                    <span className="pcp-caption pcp-text-tertiary">
                      {idx.tribes.get(x.project?.tribeId ?? '')?.name ?? 'No tribe'} · {craftDto?.name} ·{' '}
                      {x.line.status}
                    </span>
                  </span>
                  <span className="mk-line__fte pcp-tnum">
                    <span className="pcp-strong">{fmt.fte(x.open)} FTE open</span>
                    <span className="pcp-caption pcp-text-tertiary">
                      {fmt.fte(x.line.fte)} needed · {fmt.fte(x.staffed)} staffed
                      {x.proposed > 0.04 ? ` · ${fmt.fte(x.proposed)} proposed` : ''}
                    </span>
                  </span>
                </button>
                {isOpen && (
                  <div className="mk-matches">
                    {matches.length === 0 ? (
                      <p className="pcp-text-secondary mk-matches__empty">
                        Nobody with this craft has free capacity in {quarter.label}.{' '}
                        <Link
                          className="pcp-link"
                          to={`${wsPath('plan/capacity')}?pivot=craft&craft=${x.line.craftId}`}
                        >
                          See the craft outlook
                        </Link>
                      </p>
                    ) : (
                      <table className="pcp-tbl pcp-tbl--compact">
                        <caption className="pcp-sr-only">Ranked matches for {x.project?.name}</caption>
                        <thead>
                          <tr>
                            <th scope="col">Person</th>
                            <th scope="col">Why</th>
                            <th scope="col" className="pcp-num">
                              Score
                            </th>
                            <th scope="col" className="pcp-num">
                              Propose at
                            </th>
                            <th scope="col">
                              <span className="pcp-sr-only">Action</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {matches.map((mt, i) => (
                            <tr key={mt.person.id}>
                              <th scope="row">
                                <span className="pcp-row">
                                  <span className="mk-rank">{i + 1}</span>
                                  <PersonLabel name={mt.person.name} sub={mt.person.role} />
                                </span>
                              </th>
                              <td>
                                <span className="pcp-chips">
                                  {mt.reasons.map((r) => (
                                    <StatusPill key={r} tone={r === 'Offered' ? 'brand' : 'neutral'}>
                                      {r}
                                    </StatusPill>
                                  ))}
                                </span>
                              </td>
                              <td className="pcp-num">{mt.score}</td>
                              <td className="pcp-num">{mt.suggestedPct}%</td>
                              <td className="pcp-num">
                                <Button
                                  size="sm"
                                  variant="primary"
                                  iconBefore={Send}
                                  loading={busy === `p${mt.person.id}${x.line.id}`}
                                  onClick={() => void propose(x, mt)}
                                >
                                  Propose
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ── catalogue (DM-04) ───────────────────────────────────────────────────────────── */

function Catalogue({
  snapshot: s,
  quarter,
  craft,
  tribe,
}: {
  snapshot: D.WorkspaceSnapshot;
  quarter: QuarterView;
  craft: string;
  tribe: string;
}) {
  const toast = useToast();
  const quarters = useQuarters();
  const can = useViewportCan();
  const recordExport = useRecordExport();
  const wsPath = useWsPath();
  const entries = useMemo(() => buildCatalogue(s, quarters, quarter.key), [s, quarters, quarter.key]);
  const shown = entries
    .filter((e) => !craft || e.craft.id === craft)
    .map((e) => ({
      ...e,
      people: e.people.filter(
        (p) =>
          (p.freePct > 0 || p.offer) &&
          (!tribe || p.person.tribeAffinity.includes(tribe) || p.person.homeTribeId === tribe),
      ),
    }))
    .filter((e) => e.people.length > 0 || e.freeAboveFte > 0 || e.reachBelowFte > 0)
    .sort((a, z) => z.freeAboveFte + z.reachBelowFte - (a.freeAboveFte + a.reachBelowFte));
  const totalAbove = shown.reduce((x, e) => x + e.freeAboveFte, 0);
  const totalBelow = shown.reduce((x, e) => x + e.reachBelowFte, 0);

  const copyLink = async () => {
    const url = `${window.location.origin}${wsPath('plan/marketplace')}?view=catalogue&quarter=${quarter.key}${craft ? `&craft=${craft}` : ''}${tribe ? `&tribe=${tribe}` : ''}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.show({ tone: 'success', title: 'Link copied', body: 'Anyone in this workspace can open it.' });
    } catch {
      toast.show({ tone: 'error', title: 'Could not copy the link', body: url });
    }
  };
  const exportCsv = () => {
    void recordExport({ kind: 'squad-catalogue', format: 'csv' }).catch(() => undefined);
    downloadText(
      csvFileName('squad-catalogue', today()), // QA-028: {page}-{yyyy-mm-dd}.csv (DS-04#AC7)
      toCsv(
        ['craft', 'person', 'via', 'proficiency', 'free_pct', 'offered_pct', 'offer_note'],
        shown.flatMap((e) =>
          e.people.map((p) => [
            e.craft.name,
            p.person.name,
            p.via === 'above' ? 'above the table' : 'below the table',
            p.proficiency ? `L${p.proficiency}` : '',
            Math.round(p.freePct),
            p.offer?.pct ?? '',
            p.offer?.note ?? '',
          ]),
        ),
      ),
    );
  };

  return (
    <Card
      flush
      title={`What the squad can offer · ${quarter.label}`}
      subtitle={`${fmt.fte(totalAbove)} FTE free above the table · ${fmt.fte(totalBelow)} FTE reach below the table · ${quarter.calendarLabel}`}
      actions={
        <>
          <Button size="sm" iconBefore={Link2} onClick={() => void copyLink()}>
            Copy link
          </Button>
          {can('export') && (
            <Button size="sm" iconBefore={Download} onClick={exportCsv}>
              Export CSV
            </Button>
          )}
        </>
      }
    >
      {shown.length === 0 ? (
        <EmptyState
          icon={craft || tribe ? Funnel : Users}
          title="No spare capacity to offer"
          description={`The squad is fully planned in ${quarter.label}${craft || tribe ? ' for these filters' : ''}.`}
        />
      ) : (
        <div className="mk-catalogue">
          {shown.map((e) => (
            <section key={e.craft.id} className="mk-craft" aria-label={e.craft.name}>
              <header className="mk-craft__head">
                <CraftChip craft={e.craft} />
                <h3 className="mk-craft__title">{e.craft.name}</h3>
              </header>
              <div className="mk-craft__stats pcp-tnum">
                <span>
                  <span className="pcp-strong">{fmt.fte(e.freeAboveFte)}</span>{' '}
                  <span className="pcp-caption pcp-text-tertiary">FTE above</span>
                </span>
                <span>
                  <span className="pcp-strong">{fmt.fte(e.reachBelowFte)}</span>{' '}
                  <span className="pcp-caption pcp-text-tertiary">FTE reach below</span>
                </span>
              </div>
              <ul className="mk-craft__people">
                {e.people.slice(0, 6).map((p) => (
                  <li key={p.person.id}>
                    <PersonLabel
                      name={p.person.name}
                      sub={
                        p.offer?.note ?? (p.via === 'above' ? 'Above the table' : `Below the table · L${p.proficiency}`)
                      }
                    />
                    <span className="pcp-spacer" />
                    {p.offer && <StatusPill tone="brand">Offered {p.offer.pct}%</StatusPill>}
                    <span className="pcp-tnum pcp-strong mk-free">{Math.round(p.freePct)}%</span>
                  </li>
                ))}
                {e.people.length > 6 && (
                  <li className="pcp-caption pcp-text-tertiary">and {e.people.length - 6} more</li>
                )}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ── under target (DM-05) ────────────────────────────────────────────────────────── */

function UnderTarget({
  snapshot: s,
  quarter,
  craft,
  tribe,
}: {
  snapshot: D.WorkspaceSnapshot;
  quarter: QuarterView;
  craft: string;
  tribe: string;
}) {
  const quarters = useQuarters();
  const { thresholds } = useWorkspace();
  const can = useViewportCan();
  const m = useMutations();
  const { run, busy } = useAction();
  const idx = useMemo(() => indexSnapshot(s), [s]);
  const qi = quarters.findIndex((q) => q.key === quarter.key);
  const [offering, setOffering] = useState<D.PersonDTO | null>(null);
  const rows = useMemo(() => buildPeopleRows(s, quarters, thresholds), [s, quarters, thresholds]);
  const under = rows
    .filter((r) => r.quarters[qi] && (r.quarters[qi].band === 'under' || r.quarters[qi].band === 'bench'))
    .filter(
      (r) => !craft || r.person.primaryCraft === craft || r.person.secondaryCrafts.some((c) => c.craftId === craft),
    )
    .filter((r) => !tribe || r.person.tribeAffinity.includes(tribe) || r.person.homeTribeId === tribe)
    .sort((a, z) => a.quarters[qi].relativePct - z.quarters[qi].relativePct);
  return (
    <Card
      flush
      title={`Under target · ${quarter.label}`}
      subtitle="People below the on-target band. Offer their spare capacity so tribes can see it in the catalogue."
    >
      {under.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Everyone is at or above target"
          description={`Nobody is under target in ${quarter.label}.`}
        />
      ) : (
        <TableScroll>
          <table className="pcp-tbl">
            <caption className="pcp-sr-only">People under target in {quarter.label}</caption>
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Crafts</th>
                <th scope="col" className="pcp-num">
                  Load
                </th>
                <th scope="col" className="pcp-num">
                  Free
                </th>
                <th scope="col">Offer</th>
                <th scope="col">
                  <span className="pcp-sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {under.map((r) => {
                const q = r.quarters[qi];
                const offer = s.offers.find((o) => o.personId === r.person.id && o.quarterKey === quarter.key);
                const free = Math.max(0, r.person.targetUtil - q.loadPct);
                return (
                  <tr key={r.person.id}>
                    <th scope="row">
                      <PersonLabel name={r.person.name} sub={r.person.role} />
                    </th>
                    <td>
                      <span className="pcp-chips">
                        <CraftChip craft={r.primary} />
                        {r.secondary.map((c) => (
                          <CraftChip
                            key={c.craft.id}
                            craft={c.craft}
                            via="below"
                            proficiency={c.proficiency}
                            maxPct={c.maxPct}
                          />
                        ))}
                      </span>
                    </td>
                    <td className="pcp-num">
                      <BandCell value={q.relativePct} band={q.band} label={r.person.name} />
                    </td>
                    <td className="pcp-num">{fmt.pct(free)}</td>
                    <td>
                      {offer ? (
                        <span className="pcp-row">
                          <StatusPill tone="brand">Offered {offer.pct}%</StatusPill>
                          <span className="pcp-caption pcp-text-tertiary pcp-truncate">
                            {offer.craftIds.map((c) => idx.crafts.get(c)?.short).join(', ')}
                          </span>
                        </span>
                      ) : (
                        <span className="pcp-text-tertiary">Not offered</span>
                      )}
                    </td>
                    <td className="pcp-num">
                      {(can('offers.write') || can('offers.write.own')) &&
                        (offer ? (
                          <Button
                            size="sm"
                            variant="subtle"
                            loading={busy === `w${r.person.id}`}
                            onClick={() =>
                              void run(`w${r.person.id}`, () => m.marketplace.withdrawOffer(r.person.id, quarter.key), {
                                success: 'Offer withdrawn',
                                undo: true,
                              })
                            }
                          >
                            Withdraw offer
                          </Button>
                        ) : (
                          <Button size="sm" iconBefore={Store} onClick={() => setOffering(r.person)}>
                            Offer to marketplace
                          </Button>
                        ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      )}
      <OfferDialog
        snapshot={s}
        person={offering}
        quarter={quarter}
        defaultPct={
          offering
            ? Math.max(
                5,
                Math.round(
                  Math.max(
                    0,
                    offering.targetUtil - (rows.find((r) => r.person.id === offering.id)?.quarters[qi]?.loadPct ?? 0),
                  ) / 5,
                ) * 5,
              )
            : 0
        }
        onClose={() => setOffering(null)}
      />
    </Card>
  );
}

export function OfferDialog({
  snapshot: s,
  person,
  quarter,
  defaultPct,
  onClose,
}: {
  snapshot: D.WorkspaceSnapshot;
  person: D.PersonDTO | null;
  quarter: QuarterView;
  defaultPct: number;
  onClose(): void;
}) {
  if (!person) return null;
  return (
    <OfferInner
      key={person.id + quarter.key}
      s={s}
      person={person}
      quarter={quarter}
      defaultPct={defaultPct}
      onClose={onClose}
    />
  );
}

function OfferInner({
  s,
  person,
  quarter,
  defaultPct,
  onClose,
}: {
  s: D.WorkspaceSnapshot;
  person: D.PersonDTO;
  quarter: QuarterView;
  defaultPct: number;
  onClose(): void;
}) {
  const m = useMutations();
  const { run, busy } = useAction();
  const all = [person.primaryCraft, ...person.secondaryCrafts.map((c) => c.craftId)].filter((x): x is string => !!x);
  const [pct, setPct] = useState(String(defaultPct || 20));
  const [crafts, setCrafts] = useState<Set<string>>(new Set(all));
  const [note, setNote] = useState('');
  const n = Number(pct);
  const invalid = !(n > 0 && n <= 100) || crafts.size === 0;
  return (
    <Dialog
      open
      title={`Offer ${person.name} · ${quarter.label}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            iconBefore={Store}
            disabled={invalid}
            loading={busy === 'offer'}
            onClick={async () => {
              const res = await run(
                'offer',
                () =>
                  m.marketplace.setOffer({
                    personId: person.id,
                    quarterKey: quarter.key,
                    pct: n,
                    craftIds: [...crafts],
                    note: note.trim() || null,
                  }),
                {
                  success: 'Offered on the Marketplace',
                  body: `${person.name} · ${n}% in ${quarter.label}`,
                  undo: true,
                },
              );
              if (res.ok) onClose();
            }}
          >
            Offer
          </Button>
        </>
      }
    >
      <div className="pcp-stack pcp-stack--md">
        <FormField label="Capacity to offer" id="of-pct" error={!(n > 0 && n <= 100) ? 'Enter 1–100' : null}>
          <NumberField
            id="of-pct"
            unit="%"
            value={numOrNull(pct)}
            min={0}
            max={100}
            step={5}
            onChange={(n) => setPct(numText(n))}
          />
        </FormField>
        <fieldset className="mk-fieldset">
          <legend className="pcp-field__label">Crafts</legend>
          {all.map((c) => (
            <Checkbox
              key={c}
              checked={crafts.has(c)}
              label={`${s.crafts.find((x) => x.id === c)?.name ?? c}${c === person.primaryCraft ? ' (above the table)' : ''}`}
              onChange={(v) =>
                setCrafts((cur) => {
                  const nn = new Set(cur);
                  if (v) nn.add(c);
                  else nn.delete(c);
                  return nn;
                })
              }
            />
          ))}
        </fieldset>
        <FormField label="Note" id="of-note" optional help="Shown to tribe leads in the catalogue.">
          <TextField id="of-note" value={note} placeholder="e.g. Free from mid-November" onValueChange={setNote} />
        </FormField>
      </div>
    </Dialog>
  );
}

/* ── proposals (DM-03#AC4/5, AL-05#AC3) ──────────────────────────────────────────── */

function Proposals({ snapshot: s }: { snapshot: D.WorkspaceSnapshot }) {
  const can = useViewportCan();
  const m = useMutations();
  const { run, busy } = useAction();
  const idx = useMemo(() => indexSnapshot(s), [s]);
  const tentative = s.allocations
    .filter((a) => a.state === 'tentative')
    .sort((a, z) => (a.proposedAt ?? '').localeCompare(z.proposedAt ?? ''));
  const responded = s.allocations
    .filter((a) => a.respondedAt && a.proposedAt)
    .sort((a, z) => (z.respondedAt ?? '').localeCompare(a.respondedAt ?? ''))
    .slice(0, 8);
  const hours = (a: string, b: string) => Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 3600000);
  const timeToStaff = (h: number) =>
    h < 1 ? 'under an hour' : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`;
  const canDecide = can('allocations.write');
  return (
    <div className="pcp-stack">
      <Card
        flush
        title="Waiting for a response"
        subtitle="Tentative bookings proposed from the Marketplace. The person accepts in My plan; a Planner can confirm or decline here."
      >
        {tentative.length === 0 ? (
          <EmptyState
            icon={Send}
            title="No proposals waiting"
            description="Propose people from Open demand to see them here."
          />
        ) : (
          <TableScroll>
            <table className="pcp-tbl">
              <caption className="pcp-sr-only">Proposals waiting for a response</caption>
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Project</th>
                  <th scope="col">Craft</th>
                  <th scope="col" className="pcp-num">
                    %
                  </th>
                  <th scope="col">Dates</th>
                  <th scope="col">Proposed</th>
                  <th scope="col">
                    <span className="pcp-sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {tentative.map((a) => {
                  const p = idx.people.get(a.resourceId);
                  const craftId = a.craftId ?? p?.primaryCraft ?? null;
                  const sec = p?.secondaryCrafts.find((x) => x.craftId === craftId);
                  return (
                    <tr key={a.id}>
                      <th scope="row">
                        <PersonLabel name={p?.name ?? a.resourceId} sub={p?.role} />
                      </th>
                      <td>{idx.projects.get(a.projectId)?.name}</td>
                      <td>
                        <CraftChip
                          craft={craftId ? idx.crafts.get(craftId) : null}
                          via={craftId === p?.primaryCraft ? 'above' : sec ? 'below' : 'undeclared'}
                          proficiency={sec?.proficiency}
                        />
                      </td>
                      <td className="pcp-num">{a.percentage}%</td>
                      <td className="pcp-tnum">{fmt.dateRange(a.startDate, a.endDate)}</td>
                      <td>
                        <span className="pcp-caption pcp-text-tertiary">
                          {a.proposedBy?.name ?? 'A planner'} · {fmt.relative(a.proposedAt, s.serverTime)}
                        </span>
                      </td>
                      <td className="pcp-num">
                        {canDecide && (
                          <span className="pcp-row mk-actions">
                            <Button
                              size="sm"
                              iconBefore={X}
                              disabled={busy !== null}
                              onClick={() =>
                                void run(`d${a.id}`, () => m.allocations.respond(a.id, { decision: 'decline' }), {
                                  success: 'Proposal declined',
                                  undo: true,
                                })
                              }
                            >
                              Decline
                            </Button>
                            <Button
                              size="sm"
                              variant="primary"
                              iconBefore={Check}
                              loading={busy === `c${a.id}`}
                              onClick={() =>
                                void run(`c${a.id}`, () => m.allocations.respond(a.id, { decision: 'accept' }), {
                                  success: 'Booking confirmed',
                                  undo: true,
                                })
                              }
                            >
                              Confirm
                            </Button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>
      {responded.length > 0 && (
        <Card flush title="Recently answered" subtitle="Time to staff = response time from the proposal">
          <ul className="pcp-list mk-answered">
            {responded.map((a) => (
              <li key={a.id}>
                <PersonLabel
                  name={idx.people.get(a.resourceId)?.name ?? a.resourceId}
                  sub={idx.projects.get(a.projectId)?.name}
                />
                <span className="pcp-spacer" />
                {a.state === 'confirmed' ? (
                  <StatusPill tone="success">Accepted</StatusPill>
                ) : (
                  <StatusPill>Declined</StatusPill>
                )}
                <span className="pcp-caption pcp-text-tertiary pcp-tnum">
                  Time to staff {timeToStaff(hours(a.proposedAt ?? '', a.respondedAt ?? ''))}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
