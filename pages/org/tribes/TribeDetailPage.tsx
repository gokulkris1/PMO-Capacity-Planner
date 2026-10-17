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
  Button,
  Card,
  ChartPanel,
  CraftChip,
  EmptyState,
  fmt,
  GroupedBarChart,
  indexSnapshot,
  KpiTile,
  PageHeader,
  PersonLabel,
  StatusPill,
  LinkButton,
} from '../../../components/ui';
import { PageBody } from '../../../components/shell/PageBody';
import { useTimeBasis, TimeBasisControl } from '../../../components/shell/TimeBasis';
import { useWsPath } from '../../../components/shell/workspacePath';
import { CalibrationDialog } from '../../delivery/_parts/CalibrationDialog';
import { useDelivery } from '../../../state';
import './tribes.css';

export default function TribeDetailPage() {
  const { tribeId = '' } = useParams();
  const wsPath = useWsPath();
  return (
    <div className="pcp-page">
      <PageBody label="the tribe">
        {(s) => {
          const tribe = s.tribes.find((t) => t.id === tribeId);
          if (!tribe)
            return (
              <>
                <PageHeader
                  breadcrumbs={[
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
                    description="It may have been archived or the link is wrong."
                    action={
                      <LinkButton variant="secondary" to={wsPath('org/tribes')}>
                        All tribes
                      </LinkButton>
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
  const b = useTimeBasis('qbr1');
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
        breadcrumbs={[{ label: 'Organisation' }, { label: 'Tribes', to: wsPath('org/tribes') }, { label: tribe.name }]}
        title={tribe.name}
        description={`${tribe.leadName ? `Lead: ${tribe.leadName} · ` : ''}${view.projects.length} project${view.projects.length === 1 ? '' : 's'} · ${view.people.length} PMO people serving`}
        timeBasis={<TimeBasisControl state={b} exclude={['today', 'window']} />}
        actions={
          <LinkButton variant="secondary" to={`${wsPath('plan/marketplace')}?tab=catalogue&tribe=${tribe.id}`}>
            Squad catalogue for {tribe.name}
          </LinkButton>
        }
      />
      <div className="pcp-stack">
        <div className="pcp-kpi-grid" role="list" aria-label="Tribe figures">
          <div role="listitem">
            <KpiTile
              label="Demand"
              value={fmt.fte(view.demandFte[qi])}
              unit="FTE"
              caption={b.caption}
              delta={`${grid.reduce((x, d) => x + d.cells[qi].lines.length, 0)} craft lines`}
            />
          </div>
          <div role="listitem">
            <KpiTile
              label="Staffed"
              value={fmt.fte(view.staffedFte[qi])}
              unit="FTE"
              caption={b.caption}
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
              caption={b.caption}
            />
          </div>
          <div role="listitem">
            <KpiTile
              label="People serving"
              value={view.people.filter((p) => (p.pctByQuarter[qi] ?? 0) > 0).length}
              unit="people"
              caption={b.caption}
              delta={`${fmt.fte(view.people.reduce((x, p) => x + (p.pctByQuarter[qi] ?? 0), 0) / 100)} FTE booked`}
            />
          </div>
        </div>

        <div className="pcp-grid-xl">
          <div className="pcp-span-7">
            <ChartPanel
              title="Demand vs staffed"
              caption="FTE per quarter across the tribe's projects"
              legend={[
                { swatch: '4', label: 'Demand' },
                { swatch: '1', label: 'Staffed (confirmed)' },
              ]}
              table={
                <div className="pcp-tbl-wrap">
                  <table className="pcp-tbl pcp-tbl--compact">
                    <caption className="pcp-sr-only">Demand and staffed by craft</caption>
                    <thead>
                      <tr>
                        <th scope="col">Craft</th>
                        {quarters.map((q) => (
                          <th key={q.key} scope="col" className="pcp-num">
                            {q.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {byCraft.map(([craftId, vals]) => (
                        <tr key={craftId}>
                          <th scope="row">
                            <span className="pcp-row">
                              <CraftChip craft={idx.crafts.get(craftId)} />
                              {idx.crafts.get(craftId)?.name}
                            </span>
                          </th>
                          {vals.map((v, i) => (
                            <td key={quarters[i].key} className="pcp-num">
                              {fmt.fte(v)}
                            </td>
                          ))}
                        </tr>
                      ))}
                      <tr className="pcp-tbl-total">
                        <th scope="row">Demand total</th>
                        {view.demandFte.map((v, i) => (
                          <td key={quarters[i].key} className="pcp-num">
                            {fmt.fte(v)}
                          </td>
                        ))}
                      </tr>
                      <tr className="pcp-tbl-total">
                        <th scope="row">Staffed</th>
                        {view.staffedFte.map((v, i) => (
                          <td key={quarters[i].key} className="pcp-num">
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
            </ChartPanel>
          </div>
          <div className="pcp-span-5">
            <Card
              title="Story-point calibration"
              subtitle="Points per sprint per FTE, used to turn Jira story points into FTE"
              actions={
                cal &&
                can('integrations.run') && (
                  <Button size="sm" variant="subtle" iconBefore={Pencil} onClick={() => setEditCal(true)}>
                    Edit
                  </Button>
                )
              }
            >
              {cal ? (
                <div className="pcp-stack pcp-stack--md">
                  <div className="tr-cal">
                    <div>
                      <div className="pcp-caption pcp-text-tertiary">Current</div>
                      <div className="tr-cal__value pcp-tnum">{cal.pointsPerSprintPerFte}</div>
                      {cal.isDefault && <StatusPill>Default</StatusPill>}
                    </div>
                    <div>
                      <div className="pcp-caption pcp-text-tertiary">Suggested</div>
                      <div className="tr-cal__value pcp-tnum">{cal.suggestedValue ?? '—'}</div>
                      {cal.suggestedBasis && (
                        <div className="pcp-caption pcp-text-tertiary">
                          Based on {cal.suggestedBasis.sprintNames.join(', ')}: {cal.suggestedBasis.points} pts,{' '}
                          {fmt.fte(cal.suggestedBasis.fte)} FTE
                        </div>
                      )}
                    </div>
                  </div>
                  <dl className="pcp-dl">
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
                <p className="pcp-text-secondary">
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
            <div className="pcp-tbl-wrap">
              <table className="pcp-tbl">
                <caption className="pcp-sr-only">Projects in {tribe.name}</caption>
                <thead>
                  <tr>
                    <th scope="col">Project</th>
                    <th scope="col">Stage</th>
                    <th scope="col">Dates</th>
                    <th scope="col">Demand lines</th>
                    <th scope="col" className="pcp-num">
                      Demand
                    </th>
                    <th scope="col" className="pcp-num">
                      Staffed
                    </th>
                    <th scope="col" className="pcp-num">
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
                          <Link
                            className="pcp-link pcp-strong"
                            to={`${wsPath('org/projects')}?project=${d.project.id}`}
                          >
                            {d.project.name}
                          </Link>
                        </th>
                        <td>{d.project.stage && <StatusPill>{d.project.stage}</StatusPill>}</td>
                        <td className="pcp-tnum">{fmt.dateRange(d.project.startDate, d.project.endDate)}</td>
                        <td>
                          <span className="pcp-chips">
                            {c.lines.length === 0 && <span className="pcp-text-tertiary">None</span>}
                            {c.lines.map((l) => (
                              <span
                                key={l.id}
                                className={
                                  l.status === 'Confirmed'
                                    ? 'pcp-craft-chip pcp-craft-chip--demand-confirmed'
                                    : 'pcp-craft-chip pcp-craft-chip--demand-forecast'
                                }
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
                            <span className="tr-gap">{fmt.fte(c.gapFte)}</span>
                          ) : (
                            <span className="pcp-text-tertiary">0.0</span>
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
            <div className="pcp-tbl-wrap">
              <table className="pcp-tbl pcp-tbl--compact">
                <caption className="pcp-sr-only">People serving {tribe.name}</caption>
                <thead>
                  <tr>
                    <th scope="col">Person</th>
                    <th scope="col">Above the table</th>
                    {quarters.map((q) => (
                      <th key={q.key} scope="col" className="pcp-num">
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
                          <Link className="pcp-rowlink" to={`${wsPath('org/people')}?person=${p.person.id}`}>
                            <PersonLabel name={p.person.name} sub={p.person.role} />
                          </Link>
                        </th>
                        <td>
                          <CraftChip craft={p.person.primaryCraft ? idx.crafts.get(p.person.primaryCraft) : null} />
                        </td>
                        {p.pctByQuarter.map((v, i) => (
                          <td key={quarters[i].key} className="pcp-num">
                            {v > 0 ? fmt.pct(v) : <span className="pcp-text-tertiary">–</span>}
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
