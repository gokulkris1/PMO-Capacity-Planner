import React, { useState } from 'react';
import { Resource, Project, Allocation, getAllocationStatus, AllocationStatus } from '../types';

interface Props {
    resources: Resource[];
    projects: Project[];
    allocations: Allocation[];
    scenarioMode: boolean;
    scenarioAllocations: Allocation[] | null;
    onUpdateAdvanced: (resId: string, projId: string) => void;
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

// Check if an allocation falls within the selected month (YYYY-MM)
function isAllocActiveInMonth(a: Allocation, yyyyMm: string) {
    if (!yyyyMm) return true; // All Time

    // Convert YYYY-MM to the first and last day of that month
    const [year, month] = yyyyMm.split('-');
    const filterStart = new Date(parseInt(year), parseInt(month) - 1, 1);
    const filterEnd = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59);

    const aStart = a.startDate ? new Date(a.startDate) : new Date('2000-01-01');
    const aEnd = a.endDate ? new Date(a.endDate) : new Date('2099-12-31');

    return aStart <= filterEnd && aEnd >= filterStart;
}

export const AllocationMatrix: React.FC<Props> = ({
    resources, projects, allocations, scenarioMode, scenarioAllocations, onUpdateAdvanced, onExportCSV
}) => {
    const [filterProjId, setFilterProjId] = useState('');
    const [filterMonth, setFilterMonth] = useState(() => new Date().toISOString().slice(0, 7)); // Default: Current Month YYYY-MM

    const liveAlloc = scenarioMode && scenarioAllocations ? scenarioAllocations : allocations;

    const filteredProjects = filterProjId ? projects.filter(p => p.id === filterProjId) : projects;

    function getResourceUtil(resId: string) {
        return liveAlloc
            .filter(a => a.resourceId === resId && isAllocActiveInMonth(a, filterMonth))
            .reduce((s, a) => s + a.percentage, 0);
    }

    function getAllocForCell(resId: string, projId: string) {
        const allocs = liveAlloc.filter(a => a.resourceId === resId && a.projectId === projId && isAllocActiveInMonth(a, filterMonth));
        if (allocs.length === 0) return { pct: 0, multiple: false };
        if (allocs.length === 1) return { pct: allocs[0].percentage, multiple: false };

        // Sum overlapping slices for the month
        const sum = allocs.reduce((s, a) => s + a.percentage, 0);
        return { pct: sum, multiple: true };
    }

    return (
        <div className="panel page-enter" style={{ overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
            <div className="panel-header">
                <div>
                    <div className="panel-title">Allocation Matrix Timeline</div>
                    <div className="panel-subtitle">Filter by month to see forecasted utilization. Click a cell to assign dates.</div>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <input
                        type="month"
                        value={filterMonth}
                        onChange={e => setFilterMonth(e.target.value)}
                        className="form-input"
                        style={{ width: 140, fontSize: 13, height: 34, padding: '0 10px' }}
                    />
                    <select
                        value={filterProjId}
                        onChange={e => setFilterProjId(e.target.value)}
                        className="form-select"
                        style={{ width: 'auto', fontSize: 12, height: 34 }}
                    >
                        <option value="">All Projects</option>
                        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <button className="btn btn-secondary" style={{ fontSize: 12, height: 34 }} onClick={onExportCSV}>⬇ Export CSV</button>
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
                                        const { pct, multiple } = getAllocForCell(res.id, proj.id);
                                        return (
                                            <td key={proj.id} style={{ textAlign: 'center' }}>
                                                <button
                                                    onClick={() => !scenarioMode && onUpdateAdvanced(res.id, proj.id)}
                                                    style={{
                                                        width: 50, height: 32, borderRadius: 6, border: '1px solid #e2e8f0',
                                                        background: pct > 0 ? '#eff6ff' : '#fff',
                                                        color: pct > 0 ? '#1e40af' : '#94a3b8',
                                                        fontWeight: pct > 0 ? 700 : 500,
                                                        cursor: scenarioMode ? 'not-allowed' : 'pointer',
                                                        fontSize: 14
                                                    }}
                                                    title={multiple ? "Multiple time slices exist in this month. Click to edit." : "Click to edit allocation"}
                                                >
                                                    {pct > 0 ? `${pct}%` : '-'}
                                                </button>
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
