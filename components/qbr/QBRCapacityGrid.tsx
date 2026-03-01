import React, { useState, useMemo } from 'react';
import { QBRMember, QBRProject, QBRSprint, QBRBooking, QBRTribe, QBRChapter, QBRCoE } from '../../types';

const c = {
    bg: '#0a0a0f', card: '#12121a', border: '#1e1e2e',
    text: '#e2e8f0', muted: '#64748b', accent: '#818cf8',
    green: '#34d399', red: '#f87171', amber: '#fbbf24',
    purple: '#a78bfa', cyan: '#22d3ee',
};

interface Props {
    members: QBRMember[];
    projects: QBRProject[];
    sprints: QBRSprint[];
    bookings: QBRBooking[];
    tribes: QBRTribe[];
    chapters: QBRChapter[];
    coe: QBRCoE[];
    onBooking: (memberId: string, projectId: string, sprintId: string, pct: number) => void;
    onSelectMember: (m: QBRMember) => void;
    selectedTribe: string | null;
    onSelectTribe: (id: string | null) => void;
    scenarioMode: boolean;
}

function heatColor(pct: number): string {
    if (pct <= 0) return 'transparent';
    if (pct <= 30) return 'rgba(52,211,153,0.15)';
    if (pct <= 60) return 'rgba(52,211,153,0.3)';
    if (pct <= 80) return 'rgba(251,191,36,0.25)';
    if (pct <= 100) return 'rgba(251,191,36,0.4)';
    return 'rgba(248,113,113,0.4)';
}

function utilTextColor(pct: number): string {
    if (pct <= 0) return c.muted;
    if (pct <= 60) return c.green;
    if (pct <= 80) return c.amber;
    if (pct <= 100) return '#fbbf24';
    return c.red;
}

export function QBRCapacityGrid({
    members, projects, sprints, bookings, tribes, chapters, coe,
    onBooking, onSelectMember, selectedTribe, onSelectTribe, scenarioMode,
}: Props) {
    const [filterChapter, setFilterChapter] = useState<string>('');
    const [filterType, setFilterType] = useState<string>('');
    const [expandedProject, setExpandedProject] = useState<string | null>(null);
    const [editCell, setEditCell] = useState<{ memberId: string; sprintId: string } | null>(null);
    const [editProject, setEditProject] = useState<string>('');
    const [editPct, setEditPct] = useState<string>('');

    // Filter members
    const filteredMembers = useMemo(() => {
        let list = [...members];
        if (selectedTribe) list = list.filter(m => m.tribe_id === selectedTribe);
        if (filterChapter) list = list.filter(m => m.chapter_id === filterChapter);
        if (filterType) list = list.filter(m => m.member_type === filterType);
        return list;
    }, [members, selectedTribe, filterChapter, filterType]);

    // Group members by tribe/coe
    const grouped = useMemo(() => {
        const groups: { label: string; color: string; members: QBRMember[] }[] = [];
        const tribeMap: Record<string, QBRMember[]> = {};
        const coeMap: Record<string, QBRMember[]> = {};
        const unassigned: QBRMember[] = [];

        filteredMembers.forEach(m => {
            if (m.tribe_id) {
                if (!tribeMap[m.tribe_id]) tribeMap[m.tribe_id] = [];
                tribeMap[m.tribe_id].push(m);
            } else if (m.coe_id) {
                if (!coeMap[m.coe_id]) coeMap[m.coe_id] = [];
                coeMap[m.coe_id].push(m);
            } else {
                unassigned.push(m);
            }
        });

        tribes.forEach(t => {
            if (tribeMap[t.id]) groups.push({ label: t.name, color: t.color, members: tribeMap[t.id] });
        });
        coe.forEach(g => {
            if (coeMap[g.id]) groups.push({ label: `CoE: ${g.name}`, color: g.color, members: coeMap[g.id] });
        });
        if (unassigned.length) groups.push({ label: 'Shared / Unassigned', color: c.muted, members: unassigned });

        return groups;
    }, [filteredMembers, tribes, coe]);

    // Get bookings for a member in a sprint
    const getSprintBookings = (memberId: string, sprintId: string) =>
        bookings.filter(b => b.member_id === memberId && b.sprint_id === sprintId);

    const getSprintTotal = (memberId: string, sprintId: string) =>
        getSprintBookings(memberId, sprintId).reduce((s, b) => s + b.percentage, 0);

    const getMemberAvgUtil = (memberId: string) => {
        if (!sprints.length) return 0;
        const total = sprints.reduce((s, sp) => s + getSprintTotal(memberId, sp.id), 0);
        return Math.round(total / sprints.length);
    };

    const handleCellClick = (memberId: string, sprintId: string) => {
        setEditCell({ memberId, sprintId });
        setEditProject(projects[0]?.id || '');
        setEditPct('20');
    };

    const handleSaveBooking = () => {
        if (!editCell || !editProject || !editPct) return;
        onBooking(editCell.memberId, editProject, editCell.sprintId, parseInt(editPct));
        setEditCell(null);
    };

    return (
        <div>
            {/* ── Filters ─────────────────────────────── */}
            <div style={{
                display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center',
            }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: c.muted }}>Filter:</span>

                {/* Tribe filter */}
                <select value={selectedTribe || ''} onChange={e => onSelectTribe(e.target.value || null)}
                    style={{
                        background: c.card, border: `1px solid ${c.border}`, borderRadius: 8,
                        color: c.text, fontSize: 11, padding: '5px 10px', outline: 'none',
                    }}>
                    <option value="">All Tribes</option>
                    {tribes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>

                {/* Chapter filter */}
                <select value={filterChapter} onChange={e => setFilterChapter(e.target.value)}
                    style={{
                        background: c.card, border: `1px solid ${c.border}`, borderRadius: 8,
                        color: c.text, fontSize: 11, padding: '5px 10px', outline: 'none',
                    }}>
                    <option value="">All Chapters</option>
                    {chapters.map(ch => <option key={ch.id} value={ch.id}>{ch.name}</option>)}
                </select>

                {/* Type filter */}
                <select value={filterType} onChange={e => setFilterType(e.target.value)}
                    style={{
                        background: c.card, border: `1px solid ${c.border}`, borderRadius: 8,
                        color: c.text, fontSize: 11, padding: '5px 10px', outline: 'none',
                    }}>
                    <option value="">All Types</option>
                    <option value="INTERNAL">Internal</option>
                    <option value="VENDOR">Vendor</option>
                    <option value="CONTRACTOR">Contractor</option>
                </select>

                {selectedTribe && (
                    <button onClick={() => onSelectTribe(null)} style={{
                        background: 'transparent', border: `1px solid ${c.border}`, borderRadius: 8,
                        color: c.muted, fontSize: 11, padding: '5px 10px', cursor: 'pointer',
                    }}>✕ Clear Filter</button>
                )}

                <div style={{ flex: 1 }} />
                <div style={{ fontSize: 11, color: c.muted }}>
                    {filteredMembers.length} members · {sprints.length} sprints
                </div>
                {scenarioMode && (
                    <span style={{
                        fontSize: 10, fontWeight: 800, padding: '4px 12px', borderRadius: 8,
                        background: `${c.amber}20`, color: c.amber,
                    }}>🧪 SCENARIO MODE</span>
                )}
            </div>

            {/* ── Legend ───────────────────────────────── */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 12, fontSize: 10, color: c.muted }}>
                {[
                    { label: '0-30%', bg: 'rgba(52,211,153,0.15)' },
                    { label: '31-60%', bg: 'rgba(52,211,153,0.3)' },
                    { label: '61-80%', bg: 'rgba(251,191,36,0.25)' },
                    { label: '81-100%', bg: 'rgba(251,191,36,0.4)' },
                    { label: '100%+', bg: 'rgba(248,113,113,0.4)' },
                ].map(l => (
                    <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <div style={{ width: 14, height: 14, borderRadius: 3, background: l.bg, border: `1px solid ${c.border}` }} />
                        {l.label}
                    </div>
                ))}
            </div>

            {/* ── Grid ─────────────────────────────────── */}
            <div style={{
                overflowX: 'auto', borderRadius: 14, border: `1px solid ${c.border}`,
                background: c.card,
            }}>
                <table style={{
                    width: '100%', borderCollapse: 'collapse', fontSize: 11,
                    minWidth: sprints.length * 100 + 300,
                }}>
                    <thead>
                        <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                            <th style={{
                                padding: '12px 16px', textAlign: 'left', fontWeight: 800,
                                fontSize: 10, color: c.muted, textTransform: 'uppercase',
                                letterSpacing: '0.06em', position: 'sticky', left: 0,
                                background: c.card, zIndex: 2, minWidth: 200,
                                borderBottom: `1px solid ${c.border}`,
                            }}>Member</th>
                            <th style={{
                                padding: '12px 8px', textAlign: 'center', fontWeight: 800,
                                fontSize: 10, color: c.muted, width: 50,
                                borderBottom: `1px solid ${c.border}`,
                            }}>Avg</th>
                            {sprints.map(sp => (
                                <th key={sp.id} style={{
                                    padding: '10px 6px', textAlign: 'center', fontWeight: 700,
                                    fontSize: 10, color: c.muted, minWidth: 90,
                                    borderBottom: `1px solid ${c.border}`,
                                }}>
                                    <div>{sp.label}</div>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {grouped.map(group => (
                            <React.Fragment key={group.label}>
                                {/* Group header */}
                                <tr>
                                    <td colSpan={sprints.length + 2} style={{
                                        padding: '10px 16px', fontWeight: 800, fontSize: 11,
                                        color: group.color, background: group.color + '08',
                                        borderBottom: `1px solid ${c.border}`,
                                        position: 'sticky', left: 0,
                                    }}>
                                        <span style={{
                                            display: 'inline-block', width: 8, height: 8,
                                            borderRadius: 4, background: group.color, marginRight: 8,
                                        }} />
                                        {group.label} ({group.members.length})
                                    </td>
                                </tr>
                                {/* Members */}
                                {group.members.map((member, idx) => {
                                    const avgUtil = getMemberAvgUtil(member.id);
                                    return (
                                        <tr key={member.id} style={{
                                            borderBottom: idx < group.members.length - 1 ? `1px solid ${c.border}20` : `1px solid ${c.border}`,
                                        }}>
                                            {/* Member name */}
                                            <td onClick={() => onSelectMember(member)} style={{
                                                padding: '10px 16px', position: 'sticky', left: 0,
                                                background: c.card, zIndex: 1, cursor: 'pointer',
                                            }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    <div style={{
                                                        width: 26, height: 26, borderRadius: 7,
                                                        background: member.avatar_color + '25', color: member.avatar_color,
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        fontSize: 9, fontWeight: 900,
                                                    }}>{member.name.slice(0, 2).toUpperCase()}</div>
                                                    <div>
                                                        <div style={{ fontWeight: 700, fontSize: 12 }}>{member.name}</div>
                                                        <div style={{ fontSize: 9, color: c.muted }}>
                                                            {member.chapter_name || member.coe_name || ''}
                                                            {member.member_type !== 'INTERNAL' && (
                                                                <span style={{ color: c.amber, marginLeft: 4 }}>· {member.member_type}</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                            {/* Avg util */}
                                            <td style={{
                                                textAlign: 'center', fontWeight: 900,
                                                color: utilTextColor(avgUtil),
                                                fontSize: 12,
                                            }}>{avgUtil}%</td>
                                            {/* Sprint cells */}
                                            {sprints.map(sp => {
                                                const spBookings = getSprintBookings(member.id, sp.id);
                                                const total = spBookings.reduce((s, b) => s + b.percentage, 0);
                                                const isEditing = editCell?.memberId === member.id && editCell?.sprintId === sp.id;

                                                return (
                                                    <td key={sp.id} onClick={() => !isEditing && handleCellClick(member.id, sp.id)}
                                                        style={{
                                                            padding: '4px 3px', textAlign: 'center',
                                                            background: heatColor(total), cursor: 'pointer',
                                                            transition: 'background 0.15s',
                                                            position: 'relative',
                                                            borderLeft: `1px solid ${c.border}20`,
                                                        }}>
                                                        {isEditing ? (
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: 2 }}
                                                                onClick={e => e.stopPropagation()}>
                                                                <select value={editProject} onChange={e => setEditProject(e.target.value)}
                                                                    style={{ fontSize: 9, padding: 2, background: c.bg, color: c.text, border: `1px solid ${c.accent}`, borderRadius: 4 }}>
                                                                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                                                </select>
                                                                <input type="number" value={editPct} onChange={e => setEditPct(e.target.value)}
                                                                    min="0" max="100" style={{ width: '100%', fontSize: 10, padding: 2, background: c.bg, color: c.text, border: `1px solid ${c.accent}`, borderRadius: 4, textAlign: 'center' }}
                                                                />
                                                                <div style={{ display: 'flex', gap: 2 }}>
                                                                    <button onClick={handleSaveBooking} style={{
                                                                        flex: 1, fontSize: 9, padding: '2px 0', background: c.green, color: '#000', border: 'none', borderRadius: 3, cursor: 'pointer', fontWeight: 800
                                                                    }}>✓</button>
                                                                    <button onClick={() => setEditCell(null)} style={{
                                                                        flex: 1, fontSize: 9, padding: '2px 0', background: c.red, color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer', fontWeight: 800
                                                                    }}>✕</button>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <>
                                                                {total > 0 ? (
                                                                    <div>
                                                                        <div style={{
                                                                            fontWeight: 900, fontSize: 13,
                                                                            color: utilTextColor(total),
                                                                        }}>{total}%</div>
                                                                        <div style={{ marginTop: 2 }}>
                                                                            {spBookings.map(b => (
                                                                                <div key={b.id || `${b.project_id}-${b.sprint_id}`} style={{
                                                                                    fontSize: 8, color: b.project_color || c.muted,
                                                                                    fontWeight: 600, whiteSpace: 'nowrap',
                                                                                    overflow: 'hidden', textOverflow: 'ellipsis',
                                                                                    maxWidth: 80, margin: '0 auto',
                                                                                }}>
                                                                                    {b.project_name} {b.percentage}%
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                ) : (
                                                                    <div style={{
                                                                        color: c.muted, fontSize: 16, opacity: 0.3,
                                                                    }}>+</div>
                                                                )}
                                                            </>
                                                        )}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    );
                                })}
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* ── Project breakdown panel ─────────────── */}
            <div style={{
                marginTop: 20, display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10,
            }}>
                {projects.map(p => {
                    const projBookings = bookings.filter(b => b.project_id === p.id);
                    const totalSprints = projBookings.reduce((s, b) => s + b.percentage, 0);
                    const uniqueMembers = new Set(projBookings.map(b => b.member_id)).size;
                    return (
                        <div key={p.id} onClick={() => setExpandedProject(expandedProject === p.id ? null : p.id)} style={{
                            background: c.card, border: `1px solid ${c.border}`, borderRadius: 12,
                            padding: '14px 16px', cursor: 'pointer',
                            borderLeft: `3px solid ${p.color}`,
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ fontSize: 12, fontWeight: 700 }}>{p.name}</div>
                                <span style={{
                                    fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                                    background: p.priority === 'CRITICAL' ? `${c.red}20` : p.priority === 'HIGH' ? `${c.amber}20` : `${c.muted}20`,
                                    color: p.priority === 'CRITICAL' ? c.red : p.priority === 'HIGH' ? c.amber : c.muted,
                                }}>{p.priority}</span>
                            </div>
                            <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 10, color: c.muted }}>
                                <span>{uniqueMembers} members</span>
                                <span>{totalSprints} sprint-pts</span>
                            </div>
                            {expandedProject === p.id && projBookings.length > 0 && (
                                <div style={{ marginTop: 10, borderTop: `1px solid ${c.border}`, paddingTop: 8 }}>
                                    {Array.from(new Set(projBookings.map(b => b.member_id))).map(mid => {
                                        const name = projBookings.find(b => b.member_id === mid)?.member_name || mid;
                                        const memberProjBookings = projBookings.filter(b => b.member_id === mid);
                                        return (
                                            <div key={mid} style={{ fontSize: 10, marginBottom: 4, display: 'flex', gap: 8, alignItems: 'center' }}>
                                                <span style={{ fontWeight: 600, minWidth: 80 }}>{name}</span>
                                                {sprints.map(sp => {
                                                    const b = memberProjBookings.find(b => b.sprint_id === sp.id);
                                                    return (
                                                        <div key={sp.id} style={{
                                                            width: 28, height: 18, borderRadius: 3,
                                                            background: b ? p.color + '30' : 'rgba(255,255,255,0.02)',
                                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                            fontSize: 8, fontWeight: 700, color: b ? p.color : c.muted,
                                                        }}>{b ? `${b.percentage}` : '−'}</div>
                                                    );
                                                })}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
