import React, { useState } from 'react';
import { Resource, Project, Allocation, getAllocationStatus, AllocationStatus } from '../types';
import { TimeForecastGrid } from './TimeForecastGrid';

interface Props {
    resources: Resource[];
    projects: Project[];
    allocations: Allocation[];
    scenarioAllocations?: Allocation[] | null;
    onAddResource?: () => void;
    onEditResource?: (res: Resource) => void;
    onDeleteResource?: (res: Resource) => void;
}

function utilColor(pct: number) {
    const s = getAllocationStatus(pct);
    if (s === AllocationStatus.OVER) return '#ef4444';
    if (s === AllocationStatus.HIGH) return '#f59e0b';
    if (s === AllocationStatus.OPTIMAL) return '#10b981';
    return '#94a3b8';
}

export const ResourceView: React.FC<Props> = ({
    resources,
    projects,
    allocations,
    scenarioAllocations,
    onAddResource,
    onEditResource,
    onDeleteResource,
}) => {
    const [search, setSearch] = useState('');
    const liveAlloc = scenarioAllocations ?? allocations;

    const filtered = resources.filter(r => {
        const q = search.toLowerCase();
        return (
            r.name.toLowerCase().includes(q) ||
            r.role.toLowerCase().includes(q) ||
            (r.skills || []).some(s => s.toLowerCase().includes(q))
        );
    });

    return (
        <div className="page-enter" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ position: 'relative', maxWidth: 360, flex: '1 1 280px' }}>
                    <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: 14 }}>🔍</span>
                    <input
                        type="text"
                        placeholder="Search by name, role, or skill..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="form-input"
                        style={{ paddingLeft: 34 }}
                    />
                </div>
                {onAddResource && <button className="btn btn-primary" onClick={onAddResource}>+ Add Resource</button>}
            </div>

            {filtered.map(res => {
                const resAllocs = liveAlloc.filter(a => a.resourceId === res.id && a.percentage > 0);
                const totalUtil = resAllocs.reduce((s, a) => s + a.percentage, 0);

                const typeMap: Record<string, string> = {
                    Permanent: 'badge badge-perm',
                    Contractor: 'badge badge-cont',
                    'Part-Time': 'badge badge-part',
                };

                return (
                    <div key={res.id} className="panel" style={{ borderLeft: `4px solid ${utilColor(totalUtil)}` }}>
                        <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 20, alignItems: 'center' }}>
                            <div className="avatar" style={{
                                width: 48, height: 48, fontSize: 16,
                                background: res.type === 'Permanent' ? '#eef2ff' : res.type === 'Contractor' ? '#fdf4ff' : '#fff7ed',
                                color: res.type === 'Permanent' ? '#4338ca' : res.type === 'Contractor' ? '#7c3aed' : '#c2410c',
                            }}>
                                {res.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                            </div>
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                                    <span style={{ fontWeight: 800, fontSize: 16, color: '#0f172a' }}>{res.name}</span>
                                    {onEditResource && (
                                        <button onClick={() => onEditResource(res)} style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.5, transition: 'opacity 0.2s', padding: 4 }} title="Edit Resource" onMouseEnter={e => (e.currentTarget.style.opacity = '1')} onMouseLeave={e => (e.currentTarget.style.opacity = '0.5')}>
                                            ✏️
                                        </button>
                                    )}
                                </div>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: 12, color: '#64748b' }}>{res.role}</span>
                                    <span style={{ color: '#cbd5e1' }}>·</span>
                                    <span style={{ fontSize: 12, color: '#64748b' }}>{res.department}</span>
                                    {(res.teamName || res.teamId) && (
                                        <>
                                            <span style={{ color: '#cbd5e1' }}>·</span>
                                            <span style={{ fontSize: 12, color: '#64748b' }}>👥 {res.teamName || res.teamId}</span>
                                        </>
                                    )}
                                    {res.location && (
                                        <>
                                            <span style={{ color: '#cbd5e1' }}>·</span>
                                            <span style={{ fontSize: 12, color: '#94a3b8' }}>📍 {res.location}</span>
                                        </>
                                    )}
                                    <span className={typeMap[res.type] || 'badge badge-perm'}>{res.type}</span>
                                    {(res.skills || []).slice(0, 4).map(skill => (
                                        <span key={skill} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 999, background: '#eef2ff', color: '#4338ca', fontWeight: 600 }}>
                                            {skill}
                                        </span>
                                    ))}
                                </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: 28, fontWeight: 800, color: utilColor(totalUtil), lineHeight: 1 }}>{totalUtil}%</div>
                                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>Total allocated</div>
                                <div style={{ marginTop: 8, height: 7, width: 120, background: '#f1f5f9', borderRadius: 99, overflow: 'hidden' }}>
                                    <div style={{ height: '100%', width: `${Math.min(100, totalUtil)}%`, background: utilColor(totalUtil), borderRadius: 99, transition: 'width .4s' }} />
                                </div>
                            </div>
                        </div>

                        <div style={{ borderTop: '1px solid #f1f5f9', padding: '12px 24px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                            {onEditResource && <button className="btn btn-secondary" style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => onEditResource(res)}>Edit</button>}
                            {onDeleteResource && <button className="btn btn-danger" style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => onDeleteResource(res)}>Delete</button>}
                        </div>

                        {resAllocs.length > 0 ? (
                            <div style={{ borderTop: '1px solid #f1f5f9', padding: '12px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>
                                    Spread across {resAllocs.length} project{resAllocs.length !== 1 ? 's' : ''}:
                                </div>
                                {resAllocs.map(a => {
                                    const proj = projects.find(p => p.id === a.projectId);
                                    if (!proj) return null;
                                    return (
                                        <div key={a.id} style={{ display: 'grid', alignItems: 'center', gap: 10, gridTemplateColumns: '12px 160px 1fr auto' }}>
                                            <div style={{ width: 10, height: 10, borderRadius: 3, background: proj.color || '#6366f1', flexShrink: 0 }} />
                                            <div style={{ fontWeight: 600, fontSize: 13, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {proj.name}
                                                <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400, marginLeft: 6 }}>{proj.status}</span>
                                            </div>
                                            <div className="alloc-bar-bg">
                                                <div className="alloc-bar-fill" style={{ width: `${a.percentage}%`, background: proj.color || '#6366f1' }} />
                                            </div>
                                            <div style={{ fontWeight: 700, fontSize: 13, color: proj.color || '#6366f1', minWidth: 36, textAlign: 'right' }}>{a.percentage}%</div>
                                        </div>
                                    );
                                })}
                                {totalUtil > 100 && (
                                    <div style={{ marginTop: 4, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '6px 12px', fontSize: 12, color: '#b91c1c', fontWeight: 600 }}>
                                        ⚠️ Over-allocated by {totalUtil - 100}% - review assignments
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div style={{ borderTop: '1px solid #f1f5f9', padding: '12px 24px', fontSize: 13, color: '#94a3b8' }}>
                                No active project allocations - resource is available.
                            </div>
                        )}

                        <div style={{ padding: '0 24px 24px' }}>
                            <TimeForecastGrid resource={res} projects={projects} allocations={liveAlloc.filter(a => a.resourceId === res.id)} />
                        </div>
                    </div>
                );
            })}
        </div>
    );
};
