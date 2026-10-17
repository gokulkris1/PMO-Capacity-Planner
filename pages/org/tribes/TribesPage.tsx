/**
 * Tribes (ORG-05#AC1) — route `/o/:org/w/:ws/org/tribes`.
 * Each tribe with projects, demand QBR1–QBR4, QBR1 staffed and gap, PMO people serving and the delivery signal.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Network } from 'lucide-react';
import type * as D from '../../../shared/contracts/dto';
import { useQuarters } from '../../../state';
import { buildTribeView } from '../../../utils/viewModels';
import { Card, EmptyState, fmt, PageHeader, StatusPill, TableScroll } from '../../../components/ui';
import { PageBody } from '../../../components/shell/PageBody';
import { useWsPath } from '../../../components/shell/workspacePath';
import { deliverySignalOf as deliverySignal, useDelivery } from '../../../state';
import './tribes.css';

export default function TribesPage() {
  return (
    <div className="pcp-page">
      <PageHeader
        breadcrumbs={[{ label: 'Organisation' }, { label: 'Tribes' }]}
        title="Tribes"
        description="Demand, PMO staffing and delivery signal per tribe for the next four quarters."
      />
      <PageBody label="tribes">{(s) => <TribesBody snapshot={s} />}</PageBody>
    </div>
  );
}

function TribesBody({ snapshot: s }: { snapshot: D.WorkspaceSnapshot }) {
  const quarters = useQuarters();
  const wsPath = useWsPath();
  const delivery = useDelivery(s);
  const views = useMemo(
    () =>
      s.tribes
        .filter((t) => !t.archived)
        .map((t) => buildTribeView(s, quarters, t.id))
        .sort((a, z) => a.tribe.name.localeCompare(z.tribe.name)),
    [s, quarters],
  );
  const q1 = quarters[0];
  if (views.length === 0)
    return (
      <Card>
        <EmptyState
          icon={Network}
          title="No tribes yet"
          description="A PMO Admin adds tribes in Settings › Structure."
        />
      </Card>
    );
  return (
    <Card flush>
      <TableScroll>
        <table className="pcp-tbl tr-table">
          <caption className="pcp-sr-only">Tribes</caption>
          <thead>
            <tr>
              <th scope="col" rowSpan={2} className="pcp-tbl-sticky tr-col-name">
                Tribe
              </th>
              <th scope="col" rowSpan={2} className="pcp-num">
                Projects
              </th>
              <th scope="colgroup" colSpan={quarters.length} className="tr-group">
                Demand (FTE)
              </th>
              <th scope="colgroup" colSpan={2} className="tr-group">
                {fmt.quarterCaption(q1)}
              </th>
              <th scope="col" rowSpan={2} className="pcp-num">
                People serving
              </th>
              <th scope="col" rowSpan={2}>
                Delivery signal
              </th>
            </tr>
            <tr>
              {quarters.map((q, i) => (
                <th
                  key={q.key}
                  scope="col"
                  className={i === 0 ? 'pcp-num tr-first' : 'pcp-num'}
                  title={fmt.quarterTooltip(q)}
                >
                  {q.label}
                </th>
              ))}
              <th scope="col" className="pcp-num tr-first">
                Staffed
              </th>
              <th scope="col" className="pcp-num">
                Gap
              </th>
            </tr>
          </thead>
          <tbody>
            {views.map((v) => {
              const ids = new Set(v.projects.map((p) => p.id));
              const sig = delivery.byProjectQbr1.filter((x) => ids.has(x.projectId));
              const planned = sig.reduce((x, y) => x + y.plannedFte, 0);
              const implied = sig.reduce((x, y) => x + y.impliedFte, 0);
              const signal = sig.length ? deliverySignal(planned, implied) : null;
              const gap = Math.max(0, v.gapFte[0] ?? 0);
              return (
                <tr key={v.tribe.id}>
                  <th scope="row" className="pcp-tbl-sticky tr-col-name">
                    <Link className="pcp-link pcp-strong" to={wsPath(`org/tribes/${v.tribe.id}`)}>
                      {v.tribe.name}
                    </Link>
                    <span className="pcp-caption pcp-text-tertiary tr-lead">
                      {v.tribe.leadName ? `Lead: ${v.tribe.leadName}` : 'No lead set'}
                    </span>
                  </th>
                  <td className="pcp-num">{v.projects.length}</td>
                  {v.demandFte.map((d, i) => (
                    <td key={quarters[i].key} className={i === 0 ? 'pcp-num tr-first' : 'pcp-num'}>
                      {fmt.fte(d)}
                    </td>
                  ))}
                  <td className="pcp-num tr-first">{fmt.fte(v.staffedFte[0])}</td>
                  <td className="pcp-num">
                    {gap > 0.04 ? (
                      <StatusPill tone="danger" title={`${fmt.fte(gap)} FTE of demand is not staffed`}>
                        Gap {fmt.fte(gap)}
                      </StatusPill>
                    ) : (
                      <span className="pcp-text-tertiary">0.0</span>
                    )}
                  </td>
                  <td className="pcp-num">{v.people.length}</td>
                  <td>
                    {signal ? (
                      <span className="tr-signal">
                        <StatusPill tone={signal.kind === 'inline' ? 'success' : 'info'}>
                          {signal.kind === 'inline'
                            ? 'In line'
                            : signal.kind === 'more'
                              ? 'More effort'
                              : 'Less effort'}
                        </StatusPill>
                        <span className="pcp-caption pcp-text-tertiary pcp-tnum">
                          {fmt.fte(planned)} planned · {fmt.fte(implied)} implied
                        </span>
                      </span>
                    ) : (
                      <span className="pcp-text-tertiary">No Jira mapping</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>
      <div className="pcp-card__footer">
        <span className="pcp-caption pcp-text-tertiary">
          Staffed = confirmed bookings on the tribe&apos;s projects. Delivery signal compares planned with Jira-implied
          FTE (signal, not a timesheet).
        </span>
      </div>
    </Card>
  );
}
