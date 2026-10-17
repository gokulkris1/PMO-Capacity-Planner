/**
 * Jira & Planview (JI-02…JI-07, PV-01, PV-02 test) — route `/o/:org/w/:ws/delivery/jira-planview`
 * (`?tab=overview|health|mapping|people|calibration|sprints|planview`).
 * Connection status, story points per tribe/quarter/sprint mapped to capacity, mappings, per-tribe calibration,
 * sync health and the Planview preview-before-apply import. Connection set-up lives in Settings › Integrations.
 */
import { useEffect, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, CircleDashed, Plug, RefreshCw, Settings } from 'lucide-react';
import type * as D from '../../../shared/contracts/dto';
import { useWorkspace } from '../../../state';
import {
  Banner,
  Button,
  errorMessage,
  fmt,
  PageHeader,
  StatusPill,
  TabPanel,
  Tabs,
  useQueryParam,
  useToast,
  LinkButton,
} from '../../../components/ui';
import { PageBody } from '../../../components/shell/PageBody';
import { useWsPath } from '../../../components/shell/workspacePath';
import { useDelivery, type DeliverySource } from '../../../state';
import { OverviewTab } from './OverviewTab';
import { HealthTab, syncStatePill } from './HealthTab';
import { MappingTab } from './MappingTab';
import { PeopleMappingTab } from './PeopleMappingTab';
import { CalibrationTab } from './CalibrationTab';
import { SprintsTab } from './SprintsTab';
import { PlanviewTab } from './PlanviewTab';
import '../delivery.css';

type Tab = 'overview' | 'health' | 'mapping' | 'people' | 'calibration' | 'sprints' | 'planview';

export default function DeliveryPage() {
  return (
    <div className="pcp-page">
      <PageBody label="delivery data">{(s) => <DeliveryBody snapshot={s} />}</PageBody>
    </div>
  );
}

function DeliveryBody({ snapshot: s }: { snapshot: D.WorkspaceSnapshot }) {
  const { can } = useWorkspace();
  const wsPath = useWsPath();
  const delivery = useDelivery(s);
  const [tabRaw, setTab] = useQueryParam('tab', 'overview');
  const canView = can('integrations.view');
  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'sprints', label: 'Sprints' },
    ...(canView
      ? ([
          { id: 'health', label: 'Sync health' },
          { id: 'mapping', label: 'Project mapping', count: delivery.mappings.filter((m) => !m.confirmed).length },
          { id: 'people', label: 'People mapping', count: delivery.identities.filter((m) => !m.confirmed).length },
          { id: 'calibration', label: 'Calibration' },
          ...(delivery.configured.planview ? [{ id: 'planview' as const, label: 'Planview import' }] : []),
        ] as Array<{ id: Tab; label: string; count?: number }>)
      : []),
  ];
  const tab: Tab = tabs.find((t) => t.id === tabRaw)?.id ?? 'overview';
  const sync = useSync(delivery);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Delivery' }, { label: 'Jira & Planview' }]}
        title="Jira & Planview"
        description="Story points per tribe, quarter and sprint turned into FTE and compared with the plan; mappings, calibration and sync health."
        actions={
          <>
            {can('integrations.manage') && (
              <LinkButton variant="secondary" iconBefore={Settings} to={wsPath('settings/integrations')}>
                Connection settings
              </LinkButton>
            )}
            {can('integrations.run') && delivery.configured.jira && (
              <Button variant="primary" iconBefore={RefreshCw} loading={sync.running} onClick={() => void sync.start()}>
                Sync now
              </Button>
            )}
          </>
        }
      />
      <div className="pcp-stack">
        <ConnectionStrip delivery={delivery} serverTime={s.serverTime} />
        {sync.job && sync.running && (
          <Banner tone="info" title="Syncing with Jira">
            <span aria-live="polite">
              {sync.job.pagesDone} pages · {sync.job.issuesSeen} issues
            </span>
          </Banner>
        )}
        {!delivery.configured.jira ? (
          <Banner
            tone="neutral"
            title="Jira isn't connected"
            actionNode={
              can('integrations.manage') ? (
                <LinkButton variant="secondary" size="sm" iconBefore={Plug} to={wsPath('settings/integrations')}>
                  Connect Jira
                </LinkButton>
              ) : undefined
            }
          >
            {can('integrations.manage')
              ? 'Connect Jira in Settings › Integrations, then run a sync to see delivery.'
              : 'Ask a PMO Admin to connect Jira to see delivery data here.'}
          </Banner>
        ) : (
          <>
            <Tabs idBase="delivery" label="Delivery views" tabs={tabs} value={tab} onChange={(v) => setTab(v)} />
            <TabPanel idBase="delivery" tabId={tab}>
              {tab === 'overview' && <OverviewTab snapshot={s} delivery={delivery} />}
              {tab === 'sprints' && <SprintsTab snapshot={s} delivery={delivery} />}
              {tab === 'health' && <HealthTab snapshot={s} delivery={delivery} />}
              {tab === 'mapping' && <MappingTab snapshot={s} delivery={delivery} />}
              {tab === 'people' && <PeopleMappingTab snapshot={s} delivery={delivery} />}
              {tab === 'calibration' && <CalibrationTab snapshot={s} delivery={delivery} />}
              {tab === 'planview' && <PlanviewTab snapshot={s} delivery={delivery} />}
            </TabPanel>
          </>
        )}
      </div>
    </>
  );
}

/** "Sync now" (JI-01#AC4): starts a job and steps it while the page is open. */
function useSync(delivery: DeliverySource) {
  const toast = useToast();
  const [job, setJob] = useState<D.SyncJobDTO | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const running = !!job && (job.status === 'running' || job.status === 'queued');
  useEffect(() => {
    if (!job || !running) return;
    const t = window.setTimeout(async () => {
      try {
        const next = await delivery.stepJob(job.id);
        if (!live.current) return;
        setJob(next);
        if (next.status === 'succeeded')
          toast.show({
            tone: 'success',
            title: 'Jira sync finished',
            body: `${next.pagesDone} pages · ${next.issuesSeen} issues`,
          });
        if (next.status === 'failed')
          toast.show({ tone: 'error', title: 'Jira sync failed', body: next.error ?? undefined });
      } catch (e) {
        if (!live.current) return;
        setJob({ ...job, status: 'failed', error: errorMessage(e) });
        toast.show({ tone: 'error', title: 'Jira sync stopped', body: errorMessage(e) });
      }
    }, 700);
    return () => window.clearTimeout(t);
  }, [job, running, delivery, toast]);
  const start = async () => {
    try {
      setJob(await delivery.syncNow());
    } catch (e) {
      toast.show({ tone: 'error', title: 'Sync did not start', body: errorMessage(e) });
    }
  };
  return { job, running, start };
}

function ConnectionStrip({ delivery, serverTime }: { delivery: DeliverySource; serverTime: string }) {
  const h = delivery.health;
  const mappedProjects = delivery.mappings.filter((m) => m.confirmed && m.projectId).length;
  const identities = delivery.identities.filter((m) => m.confirmed && m.personId).length;
  return (
    <div className="dl-strip" role="list" aria-label="Connections">
      <div className="dl-conn" role="listitem">
        <div className="dl-conn__head">
          <span className="dl-conn__name">Jira Cloud</span>
          {!delivery.configured.jira ? (
            <StatusPill icon={CircleDashed}>Not connected</StatusPill>
          ) : h?.state === 'failed' ? (
            // QA-026: a connection whose last sync failed is not shown as healthy.
            <StatusPill tone="danger" icon={CircleAlert}>
              Sync failing
            </StatusPill>
          ) : (
            <StatusPill tone="success" icon={CircleCheck}>
              Connected
            </StatusPill>
          )}
        </div>
        <div className="pcp-caption pcp-text-tertiary">
          {h?.lastSuccessAt
            ? `Last successful sync ${fmt.relative(h.lastSuccessAt, serverTime)}`
            : 'No successful sync yet'}
        </div>
        {h?.state === 'failed' && h.lastJob?.error ? (
          <div className="pcp-caption dl-conn__error">{h.lastJob.error}</div>
        ) : null}
        {h && <div className="dl-conn__state">{syncStatePill(h.state)}</div>}
      </div>
      <div className="dl-conn" role="listitem">
        <div className="dl-conn__head">
          <span className="dl-conn__name">Mapped projects</span>
        </div>
        <div className="dl-conn__value pcp-tnum">
          {mappedProjects}
          <span className="pcp-caption pcp-text-tertiary"> of {delivery.mappings.length} Jira projects</span>
        </div>
      </div>
      <div className="dl-conn" role="listitem">
        <div className="dl-conn__head">
          <span className="dl-conn__name">Linked people</span>
        </div>
        <div className="dl-conn__value pcp-tnum">
          {identities}
          <span className="pcp-caption pcp-text-tertiary"> of {delivery.identities.length} assignees</span>
        </div>
      </div>
      <div className="dl-conn" role="listitem">
        <div className="dl-conn__head">
          <span className="dl-conn__name">Planview</span>
          {delivery.configured.planview ? (
            <StatusPill tone="success" icon={CircleCheck}>
              Connected
            </StatusPill>
          ) : (
            <StatusPill icon={CircleDashed}>Optional · off</StatusPill>
          )}
        </div>
        <div className="pcp-caption pcp-text-tertiary">
          {delivery.configured.planview
            ? 'Preview changes before applying them.'
            : 'An admin can enable it in Settings.'}
        </div>
      </div>
      {delivery.provider === 'demo' && (
        <p className="pcp-caption pcp-text-tertiary dl-demo-note">
          <CircleAlert size={12} aria-hidden="true" /> Demo workspace: Jira and Planview figures are sample data.
        </p>
      )}
    </div>
  );
}
