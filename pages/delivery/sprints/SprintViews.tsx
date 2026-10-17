/** Tribes, OKRs, squads, members and the member drawer of Sprint planning (SH-05, v1.1 QBR module). */
import { Network, Target, Users } from 'lucide-react';
import { bandFor } from '../../../shared/utilisation';
import type {
  QBRBooking,
  QBRChapter,
  QBRCoE,
  QBRMember,
  QBROKR,
  QBRProject,
  QBRSprint,
  QBRSquad,
  QBRTribe,
} from '../../../types';
import {
  Avatar,
  BandCell,
  Button,
  Card,
  Drawer,
  EmptyState,
  PersonLabel,
  StatusPill,
  TableScroll,
} from '../../../components/ui';
import { priorityTone } from './SprintGrid';
import { averageUtil } from './useSprintData';

const TYPE_LABEL: Record<string, string> = { INTERNAL: 'Internal', VENDOR: 'Vendor', CONTRACTOR: 'Contractor' };

export function TribesView({
  tribes,
  chapters,
  coe,
  members,
  projects,
  squads,
  onCapacity,
}: {
  tribes: QBRTribe[];
  chapters: QBRChapter[];
  coe: QBRCoE[];
  members: QBRMember[];
  projects: QBRProject[];
  squads: QBRSquad[];
  onCapacity(tribeId: string): void;
}) {
  return (
    <div className="sp-cards">
      {tribes.map((t) => {
        const tp = projects.filter((p) => p.tribe_id === t.id);
        return (
          <Card
            key={t.id}
            title={t.name}
            subtitle={t.lead_name ? `Lead: ${t.lead_name}` : 'No lead set'}
            footer={
              <Button size="sm" variant="subtle" onClick={() => onCapacity(t.id)}>
                View capacity
              </Button>
            }
          >
            <div className="pcp-stack pcp-stack--md">
              {t.description ? <p className="pcp-text-secondary sp-desc">{t.description}</p> : null}
              <dl className="sp-figures">
                <div>
                  <dt>Members</dt>
                  <dd>{members.filter((m) => m.tribe_id === t.id).length}</dd>
                </div>
                <div>
                  <dt>Projects</dt>
                  <dd>{tp.length}</dd>
                </div>
                <div>
                  <dt>Squads</dt>
                  <dd>{squads.filter((s) => s.tribe_id === t.id).length}</dd>
                </div>
              </dl>
              {tp.length > 0 && (
                <ul className="pcp-list" aria-label={`Projects of ${t.name}`}>
                  {tp.map((p) => (
                    <li key={p.id}>
                      <span className="pcp-truncate">{p.name}</span>
                      <span className="pcp-spacer" />
                      <StatusPill tone={priorityTone(p.priority)}>{p.priority.toLowerCase()}</StatusPill>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        );
      })}
      <GroupCard title="Chapters" items={chapters} />
      <GroupCard title="Centres of excellence" items={coe} />
    </div>
  );
}

function GroupCard({ title, items }: { title: string; items: Array<QBRChapter | QBRCoE> }) {
  return (
    <Card title={title} subtitle="Members per group">
      {items.length === 0 ? (
        <EmptyState compact title={`No ${title.toLowerCase()}`} />
      ) : (
        <ul className="pcp-list">
          {items.map((g) => (
            <li key={g.id}>
              <span className="pcp-truncate">{g.name}</span>
              <span className="pcp-spacer" />
              <span className="pcp-strong pcp-tnum">{g.member_count ?? 0}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function OkrsView({ okrs, tribes, projects }: { okrs: QBROKR[]; tribes: QBRTribe[]; projects: QBRProject[] }) {
  const leadership = okrs.filter((o) => o.level === 'LEADERSHIP');
  if (!leadership.length)
    return (
      <Card>
        <EmptyState icon={Target} title="No OKRs for this workspace" />
      </Card>
    );
  return (
    <div className="pcp-stack">
      {leadership.map((okr) => {
        const children = okrs.filter((o) => o.level === 'TRIBE' && o.parent_okr_id === okr.id);
        return (
          <Card key={okr.id} title={okr.title} subtitle="Leadership objective">
            <div className="pcp-stack pcp-stack--md">
              {okr.description ? <p className="pcp-text-secondary sp-desc">{okr.description}</p> : null}
              {children.length > 0 && (
                <ul className="sp-okr-children">
                  {children.map((c) => {
                    const tribe = tribes.find((t) => t.id === c.tribe_id);
                    const linked = projects.filter((p) => p.okr_id === c.id);
                    return (
                      <li key={c.id}>
                        <div className="pcp-row pcp-row--wrap">
                          <StatusPill tone="brand">{tribe?.name ?? 'Tribe'}</StatusPill>
                          <span className="pcp-strong">{c.title}</span>
                        </div>
                        {linked.length > 0 && (
                          <p className="pcp-caption pcp-text-secondary">
                            Projects: {linked.map((p) => p.name).join(', ')}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

export function SquadsView({ squads, tribes }: { squads: QBRSquad[]; tribes: QBRTribe[] }) {
  if (!squads.length)
    return (
      <Card>
        <EmptyState icon={Users} title="No squads yet" />
      </Card>
    );
  return (
    <div className="sp-cards">
      {squads.map((s) => {
        const tribe = tribes.find((t) => t.id === s.tribe_id);
        return (
          <Card
            key={s.id}
            title={s.name}
            subtitle={[tribe?.name ?? 'Cross-functional', s.project_name].filter(Boolean).join(' · ')}
          >
            <ul className="pcp-list">
              {(s.members ?? []).map((m) => (
                <li key={m.id}>
                  <PersonLabel name={m.member_name} sub={m.chapter_name ?? m.coe_name ?? m.tribe_name ?? ''} />
                  <span className="pcp-spacer" />
                  <StatusPill tone={m.squad_role === 'LEAD' ? 'brand' : 'neutral'}>
                    {m.squad_role.toLowerCase()}
                  </StatusPill>
                  {m.member_type !== 'INTERNAL' && <StatusPill tone="warning">{TYPE_LABEL[m.member_type]}</StatusPill>}
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}

export function MembersView({
  members,
  bookings,
  sprints,
  onSelect,
}: {
  members: QBRMember[];
  bookings: QBRBooking[];
  sprints: QBRSprint[];
  onSelect(m: QBRMember): void;
}) {
  const groups = new Map<string, QBRMember[]>();
  for (const m of members) {
    const key = m.tribe_name ?? m.coe_name ?? 'Unassigned';
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  if (!members.length)
    return (
      <Card>
        <EmptyState icon={Network} title="No members yet" />
      </Card>
    );
  return (
    <div className="pcp-stack">
      {[...groups.entries()].map(([group, list]) => (
        <Card key={group} title={group} subtitle={`${list.length} members · average booked % per sprint`} flush>
          <ul className="pcp-list sp-members">
            {list.map((m) => {
              const avg = averageUtil(bookings, m.id, sprints.length);
              return (
                <li key={m.id}>
                  <button type="button" className="pcp-rowlink sp-members__name" onClick={() => onSelect(m)}>
                    <PersonLabel name={m.name} sub={m.role_title} />
                  </button>
                  {m.member_type !== 'INTERNAL' && <StatusPill tone="warning">{TYPE_LABEL[m.member_type]}</StatusPill>}
                  <span className="pcp-spacer" />
                  <span className="sp-members__util">
                    <BandCell value={avg} band={avg > 0 ? bandFor(avg) : null} label={`${m.name} average`} />
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
    </div>
  );
}

export function MemberDrawer({
  member,
  bookings,
  sprints,
  onClose,
}: {
  member: QBRMember | null;
  bookings: QBRBooking[];
  sprints: QBRSprint[];
  onClose(): void;
}) {
  const own = member ? bookings.filter((b) => b.member_id === member.id) : [];
  const avg = member ? averageUtil(bookings, member.id, sprints.length) : 0;
  const byProject = new Map<string, QBRBooking[]>();
  for (const b of own) byProject.set(b.project_id, [...(byProject.get(b.project_id) ?? []), b]);
  return (
    <Drawer
      open={!!member}
      onClose={onClose}
      size="sm"
      title={member?.name ?? ''}
      subtitle={[member?.role_title, member?.email].filter(Boolean).join(' · ')}
      headerStart={member ? <Avatar name={member.name} size={40} /> : null}
    >
      {member ? (
        <div className="pcp-stack">
          <dl className="pcp-dl">
            <dt>Tribe</dt>
            <dd>{member.tribe_name ?? '—'}</dd>
            <dt>Chapter</dt>
            <dd>{member.chapter_name ?? member.coe_name ?? '—'}</dd>
            <dt>Type</dt>
            <dd>{TYPE_LABEL[member.member_type] ?? member.member_type}</dd>
            <dt>Average booked</dt>
            <dd>
              <span className="sp-members__util">
                <BandCell value={avg} band={avg > 0 ? bandFor(avg) : null} label="Average booked" />
              </span>
            </dd>
          </dl>
          {member.skills?.length ? (
            <p className="pcp-caption pcp-text-secondary">Skills: {member.skills.join(', ')}</p>
          ) : null}
          {byProject.size === 0 ? (
            <EmptyState compact title="No bookings this quarter" />
          ) : (
            <TableScroll>
              <table className="pcp-tbl pcp-tbl--compact">
                <caption className="pcp-sr-only">Bookings by project and sprint</caption>
                <thead>
                  <tr>
                    <th scope="col">Project</th>
                    {sprints.map((s) => (
                      <th key={s.id} scope="col" className="pcp-num">
                        S{s.sprint_number}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...byProject.entries()].map(([pid, list]) => (
                    <tr key={pid}>
                      <th scope="row">{list[0]?.project_name ?? 'Project'}</th>
                      {sprints.map((s) => {
                        const b = list.find((x) => x.sprint_id === s.id);
                        return (
                          <td key={s.id} className="pcp-num">
                            {b ? `${b.percentage}%` : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </div>
      ) : null}
    </Drawer>
  );
}
