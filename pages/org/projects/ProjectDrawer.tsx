/** Project drawer (PPL-07#AC2–4, JI-06#AC1): Details, Demand, Staffing, Delivery, Links. `?project=<id>|new`. */
import { useMemo, useState } from 'react';
import { Activity, CalendarRange, FolderKanban, Lock, Pencil, Users } from 'lucide-react';
import type * as D from '../../../shared/contracts/dto';
import { useMutations, useQuarters, useSession, useWorkspace } from '../../../state';
import { buildAllocationGrid, buildDemandGrid } from '../../../utils/viewModels';
import {
  Banner,
  BookingStatePill,
  Button,
  CraftChip,
  cx,
  Drawer,
  EmptyState,
  fmt,
  FormField,
  indexSnapshot,
  PersonLabel,
  ProvenanceTag,
  Select,
  StatusPill,
  TabPanel,
  Tabs,
  TextField,
  useAction,
  useConfirm,
  Textarea,
  LinkButton,
} from '../../../components/ui';
import { useWsPath } from '../../../components/shell/workspacePath';
import { DemandCellDialog } from '../../plan/demand/DemandCellDialog';
import { deliverySignalOf as deliverySignal, useDelivery } from '../../../state';

type TabId = 'details' | 'demand' | 'staffing' | 'delivery' | 'links';
const STATUSES: D.ProjectStatus[] = ['Planning', 'Active', 'On Hold', 'Completed'];
const PRIORITIES: D.Priority[] = ['Critical', 'High', 'Medium', 'Low'];

interface Draft {
  name: string;
  tribeId: string;
  stage: string;
  status: D.ProjectStatus;
  priority: D.Priority;
  startDate: string;
  endDate: string;
  initiatedOn: string;
  ownerUserId: string;
  description: string;
  jiraKey: string;
}
const draftOf = (p: D.ProjectDTO | null): Draft => ({
  name: p?.name ?? '',
  tribeId: p?.tribeId ?? '',
  stage: p?.stage ?? 'Initiated',
  status: p?.status ?? 'Planning',
  priority: p?.priority ?? 'Medium',
  startDate: p?.startDate ?? '',
  endDate: p?.endDate ?? '',
  initiatedOn: p?.initiatedOn ?? '',
  ownerUserId: p?.ownerUserId ?? '',
  description: p?.description ?? '',
  jiraKey: p?.jiraKey ?? '',
});

export function ProjectDrawer({
  snapshot: s,
  projectId,
  onClose,
}: {
  snapshot: D.WorkspaceSnapshot;
  projectId: string | null;
  onClose(): void;
}) {
  if (!projectId) return null;
  const project = projectId === 'new' ? null : (s.projects.find((p) => p.id === projectId) ?? null);
  if (projectId !== 'new' && !project)
    return (
      <Drawer open title="Project not found" onClose={onClose}>
        <EmptyState
          icon={FolderKanban}
          title="This project no longer exists"
          description="It may have been removed. Close this panel to continue."
        />
      </Drawer>
    );
  return <Inner key={projectId} s={s} project={project} onClose={onClose} />;
}

function Inner({ s, project, onClose }: { s: D.WorkspaceSnapshot; project: D.ProjectDTO | null; onClose(): void }) {
  const { can } = useWorkspace();
  const { me } = useSession();
  const m = useMutations();
  const { busy, run } = useAction();
  const confirm = useConfirm();
  const isNew = !project;
  const canEdit = can('projects.write');
  const [tab, setTab] = useState<TabId>('details');
  const [draft, setDraft] = useState<Draft>(() => draftOf(project));
  const [tried, setTried] = useState(false);
  const base = useMemo(() => draftOf(project), [project]);
  const dirty = JSON.stringify(base) !== JSON.stringify(draft);
  const lockedDates = !!project && project.source === 'planview' && s.org.planning.planviewOwnership === 'locked';

  const errors: Partial<Record<keyof Draft, string>> = {};
  if (!draft.name.trim()) errors.name = 'Enter a name';
  if (!draft.tribeId) errors.tribeId = 'Choose a tribe';
  if (draft.startDate && draft.endDate && draft.endDate < draft.startDate)
    errors.endDate = 'End date must be on or after the start date';
  if (draft.jiraKey && !/^[A-Z][A-Z0-9_]{1,9}$/.test(draft.jiraKey))
    errors.jiraKey = 'Use the Jira project key, e.g. PHX';

  const save = async () => {
    setTried(true);
    if (Object.keys(errors).length) {
      setTab('details');
      return;
    }
    const patch: Partial<D.ProjectDTO> = {
      name: draft.name.trim(),
      tribeId: draft.tribeId || null,
      stage: (draft.stage || null) as D.ProjectStage | null,
      status: draft.status,
      priority: draft.priority,
      initiatedOn: draft.initiatedOn || null,
      ownerUserId: draft.ownerUserId || null,
      description: draft.description,
      jiraKey: draft.jiraKey || null,
      ...(lockedDates ? {} : { startDate: draft.startDate || null, endDate: draft.endDate || null }),
    };
    const res = project
      ? await run('save', () => m.projects.update(project.id, { ...patch, version: project.version }), {
          success: 'Saved',
          undo: true,
        })
      : await run('save', () => m.projects.create({ ...patch, name: patch.name ?? '' }), {
          success: `${patch.name} added`,
        });
    if (res.ok) onClose();
  };
  const requestClose = async () => {
    if (dirty && canEdit) {
      const ok = await confirm({
        title: 'Discard changes?',
        body: 'Your edits to this project have not been saved.',
        confirmLabel: 'Discard',
        tone: 'danger',
      });
      if (!ok) return;
    }
    onClose();
  };

  const tabs: Array<{ id: TabId; label: string }> = isNew
    ? [{ id: 'details', label: 'Details' }]
    : [
        { id: 'details', label: 'Details' },
        { id: 'demand', label: 'Demand' },
        { id: 'staffing', label: 'Staffing' },
        { id: 'delivery', label: 'Delivery' },
        { id: 'links', label: 'Links' },
      ];
  const ro = !canEdit;
  const owners = [{ value: me?.user.id ?? '', label: `${me?.user.name ?? 'Me'} (you)` }].filter((o) => o.value);
  if (project?.ownerUserId && !owners.some((o) => o.value === project.ownerUserId))
    owners.push({ value: project.ownerUserId, label: 'Current owner' });

  return (
    <>
      <Drawer
        open
        title={isNew ? 'Add project' : (project?.name ?? '')}
        subtitle={
          isNew
            ? 'Projects need a tribe so demand and delivery roll up correctly.'
            : [s.tribes.find((t) => t.id === project?.tribeId)?.name, project?.stage, project?.status]
                .filter(Boolean)
                .join(' · ')
        }
        onClose={() => void requestClose()}
        tabs={<Tabs idBase="project" label="Project sections" tabs={tabs} value={tab} onChange={setTab} />}
        footer={
          canEdit && tab === 'details' ? (
            <>
              <Button onClick={() => void requestClose()}>Cancel</Button>
              <Button variant="primary" loading={busy === 'save'} onClick={() => void save()}>
                {isNew ? 'Add project' : 'Save'}
              </Button>
            </>
          ) : undefined
        }
      >
        <TabPanel idBase="project" tabId={tab}>
          {tab === 'details' && (
            <div className="pcp-stack">
              {lockedDates && (
                <Banner tone="info" title="Imported from Planview">
                  Planview owns this project&apos;s existence and dates. Craft demand and PMO bookings are managed here.
                </Banner>
              )}
              <div className="pcp-form-grid">
                <FormField label="Name" id="pj-name" error={tried ? errors.name : null} className="pcp-form-grid__full">
                  <TextField
                    id="pj-name"
                    value={draft.name}
                    readOnly={ro}
                    invalid={tried && !!errors.name}
                    onValueChange={(v) => setDraft({ ...draft, name: v })}
                  />
                </FormField>
                <FormField label="Tribe" id="pj-tribe" error={tried ? errors.tribeId : null}>
                  <Select
                    id="pj-tribe"
                    value={draft.tribeId}
                    disabled={ro}
                    placeholder="Choose a tribe"
                    invalid={tried && !!errors.tribeId}
                    onValueChange={(v) => setDraft({ ...draft, tribeId: v })}
                    options={s.tribes.filter((t) => !t.archived).map((t) => ({ value: t.id, label: t.name }))}
                  />
                </FormField>
                <FormField label="Stage" id="pj-stage">
                  <Select
                    id="pj-stage"
                    value={draft.stage}
                    disabled={ro}
                    onValueChange={(v) => setDraft({ ...draft, stage: v })}
                    options={fmt.STAGE_ORDER.map((x) => ({ value: x, label: x }))}
                  />
                </FormField>
                <FormField label="Status" id="pj-status">
                  <Select
                    id="pj-status"
                    value={draft.status}
                    disabled={ro}
                    onValueChange={(v) => setDraft({ ...draft, status: v as D.ProjectStatus })}
                    options={STATUSES.map((x) => ({ value: x, label: x }))}
                  />
                </FormField>
                <FormField label="Priority" id="pj-priority">
                  <Select
                    id="pj-priority"
                    value={draft.priority}
                    disabled={ro}
                    onValueChange={(v) => setDraft({ ...draft, priority: v as D.Priority })}
                    options={PRIORITIES.map((x) => ({ value: x, label: x }))}
                  />
                </FormField>
                <FormField
                  label="Start date"
                  id="pj-start"
                  optional
                  help={lockedDates ? 'Managed in Planview' : undefined}
                >
                  <TextField
                    id="pj-start"
                    type="date"
                    value={draft.startDate}
                    readOnly={ro || lockedDates}
                    onValueChange={(v) => setDraft({ ...draft, startDate: v })}
                  />
                </FormField>
                <FormField
                  label="End date"
                  id="pj-end"
                  optional
                  error={tried ? errors.endDate : null}
                  help={lockedDates ? 'Managed in Planview' : undefined}
                >
                  <TextField
                    id="pj-end"
                    type="date"
                    value={draft.endDate}
                    readOnly={ro || lockedDates}
                    invalid={tried && !!errors.endDate}
                    onValueChange={(v) => setDraft({ ...draft, endDate: v })}
                  />
                </FormField>
                <FormField
                  label="Initiated on"
                  id="pj-init"
                  optional
                  help="When the tribe initiated the project; drives demand capture alerts."
                >
                  <TextField
                    id="pj-init"
                    type="date"
                    value={draft.initiatedOn}
                    readOnly={ro}
                    onValueChange={(v) => setDraft({ ...draft, initiatedOn: v })}
                  />
                </FormField>
                <FormField label="Owner" id="pj-owner" optional>
                  <Select
                    id="pj-owner"
                    value={draft.ownerUserId}
                    disabled={ro}
                    placeholder="No owner"
                    onValueChange={(v) => setDraft({ ...draft, ownerUserId: v })}
                    options={owners}
                  />
                </FormField>
                <FormField label="Jira project key" id="pj-jira" optional error={tried ? errors.jiraKey : null}>
                  <TextField
                    id="pj-jira"
                    value={draft.jiraKey}
                    readOnly={ro}
                    invalid={tried && !!errors.jiraKey}
                    onValueChange={(v) => setDraft({ ...draft, jiraKey: v.toUpperCase() })}
                  />
                </FormField>
                <FormField label="Description" id="pj-desc" optional className="pcp-form-grid__full">
                  <Textarea
                    id="pj-desc"
                    rows={3}
                    value={draft.description}
                    readOnly={ro}
                    onValueChange={(v) => setDraft({ ...draft, description: v })}
                  />
                </FormField>
              </div>
            </div>
          )}
          {tab === 'demand' && project && <DemandTab s={s} project={project} />}
          {tab === 'staffing' && project && <StaffingTab s={s} project={project} />}
          {tab === 'delivery' && project && <DeliveryTab s={s} project={project} />}
          {tab === 'links' && project && (
            <dl className="pcp-dl">
              <dt>Source</dt>
              <dd>
                <ProvenanceTag source={project.source} />
              </dd>
              <dt>Planview id</dt>
              <dd className="pcp-tnum">
                {project.planviewId ?? <span className="pcp-text-secondary">Not linked</span>}
              </dd>
              <dt>Jira project</dt>
              <dd className="pcp-tnum">
                {project.jiraKey ?? (
                  <span className="pcp-text-secondary">
                    Not linked. Add the key on Details, then map it in Jira & Planview.
                  </span>
                )}
              </dd>
            </dl>
          )}
        </TabPanel>
      </Drawer>
    </>
  );
}

function DemandTab({ s, project }: { s: D.WorkspaceSnapshot; project: D.ProjectDTO }) {
  const quarters = useQuarters();
  const { can } = useWorkspace();
  const idx = useMemo(() => indexSnapshot(s), [s]);
  const row = useMemo(
    () => buildDemandGrid(s, quarters).find((d) => d.project.id === project.id),
    [s, quarters, project.id],
  );
  const [edit, setEdit] = useState<string | null>(null);
  if (!row) return null;
  return (
    <>
      <div className="pcp-tbl-wrap">
        <table className="pcp-tbl">
          <caption className="pcp-sr-only">Demand by quarter</caption>
          <thead>
            <tr>
              <th scope="col">Quarter</th>
              <th scope="col">Craft lines</th>
              <th scope="col" className="pcp-num">
                Demand
              </th>
              <th scope="col" className="pcp-num">
                Staffed
              </th>
              <th scope="col" className="pcp-num">
                Gap
              </th>
              <th scope="col">
                <span className="pcp-sr-only">Edit</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {row.cells.map((c, i) => (
              <tr key={c.quarterKey}>
                <th scope="row">
                  {quarters[i]?.label}{' '}
                  <span className="pcp-caption pcp-text-tertiary">{quarters[i]?.calendarLabel}</span>
                </th>
                <td>
                  <span className="pcp-chips">
                    {c.lines.length === 0 && <span className="pcp-text-tertiary">None</span>}
                    {c.lines.map((l) => (
                      <span
                        key={l.id}
                        className={cx(
                          'pcp-craft-chip',
                          l.status === 'Confirmed'
                            ? 'pcp-craft-chip--demand-confirmed'
                            : 'pcp-craft-chip--demand-forecast',
                        )}
                        title={l.status}
                      >
                        {idx.crafts.get(l.craftId)?.short} {fmt.fte(l.fte)}
                      </span>
                    ))}
                  </span>
                </td>
                <td className="pcp-num">{fmt.fte(c.demandFte)}</td>
                <td className="pcp-num">{fmt.fte(c.staffedFte)}</td>
                <td className="pcp-num">
                  {c.gapFte > 0.04 ? (
                    <span className="pj-gap">{fmt.fte(c.gapFte)}</span>
                  ) : (
                    <span className="pcp-text-tertiary">0.0</span>
                  )}
                </td>
                <td className="pcp-num">
                  {can('demand.write') && (
                    <Button size="sm" variant="subtle" iconBefore={Pencil} onClick={() => setEdit(c.quarterKey)}>
                      Edit
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <DemandCellDialog snapshot={s} projectId={project.id} quarterKey={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function StaffingTab({ s, project }: { s: D.WorkspaceSnapshot; project: D.ProjectDTO }) {
  const quarters = useQuarters();
  const { thresholds } = useWorkspace();
  const idx = useMemo(() => indexSnapshot(s), [s]);
  const rows = useMemo(() => {
    const g = buildAllocationGrid(s, quarters, {
      groupBy: 'none',
      pivot: 'project',
      includeTentative: true,
      thresholds,
    });
    return g.groups.flatMap((x) => x.rows).filter((r) => r.kind === 'booking' && r.projectId === project.id);
  }, [s, quarters, thresholds, project.id]);
  if (rows.length === 0)
    return (
      <EmptyState
        icon={Users}
        title="Nobody is booked yet"
        description="Propose people from the Marketplace or add bookings on Allocations."
      />
    );
  return (
    <div className="pcp-tbl-wrap">
      <table className="pcp-tbl pcp-tbl--compact">
        <caption className="pcp-sr-only">People booked per quarter</caption>
        <thead>
          <tr>
            <th scope="col">Person</th>
            <th scope="col">Craft</th>
            {quarters.map((q) => (
              <th key={q.key} scope="col" className="pcp-num">
                {q.label}
              </th>
            ))}
            <th scope="col">State</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const person = r.personId ? idx.people.get(r.personId) : undefined;
            const sec = person?.secondaryCrafts.find((x) => x.craftId === r.craftId);
            const states = [...new Set(r.cells.map((c) => c.state).filter(Boolean))];
            return (
              <tr key={r.key}>
                <th scope="row">
                  <PersonLabel name={r.label} />
                </th>
                <td>
                  <CraftChip
                    craft={r.craftId ? idx.crafts.get(r.craftId) : null}
                    via={r.craftId === person?.primaryCraft ? 'above' : sec ? 'below' : 'undeclared'}
                    proficiency={sec?.proficiency}
                  />
                </td>
                {r.cells.map((c) => (
                  <td key={c.quarterKey} className="pcp-num">
                    {c.pct > 0 ? (
                      <span className="pcp-row pj-cell">
                        {c.partial && <CalendarRange size={12} aria-hidden="true" className="pcp-text-tertiary" />}
                        {c.locked && <Lock size={12} aria-hidden="true" className="pcp-text-tertiary" />}
                        {fmt.pct(c.pct)}
                      </span>
                    ) : (
                      <span className="pcp-text-tertiary">–</span>
                    )}
                  </td>
                ))}
                <td>
                  <BookingStatePill
                    state={states.length === 1 ? (states[0] as D.AllocationState) : states.length ? 'mixed' : null}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DeliveryTab({ s, project }: { s: D.WorkspaceSnapshot; project: D.ProjectDTO }) {
  const delivery = useDelivery(s);
  const { can } = useWorkspace();
  const wsPath = useWsPath();
  const sig = delivery.byProjectQbr1.find((x) => x.projectId === project.id);
  const sprints = delivery.sprintRows.filter((r) => r.tribeId === project.tribeId).slice(-4, -1);
  if (!sig)
    return (
      <EmptyState
        icon={Activity}
        title="No Jira data for this project"
        description={
          can('integrations.run')
            ? 'Connect Jira and run a sync to see delivery.'
            : 'This project is not mapped to Jira yet.'
        }
        action={
          can('integrations.run') && (
            <LinkButton variant="secondary" to={`${wsPath('delivery/jira-planview')}?tab=mapping`}>
              Map Jira projects
            </LinkButton>
          )
        }
      />
    );
  const signal = deliverySignal(sig.plannedFte, sig.impliedFte);
  return (
    <div className="pcp-stack">
      <div className="pj-signal">
        <div>
          <div className="pcp-caption pcp-text-tertiary">Planned FTE · QBR1</div>
          <div className="pj-signal__value pcp-tnum">{fmt.fte(sig.plannedFte)}</div>
        </div>
        <div>
          <div className="pcp-caption pcp-text-tertiary">Jira-implied FTE · QBR1</div>
          <div className="pj-signal__value pcp-tnum">{fmt.fte(sig.impliedFte)}</div>
        </div>
        <StatusPill tone={signal.kind === 'inline' ? 'success' : 'info'}>{signal.label}</StatusPill>
      </div>
      <p className="pcp-caption pcp-text-tertiary">
        Signal, not a timesheet: story points ÷ the tribe&apos;s calibration (points per sprint per FTE).
      </p>
      {sprints.length > 0 && (
        <table className="pcp-tbl pcp-tbl--compact">
          <caption className="pcp-caption pcp-text-tertiary">Last closed sprints for the tribe</caption>
          <thead>
            <tr>
              <th scope="col">Sprint</th>
              <th scope="col" className="pcp-num">
                Points done
              </th>
              <th scope="col" className="pcp-num">
                Implied FTE
              </th>
              <th scope="col" className="pcp-num">
                Planned FTE
              </th>
            </tr>
          </thead>
          <tbody>
            {sprints.map((r) => (
              <tr key={r.key}>
                <th scope="row">
                  {r.sprintName}{' '}
                  <span className="pcp-caption pcp-text-tertiary">
                    {fmt.dateShort(r.from)} – {fmt.dateShort(r.to)}
                  </span>
                </th>
                <td className="pcp-num">{r.pointsDone}</td>
                <td className="pcp-num">{fmt.fte(r.impliedFte)}</td>
                <td className="pcp-num">{fmt.fte(r.plannedFte)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
