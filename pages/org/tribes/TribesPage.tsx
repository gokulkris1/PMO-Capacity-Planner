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
import { Card, EmptyState, PageBody, PageHeader, StatusPill, fmt, useWsPath } from '../../plan/_kit';
import { deliverySignal, useDelivery } from '../../delivery/_parts/deliverySource';
import './tribes.css';

export default function TribesPage() {
  return (
    <div className="b2-page">
      <PageHeader
        crumbs={[{ label: 'Organisation' }, { label: 'Tribes' }]}
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
        <EmptyState icon={Network} title="No tribes yet" body="A PMO Admin adds tribes in Settings › Structure." />
      </Card>
    );
  return (
    <Card flush>
      <div className="b2-table-wrap">
        <table className="b2-table tr-table">
          <caption className="b2-sr-only">Tribes</caption>
          <thead>
            <tr>
              <th scope="col" rowSpan={2} className="b2-sticky-col tr-col-name">
                Tribe
              </th>
              <th scope="col" rowSpan={2} className="b2-num">
                Projects
              </th>
              <th scope="colgroup" colSpan={quarters.length} className="tr-group">
                Demand (FTE)
              </th>
              <th scope="colgroup" colSpan={2} className="tr-group">
                {fmt.quarterCaption(q1)}
              </th>
              <th scope="col" rowSpan={2} className="b2-num">
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
                  className={i === 0 ? 'b2-num tr-first' : 'b2-num'}
                  title={fmt.quarterTooltip(q)}
                >
                  {q.label}
                </th>
              ))}
              <th scope="col" className="b2-num tr-first">
                Staffed
              </th>
              <th scope="col" className="b2-num">
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
                  <th scope="row" className="b2-sticky-col tr-col-name">
                    <Link className="b2-link b2-strong" to={wsPath(`org/tribes/${v.tribe.id}`)}>
                      {v.tribe.name}
                    </Link>
                    <span className="b2-caption tr-lead">
                      {v.tribe.leadName ? `Lead: ${v.tribe.leadName}` : 'No lead set'}
                    </span>
                  </th>
                  <td className="b2-num">{v.projects.length}</td>
                  {v.demandFte.map((d, i) => (
                    <td key={quarters[i].key} className={i === 0 ? 'b2-num tr-first' : 'b2-num'}>
                      {fmt.fte(d)}
                    </td>
                  ))}
                  <td className="b2-num tr-first">{fmt.fte(v.staffedFte[0])}</td>
                  <td className="b2-num">
                    {gap > 0.04 ? (
                      <StatusPill tone="danger" title={`${fmt.fte(gap)} FTE of demand is not staffed`}>
                        Gap {fmt.fte(gap)}
                      </StatusPill>
                    ) : (
                      <span className="b2-subtle">0.0</span>
                    )}
                  </td>
                  <td className="b2-num">{v.people.length}</td>
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
                        <span className="b2-caption b2-tnum">
                          {fmt.fte(planned)} planned · {fmt.fte(implied)} implied
                        </span>
                      </span>
                    ) : (
                      <span className="b2-subtle">No Jira mapping</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="b2-card__foot">
        <span className="b2-caption">
          Staffed = confirmed bookings on the tribe&apos;s projects. Delivery signal compares planned with Jira-implied
          FTE (signal, not a timesheet).
        </span>
      </div>
    </Card>
  );
}
