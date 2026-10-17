/**
 * Sprint capacity grid (SH-05, v1.1 QBR module): members grouped by tribe or centre of excellence, booked % per
 * sprint with the projects behind it, average across the quarter. Selecting a cell opens the booking dialog.
 */
import { Fragment, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { bandFor } from '../../../shared/utilisation';
import type { QBRBooking, QBRChapter, QBRCoE, QBRMember, QBRProject, QBRSprint, QBRTribe } from '../../../types';
import {
  BandCell,
  Button,
  Card,
  Dialog,
  EmptyState,
  FormField,
  NumberField,
  PersonLabel,
  Select,
  StatusPill,
  errorMessage,
  fmt,
  numOrNull,
  numText,
} from '../../../components/ui';
import { averageUtil, type BookingInput } from './useSprintData';

const TYPE_LABEL: Record<string, string> = { INTERNAL: 'Internal', VENDOR: 'Vendor', CONTRACTOR: 'Contractor' };

export function priorityTone(p: string): 'danger' | 'warning' | 'neutral' {
  return p === 'CRITICAL' ? 'danger' : p === 'HIGH' ? 'warning' : 'neutral';
}

export function SprintGrid({
  members,
  projects,
  sprints,
  bookings,
  tribes,
  chapters,
  coe,
  tribeFilter,
  onTribeFilter,
  canEdit,
  onBook,
  onSelectMember,
}: {
  members: QBRMember[];
  projects: QBRProject[];
  sprints: QBRSprint[];
  bookings: QBRBooking[];
  tribes: QBRTribe[];
  chapters: QBRChapter[];
  coe: QBRCoE[];
  tribeFilter: string;
  onTribeFilter(id: string): void;
  canEdit: boolean;
  onBook(b: BookingInput): Promise<void>;
  onSelectMember(m: QBRMember): void;
}) {
  const [chapter, setChapter] = useState('');
  const [type, setType] = useState('');
  const [editing, setEditing] = useState<{ member: QBRMember; sprint: QBRSprint } | null>(null);

  const filtered = useMemo(
    () =>
      members.filter(
        (m) =>
          (!tribeFilter || m.tribe_id === tribeFilter) &&
          (!chapter || m.chapter_id === chapter) &&
          (!type || m.member_type === type),
      ),
    [members, tribeFilter, chapter, type],
  );

  const groups = useMemo(() => {
    const out: Array<{ id: string; label: string; members: QBRMember[] }> = [];
    for (const t of tribes) {
      const list = filtered.filter((m) => m.tribe_id === t.id);
      if (list.length) out.push({ id: t.id, label: t.name, members: list });
    }
    for (const g of coe) {
      const list = filtered.filter((m) => !m.tribe_id && m.coe_id === g.id);
      if (list.length) out.push({ id: g.id, label: `Centre of excellence · ${g.name}`, members: list });
    }
    const rest = filtered.filter((m) => !m.tribe_id && !m.coe_id);
    if (rest.length) out.push({ id: 'shared', label: 'Shared or unassigned', members: rest });
    return out;
  }, [filtered, tribes, coe]);

  const cellBookings = (memberId: string, sprintId: string) =>
    bookings.filter((b) => b.member_id === memberId && b.sprint_id === sprintId);

  return (
    <div className="pcp-stack">
      <Card flush>
        <div className="pcp-tbl-toolbar">
          <Select
            size="sm"
            aria-label="Tribe"
            value={tribeFilter}
            onValueChange={onTribeFilter}
            options={[{ value: '', label: 'Tribe: all' }, ...tribes.map((t) => ({ value: t.id, label: t.name }))]}
          />
          <Select
            size="sm"
            aria-label="Chapter"
            value={chapter}
            onValueChange={setChapter}
            options={[{ value: '', label: 'Chapter: all' }, ...chapters.map((c) => ({ value: c.id, label: c.name }))]}
          />
          <Select
            size="sm"
            aria-label="Member type"
            value={type}
            onValueChange={setType}
            options={[
              { value: '', label: 'Type: all' },
              { value: 'INTERNAL', label: 'Internal' },
              { value: 'VENDOR', label: 'Vendor' },
              { value: 'CONTRACTOR', label: 'Contractor' },
            ]}
          />
          <span className="pcp-spacer" />
          <span className="pcp-caption pcp-text-tertiary">
            {filtered.length} members · {sprints.length} sprints · booked % per sprint
          </span>
        </div>
        {groups.length === 0 ? (
          <EmptyState compact title="No members match these filters" />
        ) : (
          <div className="pcp-tbl-wrap pcp-tbl-wrap--tall">
            <table className="pcp-tbl pcp-tbl--compact sp-grid">
              <caption className="pcp-sr-only">Booked percentage per member and sprint</caption>
              <thead>
                <tr>
                  <th scope="col" className="pcp-tbl-sticky sp-grid__name">
                    Member
                  </th>
                  <th scope="col" className="pcp-num">
                    Average
                  </th>
                  {sprints.map((sp) => (
                    <th key={sp.id} scope="col" className="pcp-num" title={fmt.dateRange(sp.start_date, sp.end_date)}>
                      {sp.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <Fragment key={g.id}>
                    <tr className="pcp-tbl-group">
                      <th scope="colgroup" colSpan={sprints.length + 2} className="pcp-tbl-sticky">
                        {g.label} · {g.members.length}
                      </th>
                    </tr>
                    {g.members.map((m) => {
                      const avg = averageUtil(bookings, m.id, sprints.length);
                      return (
                        <tr key={m.id}>
                          <th scope="row" className="pcp-tbl-sticky sp-grid__name">
                            <button type="button" className="pcp-rowlink" onClick={() => onSelectMember(m)}>
                              <PersonLabel
                                name={m.name}
                                sub={[
                                  m.chapter_name ?? m.coe_name ?? m.role_title ?? '',
                                  m.member_type !== 'INTERNAL' ? TYPE_LABEL[m.member_type] : '',
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              />
                            </button>
                          </th>
                          <td className="pcp-num">
                            <BandCell value={avg} band={avg > 0 ? bandFor(avg) : null} label="Average" />
                          </td>
                          {sprints.map((sp) => {
                            const list = cellBookings(m.id, sp.id);
                            const total = list.reduce((s, b) => s + b.percentage, 0);
                            const label = `${m.name}, ${sp.label}`;
                            const content =
                              total > 0 ? (
                                <span className="sp-cell">
                                  <BandCell value={total} band={bandFor(total)} label={label} />
                                  {list.map((b) => (
                                    <span key={b.id ?? `${b.project_id}-${b.sprint_id}`} className="sp-cell__line">
                                      {b.project_name} {b.percentage}%
                                    </span>
                                  ))}
                                </span>
                              ) : (
                                <span className="sp-cell sp-cell--empty">
                                  {canEdit ? <Plus size={14} strokeWidth={1.75} aria-hidden="true" /> : '—'}
                                </span>
                              );
                            return (
                              <td key={sp.id} className="sp-grid__cell">
                                {canEdit ? (
                                  <button
                                    type="button"
                                    className="sp-cell-btn"
                                    aria-label={`Book ${label}${total ? `, ${total}% booked` : ''}`}
                                    onClick={() => setEditing({ member: m, sprint: sp })}
                                  >
                                    {content}
                                  </button>
                                ) : (
                                  content
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <ProjectSummary projects={projects} bookings={bookings} />
      {editing && (
        <BookingDialog
          member={editing.member}
          sprint={editing.sprint}
          projects={projects}
          existing={cellBookings(editing.member.id, editing.sprint.id)}
          onClose={() => setEditing(null)}
          onSave={onBook}
        />
      )}
    </div>
  );
}

function ProjectSummary({ projects, bookings }: { projects: QBRProject[]; bookings: QBRBooking[] }) {
  if (!projects.length) return null;
  return (
    <Card title="Projects this quarter" subtitle="Members booked and sprint points (sum of booked % per sprint)" flush>
      <div className="pcp-tbl-wrap">
        <table className="pcp-tbl pcp-tbl--compact">
          <caption className="pcp-sr-only">Projects this quarter</caption>
          <thead>
            <tr>
              <th scope="col">Project</th>
              <th scope="col">Tribe</th>
              <th scope="col">Priority</th>
              <th scope="col" className="pcp-num">
                Members
              </th>
              <th scope="col" className="pcp-num">
                Sprint points
              </th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => {
              const list = bookings.filter((b) => b.project_id === p.id);
              return (
                <tr key={p.id}>
                  <th scope="row" className="pcp-strong">
                    {p.name}
                  </th>
                  <td>{p.tribe_name ?? '—'}</td>
                  <td>
                    <StatusPill tone={priorityTone(p.priority)}>{p.priority.toLowerCase()}</StatusPill>
                  </td>
                  <td className="pcp-num">{new Set(list.map((b) => b.member_id)).size}</td>
                  <td className="pcp-num">{list.reduce((s, b) => s + b.percentage, 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function BookingDialog({
  member,
  sprint,
  projects,
  existing,
  onClose,
  onSave,
}: {
  member: QBRMember;
  sprint: QBRSprint;
  projects: QBRProject[];
  existing: QBRBooking[];
  onClose(): void;
  onSave(b: BookingInput): Promise<void>;
}) {
  const first = existing[0];
  const [projectId, setProjectId] = useState(first?.project_id ?? projects[0]?.id ?? '');
  const [pct, setPct] = useState(first ? String(first.percentage) : '20');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = existing.find((b) => b.project_id === projectId);
  const n = Number(pct);
  const invalid = pct.trim() === '' || !Number.isFinite(n) || n < 0 || n > 100;

  const save = async (value: number) => {
    setBusy(true);
    setError(null);
    try {
      await onSave({ memberId: member.id, projectId, sprintId: sprint.id, percentage: value });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      size="sm"
      onClose={onClose}
      title={`Book ${member.name}`}
      subtitle={`${sprint.label} · ${fmt.dateRange(sprint.start_date, sprint.end_date)}`}
      footer={
        <>
          {current ? (
            <Button variant="danger" onClick={() => void save(0)} disabled={busy}>
              Remove booking
            </Button>
          ) : null}
          <span className="pcp-spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={invalid || !projectId} onClick={() => void save(n)}>
            Save
          </Button>
        </>
      }
    >
      <div className="pcp-stack pcp-stack--md">
        <FormField label="Project" id="sp-project">
          <Select
            id="sp-project"
            value={projectId}
            onValueChange={(v) => {
              setProjectId(v);
              const b = existing.find((x) => x.project_id === v);
              if (b) setPct(String(b.percentage));
            }}
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
          />
        </FormField>
        <FormField
          label="Booked for this sprint"
          id="sp-pct"
          help={current ? `Currently ${current.percentage}%. 0 removes the booking.` : 'Share of the sprint, 0–100%.'}
          error={invalid && pct.trim() !== '' ? 'Enter 0–100' : null}
        >
          <NumberField
            id="sp-pct"
            unit="%"
            min={0}
            max={100}
            step={5}
            value={numOrNull(pct)}
            onChange={(v) => setPct(numText(v))}
          />
        </FormField>
        {existing.length > 0 && (
          <p className="pcp-caption pcp-text-secondary">
            In this sprint: {existing.map((b) => `${b.project_name ?? 'Project'} ${b.percentage}%`).join(' · ')}
          </p>
        )}
        {error && <p className="pcp-field__error">{error}</p>}
      </div>
    </Dialog>
  );
}
