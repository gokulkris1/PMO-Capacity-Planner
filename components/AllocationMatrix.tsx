
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

// ── Allocation status colours (dark-mode optimised) ──────────────────────────
function utilColor(pct: number): string {
    const s = getAllocationStatus(pct);
    if (s === AllocationStatus.OVER) return '#f87171';  // red-400
    if (s === AllocationStatus.HIGH) return '#fbbf24';  // amber-400
    if (s === AllocationStatus.OPTIMAL) return '#34d399';  // emerald-400
    return '#64748b';                                       // slate-500
}

function utilBgCell(pct: number): string {
    const s = getAllocationStatus(pct);
    if (s === AllocationStatus.OVER) return 'rgba(248,113,113,0.12)';
    if (s === AllocationStatus.HIGH) return 'rgba(251,191,36,0.10)';
    if (s === AllocationStatus.OPTIMAL) return 'rgba(52,211,153,0.10)';
    return 'transparent';
}

function utilBorderCell(pct: number): string {
    const s = getAllocationStatus(pct);
    if (s === AllocationStatus.OVER) return 'rgba(248,113,113,0.35)';
    if (s === AllocationStatus.HIGH) return 'rgba(251,191,36,0.30)';
    if (s === AllocationStatus.OPTIMAL) return 'rgba(52,211,153,0.30)';
    return 'rgba(255,255,255,0.06)';
}

function isAllocActiveInRange(a: Allocation, range: { start: string; end: string }) {
    if (!range.start || !range.end) return true;
    const [sYear, sMonth] = range.start.split('-');
    const [eYear, eMonth] = range.end.split('-');
    const filterStart = new Date(parseInt(sYear), parseInt(sMonth) - 1, 1);
    const filterEnd = new Date(parseInt(eYear), parseInt(eMonth), 0, 23, 59, 59);
    const aStart = a.startDate ? new Date(a.startDate) : new Date('2000-01-01');
    const aEnd = a.endDate ? new Date(a.endDate) : new Date('2099-12-31');
    return aStart <= filterEnd && aEnd >= filterStart;
}

// ── Mini progress bar ────────────────────────────────────────────────────────
const UtilBar: React.FC<{ pct: number }> = ({ pct }) => (
    <div style={{
        height: 4, borderRadius: 4, background: 'rgba(255,255,255,0.06)',
        overflow: 'hidden', width: '100%', marginTop: 4,
    }}>
        <div style={{
            height: '100%', width: `${Math.min(100, pct)}%`,
            background: pct > 100
                ? 'linear-gradient(90deg, #ef4444, #f87171)'
                : pct > 80
                    ? 'linear-gradient(90deg, #d97706, #fbbf24)'
                    : pct > 60
                        ? 'linear-gradient(90deg, #059669, #34d399)'
                        : 'rgba(100,116,139,0.5)',
            borderRadius: 4,
            transition: 'width 0.4s cubic-bezier(.25,.46,.45,.94)',
        }} />
    </div>
);

// ── Avatar initials ──────────────────────────────────────────────────────────
const Avatar: React.FC<{ name: string; type?: string }> = ({ name, type }) => {
    const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    const colors = {
        Permanent: { bg: 'rgba(99,102,241,0.2)', color: '#a5b4fc' },
        Contractor: { bg: 'rgba(139,92,246,0.2)', color: '#c4b5fd' },
        default: { bg: 'rgba(6,182,212,0.2)', color: '#67e8f9' },
    };
    const c = colors[type as keyof typeof colors] || colors.default;
    return (
        <div style={{
            width: 34, height: 34, borderRadius: 10, flexShrink: 0,
            background: c.bg, color: c.color, border: `1px solid ${c.color} 30`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 800, letterSpacing: '0.02em',
        }}>
            {initials}
        </div>
    );
};

// ── Legend pill ───────────────────────────────────────────────────────────────
const LegendPill: React.FC<{ color: string; label: string }> = ({ color, label }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ width: 8, height: 8, borderRadius: 3, background: color, flexShrink: 0 }} />
        <span style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>{label}</span>
    </div>
);

// ── Main component ────────────────────────────────────────────────────────────
export const AllocationMatrix: React.FC<Props> = ({
    resources, projects, allocations, scenarioMode, scenarioAllocations, onUpdateAdvanced, onExportCSV
}) => {
    const [filterProjId, setFilterProjId] = useState('');
    // Filter range: start and end month (YYYY-MM)
    const [filterRange, setFilterRange] = useState({
        start: new Date().toISOString().slice(0, 7),
        end: new Date().toISOString().slice(0, 7),
    });

    const liveAlloc = scenarioMode && scenarioAllocations ? scenarioAllocations : allocations;
    const filteredProjects = filterProjId ? projects.filter(p => p.id === filterProjId) : projects;

    function getResourceUtil(resId: string) {
        return liveAlloc
            .filter(a => a.resourceId === resId && isAllocActiveInRange(a, filterRange))
            .reduce((s, a) => s + a.percentage, 0);
    }

    function getAllocForCell(resId: string, projId: string) {
        const allocs = liveAlloc.filter(a => a.resourceId === resId && a.projectId === projId && isAllocActiveInRange(a, filterRange));
        if (allocs.length === 0) return { pct: 0, multiple: false };
        if (allocs.length === 1) return { pct: allocs[0].percentage, multiple: false };
        return { pct: allocs.reduce((s, a) => s + a.percentage, 0), multiple: true };
    }

    // ── Styles ────────────────────────────────────────────────────────────────
    const headerCell: React.CSSProperties = {
        padding: '10px 14px', background: 'rgba(15,23,42,0.8)',
        color: '#475569', fontSize: 11, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.06em',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        whiteSpace: 'nowrap',
    };

    const controlInput: React.CSSProperties = {
        background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 10, color: '#f1f5f9', fontSize: 12, padding: '7px 12px',
        outline: 'none', fontFamily: 'inherit', cursor: 'pointer',
    };

    return (
        <div style={{
            background: '#0d1117', borderRadius: 16,
            border: '1px solid rgba(255,255,255,0.07)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            boxShadow: '0 24px 48px rgba(0,0,0,0.5)',
        }}>
            {/* ── Header row ────────────────────────────────────────────────── */}
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '18px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)',
                background: 'rgba(15,23,42,0.6)', gap: 16, flexWrap: 'wrap',
            }}>
                <div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.02em' }}>
                        Allocation Matrix
                    </div>
                    <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>
                        Utilisation overview · Click any cell to edit
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {/* Start month */}
                    <input type="month" value={filterRange.start} onChange={e => setFilterRange({ ...filterRange, start: e.target.value })}
                        style={{ ...controlInput, width: 120 }} />
                    {/* End month */}
                    <input type="month" value={filterRange.end} onChange={e => setFilterRange({ ...filterRange, end: e.target.value })}
                        style={{ ...controlInput, width: 120, marginLeft: 8 }} />
                    <select value={filterProjId} onChange={e => setFilterProjId(e.target.value)}
                        style={{ ...controlInput, minWidth: 140 }}>
                        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <button onClick={onExportCSV} style={{
                        ...controlInput, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                        background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)',
                        color: '#a5b4fc', fontWeight: 600, padding: '7px 14px',
                        transition: 'all 0.15s',
                    }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.2)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.12)'; }}
                    >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                        Export CSV
                    </button>
                </div>
            </div>

            {/* ── Legend + what-if banner ───────────────────────────────────── */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 20, padding: '10px 20px',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                background: 'rgba(0,0,0,0.2)', flexWrap: 'wrap',
            }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Legend</span>
                <LegendPill color="#64748b" label="Under 60%" />
                <LegendPill color="#34d399" label="Optimal 60–80%" />
                <LegendPill color="#fbbf24" label="High 80–100%" />
                <LegendPill color="#f87171" label="Over 100%" />
                {scenarioMode && (
                    <span style={{
                        marginLeft: 'auto', fontSize: 11, fontWeight: 700, padding: '4px 12px',
                        borderRadius: 8, background: 'rgba(251,191,36,0.12)',
                        border: '1px solid rgba(251,191,36,0.3)', color: '#fbbf24',
                        display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                        🔬 What-If Mode — sandboxed
                    </span>
                )}
            </div>

            {/* ── Table ─────────────────────────────────────────────────────── */}
            <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 260px)' }}>
                {resources.length === 0 ? (
                    <div style={{ padding: '60px 20px', textAlign: 'center' }}>
                        <div style={{ fontSize: 40, marginBottom: 12 }}>👤</div>
                        <div style={{ fontSize: 16, color: '#475569', fontWeight: 600 }}>No resources yet</div>
                        <div style={{ fontSize: 13, color: '#334155', marginTop: 6 }}>Add your first resource to start building the matrix</div>
                    </div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
                        <thead>
                            <tr>
                                <th style={{ ...headerCell, position: 'sticky', left: 0, zIndex: 10, minWidth: 200, background: '#0a0d14' }}>Resource</th>
                                <th style={{ ...headerCell, minWidth: 100 }}>Total %</th>
                                {filteredProjects.map(p => (
                                    <th key={p.id} style={{ ...headerCell, minWidth: 110, textAlign: 'center' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                                            <div style={{ width: 8, height: 8, borderRadius: 3, background: p.color || '#6366f1', boxShadow: `0 0 6px ${p.color || '#6366f1'} 60` }} />
                                            <span style={{ maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{p.name}</span>
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {resources.map((res, rIdx) => {
                                const util = getResourceUtil(res.id);
                                const rowBg = rIdx % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent';
                                return (
                                    <tr key={res.id} style={{ transition: 'background 0.15s' }}
                                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.06)')}
                                        onMouseLeave={e => (e.currentTarget.style.background = rowBg)}
                                    >
                                        {/* Sticky resource name */}
                                        <td style={{
                                            position: 'sticky', left: 0, zIndex: 5,
                                            background: '#0a0d14',
                                            borderBottom: '1px solid rgba(255,255,255,0.04)',
                                            padding: '12px 14px',
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                <Avatar name={res.name} type={res.type} />
                                                <div style={{ minWidth: 0 }}>
                                                    <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{res.name}</div>
                                                    <div style={{ fontSize: 11, color: '#475569', marginTop: 1 }}>{res.role}</div>
                                                </div>
                                            </div>
                                        </td>

                                        {/* Total util */}
                                        <td style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)', verticalAlign: 'middle' }}>
                                            <div style={{ minWidth: 70 }}>
                                                <span style={{ fontSize: 16, fontWeight: 900, color: utilColor(util), letterSpacing: '-0.02em' }}>
                                                    {util}%
                                                </span>
                                                <UtilBar pct={util} />
                                            </div>
                                        </td>

                                        {/* Per-project allocation cells */}
                                        {filteredProjects.map(proj => {
                                            const { pct, multiple } = getAllocForCell(res.id, proj.id);
                                            return (
                                                <td key={proj.id} style={{ textAlign: 'center', padding: '8px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                                    <button
                                                        onClick={() => !scenarioMode && onUpdateAdvanced(res.id, proj.id)}
                                                        title={multiple ? 'Multiple slices this month — click to edit' : 'Click to edit allocation'}
                                                        style={{
                                                            width: 56, height: 36, borderRadius: 9,
                                                            border: `1px solid ${pct > 0 ? utilBorderCell(pct) : 'rgba(255,255,255,0.06)'} `,
                                                            background: pct > 0 ? utilBgCell(pct) : 'rgba(255,255,255,0.03)',
                                                            color: pct > 0 ? utilColor(pct) : '#334155',
                                                            fontWeight: pct > 0 ? 800 : 500,
                                                            cursor: scenarioMode ? 'not-allowed' : 'pointer',
                                                            fontSize: 13, transition: 'all 0.15s',
                                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                            letterSpacing: pct > 0 ? '-0.02em' : 'normal',
                                                            position: 'relative',
                                                        }}
                                                        onMouseEnter={e => { if (!scenarioMode) { e.currentTarget.style.transform = 'scale(1.08)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)'; } }}
                                                        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = 'none'; }}
                                                    >
                                                        {pct > 0 ? `${pct}% ` : '·'}
                                                        {multiple && (
                                                            <span style={{ position: 'absolute', top: -3, right: -3, width: 7, height: 7, borderRadius: '50%', background: '#818cf8', border: '1.5px solid #0d1117' }} />
                                                        )}
                                                    </button>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            {/* ── Footer stats ─────────────────────────────────────────────── */}
            {resources.length > 0 && (
                <div style={{
                    padding: '10px 20px', borderTop: '1px solid rgba(255,255,255,0.05)',
                    display: 'flex', gap: 24, alignItems: 'center',
                    background: 'rgba(0,0,0,0.2)',
                }}>
                    <span style={{ fontSize: 11, color: '#334155', fontWeight: 600 }}>
                        {resources.length} resource{resources.length !== 1 ? 's' : ''} · {filteredProjects.length} project{filteredProjects.length !== 1 ? 's' : ''}
                    </span>
                    <span style={{ fontSize: 11, color: '#334155' }}>
                        Avg util: <strong style={{ color: utilColor(Math.round(resources.reduce((s, r) => s + getResourceUtil(r.id), 0) / resources.length)) }}>
                            {Math.round(resources.reduce((s, r) => s + getResourceUtil(r.id), 0) / resources.length)}%
                        </strong>
                    </span>
                    {filteredProjects.length < projects.length && (
                        <span style={{ fontSize: 11, color: '#6366f1', fontWeight: 600 }}>
                            Filtered: showing {filteredProjects.length} / {projects.length} projects
                        </span>
                    )}
                </div>
            )}
        </div>
    );
};
