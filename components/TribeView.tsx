import React, { useState } from 'react';
import { Resource, Project, Allocation, getAllocationStatus, AllocationStatus } from '../types';
import { TimeForecastGrid } from './TimeForecastGrid';

interface Props {
    resources: Resource[];
    projects: Project[];
    allocations: Allocation[];
    scenarioAllocations?: Allocation[] | null;
    onEditResource?: (res: Resource) => void;
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

export const TribeView: React.FC<Props> = ({ resources, projects, allocations, scenarioAllocations, onEditResource }) => {
    const liveAlloc = scenarioAllocations ?? allocations;

    // Extract unique Tribes (clientName) from projects
    const tribes = Array.from(new Set(projects.map(p => p.clientName).filter(Boolean))) as string[];
    // Sort alphabetically
    tribes.sort();

    const [selectedTribe, setSelectedTribe] = useState<string>(tribes[0] || '');

    if (tribes.length === 0) {
        return (
            <div className="empty-state page-enter">
                <div style={{ fontSize: 48, marginBottom: 16 }}>⛺</div>
                <h3>No Tribes Found</h3>
                <p>Edit your projects and assign a "Tribe / Client / Owner" to see them grouped here.</p>
            </div>
        );
    }

    // Projects belonging to this Tribe
    const tribeProjects = projects.filter(p => p.clientName === selectedTribe);
    const tribeProjectIds = new Set(tribeProjects.map(p => p.id));

    // Allocations belonging to this Tribe
    const tribeAllocs = liveAlloc.filter(a => tribeProjectIds.has(a.projectId));

    // Aggregate capacity per resource within this Tribe
    const resourceMap = new Map<string, { totalPct: number; projCount: number }>();
    tribeAllocs.forEach(a => {
        if (!resourceMap.has(a.resourceId)) {
            resourceMap.set(a.resourceId, { totalPct: 0, projCount: 0 });
        }
        const data = resourceMap.get(a.resourceId)!;
        data.totalPct += a.percentage;
        data.projCount += 1;
    });

    const totalFte = Array.from(resourceMap.values()).reduce((sum, r) => sum + r.totalPct, 0) / 100;

    // Calculate Monthly cost for this Tribe
    const totalMonthlyCost = Array.from(resourceMap.entries()).reduce((s, [resId, data]) => {
        const res = resources.find(r => r.id === resId);
        const rate = res?.dailyRate || 0;
        return s + (rate * 20 * (data.totalPct / 100));
    }, 0);

    return (
        <div className="page-enter" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Tribe Selector */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {tribes.map(t => (
                    <button
                        key={t}
                        onClick={() => setSelectedTribe(t)}
                        style={{
                            padding: '8px 16px', borderRadius: 99,
                            border: `2px solid ${selectedTribe === t ? '#6366f1' : 'transparent'}`,
                            background: selectedTribe === t ? '#6366f1' : '#fff',
                            color: selectedTribe === t ? '#fff' : '#475569',
                            fontWeight: 600, fontSize: 13, cursor: 'pointer',
                            boxShadow: selectedTribe === t ? '0 4px 12px rgba(99,102,241,.25)' : '0 1px 3px rgba(0,0,0,.06)',
                            transition: 'all .2s',
                        }}
                    >
                        {t}
                    </button>
                ))}
            </div>

            {selectedTribe && (
                <>
                    {/* Tribe Header summary */}
                    <div className="panel">
                        <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr 1fr 1fr', gap: 24, alignItems: 'center' }}>
                            <div style={{ width: 48, height: 48, borderRadius: 12, background: 'linear-gradient(135deg, #10b981, #059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>
                                ⛺
                            </div>
                            <div>
                                <div style={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>{selectedTribe}</div>
                                <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>Tribe / Client / Owner</div>
                            </div>
                            <div>
                                <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Active Projects</div>
                                <span style={{ fontSize: 22, fontWeight: 800, color: '#1e293b' }}>{tribeProjects.length}</span>
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
                        </div>
                    </div>

                    {/* Resources in this Tribe */}
                    <div className="panel">
                        <div className="panel-header">
                            <div>
                                <div className="panel-title">Resource Allocation – {selectedTribe}</div>
                                <div className="panel-subtitle">{resourceMap.size} resources deployed across {tribeProjects.length} projects</div>
                            </div>
                        </div>
                        {resourceMap.size === 0 ? (
                            <div className="empty-state">
                                <h3>No resources allocated</h3>
                                <p>This tribe has projects, but no resources are currently assigned to them.</p>
                            </div>
                        ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16, padding: 20 }}>
                                {Array.from(resourceMap.entries()).map(([resId, data]) => {
                                    const res = resources.find(r => r.id === resId);
                                    if (!res) return null;

                                    // Calculate this person's GLOBAL utilization (across all tribes/projects)
                                    const totalGlobalUtil = liveAlloc.filter(x => x.resourceId === res.id).reduce((s, x) => s + x.percentage, 0);
                                    const statusS = getAllocationStatus(totalGlobalUtil);

                                    return (
                                        <div key={resId} style={{
                                            background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12,
                                            padding: '16px', display: 'flex', flexDirection: 'column', gap: 10,
                                            boxShadow: '0 1px 4px rgba(0,0,0,.05)',
                                            borderLeft: `3px solid #10b981`,
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                <div className="avatar" style={{
                                                    background: res.type === 'Permanent' ? '#eef2ff' : '#fdf4ff',
                                                    color: res.type === 'Permanent' ? '#4338ca' : '#7c3aed',
                                                }}>
                                                    {res.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                                                </div>
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                        <span style={{ fontWeight: 700, fontSize: 13, color: '#1e293b' }}>{res.name}</span>
                                                        {onEditResource && (
                                                            <button onClick={() => onEditResource(res)} style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.5, transition: 'opacity 0.2s', padding: 2 }} title="Edit Resource" onMouseEnter={e => (e.currentTarget.style.opacity = '1')} onMouseLeave={e => (e.currentTarget.style.opacity = '0.5')}>
                                                                ✏️
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{res.role} · {res.department}</div>
                                                </div>
                                                <div style={{ textAlign: 'right' }}>
                                                    <div style={{ fontSize: 18, fontWeight: 800, color: '#10b981' }}>
                                                        {data.totalPct}%
                                                    </div>
                                                    <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>IN TRIBE</div>
                                                </div>
                                            </div>

                                            {/* Bar showing this Tribe's share vs total global load */}
                                            <div>
                                                <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
                                                    {data.totalPct}% to Tribe · <span style={{ color: utilColor(totalGlobalUtil), fontWeight: 700 }}>{totalGlobalUtil}% total load</span>
                                                </div>
                                                <div style={{ height: 8, background: '#f1f5f9', borderRadius: 99, overflow: 'hidden', position: 'relative' }}>
                                                    <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${Math.min(100, totalGlobalUtil)}%`, background: utilColor(totalGlobalUtil), borderRadius: 99 }} />
                                                    <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${Math.min(100, data.totalPct)}%`, background: '#10b981', opacity: .9, borderRadius: 99, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.1)' }} />
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                                                <div style={{ fontSize: 11, color: '#64748b' }}>Across {data.projCount} project(s)</div>
                                                <span className={statusBadgeClass(statusS)}>{statusS} Global</span>
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
