/**
 * Tribe page (ORG-05#AC2/3, JI-04#AC2) — route `/o/:org/w/:ws/org/tribes/:tribeId` (`?basis=`).
 * KPI tiles, projects with stage and staffing, craft demand vs staffed per quarter, people serving the tribe
 * and the tribe's story-point calibration.
 */
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Network, Pencil } from 'lucide-react';
import type * as D from '../../../shared/contracts/dto';
import { useQuarters, useWorkspace } from '../../../state';
import { buildDemandGrid, buildTribeView } from '../../../utils/viewModels';
import {
  Card,
  ChartFrame,
  CraftChip,
  EmptyState,
  GroupedBarChart,
  KpiTile,
  PageBody,
  PageHeader,
  PersonLabel,
  StatusPill,
  Button,
  fmt,
  indexSnapshot,
  useBasis,
  useWsPath,
} from '../../plan/_kit';
import { CalibrationDialog } from '../../delivery/_parts/CalibrationDialog';
import { useDelivery } from '../../../state';
import './tribes.css';

export default function TribeDetailPage() {
  const { tribeId = '' } = useParams();
  const wsPath = useWsPath();
  return (
    <div className="b2-page">
      <PageBody label="the tribe">
        {(s) => {
          const tribe = s.tribes.find((t) => t.id === tribeId);
          if (!tribe)
            return (
              <>
                <PageHeader
                  crumbs={[
                    { label: 'Organisation' },
                    { label: 'Tribes', to: wsPath('org/tribes') },
                    { label: 'Not found' },
                  ]}
                  title="Tribe not found"
                />
                <Card>
                  <EmptyState
                    icon={Network}
                    title="This tribe does not exist"
                    body="It may have been archived or the link is wrong."
                    action={
                      <Link className="b2-btn b2-btn--secondary" to={wsPath('org/tribes')}>
                        All tribes
                      </Link>
                    }
                  />
                </Card>
              </>
            );
          return <TribeBody snapshot={s} tribe={tribe} />;
        }}
      </PageBody>
    </div>
  );
}

function TribeBody({ snapshot: s, tribe }: { snapshot: D.WorkspaceSnapshot; tribe: D.TribeDTO }) {
  const quarters = useQuarters();
  const { can } = useWorkspace();
  const b = useBasis();
  const wsPath = useWsPath();
  const delivery = useDelivery(s);
  const idx = useMemo(() => indexSnapshot(s), [s]);
  const view = useMemo(() => buildTribeView(s, quarters, tribe.id), [s, quarters, tribe.id]);
  const grid = useMemo(
    () => buildDemandGrid(s, quarters).filter((d) => d.project.tribeId === tribe.id),
    [s, quarters, tribe.id],
  );
  const [editCal, setEditCal] = useState(false);
  const qi = b.quarterIndex;
  const cal = delivery.calibrations.find((c) => c.tribeId === tribe.id);

  const byCraft = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const d of grid)
      d.cells.forEach((c, i) => {
        for (const l of c.lines) {
          const arr = map.get(l.craftId) ?? quarters.map(() => 0);
          arr[i] += l.fte;
          map.set(l.craftId, arr);
        }
      });
    return [...map.entries()].sort((a, z) => z[1][qi] - a[1][qi]);
  }, [grid, quarters, qi]);

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Organisation' }, { label: 'Tribes', to: wsPath('org/tribes') }, { label: tribe.name }]}
        title={tribe.name}
        description={`${tribe.leadName ? `Lead: ${tribe.leadName} · ` : ''}${view.projects.length} project${view.projects.length === 1 ? '' : 's'} · ${view.people.length} PMO people serving`}
        basis
        basisExclude={['today', 'window']}
        actions={
          <Link
            className="b2-btn b2-btn--secondary"
            to={`${wsPath('plan/marketplace')}?tab=catalogue&tribe=${tribe.id}`}
          >
            Squad catalogue for {tribe.name}
          </Link>
        }
      />
      <div className="b2-stack">
        <div className="b2-kpis" role="list" aria-label="Tribe figures">
          <div role="listitem">
            <KpiTile
              label="Demand"
              value={fmt.fte(view.demandFte[qi])}
              unit="FTE"
              basis={b.caption}
              delta={`${grid.reduce((x, d) => x + d.cells[qi].lines.length, 0)} craft lines`}
            />
          </div>
          <div role="listitem">
            <KpiTile
              label="Staffed"
              value={fmt.fte(view.staffedFte[qi])}
              unit="FTE"
              basis={b.caption}
              delta="Confirmed bookings on tribe projects"
            />
          </div>
          <div role="listitem">
            <KpiTile
              label="Gap"
              value={fmt.fte(Math.max(0, view.gapFte[qi]))}
              unit="FTE"
              pill={
                view.gapFte[qi] > 0.04 ? (
                  <StatusPill tone="danger">Gap</StatusPill>
                ) : (
                  <StatusPill tone="success">Covered</StatusPill>
                )
              }
              basis={b.caption}
            />
          </div>
          <div role="listitem">
            <KpiTile
              label="People serving"
              value={view.people.filter((p) => (p.pctByQuarter[qi] ?? 0) > 0).length}
              unit="people"
              basis={b.caption}
              delta={`${fmt.fte(view.people.reduce((x, p) => x + (p.pctByQuarter[qi] ?? 0), 0) / 100)} FTE booked`}
            />
          </div>
        </div>

        <div className="b2-grid-12">
          <div className="b2-col-7">
            <ChartFrame
              title="Demand vs staffed"
              caption="FTE per quarter across the tribe's projects"
              legend={[
                { swatch: '4', label: 'Demand' },
                { swatch: '1', label: 'Staffed (confirmed)' },
              ]}
              table={
                <div className="b2-table-wrap">
                  <table className="b2-table b2-table--compact">
                    <caption className="b2-sr-only">Demand and staffed by craft</caption>
                    <thead>
                      <tr>
                        <th scope="col">Craft</th>
                        {quarters.map((q) => (
                          <th key={q.key} scope="col" className="b2-num">
                            {q.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {byCraft.map(([craftId, vals]) => (
                        <tr key={craftId}>
                          <th scope="row">
                            <span className="b2-row">
                              <CraftChip craft={idx.crafts.get(craftId)} />
                              {idx.crafts.get(craftId)?.name}
                            </span>
                          </th>
                          {vals.map((v, i) => (
                            <td key={quarters[i].key} className="b2-num">
                              {fmt.fte(v)}
                            </td>
                          ))}
                        </tr>
                      ))}
                      <tr className="b2-total">
                        <th scope="row">Demand total</th>
                        {view.demandFte.map((v, i) => (
                          <td key={quarters[i].key} className="b2-num">
                            {fmt.fte(v)}
                          </td>
                        ))}
                      </tr>
                      <tr className="b2-total">
                        <th scope="row">Staffed</th>
                        {view.staffedFte.map((v, i) => (
                          <td key={quarters[i].key} className="b2-num">
                            {fmt.fte(v)}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              }
            >
              <GroupedBarChart
                ariaLabel={`Demand vs staffed FTE per quarter for ${tribe.name}`}
                unit="FTE"
                categories={quarters.map((q) => ({ key: q.key, label: q.label, sublabel: q.calendarLabel }))}
                series={[
                  { name: 'Demand', kind: '4', values: view.demandFte },
                  { name: 'Staffed', kind: '1', values: view.staffedFte },
                ]}
                format={(v) => fmt.fte(v)}
              />
            </ChartFrame>
          </div>
          <div className="b2-col-5">
            <Card
              title="Story-point calibration"
              subtitle="Points per sprint per FTE, used to turn Jira story points into FTE"
              actions={
                cal &&
                can('integrations.run') && (
                  <Button size="sm" variant="subtle" icon={Pencil} onClick={() => setEditCal(true)}>
                    Edit
                  </Button>
                )
              }
            >
              {cal ? (
                <div className="b2-stack b2-stack--sm">
                  <div className="tr-cal">
                    <div>
                      <div className="b2-caption">Current</div>
                      <div className="tr-cal__value b2-tnum">{cal.pointsPerSprintPerFte}</div>
                      {cal.isDefault && <StatusPill>Default</StatusPill>}
                    </div>
                    <div>
                      <div className="b2-caption">Suggested</div>
                      <div className="tr-cal__value b2-tnum">{cal.suggestedValue ?? '—'}</div>
                      {cal.suggestedBasis && (
                        <div className="b2-caption">
                          Based on {cal.suggestedBasis.sprintNames.join(', ')}: {cal.suggestedBasis.points} pts,{' '}
                          {fmt.fte(cal.suggestedBasis.fte)} FTE
                        </div>
                      )}
                    </div>
                  </div>
                  <dl className="b2-dl">
                    <dt>Sprint length</dt>
                    <dd>{cal.sprintLengthDays} days</dd>
                    <dt>Last changed</dt>
                    <dd>{cal.updatedBy ? `${cal.updatedBy.name} · ${fmt.date(cal.updatedAt)}` : 'Never'}</dd>
                    {cal.note && (
                      <>
                        <dt>Note</dt>
                        <dd>{cal.note}</dd>
                      </>
                    )}
                  </dl>
                </div>
              ) : (
                <p className="b2-muted">
                  No Jira data for this tribe yet; the workspace default (10 points per 14-day sprint per FTE) applies.
                </p>
              )}
            </Card>
          </div>
        </div>

        <Card title="Projects" subtitle={b.caption} flush>
          {grid.length === 0 ? (
            <EmptyState compact icon={Network} title="No projects in this tribe" />
          ) : (
            <div className="b2-table-wrap">
              <table className="b2-table">
                <caption className="b2-sr-only">Projects in {tribe.name}</caption>
                <thead>
                  <tr>
                    <th scope="col">Project</th>
                    <th scope="col">Stage</th>
                    <th scope="col">Dates</th>
                    <th scope="col">Demand lines</th>
                    <th scope="col" className="b2-num">
                      Demand
                    </th>
                    <th scope="col" className="b2-num">
                      Staffed
                    </th>
                    <th scope="col" className="b2-num">
                      Gap
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {grid.map((d) => {
                    const c = d.cells[qi];
                    return (
                      <tr key={d.project.id}>
                        <th scope="row">
                          <Link className="b2-link b2-strong" to={`${wsPath('org/projects')}?project=${d.project.id}`}>
                            {d.project.name}
                          </Link>
                        </th>
                        <td>{d.project.stage && <StatusPill>{d.project.stage}</StatusPill>}</td>
                        <td className="b2-tnum">{fmt.dateRange(d.project.startDate, d.project.endDate)}</td>
                        <td>
                          <span className="b2-chips">
                            {c.lines.length === 0 && <span className="b2-subtle">None</span>}
                            {c.lines.map((l) => (
                              <span
                                key={l.id}
                                className={
                                  l.status === 'Confirmed'
                                    ? 'b2-chip b2-chip--demand-confirmed'
                                    : 'b2-chip b2-chip--demand-forecast'
                                }
                              >
                                {idx.crafts.get(l.craftId)?.short} {fmt.fte(l.fte)}
                              </span>
                            ))}
                          </span>
                        </td>
                        <td className="b2-num">{fmt.fte(c.demandFte)}</td>
                        <td className="b2-num">{fmt.fte(c.staffedFte)}</td>
                        <td className="b2-num">
                          {c.gapFte > 0.04 ? (
                            <span className="tr-gap">{fmt.fte(c.gapFte)}</span>
                          ) : (
                            <span className="b2-subtle">0.0</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="People serving this tribe" subtitle="Booked % on the tribe's projects per quarter" flush>
          {view.people.length === 0 ? (
            <EmptyState compact icon={Network} title="Nobody is booked on this tribe's projects" />
          ) : (
            <div className="b2-table-wrap">
              <table className="b2-table b2-table--compact">
                <caption className="b2-sr-only">People serving {tribe.name}</caption>
                <thead>
                  <tr>
                    <th scope="col">Person</th>
                    <th scope="col">Above the table</th>
                    {quarters.map((q) => (
                      <th key={q.key} scope="col" className="b2-num">
                        {q.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...view.people]
                    .sort((a, z) => (z.pctByQuarter[qi] ?? 0) - (a.pctByQuarter[qi] ?? 0))
                    .map((p) => (
                      <tr key={p.person.id}>
                        <th scope="row">
                          <Link className="b2-rowlink" to={`${wsPath('org/people')}?person=${p.person.id}`}>
                            <PersonLabel name={p.person.name} sub={p.person.role} />
                          </Link>
                        </th>
                        <td>
                          <CraftChip craft={p.person.primaryCraft ? idx.crafts.get(p.person.primaryCraft) : null} />
                        </td>
                        {p.pctByQuarter.map((v, i) => (
                          <td key={quarters[i].key} className="b2-num">
                            {v > 0 ? fmt.pct(v) : <span className="b2-subtle">–</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
      {editCal && cal && <CalibrationDialog snapshot={s} calibration={cal} onClose={() => setEditCal(false)} />}
    </>
  );
}
