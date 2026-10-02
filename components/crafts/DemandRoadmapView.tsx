import React, { useMemo, useState } from 'react';
import { Allocation, CraftDemand, Project, Resource } from '../../types';
import { PMO_CRAFTS, PROJECT_STAGES } from '../../constants';
import { Quarter } from '../../utils/quarters';
import { craftMatrix, demandLines, upsertDemand } from '../../utils/craftEngine';
import { CraftChip, GapBadge, QuarterHeader, tribesFromProjects } from './shared';

interface Props {
    resources: Resource[];
    projects: Project[];
    allocations: Allocation[];
    quarters: Quarter[];
    canWrite: boolean;
    onAddProject?: () => void;
    onEditProject?: (p: Project) => void;
    onUpdateDemand: (projectId: string, demand: CraftDemand[]) => void;
}

/**
 * Demand Roadmap — the project requirement roadmap. Each project row shows the
 * anticipated craft requirement per quarter (in FTE) next to what is already staffed,
 * so newly initiated projects surface their above-the-table needs early.
 */
export const DemandRoadmapView: React.FC<Props> = ({ resources, projects, allocations, quarters, canWrite, onAddProject, onEditProject, onUpdateDemand }) => {
    const [tribe, setTribe] = useState('');
    const [stage, setStage] = useState('');
    const [editing, setEditing] = useState<{ projectId: string; quarterKey: string } | null>(null);
    const [draftCraft, setDraftCraft] = useState(PMO_CRAFTS[1].id);
    const [draftFte, setDraftFte] = useState('0.5');

    const tribes = tribesFromProjects(projects);
    const quarterMap = useMemo(() => new Map(quarters.map(q => [q.key, q])), [quarters]);

    const visible = useMemo(() => projects
        .filter(p => !tribe || (p.clientName || '') === tribe)
        .filter(p => !stage || (p.stage || 'Pipeline') === stage)
        .filter(p => p.status !== 'Completed')
        .sort((a, b) => (a.startDate || '9999').localeCompare(b.startDate || '9999')), [projects, tribe, stage]);

    const lines = useMemo(() => demandLines(visible, resources, allocations, quarters), [visible, resources, allocations, quarters]);
    const matrix = useMemo(() => craftMatrix(PMO_CRAFTS, quarters, resources, projects, allocations), [resources, projects, allocations, quarters]);

    const stageCounts = PROJECT_STAGES.map(s => ({ ...s, n: projects.filter(p => (p.stage || 'Pipeline') === s.id && p.status !== 'Completed').length }));
    const newThisQuarter = quarters[0] ? projects.filter(p => p.initiatedOn && p.initiatedOn >= quarters[0].start.toISOString().slice(0, 10)) : [];

    const startEdit = (projectId: string, quarterKey: string) => {
        if (!canWrite) return;
        setEditing({ projectId, quarterKey });
    };

    const commitDraft = () => {
        if (!editing) return;
        const p = projects.find(x => x.id === editing.projectId);
        if (!p) return;
        const fte = Math.max(0, Math.min(50, parseFloat(draftFte) || 0));
        onUpdateDemand(p.id, upsertDemand(p.craftDemand, { quarterKey: editing.quarterKey, craftId: draftCraft, fte }));
        setEditing(null);
    };

    const removeDemand = (p: Project, d: CraftDemand) => {
        onUpdateDemand(p.id, upsertDemand(p.craftDemand, { ...d, fte: 0 }));
    };

    const copyForward = (p: Project, fromKey: string, toKey: string) => {
        const src = (p.craftDemand || []).filter(d => d.quarterKey === fromKey);
        let next = p.craftDemand || [];
        src.forEach(d => { next = upsertDemand(next, { ...d, quarterKey: toKey }); });
        onUpdateDemand(p.id, next);
    };

    const craftsWithActivity = PMO_CRAFTS.filter(c => quarters.some(q => {
        const b = matrix[c.id][q.key];
        return b.demand > 0 || b.committed > 0 || b.primarySupply > 0;
    }));

    return (
        <div className="page-enter" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Pipeline strip */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                {stageCounts.map(s => (
                    <button key={s.id} onClick={() => setStage(stage === s.id ? '' : s.id)} title={s.hint} style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', borderRadius: 999, cursor: 'pointer',
                        background: stage === s.id ? s.color : '#fff', color: stage === s.id ? '#fff' : 'var(--n-700)',
                        border: `1px solid ${stage === s.id ? s.color : 'var(--n-300)'}`, fontWeight: 700, fontSize: 12,
                    }}>
                        <span style={{ width: 8, height: 8, borderRadius: 999, background: stage === s.id ? '#fff' : s.color }} />
                        {s.id} <span style={{ opacity: .7 }}>{s.n}</span>
                    </button>
                ))}
                <select className="form-select" style={{ width: 'auto', marginLeft: 'auto' }} value={tribe} onChange={e => setTribe(e.target.value)}>
                    <option value="">All tribes</option>
                    {tribes.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                {onAddProject && <button className="btn btn-primary" onClick={onAddProject}>+ New project</button>}
            </div>

            {newThisQuarter.length > 0 && (
                <div style={{ background: 'var(--brand-50)', border: '1px solid var(--brand-200)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--brand-700)' }}>
                    <b>Initiated in {quarters[0].label}:</b> {newThisQuarter.map(p => `${p.name}${(p.craftDemand || []).length ? '' : ' (no demand captured yet)'}`).join(' · ')}
                </div>
            )}

            {/* Roadmap grid */}
            <div className="panel">
                <div className="panel-header">
                    <div>
                        <div className="panel-title">Project requirement roadmap</div>
                        <div className="panel-subtitle">Anticipated craft demand per quarter (FTE) vs. staffed. {canWrite ? 'Click a cell to add a requirement.' : 'Read-only.'}</div>
                    </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th style={{ minWidth: 240, position: 'sticky', left: 0, background: 'var(--n-50)', zIndex: 2 }}>Project</th>
                                {quarters.map(q => <th key={q.key} style={{ minWidth: 190 }}><QuarterHeader q={q} align="left" /></th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {visible.map(p => {
                                const st = PROJECT_STAGES.find(s => s.id === (p.stage || 'Pipeline'))!;
                                return (
                                    <tr key={p.id}>
                                        <td style={{ position: 'sticky', left: 0, background: '#fff', zIndex: 1 }}>
                                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                                                <span style={{ width: 10, height: 10, borderRadius: 3, background: p.color || '#6366f1', marginTop: 4, flexShrink: 0 }} />
                                                <div style={{ minWidth: 0 }}>
                                                    <div style={{ fontWeight: 700, color: 'var(--n-800)', cursor: onEditProject ? 'pointer' : 'default' }} onClick={() => onEditProject?.(p)}>{p.name}</div>
                                                    <div style={{ fontSize: 11, color: 'var(--n-500)', display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                                                        <span style={{ color: st.color, fontWeight: 700 }}>{st.id}</span>
                                                        {p.clientName && <span>· {p.clientName}</span>}
                                                        {p.startDate && <span>· {p.startDate.slice(0, 7)} → {p.endDate?.slice(0, 7) || 'open'}</span>}
                                                        {p.jiraKey && <span className="badge" style={{ background: '#DEEBFF', color: '#0052CC', padding: '1px 6px', fontSize: 9 }}>Jira {p.jiraKey}</span>}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        {quarters.map((q, qi) => {
                                            const cellLines = lines.filter(l => l.projectId === p.id && l.quarterKey === q.key);
                                            const active = p.startDate && p.endDate ? !(p.endDate < q.start.toISOString().slice(0, 10) || p.startDate > q.end.toISOString().slice(0, 10)) : true;
                                            const isEditing = editing?.projectId === p.id && editing.quarterKey === q.key;
                                            return (
                                                <td key={q.key} style={{ verticalAlign: 'top', background: active ? undefined : 'var(--n-100)', cursor: canWrite ? 'pointer' : 'default' }} onClick={() => !isEditing && startEdit(p.id, q.key)}>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                        {cellLines.map(l => (
                                                            <div key={l.craftId} title={`${l.demandFte} FTE needed · ${l.staffedFte} staffed${l.note ? ` · ${l.note}` : ''}`} style={{
                                                                display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', borderRadius: 6,
                                                                background: l.gapFte > 0.05 ? 'var(--over-bg)' : l.gapFte < -0.05 ? 'var(--under-bg)' : 'var(--optimal-bg)',
                                                            }}>
                                                                <CraftChip craftId={l.craftId} small />
                                                                <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--n-800)' }}>{l.demandFte.toFixed(1)}</span>
                                                                <span style={{ fontSize: 10, color: 'var(--n-600)' }}>{l.staffedFte.toFixed(1)} staffed</span>
                                                                {canWrite && <button onClick={e => { e.stopPropagation(); removeDemand(p, { quarterKey: l.quarterKey, craftId: l.craftId, fte: l.demandFte }); }} title="Remove" style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--n-500)', cursor: 'pointer', fontSize: 12 }}>×</button>}
                                                            </div>
                                                        ))}
                                                        {isEditing ? (
                                                            <div onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 4, alignItems: 'center', background: '#fff', border: '1px solid var(--brand-400)', borderRadius: 6, padding: 4 }}>
                                                                <select className="form-select" style={{ fontSize: 11, padding: '4px 6px' }} value={draftCraft} onChange={e => setDraftCraft(e.target.value)}>
                                                                    {PMO_CRAFTS.map(c => <option key={c.id} value={c.id}>{c.short} · {c.name}</option>)}
                                                                </select>
                                                                <input className="form-input" type="number" step="0.1" min="0" max="50" style={{ width: 64, fontSize: 11, padding: '4px 6px' }} value={draftFte} onChange={e => setDraftFte(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') commitDraft(); if (e.key === 'Escape') setEditing(null); }} autoFocus />
                                                                <button className="btn btn-success" style={{ padding: '4px 8px', fontSize: 11 }} onClick={commitDraft}>Add</button>
                                                                <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => setEditing(null)}>✕</button>
                                                            </div>
                                                        ) : (
                                                            cellLines.length === 0 && <span style={{ fontSize: 11, color: 'var(--n-400)' }}>{canWrite ? '+ requirement' : '—'}</span>
                                                        )}
                                                        {canWrite && qi < quarters.length - 1 && cellLines.length > 0 && !isEditing && (
                                                            <button onClick={e => { e.stopPropagation(); copyForward(p, q.key, quarters[qi + 1].key); }} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: 'var(--brand-500)', fontSize: 10, cursor: 'pointer', padding: 0, fontWeight: 700 }}>copy → {quarters[qi + 1].label}</button>
                                                        )}
                                                    </div>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                            {visible.length === 0 && <tr><td colSpan={1 + quarters.length} style={{ textAlign: 'center', color: 'var(--n-500)', padding: 32 }}>No projects in this view.</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Supply vs demand by craft */}
            <div className="panel">
                <div className="panel-header">
                    <div>
                        <div className="panel-title">Supply vs demand by craft</div>
                        <div className="panel-subtitle">Demand = sum of project requirements · Staffed = allocations under that craft · Supply = people holding the craft above the table · Reach = extra FTE available below the table</div>
                    </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th style={{ minWidth: 200 }}>Craft</th>
                                {quarters.map(q => <th key={q.key} style={{ minWidth: 200 }}><QuarterHeader q={q} align="left" /></th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {craftsWithActivity.map(c => (
                                <tr key={c.id}>
                                    <td><CraftChip craftId={c.id} /></td>
                                    {quarters.map(q => {
                                        const b = matrix[c.id][q.key];
                                        const max = Math.max(b.demand, b.committed, b.primarySupply, 0.01);
                                        const bar = (v: number, color: string, label: string) => (
                                            <div title={`${label}: ${v.toFixed(2)} FTE`} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10 }}>
                                                <span style={{ width: 54, color: 'var(--n-600)', fontWeight: 600 }}>{label}</span>
                                                <div style={{ flex: 1, height: 6, background: 'var(--n-200)', borderRadius: 3, overflow: 'hidden' }}><div style={{ width: `${(v / max) * 100}%`, height: '100%', background: color, borderRadius: 3 }} /></div>
                                                <span style={{ width: 28, textAlign: 'right', fontWeight: 700, color: 'var(--n-800)' }}>{v.toFixed(1)}</span>
                                            </div>
                                        );
                                        return (
                                            <td key={q.key} style={{ verticalAlign: 'top' }}>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                                    {bar(b.demand, 'var(--n-700)', 'Demand')}
                                                    {bar(b.committed, c.color, 'Staffed')}
                                                    {bar(b.primarySupply, 'var(--brand-200)', 'Supply')}
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                                                        <GapBadge gap={b.gap} />
                                                        {b.secondaryReach > 0.05 && <span style={{ fontSize: 10, color: '#6d28d9', fontWeight: 700 }} title="FTE that people holding this craft below the table could still take on">+{b.secondaryReach.toFixed(1)} reach</span>}
                                                    </div>
                                                </div>
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
