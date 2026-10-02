import React, { useState, useMemo } from 'react';
import { QBRMember, QBRProject, QBRSprint, QBRBooking, QBRTribe, QBRChapter, QBRCoE } from '../../types';

/* ── Colours (light design-system tokens, see index.css) ───────── */
const c = {
    card: '#fff', cardHover: 'var(--n-100)', surface: 'var(--n-200)',
    border: 'var(--n-300)', text: 'var(--n-800)', muted: 'var(--n-600)',
    placeholder: 'var(--n-500)',
    accent: 'var(--brand-500)', accentBg: 'var(--brand-50)',
    green: 'var(--optimal)', greenBg: 'var(--optimal-bg)',
    red: 'var(--over)', redBg: 'var(--over-bg)',
    // --high (#FFAB00) is too light to read as text on white; use a dark amber for text
    amber: '#974F0C', amberBg: 'var(--high-bg)',
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

/* Heat-map tints: light status backgrounds that stay readable under dark text. */
const HEAT_STEPS = [
    { label: '0-30%', bg: 'var(--optimal-bg)' },
    { label: '31-60%', bg: '#ABF5D1' },
    { label: '61-80%', bg: 'var(--high-bg)' },
    { label: '81-100%', bg: '#FFE380' },
    { label: '100%+', bg: 'var(--over-bg)' },
];

function heatColor(pct: number): string {
    if (pct <= 0) return 'transparent';
    if (pct <= 30) return HEAT_STEPS[0].bg;
    if (pct <= 60) return HEAT_STEPS[1].bg;
    if (pct <= 80) return HEAT_STEPS[2].bg;
    if (pct <= 100) return HEAT_STEPS[3].bg;
    return HEAT_STEPS[4].bg;
}

function utilTextColor(pct: number): string {
    if (pct <= 0) return c.muted;
    if (pct <= 60) return c.green;
    if (pct <= 100) return c.amber;
    return c.red;
}

const clampPct = (raw: string): number | null => {
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) return null;
    return Math.max(0, Math.min(100, n));
};

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
        // Group colour is used with a hex alpha suffix for the row tint, so it must be a literal hex
        if (unassigned.length) groups.push({ label: 'Shared / Unassigned', color: '#5E6C84', members: unassigned });

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
        // Pre-fill with the first existing booking in this cell, otherwise sensible defaults
        const existing = getSprintBookings(memberId, sprintId)[0];
        if (existing) {
            setEditProject(existing.project_id);
            setEditPct(String(existing.percentage));
        } else {
            setEditProject(projects[0]?.id || '');
            setEditPct('20');
        }
    };

    const handleSaveBooking = () => {
        if (!editCell || !editProject || editPct.trim() === '') return;
        const pct = clampPct(editPct);
        if (pct === null) return;
        onBooking(editCell.memberId, editProject, editCell.sprintId, pct);
        setEditCell(null);
    };

    const filterSelectStyle: React.CSSProperties = {
        width: 'auto', fontSize: 11, padding: '5px 10px', cursor: 'pointer',
    };

    const priorityTag = (priority: string) => (
        <span style={{
            fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--radius-sm)',
            textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap',
            background: priority === 'CRITICAL' ? c.redBg : priority === 'HIGH' ? c.amberBg : c.surface,
            color: priority === 'CRITICAL' ? c.red : priority === 'HIGH' ? c.amber : c.muted,
        }}>{priority}</span>
    );

    return (
        <div style={{ color: c.text }}>
            {/* ── Filters ─────────────────────────────── */}
            <div style={{
                display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center',
            }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: c.muted }}>Filter:</span>

                {/* Tribe filter */}
                <select className="form-select" value={selectedTribe || ''} onChange={e => onSelectTribe(e.target.value || null)}
                    style={filterSelectStyle}>
                    <option value="">All Tribes</option>
                    {tribes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>

                {/* Chapter filter */}
                <select className="form-select" value={filterChapter} onChange={e => setFilterChapter(e.target.value)}
                    style={filterSelectStyle}>
                    <option value="">All Chapters</option>
                    {chapters.map(ch => <option key={ch.id} value={ch.id}>{ch.name}</option>)}
                </select>

                {/* Type filter */}
                <select className="form-select" value={filterType} onChange={e => setFilterType(e.target.value)}
                    style={filterSelectStyle}>
                    <option value="">All Types</option>
                    <option value="INTERNAL">Internal</option>
                    <option value="VENDOR">Vendor</option>
                    <option value="CONTRACTOR">Contractor</option>
                </select>

                {selectedTribe && (
                    <button className="btn btn-secondary" onClick={() => onSelectTribe(null)} style={{
                        fontSize: 11, padding: '5px 10px',
                    }}>✕ Clear Filter</button>
                )}

                <div style={{ flex: 1 }} />
                <div style={{ fontSize: 11, color: c.muted }}>
                    {filteredMembers.length} members · {sprints.length} sprints
                </div>
                {scenarioMode && (
                    <span className="badge" style={{ background: c.amberBg, color: c.amber }}>🧪 Scenario Mode</span>
                )}
            </div>

            {/* ── Legend ───────────────────────────────── */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 12, fontSize: 10, color: c.muted, flexWrap: 'wrap' }}>
                {HEAT_STEPS.map(l => (
                    <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <div style={{ width: 14, height: 14, borderRadius: 3, background: l.bg, border: `1px solid ${c.border}` }} />
                        {l.label}
                    </div>
                ))}
            </div>

            {/* ── Grid ─────────────────────────────────── */}
            <div className="panel" style={{ overflowX: 'auto' }}>
                <table style={{
                    width: '100%', borderCollapse: 'collapse', fontSize: 11,
                    minWidth: sprints.length * 100 + 300,
                }}>
                    <thead>
                        <tr style={{ background: c.cardHover }}>
                            <th style={{
                                padding: '12px 16px', textAlign: 'left', fontWeight: 700,
                                fontSize: 10, color: c.muted, textTransform: 'uppercase',
                                letterSpacing: '0.06em', position: 'sticky', left: 0,
                                background: c.cardHover, zIndex: 2, minWidth: 200,
                                borderBottom: `1px solid ${c.border}`,
                            }}>Member</th>
                            <th style={{
                                padding: '12px 8px', textAlign: 'center', fontWeight: 700,
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
                                        padding: '10px 16px', fontWeight: 700, fontSize: 11,
                                        color: group.color, background: group.color + '12',
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
                                            borderBottom: `1px solid ${idx < group.members.length - 1 ? 'var(--n-200)' : c.border}`,
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
                                                        fontSize: 9, fontWeight: 800,
                                                    }}>{member.name.slice(0, 2).toUpperCase()}</div>
                                                    <div>
                                                        <div style={{ fontWeight: 700, fontSize: 12, color: c.text }}>{member.name}</div>
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
                                                textAlign: 'center', fontWeight: 800,
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
                                                            borderLeft: '1px solid var(--n-200)',
                                                        }}>
                                                        {isEditing ? (
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: 2 }}
                                                                onClick={e => e.stopPropagation()}>
                                                                <select value={editProject} onChange={e => setEditProject(e.target.value)}
                                                                    style={{ fontSize: 9, padding: 2, background: c.card, color: c.text, border: `1px solid ${c.accent}`, borderRadius: 'var(--radius-sm)', fontFamily: 'inherit' }}>
                                                                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                                                </select>
                                                                <input type="number" value={editPct} onChange={e => setEditPct(e.target.value)}
                                                                    onKeyDown={e => { if (e.key === 'Enter') handleSaveBooking(); if (e.key === 'Escape') setEditCell(null); }}
                                                                    min="0" max="100" step="5"
                                                                    style={{ width: '100%', fontSize: 10, padding: 2, background: c.card, color: c.text, border: `1px solid ${c.accent}`, borderRadius: 'var(--radius-sm)', textAlign: 'center', fontFamily: 'inherit' }}
                                                                />
                                                                <div style={{ display: 'flex', gap: 2 }}>
                                                                    <button onClick={handleSaveBooking} style={{
                                                                        flex: 1, fontSize: 9, padding: '2px 0', background: c.green, color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontWeight: 800
                                                                    }}>✓</button>
                                                                    <button onClick={() => setEditCell(null)} style={{
                                                                        flex: 1, fontSize: 9, padding: '2px 0', background: c.red, color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontWeight: 800
                                                                    }}>✕</button>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <>
                                                                {total > 0 ? (
                                                                    <div>
                                                                        <div style={{
                                                                            fontWeight: 800, fontSize: 13,
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
                                                                        color: c.placeholder, fontSize: 16, fontWeight: 600, lineHeight: 1,
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
                        <div key={p.id} className="panel" onClick={() => setExpandedProject(expandedProject === p.id ? null : p.id)} style={{
                            padding: '14px 16px', cursor: 'pointer',
                            borderLeft: `3px solid ${p.color}`,
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ fontSize: 12, fontWeight: 700, color: c.text }}>{p.name}</div>
                                {priorityTag(p.priority)}
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
                                                <span style={{ fontWeight: 600, minWidth: 80, color: c.text }}>{name}</span>
                                                {sprints.map(sp => {
                                                    const b = memberProjBookings.find(b => b.sprint_id === sp.id);
                                                    return (
                                                        <div key={sp.id} style={{
                                                            width: 28, height: 18, borderRadius: 3,
                                                            background: b ? p.color + '30' : c.surface,
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
