import React from 'react';
import { QBRMember, QBRBooking, QBRSprint, QBRProject } from '../../types';

/* ── Colours (light design-system tokens, see index.css) ───────── */
const c = {
    card: '#fff', surface: 'var(--n-200)', track: 'var(--n-300)',
    border: 'var(--n-300)', text: 'var(--n-800)', muted: 'var(--n-600)',
    accent: 'var(--brand-500)', accentBg: 'var(--brand-50)',
    green: 'var(--optimal)', greenBg: 'var(--optimal-bg)',
    red: 'var(--over)', redBg: 'var(--over-bg)',
    // --high (#FFAB00) is too light to read as text on white; use a dark amber for text
    amber: '#974F0C', amberBg: 'var(--high-bg)',
    pink: '#C9357E', pinkBg: '#FFE9F3',
};

interface Props {
    member: QBRMember;
    bookings: QBRBooking[];
    sprints: QBRSprint[];
    projects: QBRProject[];
    onClose: () => void;
}

const sectionLabel: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, color: c.muted, textTransform: 'uppercase',
    letterSpacing: '0.06em', marginBottom: 8,
};

const tag = (color: string, bg: string): React.CSSProperties => ({
    fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 'var(--radius-sm)',
    background: bg, color, whiteSpace: 'nowrap',
});

export function QBRMemberCard({ member, bookings, sprints, projects, onClose }: Props) {
    const avgUtil = sprints.length
        ? Math.round(bookings.reduce((s, b) => s + b.percentage, 0) / sprints.length)
        : 0;

    const utilColor = avgUtil > 100 ? c.red : avgUtil > 80 ? c.amber : avgUtil > 50 ? c.green : c.muted;
    const utilFill = avgUtil > 100 ? 'var(--over)' : avgUtil > 80 ? 'var(--high)' : avgUtil > 50 ? 'var(--optimal)' : 'var(--n-500)';

    // Group bookings by project
    const projectGroups: Record<string, { name: string; color: string; bookings: QBRBooking[] }> = {};
    bookings.forEach(b => {
        const proj = projects.find(p => p.id === b.project_id);
        if (!projectGroups[b.project_id]) {
            projectGroups[b.project_id] = { name: proj?.name || b.project_name || 'Unknown', color: proj?.color || '#5E6C84', bookings: [] };
        }
        projectGroups[b.project_id].bookings.push(b);
    });

    return (
        <div style={{
            position: 'fixed', top: 0, right: 0, bottom: 0, width: 380,
            background: c.card, borderLeft: `1px solid ${c.border}`, color: c.text,
            zIndex: 1000, display: 'flex', flexDirection: 'column',
            boxShadow: 'var(--shadow-lg)',
        }}>
            {/* Header */}
            <div style={{
                padding: '20px 24px', borderBottom: `1px solid ${c.border}`,
                display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
            }}>
                <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                    <div style={{
                        width: 48, height: 48, borderRadius: 'var(--radius-xl)',
                        background: member.avatar_color + '25', color: member.avatar_color,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 16, fontWeight: 800,
                    }}>{member.name.slice(0, 2).toUpperCase()}</div>
                    <div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: c.text }}>{member.name}</div>
                        <div style={{ fontSize: 11, color: c.muted }}>{member.role_title}</div>
                        {member.email && <div style={{ fontSize: 10, color: c.muted }}>{member.email}</div>}
                    </div>
                </div>
                <button onClick={onClose} aria-label="Close" style={{
                    background: 'transparent', border: 'none', color: c.muted,
                    fontSize: 20, cursor: 'pointer', padding: 4, lineHeight: 1,
                }}>✕</button>
            </div>

            <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
                {/* Tags */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
                    {member.tribe_name && (
                        <span style={tag(c.accent, c.accentBg)}>🏛️ {member.tribe_name}</span>
                    )}
                    {member.chapter_name && (
                        <span style={tag(c.pink, c.pinkBg)}>📚 {member.chapter_name}</span>
                    )}
                    {member.coe_name && (
                        <span style={tag(c.amber, c.amberBg)}>⭐ {member.coe_name}</span>
                    )}
                    <span style={member.member_type !== 'INTERNAL' ? tag(c.amber, c.amberBg) : tag(c.green, c.greenBg)}>
                        {member.member_type}
                    </span>
                </div>

                {/* Utilization */}
                <div className="panel" style={{ padding: '18px 20px', marginBottom: 20 }}>
                    <div style={sectionLabel}>Average Utilization</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        <span style={{ fontSize: 36, fontWeight: 800, color: utilColor }}>{avgUtil}%</span>
                        <span style={{ fontSize: 12, color: c.muted }}>across {sprints.length} sprints</span>
                    </div>
                    {/* Capacity bar */}
                    <div style={{
                        height: 8, borderRadius: 4, background: c.track,
                        marginTop: 12, overflow: 'hidden',
                    }}>
                        <div style={{
                            height: '100%', borderRadius: 4,
                            background: utilFill,
                            width: `${Math.min(avgUtil, 100)}%`,
                            transition: 'width 0.3s',
                        }} />
                    </div>
                </div>

                {/* Skills */}
                {member.skills && member.skills.length > 0 && (
                    <div style={{ marginBottom: 20 }}>
                        <div style={sectionLabel}>Skills</div>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {member.skills.map(s => (
                                <span key={s} style={{
                                    fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 'var(--radius-sm)',
                                    background: c.surface, color: c.text,
                                    border: `1px solid ${c.border}`,
                                }}>{s}</span>
                            ))}
                        </div>
                    </div>
                )}

                {/* Sprint timeline */}
                <div style={{ ...sectionLabel, marginBottom: 10 }}>Sprint Bookings</div>
                <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
                    {sprints.map(sp => {
                        const spTotal = bookings.filter(b => b.sprint_id === sp.id).reduce((s, b) => s + b.percentage, 0);
                        const bg = spTotal > 100 ? c.redBg : spTotal > 80 ? c.amberBg : spTotal > 0 ? c.greenBg : c.surface;
                        const fg = spTotal > 100 ? c.red : spTotal > 80 ? c.amber : spTotal > 0 ? c.green : c.muted;
                        return (
                            <div key={sp.id} title={`${sp.label}: ${spTotal}%`} style={{
                                flex: 1, height: 40, borderRadius: 'var(--radius-md)', background: bg,
                                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                fontSize: 9, fontWeight: 700, border: `1px solid ${c.border}`,
                            }}>
                                <span style={{ color: fg }}>{spTotal}%</span>
                                <span style={{ color: c.muted, fontSize: 8 }}>S{sp.sprint_number}</span>
                            </div>
                        );
                    })}
                </div>

                {/* Project breakdown */}
                <div style={{ ...sectionLabel, marginBottom: 10 }}>Projects ({Object.keys(projectGroups).length})</div>
                {Object.entries(projectGroups).map(([projId, group]) => (
                    <div key={projId} className="panel" style={{
                        padding: '12px 14px', marginBottom: 8,
                        borderLeft: `3px solid ${group.color}`,
                    }}>
                        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: c.text }}>{group.name}</div>
                        <div style={{ display: 'flex', gap: 3 }}>
                            {sprints.map(sp => {
                                const b = group.bookings.find(b => b.sprint_id === sp.id);
                                return (
                                    <div key={sp.id} style={{
                                        flex: 1, height: 22, borderRadius: 'var(--radius-sm)',
                                        background: b ? group.color + '25' : c.surface,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: 8, fontWeight: 700, color: b ? group.color : c.muted,
                                    }}>{b ? `${b.percentage}%` : '−'}</div>
                                );
                            })}
                        </div>
                    </div>
                ))}

                {member.daily_rate && (
                    <div className="panel" style={{ marginTop: 16, padding: '12px 14px' }}>
                        <div style={{ fontSize: 10, color: c.muted, fontWeight: 700, marginBottom: 4 }}>💰 Daily Rate</div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: c.green }}>€{member.daily_rate.toLocaleString()}</div>
                    </div>
                )}
            </div>
        </div>
    );
}
