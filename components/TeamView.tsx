
import React from 'react';
import { Resource, Project, Allocation, Team, getAllocationStatus, AllocationStatus } from '../types';

interface Props {
    resources: Resource[];
    projects: Project[];
    allocations: Allocation[];
    teams: Team[];
    scenarioAllocations?: Allocation[] | null;
}

function heatColor(pct: number): { bg: string; text: string } {
    const s = getAllocationStatus(pct);
    if (s === AllocationStatus.OVER) return { bg: '#fecaca', text: '#b91c1c' };
    if (s === AllocationStatus.HIGH) return { bg: '#fde68a', text: '#92400e' };
    if (s === AllocationStatus.OPTIMAL) return { bg: '#bbf7d0', text: '#166534' };
    return { bg: '#e2e8f0', text: '#475569' };
}

export const TeamView: React.FC<Props> = ({ resources, projects, allocations, teams, scenarioAllocations }) => {
    const liveAlloc = scenarioAllocations ?? allocations;

    // Group resources by team
    const teamGroups = teams.map(team => {
        const members = resources.filter(r => r.teamId === team.id);
        return { team, members };
    }).filter(g => g.members.length > 0);

    // Resources without a team
    const unassigned = resources.filter(r => !r.teamId);
    if (unassigned.length > 0) {
        teamGroups.push({ team: { id: '_', name: 'Unassigned', color: '#94a3b8' }, members: unassigned });
    }

    return (
        <div className="page-enter" style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                {teamGroups.map(({ team }) => (
                    <span key={team.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 13px', background: team.color + '1a', border: `1px solid ${team.color}44`, borderRadius: 99, fontSize: 12, fontWeight: 700, color: team.color }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: team.color }}></span>
                        {team.name}
                    </span>
                ))}
                <div className="legend" style={{ marginLeft: 'auto' }}>
                    {[
                        { label: 'Under', color: '#e2e8f0', text: '#475569' },
                        { label: 'Optimal', color: '#bbf7d0', text: '#166534' },
                        { label: 'High', color: '#fde68a', text: '#92400e' },
                        { label: 'Over', color: '#fecaca', text: '#b91c1c' },
                    ].map(l => (
                        <span key={l.label} className="legend-item">
                            <span className="legend-dot" style={{ background: l.color, border: `1px solid ${l.text}33` }}></span>
                            {l.label}
                        </span>
                    ))}
                </div>
            </div>

            {teamGroups.map(({ team, members }) => {
                const teamTotalAlloc = members.reduce((s, r) => s + liveAlloc.filter(a => a.resourceId === r.id).reduce((ss, a) => ss + a.percentage, 0), 0);
                const teamAvgUtil = members.length ? Math.round(teamTotalAlloc / members.length) : 0;

                return (
                    <div key={team.id} className="panel">
                        {/* Team Header */}
                        <div className="panel-header" style={{ borderLeft: `4px solid ${team.color}` }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                                <div style={{ width: 40, height: 40, borderRadius: 10, background: team.color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, border: `2px solid ${team.color}44` }}>
                                    👥
                                </div>
                                <div>
                                    <div className="panel-title" style={{ color: team.color }}>{team.name}</div>
                                    <div className="panel-subtitle">{members.length} member{members.length !== 1 ? 's' : ''} · Avg util: <span style={{ fontWeight: 700, color: '#334155' }}>{teamAvgUtil}%</span></div>
                                </div>
                            </div>
                        </div>

                        {/* Heatmap Grid */}
                        <div style={{ overflowX: 'auto' }}>
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th style={{ position: 'sticky', left: 0, background: '#f8fafc', zIndex: 5, minWidth: 160 }}>Member</th>
                                        <th style={{ minWidth: 80 }}>Total %</th>
                                        {projects.map(p => (
                                            <th key={p.id} style={{ minWidth: 100, textAlign: 'center' }}>
                                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                                                    <div style={{ width: 6, height: 6, borderRadius: 2, background: p.color || '#6366f1' }} />
                                                    <span style={{ fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 90 }}>{p.name}</span>
                                                </div>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {members.map(res => {
                                        const totalUtil = liveAlloc.filter(a => a.resourceId === res.id).reduce((s, a) => s + a.percentage, 0);
                                        const { bg, text } = heatColor(totalUtil);
                                        return (
                                            <tr key={res.id}>
                                                <td style={{ position: 'sticky', left: 0, background: '#fff', zIndex: 4 }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                        <div className="avatar" style={{ width: 28, height: 28, fontSize: 10, background: team.color + '22', color: team.color, flexShrink: 0 }}>
                                                            {res.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                                                        </div>
                                                        <div>
                                                            <div style={{ fontWeight: 600, fontSize: 12, color: '#1e293b' }}>{res.name}</div>
                                                            <div style={{ fontSize: 10, color: '#94a3b8' }}>{res.role}</div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td>
                                                    <div className="heatmap-cell" style={{ background: bg, color: text, borderRadius: 8, width: 56, height: 32, fontSize: 12 }}>
                                                        {totalUtil}%
                                                    </div>
                                                </td>
                                                {projects.map(proj => {
                                                    const pct = liveAlloc.find(a => a.resourceId === res.id && a.projectId === proj.id)?.percentage || 0;
                                                    const { bg: cb, text: ct } = pct > 0 ? { bg: (proj.color || '#6366f1') + '28', text: proj.color || '#6366f1' } : { bg: '#f8fafc', text: '#cbd5e1' };
                                                    return (
                                                        <td key={proj.id} style={{ textAlign: 'center' }}>
                                                            {pct > 0 ? (
                                                                <div className="heatmap-cell" style={{ background: cb, color: ct, fontSize: 12, width: 56, height: 32, margin: '0 auto', borderRadius: 8 }}>
                                                                    {pct}%
                                                                </div>
                                                            ) : (
                                                                <div style={{ color: '#e2e8f0', fontSize: 12, textAlign: 'center' }}>—</div>
                                                            )}
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        );
                                    })}
                                    {/* Team totals row */}
                                    <tr style={{ background: '#f8fafc', borderTop: '2px solid #e2e8f0' }}>
                                        <td style={{ position: 'sticky', left: 0, background: '#f8fafc', zIndex: 4, fontWeight: 700, fontSize: 12, color: '#475569' }}>Team Total</td>
                                        <td>
                                            <span style={{ fontWeight: 800, fontSize: 13, color: '#334155' }}>{teamAvgUtil}%</span>
                                            <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 3 }}>avg</span>
                                        </td>
                                        {projects.map(proj => {
                                            const total = members.reduce((s, res) => {
                                                return s + (liveAlloc.find(a => a.resourceId === res.id && a.projectId === proj.id)?.percentage || 0);
                                            }, 0);
                                            return (
                                                <td key={proj.id} style={{ textAlign: 'center', fontWeight: 700, fontSize: 12, color: total > 0 ? (proj.color || '#6366f1') : '#cbd5e1' }}>
                                                    {total > 0 ? `${total}%` : '—'}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};
