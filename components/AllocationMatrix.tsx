import React, { useState, useMemo } from 'react';
import { Resource, Project, Allocation, getAllocationStatus, AllocationStatus } from '../types';
import { getAvailableYears, getQuartersForYear } from '../src/utils/sprintUtils';

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

// Helper to see if an allocation hits a specific sprint precise dates
function isAllocActiveInSprint(a: Allocation, sprintStart: string, sprintEnd: string) {
    if (!a.startDate || !a.endDate) return true; // generic allocation applies always
    const aS = new Date(a.startDate);
    const aE = new Date(a.endDate);
    const sS = new Date(sprintStart);
    const sE = new Date(sprintEnd);
    return aS <= sE && aE >= sS;
}

export const AllocationMatrix: React.FC<Props> = ({
    resources, projects, allocations, scenarioMode, scenarioAllocations, onUpdateAdvanced, onExportCSV
}) => {
    const currentYear = new Date().getUTCFullYear();
    const currentQ = Math.floor(new Date().getUTCMonth() / 3) + 1;

    const [filterYear, setFilterYear] = useState<number>(currentYear);
    const [filterQuarterId, setFilterQuarterId] = useState<string>(`${currentYear}-Q${currentQ}`);
    const [filterProjId, setFilterProjId] = useState('');

    const liveAlloc = scenarioMode && scenarioAllocations ? scenarioAllocations : allocations;
    const availableYears = getAvailableYears();
    const quarters = useMemo(() => getQuartersForYear(filterYear), [filterYear]);
    const activeQuarter = quarters.find(q => q.id === filterQuarterId) || quarters[0];

    // Resources might be assigned to multiple projects in a single sprint
    function getResourceSprintUtil(resId: string, sprintStart: string, sprintEnd: string) {
        let util = 0;
        liveAlloc.forEach(a => {
            if (a.resourceId === resId) {
                // If filtering by project, skip other projects
                if (filterProjId && a.projectId !== filterProjId) return;

                if (isAllocActiveInSprint(a, sprintStart, sprintEnd)) {
                    util += a.percentage;
                }
            }
        });
        return util;
    }

    // Projects array matching what a resource is doing inside a sprint
    function getProjectsForSprint(resId: string, sprintStart: string, sprintEnd: string) {
        const matches: { proj: Project, pct: number }[] = [];
        liveAlloc.forEach(a => {
            if (a.resourceId === resId && isAllocActiveInSprint(a, sprintStart, sprintEnd)) {
                if (filterProjId && a.projectId !== filterProjId) return;
                const proj = projects.find(p => p.id === a.projectId);
                if (proj) {
                    matches.push({ proj, pct: a.percentage });
                }
            }
        });
        return matches;
    }

    return (
        <div className="panel page-enter" style={{ overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
            <div className="panel-header">
                <div>
                    <div className="panel-title">Sprint Allocation Matrix</div>
                    <div className="panel-subtitle">View capacity bounded strictly by 14-day Sprint cadence. Colors highlight 80% critical thresholds.</div>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <select
                        value={filterYear}
                        onChange={e => {
                            const y = parseInt(e.target.value);
                            setFilterYear(y);
                            setFilterQuarterId(`${y}-Q1`);
                        }}
                        className="form-select" style={{ width: 100, fontSize: 13, height: 34 }}
                    >
                        {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                    <select
                        value={filterQuarterId}
                        onChange={e => setFilterQuarterId(e.target.value)}
                        className="form-select" style={{ width: 120, fontSize: 13, height: 34 }}
                    >
                        {quarters.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}
                    </select>
                    <select
                        value={filterProjId}
                        onChange={e => setFilterProjId(e.target.value)}
                        className="form-select"
                        style={{ width: 'auto', fontSize: 13, height: 34 }}
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
                <table className="data-table" style={{ minWidth: 900 }}>
                    <thead>
                        <tr>
                            <th style={{ position: 'sticky', left: 0, background: '#f8fafc', zIndex: 10, minWidth: 220 }}>Resource</th>
                            {activeQuarter.sprints.map(s => (
                                <th key={s.id} style={{ minWidth: 140, textAlign: 'center' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                        <div style={{ fontWeight: 700, color: '#1e293b' }}>{s.name}</div>
                                        <div style={{ fontSize: 10, color: '#64748b', fontWeight: 500 }}>{s.startDate.slice(5)} to {s.endDate.slice(5)}</div>
                                    </div>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {resources.map(res => {
                            // Find out if they are over 80% anywhere in this quarter for background highlight
                            const sprintUtils = activeQuarter.sprints.map(s => getResourceSprintUtil(res.id, s.startDate, s.endDate));
                            const maxUtil = Math.max(...sprintUtils, 0);

                            return (
                                <tr key={res.id} style={{ background: utilBg(maxUtil) }}>
                                    {/* Resource name sticky */}
                                    <td style={{ position: 'sticky', left: 0, background: utilBg(maxUtil) || '#fff', zIndex: 5 }}>
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
                                                <div style={{ fontSize: 11, color: '#94a3b8' }}>{res.role} (Max: {maxUtil}%)</div>
                                            </div>
                                        </div>
                                    </td>
                                    {/* Per-Sprint cells */}
                                    {activeQuarter.sprints.map((sprint, idx) => {
                                        const util = sprintUtils[idx];
                                        const projectsInSprint = getProjectsForSprint(res.id, sprint.startDate, sprint.endDate);

                                        return (
                                            <td key={sprint.id} style={{ textAlign: 'center', verticalAlign: 'top', background: utilBg(util) }}>
                                                {/* Threshold logic - 80% is the cutoff */}
                                                <div style={{ fontWeight: 800, fontSize: 15, color: utilColor(util), marginBottom: 8 }}>
                                                    {util > 0 ? `${util}%` : '-'}
                                                </div>

                                                {/* Stack of projects assigned in this sprint */}
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                                                    {projectsInSprint.map((pSet, i) => (
                                                        <button
                                                            key={i}
                                                            onClick={() => !scenarioMode && onUpdateAdvanced(res.id, pSet.proj.id)}
                                                            style={{
                                                                width: '100%',
                                                                maxWidth: 130,
                                                                padding: '4px 6px',
                                                                borderRadius: 6,
                                                                border: `1px solid ${pSet.proj.color || '#6366f1'}40`,
                                                                background: '#fff',
                                                                cursor: scenarioMode ? 'not-allowed' : 'pointer',
                                                                fontSize: 10,
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'space-between',
                                                                boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                                                            }}
                                                            title={`Click to edit allocation for ${pSet.proj.name}`}
                                                        >
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden' }}>
                                                                <div style={{ width: 6, height: 6, borderRadius: '50%', background: pSet.proj.color || '#6366f1', flexShrink: 0 }} />
                                                                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600, color: '#475569' }}>{pSet.proj.name}</span>
                                                            </div>
                                                            <strong style={{ color: pSet.proj.color || '#6366f1' }}>{pSet.pct}%</strong>
                                                        </button>
                                                    ))}
                                                </div>
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
