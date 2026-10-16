/** Person drawer (PPL-02): Profile, Crafts, Load, Bookings, Identity. `?person=<id>` or `?person=new`. */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarRange, Check, Link2, Plus, Send, Trash2, UserRound, X } from 'lucide-react';
import type * as D from '../../../shared/contracts/dto';
import { useMutations, useQuarters, useWorkspace } from '../../../state';
import { buildPeopleRows } from '../../../utils/viewModels';
import {
  Avatar,
  Banner,
  BandCell,
  BookingStatePill,
  Button,
  CraftChip,
  Drawer,
  EmptyState,
  FormField,
  IconButton,
  NumberField,
  ProvenanceTag,
  QuarterLoadBar,
  Select,
  StatusPill,
  TabPanel,
  Tabs,
  Tag,
  TextField,
  fmt,
  indexSnapshot,
  useAction,
  useConfirm,
  useWsPath,
} from '../../plan/_kit';
import { BookingDatesDialog } from '../../plan/_parts/BookingDatesDialog';
import { useDelivery } from '../../delivery/_parts/deliverySource';

type TabId = 'profile' | 'crafts' | 'load' | 'bookings' | 'identity';

interface ProfileDraft {
  name: string;
  email: string;
  role: string;
  type: D.PersonType;
  location: string;
  chapterId: string;
  teamId: string;
  homeTribeId: string;
  targetUtil: string;
  dailyRate: string;
  skills: string;
}
interface CraftDraft {
  primaryCraft: string;
  secondary: Array<{ key: string; craftId: string; proficiency: D.Proficiency; maxPct: string }>;
}

function profileOf(p: D.PersonDTO | null): ProfileDraft {
  return {
    name: p?.name ?? '',
    email: p?.email ?? '',
    role: p?.role ?? '',
    type: p?.type ?? 'Permanent',
    location: p?.location ?? '',
    chapterId: p?.chapterId ?? '',
    teamId: p?.teamId ?? '',
    homeTribeId: p?.homeTribeId ?? '',
    targetUtil: String(p?.targetUtil ?? 100),
    dailyRate: p?.dailyRate != null ? String(p.dailyRate) : '',
    skills: (p?.skills ?? []).join(', '),
  };
}
function craftsOf(p: D.PersonDTO | null): CraftDraft {
  return {
    primaryCraft: p?.primaryCraft ?? '',
    secondary: (p?.secondaryCrafts ?? []).map((c, i) => ({
      key: `${c.craftId}-${i}`,
      craftId: c.craftId,
      proficiency: c.proficiency,
      maxPct: String(c.maxPct),
    })),
  };
}

export function PersonDrawer({
  snapshot: s,
  personId,
  onClose,
  initialTab = 'profile',
}: {
  snapshot: D.WorkspaceSnapshot;
  personId: string | null;
  onClose(): void;
  initialTab?: 'profile' | 'crafts' | 'load' | 'bookings' | 'identity';
}) {
  if (!personId) return null;
  const person = personId === 'new' ? null : (s.people.find((p) => p.id === personId) ?? null);
  if (personId !== 'new' && !person)
    return (
      <Drawer open title="Person not found" onClose={onClose}>
        <EmptyState
          icon={UserRound}
          title="This person no longer exists"
          body="They may have been removed. Close this panel to continue."
        />
      </Drawer>
    );
  return <PersonDrawerInner key={personId} s={s} person={person} onClose={onClose} initialTab={initialTab} />;
}

function PersonDrawerInner({
  s,
  person,
  onClose,
  initialTab,
}: {
  s: D.WorkspaceSnapshot;
  person: D.PersonDTO | null;
  onClose(): void;
  initialTab: TabId;
}) {
  const { can, isOwnPerson, thresholds } = useWorkspace();
  const quarters = useQuarters();
  const m = useMutations();
  const { busy, run } = useAction();
  const { confirm, dialog } = useConfirm();
  const idx = useMemo(() => indexSnapshot(s), [s]);
  const isNew = !person;
  const canEdit = can('people.write');
  const own = !!person && isOwnPerson(person.id) && can('people.write.own');
  const [tab, setTab] = useState<TabId>(initialTab);
  const [profile, setProfile] = useState<ProfileDraft>(() => profileOf(person));
  const [crafts, setCrafts] = useState<CraftDraft>(() => craftsOf(person));
  const [tried, setTried] = useState(false);
  const [editBooking, setEditBooking] = useState<{
    resourceId: string;
    projectId: string;
    craftId: string | null;
  } | null>(null);

  const baseProfile = useMemo(() => profileOf(person), [person]);
  const baseCrafts = useMemo(() => craftsOf(person), [person]);
  const dirty =
    JSON.stringify(profile) !== JSON.stringify(baseProfile) || JSON.stringify(crafts) !== JSON.stringify(baseCrafts);

  const row = useMemo(
    () => (person ? buildPeopleRows(s, quarters, thresholds).find((r) => r.person.id === person.id) : undefined),
    [s, quarters, thresholds, person],
  );
  const activeCrafts = s.crafts.filter((c) => !c.archived).sort((a, b) => a.sortOrder - b.sortOrder);
  const craftOptions = activeCrafts.map((c) => ({ value: c.id, label: `${c.name} (${c.short})` }));

  const profileErrors: Partial<Record<keyof ProfileDraft, string>> = {};
  if (!profile.name.trim()) profileErrors.name = 'Enter a name';
  if (profile.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(profile.email)) profileErrors.email = 'Enter a valid email';
  const t = Number(profile.targetUtil);
  if (!Number.isFinite(t) || t < 0 || t > 150) profileErrors.targetUtil = 'Enter 0–150';
  if (profile.dailyRate && !(Number(profile.dailyRate) >= 0)) profileErrors.dailyRate = 'Enter a positive number';
  const craftErrors = crafts.secondary.map((c, i) => {
    if (!c.craftId) return 'Choose a craft';
    if (c.craftId === crafts.primaryCraft) return 'Already their above-the-table craft';
    if (crafts.secondary.findIndex((x) => x.craftId === c.craftId) !== i) return 'Listed twice';
    const cap = Number(c.maxPct);
    if (!Number.isFinite(cap) || cap < 0 || cap > 100) return 'Cap must be 0–100';
    return null;
  });
  const hasErrors = Object.keys(profileErrors).length > 0 || craftErrors.some(Boolean);

  const secondaryDto = (): D.SecondaryCraftDTO[] =>
    crafts.secondary.map((c) => ({ craftId: c.craftId, proficiency: c.proficiency, maxPct: Number(c.maxPct) }));

  const save = async () => {
    setTried(true);
    if (hasErrors) {
      setTab(Object.keys(profileErrors).length ? 'profile' : 'crafts');
      return;
    }
    const patch: Partial<D.PersonDTO> = {
      name: profile.name.trim(),
      email: profile.email.trim() || null,
      role: profile.role.trim(),
      type: profile.type,
      location: profile.location.trim() || null,
      chapterId: profile.chapterId || null,
      teamId: profile.teamId || null,
      homeTribeId: profile.homeTribeId || null,
      targetUtil: Number(profile.targetUtil),
      dailyRate: profile.dailyRate ? Number(profile.dailyRate) : null,
      skills: profile.skills
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
      primaryCraft: crafts.primaryCraft || null,
      secondaryCrafts: secondaryDto(),
    };
    if (isNew) {
      const res = await run('save', () => m.people.create({ ...patch, name: patch.name ?? '' }), {
        success: `${patch.name} added`,
      });
      if (res.ok) onClose();
    } else if (person) {
      const res = await run('save', () => m.people.update(person.id, { ...patch, version: person.version }), {
        success: 'Saved',
        undo: true,
      });
      if (res.ok) onClose();
    }
  };

  const suggest = async () => {
    if (!person) return;
    setTried(true);
    if (craftErrors.some(Boolean)) return;
    const res = await run('suggest', () => m.people.requestCraftChange(person.id, secondaryDto()), {
      success: 'Change sent for approval',
      body: 'Your chapter lead or a Planner will review it.',
    });
    if (res.ok) onClose();
  };

  const requestClose = async () => {
    if (dirty && (canEdit || own)) {
      const ok = await confirm({
        title: 'Discard changes?',
        body: 'Your edits to this person have not been saved.',
        confirmLabel: 'Discard',
        tone: 'danger',
      });
      if (!ok) return;
    }
    onClose();
  };

  const pendingRequest = person
    ? s.craftRequests.find((r) => r.personId === person.id && r.status === 'pending')
    : undefined;
  const chapterLead = person?.chapterId
    ? idx.people.get(idx.chapters.get(person.chapterId)?.leadPersonId ?? '')
    : undefined;

  const tabs: Array<{ id: TabId; label: string }> = isNew
    ? [
        { id: 'profile', label: 'Profile' },
        { id: 'crafts', label: 'Crafts' },
      ]
    : [
        { id: 'profile', label: 'Profile' },
        { id: 'crafts', label: 'Crafts' },
        { id: 'load', label: 'Load' },
        { id: 'bookings', label: 'Bookings' },
        { id: 'identity', label: 'Identity' },
      ];

  const footer =
    canEdit && (tab === 'profile' || tab === 'crafts') ? (
      <>
        <Button onClick={() => void requestClose()}>Cancel</Button>
        <Button variant="primary" loading={busy === 'save'} onClick={() => void save()}>
          {isNew ? 'Add person' : 'Save'}
        </Button>
      </>
    ) : own && tab === 'crafts' ? (
      <>
        <Button onClick={() => void requestClose()}>Cancel</Button>
        <Button
          variant="primary"
          icon={Send}
          loading={busy === 'suggest'}
          disabled={!dirty || !!pendingRequest}
          onClick={() => void suggest()}
        >
          Suggest changes
        </Button>
      </>
    ) : undefined;

  const readOnly = !canEdit;
  const tribeOptions = s.tribes.filter((x) => !x.archived).map((x) => ({ value: x.id, label: x.name }));
  return (
    <>
      <Drawer
        open
        title={isNew ? 'Add person' : (person?.name ?? '')}
        subtitle={isNew ? 'Profile and crafts' : [person?.role, person?.type].filter(Boolean).join(' · ')}
        headerExtra={!isNew && person ? <Avatar name={person.name} size={40} /> : undefined}
        onClose={() => void requestClose()}
        tabs={<Tabs idPrefix="person" label="Person sections" items={tabs} value={tab} onChange={setTab} />}
        footer={footer}
      >
        <TabPanel idPrefix="person" value={tab}>
          {tab === 'profile' && (
            <div className="b2-form">
              <FormField label="Name" htmlFor="pf-name" error={tried ? profileErrors.name : null}>
                <TextField
                  id="pf-name"
                  value={profile.name}
                  readOnly={readOnly}
                  invalid={tried && !!profileErrors.name}
                  onChange={(v) => setProfile({ ...profile, name: v })}
                />
              </FormField>
              <FormField label="Email" htmlFor="pf-email" optional error={tried ? profileErrors.email : null}>
                <TextField
                  id="pf-email"
                  type="email"
                  value={profile.email}
                  readOnly={readOnly}
                  invalid={tried && !!profileErrors.email}
                  onChange={(v) => setProfile({ ...profile, email: v })}
                />
              </FormField>
              <FormField label="Job title" htmlFor="pf-role" optional>
                <TextField
                  id="pf-role"
                  value={profile.role}
                  readOnly={readOnly}
                  onChange={(v) => setProfile({ ...profile, role: v })}
                />
              </FormField>
              <FormField label="Type" htmlFor="pf-type">
                <Select
                  id="pf-type"
                  value={profile.type}
                  disabled={readOnly}
                  onChange={(v) => setProfile({ ...profile, type: v as D.PersonType })}
                  options={['Permanent', 'Contractor', 'Part-Time'].map((x) => ({ value: x, label: x }))}
                />
              </FormField>
              <FormField label="Location" htmlFor="pf-loc" optional>
                <TextField
                  id="pf-loc"
                  value={profile.location}
                  readOnly={readOnly}
                  onChange={(v) => setProfile({ ...profile, location: v })}
                />
              </FormField>
              <FormField label="Chapter" htmlFor="pf-chapter" optional>
                <Select
                  id="pf-chapter"
                  value={profile.chapterId}
                  disabled={readOnly}
                  placeholder="No chapter"
                  onChange={(v) => setProfile({ ...profile, chapterId: v })}
                  options={s.chapters.filter((c) => !c.archived).map((c) => ({ value: c.id, label: c.name }))}
                />
              </FormField>
              <FormField label="Team" htmlFor="pf-team" optional>
                <Select
                  id="pf-team"
                  value={profile.teamId}
                  disabled={readOnly}
                  placeholder="No team"
                  onChange={(v) => setProfile({ ...profile, teamId: v })}
                  options={s.teams.filter((c) => !c.archived).map((c) => ({ value: c.id, label: c.name }))}
                />
              </FormField>
              <FormField label="Home tribe" htmlFor="pf-tribe" optional>
                <Select
                  id="pf-tribe"
                  value={profile.homeTribeId}
                  disabled={readOnly}
                  placeholder="No home tribe"
                  onChange={(v) => setProfile({ ...profile, homeTribeId: v })}
                  options={tribeOptions}
                />
              </FormField>
              <FormField
                label="Target utilisation"
                htmlFor="pf-target"
                help="100% means fully planned. Part-time people use a lower target."
                error={tried ? profileErrors.targetUtil : null}
              >
                <NumberField
                  id="pf-target"
                  unit="%"
                  value={profile.targetUtil}
                  min={0}
                  max={150}
                  step={5}
                  disabled={readOnly}
                  invalid={tried && !!profileErrors.targetUtil}
                  onChange={(v) => setProfile({ ...profile, targetUtil: v })}
                />
              </FormField>
              <FormField label="Daily rate" htmlFor="pf-rate" optional error={tried ? profileErrors.dailyRate : null}>
                <NumberField
                  id="pf-rate"
                  value={profile.dailyRate}
                  min={0}
                  step={50}
                  disabled={readOnly}
                  onChange={(v) => setProfile({ ...profile, dailyRate: v })}
                />
              </FormField>
              <FormField
                label="Skills"
                htmlFor="pf-skills"
                optional
                help="Comma-separated; searchable on People."
                className="b2-form__full"
              >
                <TextField
                  id="pf-skills"
                  value={profile.skills}
                  readOnly={readOnly}
                  onChange={(v) => setProfile({ ...profile, skills: v })}
                />
              </FormField>
            </div>
          )}

          {tab === 'crafts' && (
            <div className="b2-stack">
              {pendingRequest && (
                <Banner tone="info" title="A craft change is waiting for approval">
                  Submitted by {pendingRequest.submittedBy.name}{' '}
                  {fmt.relative(pendingRequest.submittedAt, s.serverTime)}. Pending approval by{' '}
                  {chapterLead?.name ?? 'a Planner'}.
                </Banner>
              )}
              {own && !canEdit && !pendingRequest && (
                <Banner tone="neutral">
                  You can suggest changes to your below-the-table crafts. Your chapter lead approves them.
                </Banner>
              )}
              <FormField
                label="Above the table"
                htmlFor="pc-primary"
                help="The craft this person is hired for. One per person."
              >
                <Select
                  id="pc-primary"
                  value={crafts.primaryCraft}
                  disabled={!canEdit}
                  placeholder="Not set"
                  onChange={(v) => setCrafts({ ...crafts, primaryCraft: v })}
                  options={craftOptions}
                />
              </FormField>
              <div className="b2-stack b2-stack--sm">
                <div className="b2-row b2-row--between">
                  <span className="b2-field__label">Below the table</span>
                  <span className="b2-caption">L1 can assist · L2 can own with support · L3 can own independently</span>
                </div>
                {crafts.secondary.length === 0 && <p className="b2-muted">No below-the-table crafts yet.</p>}
                {crafts.secondary.map((c, i) => (
                  <div key={c.key} className="pd-craft-row">
                    <Select
                      ariaLabel={`Below-the-table craft ${i + 1}`}
                      value={c.craftId}
                      disabled={!canEdit && !own}
                      placeholder="Choose a craft"
                      invalid={tried && !!craftErrors[i]}
                      onChange={(v) =>
                        setCrafts({
                          ...crafts,
                          secondary: crafts.secondary.map((x) => (x.key === c.key ? { ...x, craftId: v } : x)),
                        })
                      }
                      options={craftOptions}
                    />
                    <Select
                      ariaLabel={`Proficiency for craft ${i + 1}`}
                      value={String(c.proficiency)}
                      disabled={!canEdit && !own}
                      onChange={(v) =>
                        setCrafts({
                          ...crafts,
                          secondary: crafts.secondary.map((x) =>
                            x.key === c.key ? { ...x, proficiency: Number(v) as D.Proficiency } : x,
                          ),
                        })
                      }
                      options={([1, 2, 3] as D.Proficiency[]).map((l) => ({
                        value: String(l),
                        label: `L${l} · ${fmt.PROFICIENCY_LABEL[l]}`,
                      }))}
                    />
                    <NumberField
                      id={`pc-cap-${c.key}`}
                      ariaLabel={`Cap for craft ${i + 1}`}
                      unit="%"
                      value={c.maxPct}
                      min={0}
                      max={100}
                      step={5}
                      disabled={!canEdit && !own}
                      onChange={(v) =>
                        setCrafts({
                          ...crafts,
                          secondary: crafts.secondary.map((x) => (x.key === c.key ? { ...x, maxPct: v } : x)),
                        })
                      }
                    />
                    {(canEdit || own) && (
                      <IconButton
                        icon={Trash2}
                        label={`Remove craft ${i + 1}`}
                        onClick={() =>
                          setCrafts({ ...crafts, secondary: crafts.secondary.filter((x) => x.key !== c.key) })
                        }
                      />
                    )}
                    {tried && craftErrors[i] && (
                      <span className="b2-field__error pd-craft-row__err">{craftErrors[i]}</span>
                    )}
                  </div>
                ))}
                {(canEdit || own) && (
                  <div>
                    <Button
                      size="sm"
                      icon={Plus}
                      onClick={() =>
                        setCrafts({
                          ...crafts,
                          secondary: [
                            ...crafts.secondary,
                            {
                              key: `new-${crafts.secondary.length}-${crafts.secondary.map((x) => x.key).join('')}`,
                              craftId: '',
                              proficiency: 2,
                              maxPct: '40',
                            },
                          ],
                        })
                      }
                    >
                      Add below-the-table craft
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'load' && row && (
            <div className="b2-stack">
              <ul className="b2-list">
                {row.quarters.map((q, i) => (
                  <li key={q.key} className="pd-load-row">
                    <span className="pd-load-row__q">
                      <span className="b2-strong">{quarters[i]?.label}</span>
                      <span className="b2-caption">{quarters[i]?.calendarLabel}</span>
                    </span>
                    <span className="pd-load-row__bar">
                      <QuarterLoadBar
                        size="lg"
                        above={q.above}
                        below={q.below}
                        undeclared={q.undeclared}
                        target={person?.targetUtil ?? 100}
                        label={quarters[i]?.label ?? q.key}
                      />
                    </span>
                    <BandCell value={q.relativePct} band={q.band} label={quarters[i]?.label} />
                  </li>
                ))}
              </ul>
              <div className="b2-table-wrap">
                <table className="b2-table b2-table--compact">
                  <caption className="b2-caption">
                    Load by kind of work (% of a full-time week, FTE in brackets)
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Quarter</th>
                      <th scope="col" className="b2-num">
                        Above
                      </th>
                      <th scope="col" className="b2-num">
                        Below
                      </th>
                      <th scope="col" className="b2-num">
                        Undeclared
                      </th>
                      <th scope="col" className="b2-num">
                        Free
                      </th>
                      <th scope="col" className="b2-num">
                        Of target
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.quarters.map((q, i) => (
                      <tr key={q.key}>
                        <th scope="row">{quarters[i]?.label}</th>
                        <td className="b2-num">
                          {fmt.pct(q.above)} <span className="b2-caption">({fmt.fte(q.above / 100)})</span>
                        </td>
                        <td className="b2-num">
                          {fmt.pct(q.below)} <span className="b2-caption">({fmt.fte(q.below / 100)})</span>
                        </td>
                        <td className="b2-num">
                          {fmt.pct(q.undeclared)} <span className="b2-caption">({fmt.fte(q.undeclared / 100)})</span>
                        </td>
                        <td className="b2-num">
                          {fmt.pct(q.free)} <span className="b2-caption">({fmt.fte(q.free / 100)})</span>
                        </td>
                        <td className="b2-num">{fmt.pct(q.relativePct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'bookings' && person && <BookingsTab s={s} person={person} onEdit={setEditBooking} />}

          {tab === 'identity' && person && <IdentityTab s={s} person={person} />}
        </TabPanel>
      </Drawer>
      <BookingDatesDialog snapshot={s} booking={editBooking} onClose={() => setEditBooking(null)} />
      {dialog}
    </>
  );
}

function BookingsTab({
  s,
  person,
  onEdit,
}: {
  s: D.WorkspaceSnapshot;
  person: D.PersonDTO;
  onEdit(b: { resourceId: string; projectId: string; craftId: string | null }): void;
}) {
  const { can } = useWorkspace();
  const m = useMutations();
  const { busy, run } = useAction();
  const idx = useMemo(() => indexSnapshot(s), [s]);
  const list = s.allocations
    .filter((a) => a.resourceId === person.id)
    .sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''));
  if (list.length === 0)
    return <EmptyState icon={CalendarRange} title="No bookings" body="This person is not booked on any project yet." />;
  return (
    <div className="b2-table-wrap">
      <table className="b2-table b2-table--compact">
        <caption className="b2-sr-only">Bookings for {person.name}</caption>
        <thead>
          <tr>
            <th scope="col">Project</th>
            <th scope="col">Craft</th>
            <th scope="col" className="b2-num">
              %
            </th>
            <th scope="col">Dates</th>
            <th scope="col">State</th>
            <th scope="col">Source</th>
            <th scope="col">
              <span className="b2-sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {list.map((a) => {
            const project = idx.projects.get(a.projectId);
            const craftId = a.craftId ?? person.primaryCraft;
            const craft = craftId ? idx.crafts.get(craftId) : null;
            const sec = person.secondaryCrafts.find((x) => x.craftId === craftId);
            const via = craftId === person.primaryCraft ? 'above' : sec ? 'below' : 'undeclared';
            return (
              <tr key={a.id}>
                <th scope="row" className="b2-ellipsis">
                  {project?.name ?? a.projectId}
                </th>
                <td>
                  <CraftChip craft={craft} via={via} proficiency={sec?.proficiency} />
                </td>
                <td className="b2-num">{fmt.pct(a.percentage)}</td>
                <td className="b2-tnum">
                  {fmt.dateRange(a.startDate ?? project?.startDate, a.endDate ?? project?.endDate)}
                </td>
                <td>
                  <BookingStatePill state={a.state} />
                </td>
                <td>
                  <ProvenanceTag source={a.source} />
                </td>
                <td className="b2-num">
                  <span className="b2-row pd-actions">
                    {a.state === 'tentative' && can('allocations.write') && (
                      <>
                        <IconButton
                          icon={Check}
                          size="sm"
                          label="Confirm booking"
                          disabled={busy !== null}
                          onClick={() =>
                            void run(`c${a.id}`, () => m.allocations.respond(a.id, { decision: 'accept' }), {
                              success: 'Booking confirmed',
                              undo: true,
                            })
                          }
                        />
                        <IconButton
                          icon={X}
                          size="sm"
                          label="Decline booking"
                          disabled={busy !== null}
                          onClick={() =>
                            void run(`d${a.id}`, () => m.allocations.respond(a.id, { decision: 'decline' }), {
                              success: 'Booking declined',
                              undo: true,
                            })
                          }
                        />
                      </>
                    )}
                    {can('allocations.write') && a.state !== 'declined' && (
                      <Button
                        size="sm"
                        variant="subtle"
                        onClick={() =>
                          onEdit({ resourceId: person.id, projectId: a.projectId, craftId: craftId ?? null })
                        }
                      >
                        Edit dates
                      </Button>
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function IdentityTab({ s, person }: { s: D.WorkspaceSnapshot; person: D.PersonDTO }) {
  const { can } = useWorkspace();
  const wsPath = useWsPath();
  const delivery = useDelivery(s);
  const ids = delivery.identities.filter((i) => i.personId === person.id);
  return (
    <div className="b2-stack">
      <dl className="b2-dl">
        <dt>Login</dt>
        <dd>
          {person.linkedUserId ? (
            <StatusPill tone="info" icon={Link2}>
              Linked
            </StatusPill>
          ) : (
            <span className="b2-muted">Not linked to a login. Members and roles links people to logins.</span>
          )}
        </dd>
        <dt>Email</dt>
        <dd>{person.email ?? <span className="b2-muted">None</span>}</dd>
        <dt>Skills</dt>
        <dd>
          {person.skills.length ? (
            <span className="b2-chips">
              {person.skills.map((x) => (
                <Tag key={x}>{x}</Tag>
              ))}
            </span>
          ) : (
            <span className="b2-muted">None</span>
          )}
        </dd>
      </dl>
      <div className="b2-table-wrap">
        <table className="b2-table b2-table--compact">
          <caption className="b2-caption">Jira and Planview identities</caption>
          <thead>
            <tr>
              <th scope="col">Provider</th>
              <th scope="col">Display name</th>
              <th scope="col">Matched by</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {ids.length === 0 ? (
              <tr>
                <td colSpan={4} className="b2-muted">
                  No Jira or Planview identity linked yet.
                </td>
              </tr>
            ) : (
              ids.map((i) => (
                <tr key={`${i.provider}:${i.externalId}`}>
                  <td>{i.provider === 'jira' ? 'Jira' : 'Planview'}</td>
                  <td>{i.displayName}</td>
                  <td>
                    {i.matchMethod === 'accountId'
                      ? 'Account id'
                      : i.matchMethod === 'email'
                        ? 'Email'
                        : i.matchMethod === 'name'
                          ? 'Name'
                          : 'Manual'}
                  </td>
                  <td>
                    {i.confirmed ? (
                      <StatusPill tone="success">Confirmed</StatusPill>
                    ) : (
                      <StatusPill tone="warning">Suggested</StatusPill>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {can('integrations.run') && (
        <div>
          <Link className="b2-btn b2-btn--secondary b2-btn--sm" to={`${wsPath('delivery/jira-planview')}?tab=people`}>
            Change in people mapping
          </Link>
        </div>
      )}
    </div>
  );
}
