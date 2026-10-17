/**
 * Sprint planning (SH-05#AC2, D-5) — route `/o/:org/w/:ws/delivery/sprints`, only when the `qbrSprintModule` flag
 * is on. The v1.1 QBR sprint module (its own members, projects, squads and OKRs per sprint) on the 2.0 kit; it keeps
 * its own data until it is unified with the core plan (EP-21). Data goes through `api.qbr` (cookie session + CSRF).
 */
import { useState } from 'react';
import { CalendarDays, FlaskConical, RefreshCw, Sprout } from 'lucide-react';
import { useFeature, useSession, useWorkspace } from '../../../state';
import type { QBRMember } from '../../../types';
import {
  Banner,
  Button,
  Card,
  Dialog,
  EmptyState,
  FormField,
  KpiTile,
  PageHeader,
  Select,
  Skeleton,
  Tabs,
  TabPanel,
  TextField,
  errorMessage,
  useConfirm,
  useQueryParam,
  useToast,
} from '../../../components/ui';
import { SprintGrid } from './SprintGrid';
import { MemberDrawer, MembersView, OkrsView, SquadsView, TribesView } from './SprintViews';
import { useSprintData } from './useSprintData';
import './sprints.css';

type View = 'capacity' | 'tribes' | 'okrs' | 'squads' | 'members';
const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'capacity', label: 'Capacity grid' },
  { id: 'tribes', label: 'Tribes' },
  { id: 'okrs', label: 'OKRs' },
  { id: 'squads', label: 'Squads' },
  { id: 'members', label: 'Members' },
];

export default function SprintsPage() {
  const enabled = useFeature('qbrSprintModule');
  const { mode } = useSession();
  const { workspace } = useWorkspace();
  const header = (
    <PageHeader
      breadcrumbs={[{ label: 'Delivery' }, { label: 'Sprint planning' }]}
      title="Sprint planning"
      description="Sprint-level bookings, squads and OKRs per quarter (the QBR sprint module). It keeps its own members and projects."
    />
  );
  if (!enabled || !workspace || mode === 'demo')
    return (
      <div className="pcp-page">
        {header}
        <Card>
          <EmptyState
            icon={CalendarDays}
            title={mode === 'demo' ? 'Sprint planning needs a live workspace' : 'Sprint planning is turned off'}
            description={
              mode === 'demo'
                ? 'The demo shows the core plan only. Sign in to use sprint planning.'
                : 'An Org Admin can switch it on in Settings › Features.'
            }
          />
        </Card>
      </div>
    );
  return (
    <div className="pcp-page">
      {header}
      <SprintPlanner wsId={workspace.id} />
    </div>
  );
}

function SprintPlanner({ wsId }: { wsId: string }) {
  const { can } = useWorkspace();
  const toast = useToast();
  const confirm = useConfirm();
  const sp = useSprintData(wsId);
  const [viewRaw, setView] = useQueryParam('view', 'capacity');
  const view: View = VIEWS.some((v) => v.id === viewRaw) ? (viewRaw as View) : 'capacity';
  const [tribeFilter, setTribeFilter] = useState('');
  const [member, setMember] = useState<QBRMember | null>(null);
  const [naming, setNaming] = useState(false);
  const canEdit = can('qbr.write');
  const canCommit = can('qbr.commit');

  const act = async (fn: () => Promise<void>, success?: string) => {
    try {
      await fn();
      if (success) toast.success(success);
    } catch (e) {
      toast.error('That did not work', { body: errorMessage(e) });
    }
  };

  if (sp.status === 'loading')
    return (
      <div className="pcp-stack">
        <Skeleton variant="kpi" label="sprint planning" />
        <Skeleton variant="table" label="sprint planning" />
      </div>
    );
  if (sp.status === 'error' || !sp.overview)
    return (
      <Banner
        tone="danger"
        title="We couldn't load sprint planning."
        actionNode={
          <Button size="sm" iconBefore={RefreshCw} onClick={() => void sp.actions.reload()}>
            Retry
          </Button>
        }
      >
        {errorMessage(sp.error)}
      </Banner>
    );

  const o = sp.overview;
  const { data } = sp;
  const seed = async () => {
    const ok = await confirm({
      title: 'Load sample sprint data?',
      body: 'This replaces the sprint planning data of this workspace with a sample. The core plan is not changed.',
      confirmLabel: 'Load sample data',
      tone: 'danger',
    });
    if (ok) await act(() => sp.actions.seed(), 'Sample data loaded');
  };

  if (o.tribes.length === 0 && o.quarters.length === 0)
    return (
      <Card>
        <EmptyState
          icon={CalendarDays}
          title="No sprint plan yet"
          description="Sprint planning starts with tribes, members, projects and a quarter of sprints."
          action={
            canCommit ? (
              <Button variant="primary" iconBefore={Sprout} onClick={() => void seed()}>
                Load sample data
              </Button>
            ) : undefined
          }
        />
      </Card>
    );

  const scenario = data.scenarios.find((s) => s.id === sp.scenarioId) ?? null;

  return (
    <div className="pcp-stack">
      <div className="pcp-row pcp-row--wrap sp-bar">
        <FormField label="Quarter" id="sp-quarter" hideLabel>
          <Select
            id="sp-quarter"
            size="sm"
            value={sp.quarterId}
            onValueChange={sp.setQuarterId}
            options={o.quarters.map((q) => ({ value: q.id, label: `${q.label}${q.is_active ? ' (active)' : ''}` }))}
          />
        </FormField>
        <span className="pcp-spacer" />
        {scenario ? (
          <>
            <span className="pcp-row">
              <FlaskConical size={16} strokeWidth={1.75} aria-hidden="true" className="pcp-icon-status--warning" />
              <span className="pcp-strong">Scenario: {scenario.name}</span>
            </span>
            {canCommit && (
              <Button
                size="sm"
                variant="primary"
                onClick={() =>
                  void confirm({
                    title: `Commit "${scenario.name}"?`,
                    body: 'Its bookings replace the live sprint plan for this quarter.',
                    confirmLabel: 'Commit scenario',
                    tone: 'primary',
                  }).then((ok) => ok && act(() => sp.actions.commitScenario(scenario.id), 'Scenario committed'))
                }
              >
                Commit
              </Button>
            )}
            {canCommit && (
              <Button
                size="sm"
                variant="danger"
                onClick={() =>
                  void confirm({
                    title: `Discard "${scenario.name}"?`,
                    body: 'The scenario and its bookings are deleted. The live plan is not changed.',
                    confirmLabel: 'Discard',
                    tone: 'danger',
                  }).then((ok) => ok && act(() => sp.actions.discardScenario(scenario.id), 'Scenario discarded'))
                }
              >
                Discard
              </Button>
            )}
            <Button size="sm" onClick={() => sp.actions.exitScenario()}>
              Back to the live plan
            </Button>
          </>
        ) : (
          <>
            {data.scenarios.length > 0 && (
              <FormField label="Open a scenario" id="sp-scenario" hideLabel>
                <Select
                  id="sp-scenario"
                  size="sm"
                  value=""
                  placeholder="Open a scenario"
                  onValueChange={(id) => id && void act(() => sp.actions.openScenario(id))}
                  options={data.scenarios.map((s) => ({
                    value: s.id,
                    label: `${s.name}${s.is_committed ? ' (committed)' : ''}`,
                  }))}
                />
              </FormField>
            )}
            {canEdit && (
              <Button size="sm" iconBefore={FlaskConical} onClick={() => setNaming(true)}>
                New scenario
              </Button>
            )}
          </>
        )}
      </div>

      {scenario && (
        <Banner tone="warning" title="You are editing a scenario">
          Bookings you change here stay in the scenario until you commit it.
        </Banner>
      )}

      <div className="pcp-kpi-grid" role="list" aria-label="Sprint planning figures">
        <div role="listitem">
          <KpiTile
            label="Tribes"
            value={o.stats.tribes ?? o.tribes.length}
            caption={`${o.stats.chapters ?? 0} chapters`}
          />
        </div>
        <div role="listitem">
          <KpiTile
            label="Members"
            value={o.stats.members ?? data.members.length}
            caption={`${o.stats.coe ?? 0} centres of excellence`}
          />
        </div>
        <div role="listitem">
          <KpiTile label="Projects" value={o.stats.projects ?? data.projects.length} caption="This workspace" />
        </div>
        <div role="listitem">
          <KpiTile label="Scenarios" value={data.scenarios.length} caption="This quarter" />
        </div>
      </div>

      <Tabs<View> label="Sprint planning views" idBase="sp" tabs={VIEWS} value={view} onChange={setView} />
      <TabPanel idBase="sp" tabId={view}>
        {view === 'capacity' && (
          <SprintGrid
            members={data.members}
            projects={data.projects}
            sprints={data.sprints}
            bookings={sp.bookings}
            tribes={o.tribes}
            chapters={o.chapters}
            coe={o.coe}
            tribeFilter={tribeFilter}
            onTribeFilter={setTribeFilter}
            canEdit={canEdit}
            onBook={(b) => sp.actions.book(b)}
            onSelectMember={setMember}
          />
        )}
        {view === 'tribes' && (
          <TribesView
            tribes={o.tribes}
            chapters={o.chapters}
            coe={o.coe}
            members={data.members}
            projects={data.projects}
            squads={data.squads}
            onCapacity={(id) => {
              setTribeFilter(id);
              setView('capacity');
            }}
          />
        )}
        {view === 'okrs' && <OkrsView okrs={data.okrs} tribes={o.tribes} projects={data.projects} />}
        {view === 'squads' && <SquadsView squads={data.squads} tribes={o.tribes} />}
        {view === 'members' && (
          <MembersView members={data.members} bookings={sp.bookings} sprints={data.sprints} onSelect={setMember} />
        )}
      </TabPanel>

      {canCommit && (
        <p className="pcp-caption pcp-text-tertiary">
          Sample data:{' '}
          <Button size="sm" variant="link" onClick={() => void seed()}>
            reload the sample sprint plan
          </Button>
        </p>
      )}

      <MemberDrawer member={member} bookings={sp.bookings} sprints={data.sprints} onClose={() => setMember(null)} />
      {naming && (
        <ScenarioNameDialog
          onClose={() => setNaming(false)}
          onCreate={(name) => act(() => sp.actions.createScenario(name), `Scenario "${name}" created`)}
        />
      )}
    </div>
  );
}

function ScenarioNameDialog({ onClose, onCreate }: { onClose(): void; onCreate(name: string): Promise<void> }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    await onCreate(name.trim());
    setBusy(false);
    onClose();
  };
  return (
    <Dialog
      open
      size="sm"
      onClose={onClose}
      title="New scenario"
      subtitle="Try bookings without changing the live sprint plan"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void submit()}>
            Create scenario
          </Button>
        </>
      }
    >
      <FormField label="Scenario name" id="sp-scenario-name">
        <TextField
          id="sp-scenario-name"
          data-autofocus=""
          value={name}
          maxLength={80}
          onValueChange={setName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />
      </FormField>
    </Dialog>
  );
}
