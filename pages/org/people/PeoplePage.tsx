/**
 * People (PPL-01, PPL-03, PPL-04, PPL-06) — route `/o/:org/w/:ws/org/people` (`?person=<id>|new`, `?tab=requests`).
 * Directory with above/below-the-table crafts and a QBR1–QBR4 heat strip, filters in the URL, group by,
 * bulk edit, CSV import/export, the person drawer and craft-change approvals.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  Funnel,
  ListChecks,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import type * as D from '../../../shared/contracts/dto';
import { bandFor, BAND_LABEL, type UtilBand } from '../../../shared/utilisation';
import { useEntitlements, useMutations, useQuarters, useRecordExport, useWorkspace } from '../../../state';
import { buildPeopleRows, type PersonRow } from '../../../utils/viewModels';
import {
  Banner,
  BandCell,
  Button,
  Card,
  Checkbox,
  CraftChip,
  EmptyState,
  Menu,
  PageBody,
  PageHeader,
  PersonLabel,
  Select,
  SortTh,
  TabPanel,
  Tabs,
  TextField,
  cx,
  downloadText,
  fmt,
  indexSnapshot,
  useAction,
  useBasis,
  useConfirm,
  useQueryParam,
  useSort,
} from '../../plan/_kit';
import { PersonDrawer } from './PersonDrawer';
import { BulkEditDialog, type BulkKind } from './_parts/BulkEditDialog';
import { ImportPeopleDialog } from './_parts/ImportPeopleDialog';
import { CraftRequests } from './_parts/CraftRequests';
import { peopleToCsv } from '../../../utils/csvPeople';
import './people.css';

export default function PeoplePage() {
  const { can } = useWorkspace();
  const ent = useEntitlements();
  const [, setPerson] = useQueryParam('person');
  const [importOpen, setImportOpen] = useState(false);
  const [exportReq, setExportReq] = useState(0);
  const overflow = [
    ...(can('import.csv') && ent.has('csvImport')
      ? [{ label: 'Import CSV', icon: Upload, onSelect: () => setImportOpen(true) }]
      : []),
    ...(can('export') ? [{ label: 'Export CSV', icon: Download, onSelect: () => setExportReq((n) => n + 1) }] : []),
  ];
  return (
    <div className="b2-page">
      <PageHeader
        crumbs={[{ label: 'Organisation' }, { label: 'People' }]}
        title="People"
        description="The PMO squad with above-the-table and below-the-table crafts and their load for the next four quarters."
        basis
        basisExclude={['today', 'window']}
        actions={
          <>
            {can('people.write') && (
              <Button variant="primary" icon={Plus} onClick={() => setPerson('new')}>
                Add person
              </Button>
            )}
            {overflow.length > 0 && <Menu label="More actions" items={overflow} />}
          </>
        }
      />
      <PageBody label="people">
        {(s) => (
          <PeopleBody
            snapshot={s}
            importOpen={importOpen}
            onImportClose={() => setImportOpen(false)}
            exportReq={exportReq}
          />
        )}
      </PageBody>
    </div>
  );
}

type GroupBy = 'none' | 'team' | 'chapter' | 'tribe';

function PeopleBody({
  snapshot: s,
  importOpen,
  onImportClose,
  exportReq,
}: {
  snapshot: D.WorkspaceSnapshot;
  importOpen: boolean;
  onImportClose(): void;
  exportReq: number;
}) {
  const { can, thresholds } = useWorkspace();
  const quarters = useQuarters();
  const recordExport = useRecordExport();
  const b = useBasis();
  const m = useMutations();
  const { run } = useAction();
  const { confirm, dialog } = useConfirm();
  const idx = useMemo(() => indexSnapshot(s), [s]);
  const [personId, setPerson] = useQueryParam('person');
  const [tab, setTab] = useQueryParam('tab', 'people');
  const [q, setQ] = useQueryParam('q');
  const [craft, setCraft] = useQueryParam('craft');
  const [chapter, setChapter] = useQueryParam('chapter');
  const [tribe, setTribe] = useQueryParam('tribe');
  const [band, setBand] = useQueryParam('band');
  const [skill, setSkill] = useQueryParam('skill');
  const [groupBy, setGroupBy] = useQueryParam('group', 'none');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<BulkKind | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const handledExport = useRef(exportReq);

  const rows = useMemo(() => buildPeopleRows(s, quarters, thresholds), [s, quarters, thresholds]);
  const qi = b.quarterIndex;
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      const p = r.person;
      if (needle && !`${p.name} ${p.role} ${p.email ?? ''} ${p.skills.join(' ')}`.toLowerCase().includes(needle))
        return false;
      if (craft && p.primaryCraft !== craft && !p.secondaryCrafts.some((c) => c.craftId === craft)) return false;
      if (chapter && p.chapterId !== chapter) return false;
      if (tribe && !p.tribeAffinity.includes(tribe) && p.homeTribeId !== tribe) return false;
      if (band && r.quarters[qi]?.band !== band) return false;
      if (skill && !p.skills.some((x) => x.toLowerCase() === skill.toLowerCase())) return false;
      return true;
    });
  }, [rows, q, craft, chapter, tribe, band, skill, qi]);

  const accessors = useMemo(
    () => ({
      name: (r: PersonRow) => r.person.name,
      chapter: (r: PersonRow) => r.chapter?.name ?? '',
      team: (r: PersonRow) => r.team?.name ?? '',
      above: (r: PersonRow) => r.primary?.short ?? '',
      target: (r: PersonRow) => r.person.targetUtil,
      q0: (r: PersonRow) => r.quarters[0]?.relativePct ?? 0,
      q1: (r: PersonRow) => r.quarters[1]?.relativePct ?? 0,
      q2: (r: PersonRow) => r.quarters[2]?.relativePct ?? 0,
      q3: (r: PersonRow) => r.quarters[3]?.relativePct ?? 0,
    }),
    [],
  );
  const { rows: sorted, sort, toggle } = useSort(filtered, accessors, { key: 'name', dir: 'asc' });

  const groups = useMemo(() => {
    const gb = groupBy as GroupBy;
    if (gb === 'none') return [{ id: 'all', label: '', rows: sorted }];
    const map = new Map<string, { id: string; label: string; rows: PersonRow[] }>();
    for (const r of sorted) {
      const id = gb === 'team' ? r.person.teamId : gb === 'chapter' ? r.person.chapterId : r.person.homeTribeId;
      const label =
        (gb === 'team' ? r.team?.name : gb === 'chapter' ? r.chapter?.name : id ? idx.tribes.get(id)?.name : null) ??
        `No ${gb === 'tribe' ? 'home tribe' : gb}`;
      const key = id ?? 'none';
      if (!map.has(key)) map.set(key, { id: key, label, rows: [] });
      map.get(key)?.rows.push(r);
    }
    return [...map.values()].sort((a, z) => fmt.compare(a.label, z.label));
  }, [sorted, groupBy, idx]);

  // Export is requested from the page header menu; run it once per request, for the current filter.
  useEffect(() => {
    if (exportReq === handledExport.current) return;
    handledExport.current = exportReq;
    downloadText(
      `people-${quarters[0]?.key ?? 'export'}.csv`,
      peopleToCsv(
        sorted.map((r) => r.person),
        s,
      ),
    );
    void recordExport({ kind: 'people', format: 'csv' }).catch(() => undefined);
  }, [exportReq, sorted, s, quarters, recordExport]);

  const canWrite = can('people.write');
  const pending = s.craftRequests.filter((r) => r.status === 'pending');
  const canApprove = can('craftProfile.approve');
  const activeFilters = [q, craft, chapter, tribe, band, skill].filter(Boolean).length;
  const allSelected = sorted.length > 0 && sorted.every((r) => selected.has(r.person.id));
  const someSelected = sorted.some((r) => selected.has(r.person.id));
  const toggleRow = (id: string) =>
    setSelected((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const clearFilters = () => {
    setQ(null);
    setCraft(null);
    setChapter(null);
    setTribe(null);
    setBand(null);
    setSkill(null);
  };
  const skills = useMemo(() => [...new Set(s.people.flatMap((p) => p.skills))].sort(), [s.people]);

  const remove = async (p: D.PersonDTO) => {
    const n = s.allocations.filter((a) => a.resourceId === p.id).length;
    const ok = await confirm({
      title: `Delete ${p.name}?`,
      body: `${n ? `Their ${n} booking${n === 1 ? '' : 's'} will also be deleted. ` : ''}You can undo this for 8 seconds.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (ok) await run(`rm${p.id}`, () => m.people.remove(p.id), { success: `${p.name} deleted`, undo: true });
  };

  return (
    <>
      {canApprove && pending.length > 0 && tab !== 'requests' && (
        <div className="pp-banner">
          <Banner
            tone="info"
            title={`${pending.length} craft change${pending.length === 1 ? '' : 's'} waiting for approval`}
            action={
              <Button size="sm" variant="secondary" icon={ListChecks} onClick={() => setTab('requests')}>
                Review requests
              </Button>
            }
          />
        </div>
      )}
      {canApprove && (
        <div className="pp-tabs">
          <Tabs
            idPrefix="people"
            label="People views"
            value={tab === 'requests' ? 'requests' : 'people'}
            onChange={(v) => setTab(v)}
            items={[
              { id: 'people', label: 'Directory' },
              { id: 'requests', label: 'Requests', count: pending.length },
            ]}
          />
        </div>
      )}
      <TabPanel idPrefix="people" value={tab === 'requests' ? 'requests' : 'people'}>
        {tab === 'requests' && canApprove ? (
          <CraftRequests snapshot={s} />
        ) : (
          <Card flush>
            {someSelected && canWrite ? (
              <div className="b2-toolbar b2-toolbar--bulk" role="region" aria-label="Bulk actions">
                <span className="b2-toolbar__count">
                  {[...selected].filter((id) => sorted.some((r) => r.person.id === id)).length} selected
                </span>
                <Button size="sm" onClick={() => setBulk('chapter')}>
                  Set chapter
                </Button>
                <Button size="sm" onClick={() => setBulk('team')}>
                  Set team
                </Button>
                <Button size="sm" onClick={() => setBulk('target')}>
                  Set target
                </Button>
                <Button size="sm" onClick={() => setBulk('craft')}>
                  Add below-the-table craft
                </Button>
                <span className="b2-spacer" />
                <Button variant="link" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
              </div>
            ) : (
              <div className="b2-toolbar" role="search" aria-label="Filter people">
                <span className="pp-search">
                  <TextField
                    id="pp-q"
                    icon={Search}
                    size="sm"
                    value={q}
                    placeholder="Search name, title or skill"
                    ariaLabel="Search people"
                    onChange={(v) => setQ(v)}
                  />
                </span>
                <span className="pp-filter">
                  <Select
                    size="sm"
                    ariaLabel="Filter by craft"
                    value={craft}
                    placeholder="Craft: all"
                    onChange={setCraft}
                    options={s.crafts
                      .filter((c) => !c.archived)
                      .map((c) => ({ value: c.id, label: `Craft: ${c.name}` }))}
                  />
                </span>
                <span className="pp-filter">
                  <Select
                    size="sm"
                    ariaLabel="Filter by chapter"
                    value={chapter}
                    placeholder="Chapter: all"
                    onChange={setChapter}
                    options={s.chapters
                      .filter((c) => !c.archived)
                      .map((c) => ({ value: c.id, label: `Chapter: ${c.name}` }))}
                  />
                </span>
                <span className="pp-filter">
                  <Select
                    size="sm"
                    ariaLabel="Filter by tribe affinity"
                    value={tribe}
                    placeholder="Tribe: all"
                    onChange={setTribe}
                    options={s.tribes
                      .filter((c) => !c.archived)
                      .map((c) => ({ value: c.id, label: `Tribe: ${c.name}` }))}
                  />
                </span>
                <span className="pp-filter pp-filter--sm">
                  <Select
                    size="sm"
                    ariaLabel={`Filter by band in ${b.quarter?.label ?? 'QBR1'}`}
                    value={band}
                    placeholder={`Band (${b.quarter?.label ?? 'QBR1'}): all`}
                    onChange={setBand}
                    options={(['over', 'on-target', 'under', 'bench'] as UtilBand[]).map((x) => ({
                      value: x,
                      label: `${b.quarter?.label}: ${BAND_LABEL[x]}`,
                    }))}
                  />
                </span>
                {skills.length > 0 && (
                  <span className="pp-filter pp-filter--sm">
                    <Select
                      size="sm"
                      ariaLabel="Filter by skill"
                      value={skill}
                      placeholder="Skill: all"
                      onChange={setSkill}
                      options={skills.map((x) => ({ value: x, label: `Skill: ${x}` }))}
                    />
                  </span>
                )}
                {activeFilters > 0 && (
                  <Button size="sm" variant="subtle" icon={X} onClick={clearFilters}>
                    Clear filters
                  </Button>
                )}
                <span className="b2-spacer" />
                <span className="pp-filter pp-filter--sm">
                  <Select
                    size="sm"
                    ariaLabel="Group by"
                    value={groupBy}
                    onChange={(v) => setGroupBy(v)}
                    options={[
                      { value: 'none', label: 'Group: none' },
                      { value: 'team', label: 'Group: team' },
                      { value: 'chapter', label: 'Group: chapter' },
                      { value: 'tribe', label: 'Group: home tribe' },
                    ]}
                  />
                </span>
              </div>
            )}
            {sorted.length === 0 ? (
              rows.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title="No people yet"
                  body="Add your squad to start planning capacity."
                  action={
                    canWrite && (
                      <Button variant="primary" icon={Plus} onClick={() => setPerson('new')}>
                        Add person
                      </Button>
                    )
                  }
                />
              ) : (
                <EmptyState
                  icon={Funnel}
                  title="No people match these filters."
                  action={
                    <Button variant="link" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  }
                />
              )
            ) : (
              <div className="b2-table-wrap b2-table-wrap--tall">
                <table className="b2-table pp-table">
                  <caption className="b2-sr-only">People with crafts and quarterly load ({b.caption})</caption>
                  <thead>
                    <tr>
                      {canWrite && (
                        <th scope="col" className="b2-cell-check">
                          <Checkbox
                            label="Select all people"
                            hideLabel
                            checked={allSelected}
                            indeterminate={someSelected && !allSelected}
                            onChange={(v) => setSelected(v ? new Set(sorted.map((r) => r.person.id)) : new Set())}
                          />
                        </th>
                      )}
                      <SortTh label="Person" sortKey="name" sort={sort} onSort={toggle} className="pp-col-person" />
                      <SortTh
                        label="Chapter"
                        sortKey="chapter"
                        sort={sort}
                        onSort={toggle}
                        className="pp-col-wide pp-col-chapter"
                      />
                      <SortTh
                        label="Team"
                        sortKey="team"
                        sort={sort}
                        onSort={toggle}
                        className="pp-col-wide pp-col-team"
                      />
                      <SortTh
                        label="Above"
                        sortKey="above"
                        sort={sort}
                        onSort={toggle}
                        className="pp-col-above"
                        title="Above-the-table craft"
                      />
                      <th scope="col" className="pp-col-below" title="Below-the-table crafts">
                        Below the table
                      </th>
                      <SortTh
                        label="Target"
                        sortKey="target"
                        sort={sort}
                        onSort={toggle}
                        numeric
                        className="pp-col-target"
                      />
                      {quarters.map((qq, i) => (
                        <SortTh
                          key={qq.key}
                          label={qq.label}
                          sortKey={`q${i}`}
                          sort={sort}
                          onSort={toggle}
                          numeric
                          className={cx('pp-col-q', i === qi && 'is-basis')}
                          title={fmt.quarterTooltip(qq)}
                        >
                          <span className="pp-qhead">
                            {qq.label}
                            <span className="pp-qhead__sub">{qq.calendarLabel}</span>
                          </span>
                        </SortTh>
                      ))}
                      <th scope="col" className="b2-cell-menu">
                        <span className="b2-sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => {
                      const isCollapsed = collapsed.has(g.id);
                      return (
                        <Fragment key={g.id}>
                          {groupBy !== 'none' && (
                            <tr className="b2-group">
                              <th scope="rowgroup" colSpan={canWrite ? 7 : 6}>
                                <button
                                  type="button"
                                  className="b2-rowlink pp-grouptoggle"
                                  aria-expanded={!isCollapsed}
                                  onClick={() =>
                                    setCollapsed((c) => {
                                      const n = new Set(c);
                                      if (n.has(g.id)) n.delete(g.id);
                                      else n.add(g.id);
                                      return n;
                                    })
                                  }
                                >
                                  {isCollapsed ? (
                                    <ChevronRight size={16} aria-hidden="true" />
                                  ) : (
                                    <ChevronDown size={16} aria-hidden="true" />
                                  )}
                                  {g.label} <span className="b2-caption">· {g.rows.length}</span>
                                </button>
                              </th>
                              {quarters.map((qq, i) => {
                                const load = g.rows.reduce((x, r) => x + (r.quarters[i]?.loadPct ?? 0), 0);
                                const target = g.rows.reduce(
                                  (x, r) => x + (r.person.targetUtil > 0 ? r.person.targetUtil : 100),
                                  0,
                                );
                                const rel = target > 0 ? (100 * load) / target : 0;
                                return (
                                  <td key={qq.key} className="b2-num">
                                    <BandCell
                                      value={rel}
                                      band={bandFor(rel, thresholds)}
                                      label={`${g.label} ${qq.label}`}
                                    />
                                  </td>
                                );
                              })}
                              <td />
                            </tr>
                          )}
                          {!isCollapsed &&
                            g.rows.map((r) => {
                              const p = r.person;
                              const isSel = selected.has(p.id);
                              const secondaryLine = [r.chapter?.name, r.team?.name].filter(Boolean).join(' · ');
                              return (
                                <tr key={p.id} className={cx(isSel && 'is-selected')}>
                                  {canWrite && (
                                    <td className="b2-cell-check">
                                      <Checkbox
                                        label={`Select ${p.name}`}
                                        hideLabel
                                        checked={isSel}
                                        onChange={() => toggleRow(p.id)}
                                      />
                                    </td>
                                  )}
                                  <th scope="row" className="pp-col-person">
                                    <button
                                      type="button"
                                      className="b2-rowlink pp-person"
                                      onClick={() => setPerson(p.id)}
                                    >
                                      <PersonLabel
                                        name={p.name}
                                        sub={
                                          <>
                                            <span className="pp-sub-title">{p.role}</span>
                                            {secondaryLine && <span className="pp-sub-org"> · {secondaryLine}</span>}
                                          </>
                                        }
                                      />
                                    </button>
                                  </th>
                                  <td className="pp-col-wide pp-col-chapter">
                                    <span className="b2-ellipsis pp-trunc" title={r.chapter?.name}>
                                      {r.chapter?.name ?? '—'}
                                    </span>
                                  </td>
                                  <td className="pp-col-wide pp-col-team">
                                    <span className="b2-ellipsis pp-trunc" title={r.team?.name}>
                                      {r.team?.name ?? '—'}
                                    </span>
                                  </td>
                                  <td className="pp-col-above">
                                    <CraftChip craft={r.primary} via="above" />
                                  </td>
                                  <td className="pp-col-below">
                                    <span className="b2-chips">
                                      {r.secondary.length === 0 && <span className="b2-subtle">—</span>}
                                      {r.secondary.map((c) => (
                                        <CraftChip
                                          key={c.craft.id}
                                          craft={c.craft}
                                          via="below"
                                          proficiency={c.proficiency}
                                          maxPct={c.maxPct}
                                        />
                                      ))}
                                    </span>
                                  </td>
                                  <td className="b2-num pp-col-target">{fmt.pct(p.targetUtil)}</td>
                                  {r.quarters.map((qq, i) => (
                                    <td key={qq.key} className={cx('b2-num pp-col-q', i === qi && 'is-basis')}>
                                      <BandCell
                                        value={qq.relativePct}
                                        band={qq.band}
                                        label={`${p.name}, ${quarters[i]?.label}`}
                                      />
                                    </td>
                                  ))}
                                  <td className="b2-cell-menu">
                                    <Menu
                                      label={`Actions for ${p.name}`}
                                      size="sm"
                                      items={[
                                        {
                                          label: canWrite ? 'Edit' : 'Open',
                                          icon: Pencil,
                                          onSelect: () => setPerson(p.id),
                                        },
                                        ...(canWrite
                                          ? [
                                              {
                                                label: 'Delete',
                                                icon: Trash2,
                                                danger: true,
                                                separatorBefore: true,
                                                onSelect: () => void remove(p),
                                              },
                                            ]
                                          : []),
                                      ]}
                                    />
                                  </td>
                                </tr>
                              );
                            })}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="b2-card__foot">
              <span className="b2-caption">
                {sorted.length} of {rows.length} people · load as % of each person&apos;s target · band filter uses{' '}
                {b.caption}
              </span>
              <span className="b2-spacer" />
              <span className="b2-caption">Filled chip = above the table · outlined = below the table (L1–L3)</span>
            </div>
          </Card>
        )}
      </TabPanel>
      <PersonDrawer snapshot={s} personId={personId || null} onClose={() => setPerson(null)} />
      <BulkEditDialog
        snapshot={s}
        kind={bulk}
        ids={[...selected].filter((id) => sorted.some((r) => r.person.id === id))}
        onClose={(done) => {
          setBulk(null);
          if (done) setSelected(new Set());
        }}
      />
      <ImportPeopleDialog snapshot={s} open={importOpen} onClose={onImportClose} />
      {dialog}
    </>
  );
}
