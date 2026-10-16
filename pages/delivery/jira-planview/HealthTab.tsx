/** Sync health (JI-07): last success, last run status, duration, pages, issues, the last 10 jobs and errors. */
import { CircleAlert, CircleCheck, CircleDashed, CircleX, Hourglass, LoaderCircle, TriangleAlert } from 'lucide-react';
import type * as D from '../../../shared/contracts/dto';
import { Banner, Card, EmptyState, KpiTile, StatusPill, fmt } from '../../plan/_kit';
import type { DeliverySource } from '../_parts/deliverySource';

export function syncStatePill(state: D.SyncHealthDTO['state']) {
  switch (state) {
    case 'ok':
      return (
        <StatusPill tone="success" icon={CircleCheck}>
          Healthy
        </StatusPill>
      );
    case 'failed':
      return (
        <StatusPill tone="danger" icon={CircleAlert}>
          Failed
        </StatusPill>
      );
    case 'stale':
      return (
        <StatusPill tone="warning" icon={TriangleAlert}>
          Stale
        </StatusPill>
      );
    case 'running':
      return (
        <StatusPill tone="info" icon={LoaderCircle}>
          Running
        </StatusPill>
      );
    default:
      return <StatusPill icon={CircleDashed}>Never synced</StatusPill>;
  }
}

export function jobStatusPill(j: D.SyncJobDTO) {
  if (j.rateLimitedUntil && j.status === 'running')
    return (
      <StatusPill tone="warning" icon={Hourglass}>
        Rate limited
      </StatusPill>
    );
  switch (j.status) {
    case 'succeeded':
      return (
        <StatusPill tone="success" icon={CircleCheck}>
          Succeeded
        </StatusPill>
      );
    case 'failed':
      return (
        <StatusPill tone="danger" icon={CircleX}>
          Failed
        </StatusPill>
      );
    case 'partial':
      return (
        <StatusPill tone="warning" icon={TriangleAlert}>
          Partial
        </StatusPill>
      );
    case 'running':
      return (
        <StatusPill tone="info" icon={LoaderCircle}>
          Running
        </StatusPill>
      );
    default:
      return <StatusPill icon={CircleDashed}>Queued</StatusPill>;
  }
}

const duration = (j: D.SyncJobDTO) => {
  if (!j.startedAt || !j.finishedAt) return '—';
  const s = Math.max(0, Math.round((new Date(j.finishedAt).getTime() - new Date(j.startedAt).getTime()) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
};

export function HealthTab({ snapshot: s, delivery }: { snapshot: D.WorkspaceSnapshot; delivery: DeliverySource }) {
  const h = delivery.health;
  if (!h)
    return <EmptyState icon={CircleDashed} title="No sync has run yet" body="Run a sync to see its health here." />;
  const last = h.lastJob;
  const staleHours = h.lastSuccessAt
    ? (new Date(s.serverTime).getTime() - new Date(h.lastSuccessAt).getTime()) / 3600000
    : Infinity;
  return (
    <div className="b2-stack">
      {(h.state === 'failed' || last?.status === 'failed') && (
        <Banner tone="danger" title={`Last run failed ${fmt.relative(last?.finishedAt, s.serverTime)}`}>
          {last?.error ?? 'Jira returned an error.'}
        </Banner>
      )}
      {staleHours > 48 && h.state !== 'failed' && (
        <Banner tone="warning" title="Stale: no successful sync in the last 48 hours" />
      )}
      <div className="b2-kpis" role="list" aria-label="Sync figures">
        <div role="listitem">
          <KpiTile
            label="Last successful sync"
            value={h.lastSuccessAt ? fmt.relative(h.lastSuccessAt, s.serverTime) : 'Never'}
            basis={h.lastSuccessAt ? fmt.dateTime(h.lastSuccessAt) : 'Daily at 05:00 UTC'}
          />
        </div>
        <div role="listitem">
          <KpiTile
            label="Last run"
            value={last ? jobStatusPill(last) : '—'}
            basis={
              last ? `${last.trigger === 'manual' ? 'Manual' : 'Scheduled'} · ${fmt.dateTime(last.startedAt)}` : '—'
            }
          />
        </div>
        <div role="listitem">
          <KpiTile label="Duration" value={last ? duration(last) : '—'} basis="Last run" />
        </div>
        <div role="listitem">
          <KpiTile
            label="Pages · issues"
            value={last ? `${last.pagesDone} · ${last.issuesSeen}` : '—'}
            basis="Last run"
          />
        </div>
      </div>
      <Card title="Recent runs" subtitle="The last 10 sync jobs" flush>
        <div className="b2-table-wrap">
          <table className="b2-table b2-table--compact">
            <caption className="b2-sr-only">Recent sync jobs</caption>
            <thead>
              <tr>
                <th scope="col">Started</th>
                <th scope="col">Trigger</th>
                <th scope="col">Status</th>
                <th scope="col" className="b2-num">
                  Duration
                </th>
                <th scope="col" className="b2-num">
                  Pages
                </th>
                <th scope="col" className="b2-num">
                  Issues
                </th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {h.recentJobs.map((j) => (
                <tr key={j.id}>
                  <th scope="row" className="b2-tnum">
                    {fmt.dateTime(j.startedAt)}
                  </th>
                  <td>
                    {j.trigger === 'manual' ? `Manual${j.requestedBy ? ` · ${j.requestedBy.name}` : ''}` : 'Scheduled'}
                  </td>
                  <td>{jobStatusPill(j)}</td>
                  <td className="b2-num">{duration(j)}</td>
                  <td className="b2-num">{j.pagesDone}</td>
                  <td className="b2-num">{j.issuesSeen}</td>
                  <td className="dl-err">
                    {j.error ? (
                      <span className={j.status === 'failed' ? 'dl-err__text' : 'b2-muted'}>{j.error}</span>
                    ) : (
                      <span className="b2-subtle">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
