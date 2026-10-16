/**
 * Projects (PPL-07) — route `/o/:org/w/:ws/org/projects` (`?project=<id>|new`, `?stage=`, `?tribe=`, `?q=`).
 * Stage pipeline, project table with QBR1 demand/staffed/gap, Jira and Planview links, and the project drawer.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, FolderKanban, Funnel, Plus, Search, X } from 'lucide-react';
import type * as D from '../../../shared/contracts/dto';
import { useQuarters, useRecordExport, useSession, useWorkspace } from '../../../state';
import { buildDemandGrid } from '../../../utils/viewModels';
import {
  Button,
  Card,
  EmptyState,
  Menu,
  PageBody,
  PageHeader,
  ProvenanceTag,
  Select,
  SortTh,
  StatusPill,
  TextField,
  cx,
  downloadText,
  fmt,
  toCsv,
  useQueryParam,
  useSort,
} from '../../plan/_kit';
import { ProjectDrawer } from './ProjectDrawer';
import './projects.css';

export default function ProjectsPage() {
  const { can } = useWorkspace();
  const [, setProject] = useQueryParam('project');
  const [exportReq, setExportReq] = useState(0);
  return (
    <div className="b2-page">
      <PageHeader
        crumbs={[{ label: 'Organisation' }, { label: 'Projects' }]}
        title="Projects"
        description="Every project with its stage, initiation date, demand and staffing for QBR1, and its Jira and Planview links."
        actions={
          <>
            {can('projects.write') && (
              <Button variant="primary" icon={Plus} onClick={() => setProject('new')}>
                Add project
              </Button>
            )}
            {can('export') && (
              <Menu
                label="More actions"
                items={[{ label: 'Export CSV', icon: Download, onSelect: () => setExportReq((n) => n + 1) }]}
              />
            )}
          </>
        }
      />
      <PageBody label="projects">{(s) => <ProjectsBody snapshot={s} exportReq={exportReq} />}</PageBody>
    </div>
  );
}

type Row = ReturnType<typeof buildDemandGrid>[number];

function ProjectsBody({ snapshot: s, exportReq }: { snapshot: D.WorkspaceSnapshot; exportReq: number }) {
  const quarters = useQuarters();
  const recordExport = useRecordExport();
  const { can } = useWorkspace();
  const { me } = useSession();
  const [projectId, setProject] = useQueryParam('project');
  const [stage, setStage] = useQueryParam('stage');
  const [tribe, setTribe] = useQueryParam('tribe');
  const [status, setStatus] = useQueryParam('status');
  const [q, setQ] = useQueryParam('q');
  const handledExport = useRef(exportReq);
  const grid = useMemo(() => buildDemandGrid(s, quarters), [s, quarters]);
  const filtered = grid.filter(
    (d) =>
      (!stage || d.project.stage === stage) &&
      (!tribe || d.project.tribeId === tribe) &&
      (!status || d.project.status === status) &&
      (!q || `${d.project.name} ${d.project.jiraKey ?? ''}`.toLowerCase().includes(q.toLowerCase())),
  );
  const accessors = useMemo(
    () => ({
      name: (r: Row) => r.project.name,
      jira: (r: Row) => r.project.jiraKey ?? '',
      tribe: (r: Row) => r.tribe?.name ?? '',
      stage: (r: Row) => fmt.STAGE_ORDER.indexOf(r.project.stage ?? 'Pipeline'),
      status: (r: Row) => r.project.status,
      start: (r: Row) => r.project.startDate ?? '',
      demand: (r: Row) => r.cells[0]?.demandFte ?? 0,
      staffed: (r: Row) => r.cells[0]?.staffedFte ?? 0,
      gap: (r: Row) => r.cells[0]?.gapFte ?? 0,
    }),
    [],
  );
  const { rows, sort, toggle } = useSort(filtered, accessors, { key: 'stage', dir: 'asc' });
  const q1 = quarters[0];

  const doExport = useCallback(() => {
    void recordExport({ kind: 'projects', format: 'csv' }).catch(() => undefined);
    downloadText(
      'projects.csv',
      toCsv(
        [
          'name',
          'jira_key',
          'tribe',
          'stage',
          'status',
          'start',
          'end',
          'initiated_on',
          `demand_${q1?.key}`,
          `staffed_${q1?.key}`,
          `gap_${q1?.key}`,
          'source',
          'planview_id',
        ],
        rows.map((r) => [
          r.project.name,
          r.project.jiraKey ?? '',
          r.tribe?.name ?? '',
          r.project.stage ?? '',
          r.project.status,
          r.project.startDate ?? '',
          r.project.endDate ?? '',
          r.project.initiatedOn ?? '',
          r.cells[0]?.demandFte ?? 0,
          r.cells[0]?.staffedFte ?? 0,
          Math.max(0, r.cells[0]?.gapFte ?? 0),
          r.project.source,
          r.project.planviewId ?? '',
        ]),
      ),
    );
  }, [rows, q1, recordExport]);
  useEffect(() => {
    if (exportReq === handledExport.current) return;
    handledExport.current = exportReq;
    doExport();
  }, [exportReq, doExport]);

  const pipeline = fmt.STAGE_ORDER.map((st) => {
    const items = grid.filter((d) => d.project.stage === st && d.project.status !== 'Completed');
    return {
      stage: st,
      count: items.length,
      demand: items.reduce((x, d) => x + (d.cells[0]?.demandFte ?? 0), 0),
      gap: items.reduce((x, d) => x + Math.max(0, d.cells[0]?.gapFte ?? 0), 0),
    };
  });
  const filters = [stage, tribe, status, q].filter(Boolean).length;

  return (
    <div className="b2-stack">
      <ol className="pj-pipeline" aria-label="Stage pipeline">
        {pipeline.map((p) => (
          <li key={p.stage}>
            <button
              type="button"
              className={cx('pj-stage', stage === p.stage && 'is-active')}
              aria-pressed={stage === p.stage}
              onClick={() => setStage(stage === p.stage ? null : p.stage)}
            >
              <span className="pj-stage__label">{p.stage}</span>
              <span className="pj-stage__count b2-tnum">{p.count}</span>
              <span className="b2-caption b2-tnum">
                {fmt.fte(p.demand)} FTE demand {q1?.label}
                {p.gap > 0.04 && <span className="pj-gap"> · gap {fmt.fte(p.gap)}</span>}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <Card flush>
        <div className="b2-toolbar">
          <span className="pj-search">
            <TextField
              id="pj-q"
              icon={Search}
              size="sm"
              value={q}
              placeholder="Find a project or Jira key"
              ariaLabel="Find a project"
              onChange={(v) => setQ(v)}
            />
          </span>
          <span className="pj-filter">
            <Select
              size="sm"
              ariaLabel="Filter by tribe"
              value={tribe}
              placeholder="Tribe: all"
              onChange={setTribe}
              options={s.tribes.filter((t) => !t.archived).map((t) => ({ value: t.id, label: `Tribe: ${t.name}` }))}
            />
          </span>
          <span className="pj-filter">
            <Select
              size="sm"
              ariaLabel="Filter by status"
              value={status}
              placeholder="Status: all"
              onChange={setStatus}
              options={['Planning', 'Active', 'On Hold', 'Completed'].map((x) => ({ value: x, label: `Status: ${x}` }))}
            />
          </span>
          {filters > 0 && (
            <Button
              size="sm"
              variant="subtle"
              icon={X}
              onClick={() => {
                setStage(null);
                setTribe(null);
                setStatus(null);
                setQ(null);
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
        {rows.length === 0 ? (
          grid.length === 0 ? (
            <EmptyState
              icon={FolderKanban}
              title="No projects yet"
              body="Add the projects your tribes have initiated."
              action={
                can('projects.write') && (
                  <Button variant="primary" icon={Plus} onClick={() => setProject('new')}>
                    Add project
                  </Button>
                )
              }
            />
          ) : (
            <EmptyState icon={Funnel} title="No projects match these filters." />
          )
        ) : (
          <div className="b2-table-wrap b2-table-wrap--tall">
            <table className="b2-table pj-table">
              <caption className="b2-sr-only">Projects</caption>
              <thead>
                <tr>
                  <SortTh
                    label="Project"
                    sortKey="name"
                    sort={sort}
                    onSort={toggle}
                    className="b2-sticky-col pj-col-name"
                  />
                  <SortTh label="Jira" sortKey="jira" sort={sort} onSort={toggle} className="pj-col-jira" />
                  <SortTh label="Tribe" sortKey="tribe" sort={sort} onSort={toggle} className="pj-col-tribe" />
                  <SortTh label="Stage" sortKey="stage" sort={sort} onSort={toggle} className="pj-col-stage" />
                  <SortTh label="Status" sortKey="status" sort={sort} onSort={toggle} className="pj-col-status" />
                  <SortTh label="Dates" sortKey="start" sort={sort} onSort={toggle} className="pj-col-dates" />
                  <SortTh
                    label={`Demand ${q1?.label}`}
                    sortKey="demand"
                    sort={sort}
                    onSort={toggle}
                    numeric
                    className="pj-col-num"
                    title="FTE"
                  >
                    <span className="pj-qhead">
                      Demand<span className="pj-qhead__sub">{q1?.label}</span>
                    </span>
                  </SortTh>
                  <SortTh
                    label={`Staffed ${q1?.label}`}
                    sortKey="staffed"
                    sort={sort}
                    onSort={toggle}
                    numeric
                    className="pj-col-num"
                    title="FTE, confirmed bookings"
                  >
                    <span className="pj-qhead">
                      Staffed<span className="pj-qhead__sub">{q1?.label}</span>
                    </span>
                  </SortTh>
                  <SortTh
                    label={`Gap ${q1?.label}`}
                    sortKey="gap"
                    sort={sort}
                    onSort={toggle}
                    numeric
                    className="pj-col-num"
                    title="FTE"
                  >
                    <span className="pj-qhead">
                      Gap<span className="pj-qhead__sub">{q1?.label}</span>
                    </span>
                  </SortTh>
                  <th scope="col" className="pj-col-owner">
                    Owner
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const p = r.project;
                  const c = r.cells[0];
                  return (
                    <tr key={p.id}>
                      <th scope="row" className="b2-sticky-col pj-col-name">
                        <button type="button" className="b2-rowlink pj-name" onClick={() => setProject(p.id)}>
                          <span className="b2-rowlink__label b2-strong b2-ellipsis" title={p.name}>
                            {p.name}
                          </span>
                          <span className="b2-caption pj-name__sub">
                            {p.source === 'planview' && <ProvenanceTag source="planview" />}
                            {p.initiatedOn ? `Initiated ${fmt.date(p.initiatedOn)}` : p.priority}
                          </span>
                        </button>
                      </th>
                      <td className="b2-tnum">{p.jiraKey ?? <span className="b2-subtle">—</span>}</td>
                      <td className="b2-ellipsis">{r.tribe?.name ?? <span className="b2-subtle">No tribe</span>}</td>
                      <td>{p.stage ? <StatusPill>{p.stage}</StatusPill> : <span className="b2-subtle">—</span>}</td>
                      <td>{p.status}</td>
                      <td className="b2-tnum pj-dates">{fmt.dateRange(p.startDate, p.endDate)}</td>
                      <td className="b2-num">{fmt.fte(c?.demandFte)}</td>
                      <td className="b2-num">{fmt.fte(c?.staffedFte)}</td>
                      <td className="b2-num">
                        {c && c.gapFte > 0.04 ? (
                          <span className="pj-gap-pill">{fmt.fte(c.gapFte)}</span>
                        ) : (
                          <span className="b2-subtle">0.0</span>
                        )}
                      </td>
                      <td className="b2-ellipsis">
                        {p.ownerUserId ? (
                          p.ownerUserId === me?.user.id ? (
                            'You'
                          ) : (
                            'Assigned'
                          )
                        ) : (
                          <span className="b2-subtle">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="b2-card__foot">
          <span className="b2-caption">
            {rows.length} of {grid.length} projects · FTE for {fmt.quarterCaption(q1)} · projects carry no colour;
            status colours mean status only
          </span>
        </div>
      </Card>
      <ProjectDrawer snapshot={s} projectId={projectId || null} onClose={() => setProject(null)} />
    </div>
  );
}
