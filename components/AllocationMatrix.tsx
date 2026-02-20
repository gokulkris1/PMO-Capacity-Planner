
import React, { useState } from 'react';
import { Resource, Project, Allocation, getAllocationStatus, AllocationStatus } from '../types';

interface Props {
    resources: Resource[];
    projects: Project[];
    allocations: Allocation[];
    scenarioMode: boolean;
    scenarioAllocations: Allocation[] | null;
    onUpdate: (resId: string, projId: string, val: string) => void;
    onExportCSV: () => void;
}

function statusClass(pct: number) {
    const s = getAllocationStatus(pct);
    if (s === AllocationStatus.OVER) return 'over';
    if (s === AllocationStatus.HIGH) return 'high';
    if (s === AllocationStatus.OPTIMAL) return 'optimal';
    return '';
}

function utilColor(pct: number) {
    const s = getAllocationStatus(pct);
    if (s === AllocationStatus.OVER) return '#ef4444';
    if (s === AllocationStatus.HIGH) return '#f59e0b';
    if (s === AllocationStatus.OPTIMAL) return '#10b981';
    return '#94a3b8';
}

function utilBg(pct: number) {
    const s = getAllocationStatus(pct);
    if (s === AllocationStatus.OVER) return '#fef2f2';
    if (s === AllocationStatus.HIGH) return '#fffbeb';
    if (s === AllocationStatus.OPTIMAL) return '#ecfdf5';
    return 'transparent';
}

export const AllocationMatrix: React.FC<Props> = ({
    resources, projects, allocations, scenarioMode, scenarioAllocations, onUpdate, onExportCSV
}) => {
    const [filterProjId, setFilterProjId] = useState('');
    const liveAlloc = scenarioMode && scenarioAllocations ? scenarioAllocations : allocations;

    const filteredProjects = filterProjId ? projects.filter(p => p.id === filterProjId) : projects;

    function getResourceUtil(resId: string) {
        return liveAlloc.filter(a => a.resourceId === resId).reduce((s, a) => s + a.percentage, 0);
    }

    function getAlloc(resId: string, projId: string) {
        return liveAlloc.find(a => a.resourceId === resId && a.projectId === projId)?.percentage || 0;
    }

    return (
        <div className="panel page-enter" style={{ overflow: 'hidden' }}>
            <div className="panel-header">
                <div>
                    <div className="panel-title">Allocation Matrix</div>
                    <div className="panel-subtitle">Each cell = % of resource dedicated to that project. Click a cell to edit.</div>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <select
                        value={filterProjId}
                        onChange={e => setFilterProjId(e.target.value)}
                        className="form-select"
                        style={{ width: 'auto', fontSize: 12 }}
                    >
                        <option value="">All Projects</option>
                        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={onExportCSV}>⬇ Export CSV</button>
                </div>
            </div>

            {/* Legend */}
            <div style={{ padding: '10px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', gap: 16, alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Legend:</span>
                {[
                    { label: 'Under <60%', color: '#94a3b8', bg: '#f8fafc' },
                    { label: 'Optimal 60–80%', color: '#059669', bg: '#ecfdf5' },
                    { label: 'High 80–100%', color: '#b45309', bg: '#fffbeb' },
                    { label: 'Over >100%', color: '#b91c1c', bg: '#fef2f2' },
                ].map(l => (
                    <span key={l.label} style={{ fontSize: 11, fontWeight: 600, color: l.color, background: l.bg, padding: '2px 8px', borderRadius: 6 }}>{l.label}</span>
                ))}
                {scenarioMode && (
                    <span style={{ marginLeft: 'auto', fontSize: 11, background: '#fffbeb', color: '#b45309', fontWeight: 700, padding: '3px 10px', borderRadius: 6, border: '1px solid #fde68a' }}>
                        🔬 WHAT-IF MODE – edits are sandboxed
                    </span>
                )}
            </div>

            <div style={{ overflowX: 'auto' }}>
                <table className="data-table" style={{ minWidth: 700 }}>
                    <thead>
                        <tr>
                            <th style={{ position: 'sticky', left: 0, background: '#f8fafc', zIndex: 10, minWidth: 180 }}>Resource</th>
                            <th style={{ minWidth: 80 }}>Total %</th>
                            {filteredProjects.map(p => (
                                <th key={p.id} style={{ minWidth: 110, textAlign: 'center' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                                        <div style={{ width: 6, height: 6, borderRadius: 2, background: p.color || '#6366f1' }} />
                                        <span>{p.name}</span>
                                    </div>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {resources.map(res => {
                            const util = getResourceUtil(res.id);
                            return (
                                <tr key={res.id} style={{ background: utilBg(util) }}>
                                    {/* Resource name sticky */}
                                    <td style={{ position: 'sticky', left: 0, background: utilBg(util) || '#fff', zIndex: 5 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                            <div
                                                className="avatar"
                                                style={{
                                                    background: res.type === 'Permanent' ? '#eef2ff' : res.type === 'Contractor' ? '#fdf4ff' : '#fff7ed',
                                                    color: res.type === 'Permanent' ? '#4338ca' : res.type === 'Contractor' ? '#7c3aed' : '#c2410c',
                                                    fontSize: 11,
                                                }}
                                            >
                                                {res.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                                            </div>
                                            <div>
                                                <div style={{ fontWeight: 600, fontSize: 13, color: '#1e293b' }}>{res.name}</div>
                                                <div style={{ fontSize: 11, color: '#94a3b8' }}>{res.role}</div>
                                            </div>
                                        </div>
                                    </td>
                                    {/* Total util */}
                                    <td>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                            <span style={{ fontWeight: 800, fontSize: 14, color: utilColor(util) }}>{util}%</span>
                                            <div className="alloc-bar-bg">
                                                <div className="alloc-bar-fill" style={{ width: `${Math.min(100, util)}%`, background: utilColor(util) }} />
                                            </div>
                                        </div>
                                    </td>
                                    {/* Per-project cells */}
                                    {filteredProjects.map(proj => {
                                        const pct = getAlloc(res.id, proj.id);
                                        return (
                                            <td key={proj.id} style={{ textAlign: 'center' }}>
                                                <input
                                                    type="number"
                                                    min={0}
                                                    max={100}
                                                    value={pct || ''}
                                                    placeholder="0"
                                                    onChange={e => onUpdate(res.id, proj.id, e.target.value)}
                                                    className={`matrix-cell-input ${statusClass(pct)}`}
                                                />
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
