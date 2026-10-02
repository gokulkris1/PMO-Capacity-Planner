import React, { useMemo, useState } from 'react';
import { Allocation, Project, Resource } from '../../types';
import { PMO_CRAFTS } from '../../constants';
import { Quarter } from '../../utils/quarters';
import { personOutlook, craftBalance } from '../../utils/craftEngine';
import { Avatar, CraftChip, LoadBar, LoadLegend, QuarterHeader, craftName } from './shared';

interface Props {
    resources: Resource[];
    projects: Project[];
    allocations: Allocation[];
    quarters: Quarter[];
    onEditResource?: (r: Resource) => void;
}

/**
 * Craft Profiles — every individual with their above-the-table craft, the
 * below-the-table crafts they can serve, and how their next four quarters look.
 */
export const CraftProfilesView: React.FC<Props> = ({ resources, projects, allocations, quarters, onEditResource }) => {
    const [search, setSearch] = useState('');
    const [craftFilter, setCraftFilter] = useState('');
    const [expanded, setExpanded] = useState<string | null>(null);

    const rows = useMemo(() => resources
        .filter(r => {
            const q = search.toLowerCase();
            const hit = !q || r.name.toLowerCase().includes(q) || r.role.toLowerCase().includes(q) || craftName(r.primaryCraft).toLowerCase().includes(q)
                || (r.secondaryCrafts || []).some(s => craftName(s.craftId).toLowerCase().includes(q));
            const craftHit = !craftFilter || r.primaryCraft === craftFilter || (r.secondaryCrafts || []).some(s => s.craftId === craftFilter);
            return hit && craftHit;
        })
        .map(r => ({ r, outlook: personOutlook(r, quarters, allocations, projects) }))
        .sort((a, b) => a.r.name.localeCompare(b.r.name)), [resources, projects, allocations, quarters, search, craftFilter]);

    const craftCoverage = useMemo(() => PMO_CRAFTS.map(c => {
        const primary = resources.filter(r => r.primaryCraft === c.id);
        const secondary = resources.filter(r => (r.secondaryCrafts || []).some(s => s.craftId === c.id));
        const q1 = quarters[0] ? craftBalance(c, quarters[0], resources, projects, allocations) : null;
        return { c, primary, secondary, q1 };
    }).filter(x => x.primary.length || x.secondary.length), [resources, projects, allocations, quarters]);

    const missingProfile = resources.filter(r => !r.primaryCraft);

    return (
        <div className="page-enter" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Craft coverage strip */}
            <div className="panel">
                <div className="panel-header">
                    <div>
                        <div className="panel-title">Craft coverage</div>
                        <div className="panel-subtitle">Who holds each craft above the table (solid) and who can serve it below the table (outlined). Bench shown for {quarters[0]?.label}.</div>
                    </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10, padding: 16 }}>
                    {craftCoverage.map(({ c, primary, secondary, q1 }) => (
                        <button key={c.id} onClick={() => setCraftFilter(craftFilter === c.id ? '' : c.id)} style={{
                            textAlign: 'left', cursor: 'pointer', background: craftFilter === c.id ? c.color + '14' : '#fff',
                            border: `1px solid ${craftFilter === c.id ? c.color : 'var(--n-300)'}`, borderRadius: 8, padding: '10px 12px',
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                <CraftChip craftId={c.id} />
                                <span style={{ fontSize: 11, color: 'var(--n-600)', fontWeight: 700 }}>{primary.length}+{secondary.length}</span>
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--n-600)', marginTop: 6, display: 'flex', justifyContent: 'space-between' }}>
                                <span>Supply {q1?.primarySupply.toFixed(1)} FTE</span>
                                <span style={{ color: (q1?.primaryBench || 0) > 0.05 ? 'var(--high)' : 'var(--optimal)', fontWeight: 700 }}>
                                    {q1 ? `${q1.primaryBench > 0 ? 'bench' : 'full'} ${Math.abs(q1.primaryBench).toFixed(1)}` : ''}
                                </span>
                            </div>
                        </button>
                    ))}
                    {craftCoverage.length === 0 && <div style={{ color: 'var(--n-500)', fontSize: 13 }}>No crafts captured yet. Edit a resource and set their above/below-the-table crafts.</div>}
                </div>
            </div>

            {missingProfile.length > 0 && (
                <div style={{ background: 'var(--high-bg)', border: '1px solid var(--high)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#974F0C' }}>
                    <b>{missingProfile.length} {missingProfile.length === 1 ? 'person has' : 'people have'} no above-the-table craft:</b> {missingProfile.map(r => r.name).join(', ')}. Their allocations count as "undeclared craft" until a profile is set.
                </div>
            )}

            {/* Toolbar */}
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', maxWidth: 360, flex: '1 1 260px' }}>
                    <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: 14 }}>🔍</span>
                    <input className="form-input" style={{ paddingLeft: 34 }} placeholder="Search people, roles or crafts…" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <select className="form-select" style={{ width: 'auto' }} value={craftFilter} onChange={e => setCraftFilter(e.target.value)}>
                    <option value="">All crafts</option>
                    {PMO_CRAFTS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <div style={{ marginLeft: 'auto' }}><LoadLegend /></div>
            </div>

            {/* People table */}
            <div className="panel">
                <div style={{ overflowX: 'auto' }}>
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th style={{ minWidth: 220 }}>Person</th>
                                <th style={{ minWidth: 150 }}>Above the table</th>
                                <th style={{ minWidth: 220 }}>Below the table</th>
                                {quarters.map(q => <th key={q.key} style={{ minWidth: 170 }}><QuarterHeader q={q} align="left" /></th>)}
                                <th style={{ width: 70 }}>Avg</th>
                                <th />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(({ r, outlook }) => {
                                const avg = Math.round(outlook.reduce((s, l) => s + l.total, 0) / Math.max(1, outlook.length));
                                const isOpen = expanded === r.id;
                                return (
                                    <React.Fragment key={r.id}>
                                        <tr style={{ cursor: 'pointer' }} onClick={() => setExpanded(isOpen ? null : r.id)}>
                                            <td>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                    <Avatar r={r} />
                                                    <div>
                                                        <div style={{ fontWeight: 700, color: 'var(--n-800)' }}>{r.name}</div>
                                                        <div style={{ fontSize: 11, color: 'var(--n-500)' }}>{r.role}{r.teamName ? ` · ${r.teamName}` : ''}{r.totalCapacity !== 100 ? ` · ${r.totalCapacity}% capacity` : ''}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td>{r.primaryCraft ? <CraftChip craftId={r.primaryCraft} /> : <span className="badge badge-under">not set</span>}</td>
                                            <td>
                                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                                    {(r.secondaryCrafts || []).map(s => <CraftChip key={s.craftId} craftId={s.craftId} via="secondary" small proficiency={s.proficiency} title={`${craftName(s.craftId)} · level ${s.proficiency} · up to ${s.maxPct ?? 40}% of capacity`} />)}
                                                    {!(r.secondaryCrafts || []).length && <span style={{ fontSize: 11, color: 'var(--n-400)' }}>—</span>}
                                                </div>
                                            </td>
                                            {outlook.map((l, i) => <td key={l.quarterKey}><LoadBar load={l} quarter={quarters[i]} /></td>)}
                                            <td style={{ fontWeight: 800, color: avg > 100 ? 'var(--over)' : avg >= 90 ? 'var(--optimal)' : avg >= 60 ? 'var(--n-700)' : 'var(--high)' }}>{avg}%</td>
                                            <td onClick={e => e.stopPropagation()}>
                                                {onEditResource && <button className="btn btn-secondary" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => onEditResource(r)}>Edit crafts</button>}
                                            </td>
                                        </tr>
                                        {isOpen && (
                                            <tr>
                                                <td colSpan={5 + quarters.length} style={{ background: 'var(--n-100)' }}>
                                                    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${quarters.length}, 1fr)`, gap: 12 }}>
                                                        {outlook.map((l, i) => (
                                                            <div key={l.quarterKey} style={{ background: '#fff', border: '1px solid var(--n-300)', borderRadius: 8, padding: 12 }}>
                                                                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--n-600)', marginBottom: 8 }}>{quarters[i].label} · {quarters[i].name}</div>
                                                                {l.byProject.length === 0 && <div style={{ fontSize: 12, color: 'var(--n-500)' }}>Fully on the bench ({l.bench}% free)</div>}
                                                                {l.byProject.map((b, j) => {
                                                                    const p = projects.find(x => x.id === b.projectId);
                                                                    const via = b.craftId === r.primaryCraft ? 'primary' : (r.secondaryCrafts || []).some(s => s.craftId === b.craftId) ? 'secondary' : undefined;
                                                                    return (
                                                                        <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 6 }}>
                                                                            <span style={{ width: 8, height: 8, borderRadius: 2, background: p?.color || '#94a3b8', flexShrink: 0 }} />
                                                                            <span style={{ flex: 1, color: 'var(--n-800)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p?.name || 'Unknown'}</span>
                                                                            <CraftChip craftId={b.craftId} via={via === 'primary' ? 'primary' : 'secondary'} small />
                                                                            <span style={{ fontWeight: 800, minWidth: 34, textAlign: 'right' }}>{Math.round(b.pct)}%</span>
                                                                        </div>
                                                                    );
                                                                })}
                                                                {l.bench > 0 && l.byProject.length > 0 && <div style={{ fontSize: 11, color: 'var(--n-500)', marginTop: 4 }}>{l.bench}% available to offer</div>}
                                                            </div>
                                                        ))}
                                                    </div>
                                                    {(r.tribeAffinity || []).length > 0 && <div style={{ fontSize: 11, color: 'var(--n-600)', marginTop: 10 }}>Tribe familiarity: {(r.tribeAffinity || []).join(', ')}</div>}
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                            {rows.length === 0 && <tr><td colSpan={5 + quarters.length} style={{ textAlign: 'center', color: 'var(--n-500)', padding: 32 }}>No people match.</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
