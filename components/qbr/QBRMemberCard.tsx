import React from 'react';
import { QBRMember, QBRBooking, QBRSprint, QBRProject } from '../../types';

const c = {
    bg: '#0a0a0f', card: '#12121a', border: '#1e1e2e',
    text: '#e2e8f0', muted: '#64748b', accent: '#818cf8',
    green: '#34d399', red: '#f87171', amber: '#fbbf24',
};

interface Props {
    member: QBRMember;
    bookings: QBRBooking[];
    sprints: QBRSprint[];
    projects: QBRProject[];
    onClose: () => void;
}

export function QBRMemberCard({ member, bookings, sprints, projects, onClose }: Props) {
    const avgUtil = sprints.length
        ? Math.round(bookings.reduce((s, b) => s + b.percentage, 0) / sprints.length)
        : 0;

    const utilColor = avgUtil > 100 ? c.red : avgUtil > 80 ? c.amber : avgUtil > 50 ? c.green : c.muted;

    // Group bookings by project
    const projectGroups: Record<string, { name: string; color: string; bookings: QBRBooking[] }> = {};
    bookings.forEach(b => {
        const proj = projects.find(p => p.id === b.project_id);
        if (!projectGroups[b.project_id]) {
            projectGroups[b.project_id] = { name: proj?.name || b.project_name || 'Unknown', color: proj?.color || '#666', bookings: [] };
        }
        projectGroups[b.project_id].bookings.push(b);
    });

    return (
        <div style={{
            position: 'fixed', top: 0, right: 0, bottom: 0, width: 380,
            background: c.bg, borderLeft: `1px solid ${c.border}`,
            zIndex: 1000, display: 'flex', flexDirection: 'column',
            boxShadow: '-10px 0 40px rgba(0,0,0,0.5)',
        }}>
            {/* Header */}
            <div style={{
                padding: '20px 24px', borderBottom: `1px solid ${c.border}`,
                display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
            }}>
                <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                    <div style={{
                        width: 48, height: 48, borderRadius: 14,
                        background: member.avatar_color + '25', color: member.avatar_color,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 16, fontWeight: 900,
                    }}>{member.name.slice(0, 2).toUpperCase()}</div>
                    <div>
                        <div style={{ fontSize: 16, fontWeight: 800 }}>{member.name}</div>
                        <div style={{ fontSize: 11, color: c.muted }}>{member.role_title}</div>
                        {member.email && <div style={{ fontSize: 10, color: c.muted }}>{member.email}</div>}
                    </div>
                </div>
                <button onClick={onClose} style={{
                    background: 'transparent', border: 'none', color: c.muted,
                    fontSize: 20, cursor: 'pointer', padding: 4,
                }}>✕</button>
            </div>

            <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
                {/* Tags */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
                    {member.tribe_name && (
                        <span style={{
                            fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 6,
                            background: `${c.accent}15`, color: c.accent,
                        }}>🏛️ {member.tribe_name}</span>
                    )}
                    {member.chapter_name && (
                        <span style={{
                            fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 6,
                            background: 'rgba(236,72,153,0.15)', color: '#ec4899',
                        }}>📚 {member.chapter_name}</span>
                    )}
                    {member.coe_name && (
                        <span style={{
                            fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 6,
                            background: `${c.amber}15`, color: c.amber,
                        }}>⭐ {member.coe_name}</span>
                    )}
                    <span style={{
                        fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 6,
                        background: member.member_type !== 'INTERNAL' ? `${c.amber}15` : `${c.green}15`,
                        color: member.member_type !== 'INTERNAL' ? c.amber : c.green,
                    }}>{member.member_type}</span>
                </div>

                {/* Utilization */}
                <div style={{
                    background: c.card, border: `1px solid ${c.border}`, borderRadius: 14,
                    padding: '18px 20px', marginBottom: 20,
                }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: c.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                        Average Utilization
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        <span style={{ fontSize: 36, fontWeight: 900, color: utilColor }}>{avgUtil}%</span>
                        <span style={{ fontSize: 12, color: c.muted }}>across {sprints.length} sprints</span>
                    </div>
                    {/* Capacity bar */}
                    <div style={{
                        height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.06)',
                        marginTop: 12, overflow: 'hidden',
                    }}>
                        <div style={{
                            height: '100%', borderRadius: 4,
                            background: utilColor,
                            width: `${Math.min(avgUtil, 100)}%`,
                            transition: 'width 0.3s',
                        }} />
                    </div>
                </div>

                {/* Skills */}
                {member.skills && member.skills.length > 0 && (
                    <div style={{ marginBottom: 20 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: c.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                            Skills
                        </div>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {member.skills.map(s => (
                                <span key={s} style={{
                                    fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 6,
                                    background: 'rgba(255,255,255,0.04)', color: c.text,
                                    border: `1px solid ${c.border}`,
                                }}>{s}</span>
                            ))}
                        </div>
                    </div>
                )}

                {/* Sprint timeline */}
                <div style={{ fontSize: 10, fontWeight: 700, color: c.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                    Sprint Bookings
                </div>
                <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
                    {sprints.map(sp => {
                        const spTotal = bookings.filter(b => b.sprint_id === sp.id).reduce((s, b) => s + b.percentage, 0);
                        const bg = spTotal > 100 ? `${c.red}40` : spTotal > 80 ? `${c.amber}40` : spTotal > 0 ? `${c.green}25` : 'rgba(255,255,255,0.03)';
                        return (
                            <div key={sp.id} title={`${sp.label}: ${spTotal}%`} style={{
                                flex: 1, height: 40, borderRadius: 6, background: bg,
                                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                fontSize: 9, fontWeight: 700, border: `1px solid ${c.border}`,
                            }}>
                                <span style={{ color: spTotal > 100 ? c.red : spTotal > 80 ? c.amber : spTotal > 0 ? c.green : c.muted }}>
                                    {spTotal}%
                                </span>
                                <span style={{ color: c.muted, fontSize: 8 }}>S{sp.sprint_number}</span>
                            </div>
                        );
                    })}
                </div>

                {/* Project breakdown */}
                <div style={{ fontSize: 10, fontWeight: 700, color: c.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                    Projects ({Object.keys(projectGroups).length})
                </div>
                {Object.entries(projectGroups).map(([projId, group]) => (
                    <div key={projId} style={{
                        background: c.card, border: `1px solid ${c.border}`, borderRadius: 10,
                        padding: '12px 14px', marginBottom: 8,
                        borderLeft: `3px solid ${group.color}`,
                    }}>
                        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{group.name}</div>
                        <div style={{ display: 'flex', gap: 3 }}>
                            {sprints.map(sp => {
                                const b = group.bookings.find(b => b.sprint_id === sp.id);
                                return (
                                    <div key={sp.id} style={{
                                        flex: 1, height: 22, borderRadius: 4,
                                        background: b ? group.color + '25' : 'rgba(255,255,255,0.02)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: 8, fontWeight: 700, color: b ? group.color : c.muted,
                                    }}>{b ? `${b.percentage}%` : '−'}</div>
                                );
                            })}
                        </div>
                    </div>
                ))}

                {member.daily_rate && (
                    <div style={{
                        marginTop: 16, padding: '12px 14px', background: c.card,
                        border: `1px solid ${c.border}`, borderRadius: 10,
                    }}>
                        <div style={{ fontSize: 10, color: c.muted, fontWeight: 700, marginBottom: 4 }}>💰 Daily Rate</div>
                        <div style={{ fontSize: 18, fontWeight: 900, color: c.green }}>€{member.daily_rate}</div>
                    </div>
                )}
            </div>
        </div>
    );
}
