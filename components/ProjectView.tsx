
import React, { useState } from 'react';
import { Resource, Project, Allocation, getAllocationStatus, AllocationStatus } from '../types';
import { TimeForecastGrid } from './TimeForecastGrid';

interface Props {
    resources: Resource[];
    projects: Project[];
    allocations: Allocation[];
    scenarioAllocations?: Allocation[] | null;
    onEditProject?: (proj: Project) => void;
}

function utilColor(pct: number) {
    const s = getAllocationStatus(pct);
    if (s === AllocationStatus.OVER) return '#ef4444';
    if (s === AllocationStatus.HIGH) return '#f59e0b';
    if (s === AllocationStatus.OPTIMAL) return '#10b981';
    return '#94a3b8';
}

function statusBadgeClass(s: AllocationStatus) {
    if (s === AllocationStatus.OVER) return 'badge badge-over';
    if (s === AllocationStatus.HIGH) return 'badge badge-high-util';
    if (s === AllocationStatus.OPTIMAL) return 'badge badge-optimal';
    return 'badge badge-under';
}

export const ProjectView: React.FC<Props> = ({ resources, projects, allocations, scenarioAllocations, onEditProject }) => {
    const [selectedProj, setSelectedProj] = useState<string>(projects[0]?.id || '');
    const liveAlloc = scenarioAllocations ?? allocations;

    const project = projects.find(p => p.id === selectedProj);
    const projAllocs = liveAlloc.filter(a => a.projectId === selectedProj);

    const totalFte = projAllocs.reduce((s, a) => s + a.percentage, 0) / 100;

    // Assume 20 working days per month for cost estimate
    const totalMonthlyCost = projAllocs.reduce((s, a) => {
        const res = resources.find(r => r.id === a.resourceId);
        const rate = res?.dailyRate || 0;
        return s + (rate * 20 * (a.percentage / 100));
    }, 0);

    function getProjStatusBadge(status: string) {
        const map: Record<string, string> = {
            Active: 'badge badge-active', Planning: 'badge badge-planning',
            'On Hold': 'badge badge-hold', Completed: 'badge badge-completed',
        };
        return map[status] || 'badge badge-hold';
    }

    return (
        <div className="page-enter" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Project selector row */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {projects.map(p => (
                    <button
                        key={p.id}
                        onClick={() => setSelectedProj(p.id)}
                        style={{
                            padding: '8px 16px',
                            borderRadius: 99,
                            border: `2px solid ${selectedProj === p.id ? (p.color || '#6366f1') : 'transparent'}`,
                            background: selectedProj === p.id ? (p.color || '#6366f1') : '#fff',
                            color: selectedProj === p.id ? '#fff' : '#475569',
                            fontWeight: 600, fontSize: 13,
                            cursor: 'pointer',
                            boxShadow: selectedProj === p.id ? '0 4px 12px rgba(0,0,0,.15)' : '0 1px 3px rgba(0,0,0,.06)',
                            transition: 'all .2s',
                        }}
                    >
                        {p.name}
                    </button>
                ))}
            </div>

            {project && (
                <>
                    {/* Project header card */}
                    <div className="panel">
                        <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr 1fr 1fr', gap: 24, alignItems: 'center' }}>
                            <div style={{ width: 48, height: 48, borderRadius: 12, background: project.color || '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>
                                🚀
                            </div>
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                                    <span style={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>{project.name}</span>
                                    {onEditProject && (
                                        <button onClick={() => onEditProject(project)} style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.5, transition: 'opacity 0.2s', padding: 4 }} title="Edit Project" onMouseEnter={e => (e.currentTarget.style.opacity = '1')} onMouseLeave={e => (e.currentTarget.style.opacity = '0.5')}>
                                            ✏️
                                        </button>
                                    )}
                                </div>
                                <div style={{ fontSize: 12, color: '#64748b' }}>{project.description}</div>
                            </div>
                            <div>
                                <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Status</div>
                                <span className={getProjStatusBadge(project.status)}>{project.status}</span>
                            </div>
                            <div>
                                <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>FTE Committed</div>
                                <span style={{ fontSize: 22, fontWeight: 800, color: '#1e293b' }}>{totalFte.toFixed(1)}</span>
                                <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 4 }}>FTE</span>
                            </div>
                            <div>
                                <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Est. Monthly Cost</div>
                                <span style={{ fontSize: 22, fontWeight: 800, color: '#10b981' }}>
                                    €{totalMonthlyCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </span>
                            </div>
                            <div>
                                <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Timeline</div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>
                                    {project.startDate && project.endDate ? `${project.startDate} → ${project.endDate}` : 'TBD'}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Resource allocation for this project */}
                    <div className="panel">
                        <div className="panel-header">
                            <div>
                                <div className="panel-title">Capacity Allocated – {project.name}</div>
                                <div className="panel-subtitle">{projAllocs.length} resources committed</div>
                            </div>
                        </div>
                        {projAllocs.length === 0 ? (
                            <div className="empty-state">
                                <h3>No resources allocated</h3>
                                <p>Use the Allocation Matrix to assign resources to this project.</p>
                            </div>
                        ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, padding: 20 }}>
                                {projAllocs.map(a => {
                                    const res = resources.find(r => r.id === a.resourceId);
                                    if (!res) return null;
                                    const totalUtil = liveAlloc.filter(x => x.resourceId === res.id).reduce((s, x) => s + x.percentage, 0);
                                    const statusS = getAllocationStatus(totalUtil);
                                    return (
                                        <div key={a.id} style={{
                                            background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12,
                                            padding: '16px', display: 'flex', flexDirection: 'column', gap: 10,
                                            boxShadow: '0 1px 4px rgba(0,0,0,.05)',
                                            borderLeft: `3px solid ${project.color || '#6366f1'}`,
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                <div className="avatar" style={{
                                                    background: res.type === 'Permanent' ? '#eef2ff' : '#fdf4ff',
                                                    color: res.type === 'Permanent' ? '#4338ca' : '#7c3aed',
                                                }}>
                                                    {res.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                                                </div>
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ fontWeight: 700, fontSize: 13, color: '#1e293b' }}>
                                                        {res.name}
                                                        {res.dailyRate ? <span style={{ fontSize: 11, color: '#64748b', fontWeight: 500, marginLeft: 6 }}>€{res.dailyRate}/day</span> : ''}
                                                    </div>
                                                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{res.role} · {res.department}</div>
                                                </div>
                                                <div style={{ fontSize: 18, fontWeight: 800, color: project.color || '#6366f1' }}>
                                                    {a.percentage}%
                                                </div>
                                            </div>
                                            {/* Bar showing this project's share vs total */}
                                            <div>
                                                <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
                                                    {a.percentage}% to {project.name} · <span style={{ color: utilColor(totalUtil), fontWeight: 700 }}>{totalUtil}% total load</span>
                                                </div>
                                                <div style={{ height: 8, background: '#f1f5f9', borderRadius: 99, overflow: 'hidden', position: 'relative' }}>
                                                    <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${Math.min(100, totalUtil)}%`, background: utilColor(totalUtil), borderRadius: 99 }} />
                                                    <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${Math.min(100, a.percentage)}%`, background: project.color || '#6366f1', opacity: .7, borderRadius: 99 }} />
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                                                <span className={statusBadgeClass(statusS)}>{statusS}</span>
                                            </div>

                                            <div style={{ marginTop: 8 }}>
                                                <TimeForecastGrid resource={res} projects={projects} allocations={liveAlloc.filter(x => x.resourceId === res.id)} />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};
