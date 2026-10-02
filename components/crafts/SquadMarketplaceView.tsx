import React, { useMemo, useState } from 'react';
import { Allocation, Project, Resource } from '../../types';
import { PMO_CRAFTS } from '../../constants';
import { Quarter } from '../../utils/quarters';
import { DemandLine, MatchSuggestion, demandLines, personQuarterLoad, suggestMatches } from '../../utils/craftEngine';
import { Avatar, CraftChip, craftName, tribesFromProjects } from './shared';

interface Props {
    resources: Resource[];
    projects: Project[];
    allocations: Allocation[];
    quarters: Quarter[];
    canWrite: boolean;
    onPropose: (s: MatchSuggestion, line: DemandLine, quarter: Quarter) => void;
}

/**
 * PMO Squad Marketplace — showcases what the squad can offer each tribe/project
 * (above and below the table), lists open demand, and proposes who can absorb it.
 */
export const SquadMarketplaceView: React.FC<Props> = ({ resources, projects, allocations, quarters, canWrite, onPropose }) => {
    const [quarterKey, setQuarterKey] = useState(quarters[0]?.key || '');
    const [tribe, setTribe] = useState('');
    const [craft, setCraft] = useState('');
    const [openLine, setOpenLine] = useState<string | null>(null);

    const quarter = quarters.find(q => q.key === quarterKey) || quarters[0];
    const tribes = tribesFromProjects(projects);

    const openDemand = useMemo(() => demandLines(projects, resources, allocations, quarter ? [quarter] : [])
        .filter(l => l.gapFte > 0.05)
        .filter(l => !tribe || l.tribe === tribe)
        .filter(l => !craft || l.craftId === craft)
        .sort((a, b) => b.gapFte - a.gapFte), [projects, resources, allocations, quarter, tribe, craft]);

    const offers = useMemo(() => {
        if (!quarter) return [];
        return PMO_CRAFTS.map(c => {
            const holders = resources
                .filter(r => r.primaryCraft === c.id || (r.secondaryCrafts || []).some(s => s.craftId === c.id))
                .map(r => {
                    const load = personQuarterLoad(r, quarter, allocations, projects);
                    const sec = (r.secondaryCrafts || []).find(s => s.craftId === c.id);
                    const via: 'primary' | 'secondary' = r.primaryCraft === c.id ? 'primary' : 'secondary';
                    const onCraft = load.byProject.filter(b => b.craftId === c.id).reduce((s, b) => s + b.pct, 0);
                    const offer = via === 'primary' ? load.bench : Math.max(0, Math.min(load.bench, (sec?.maxPct ?? 40) - onCraft));
                    return { r, via, proficiency: sec?.proficiency || 3, free: load.bench, offer: Math.round(offer), total: load.total };
                })
                .filter(h => !tribe || (h.r.tribeAffinity || []).map(t => t.toLowerCase()).includes(tribe.toLowerCase()) || h.offer > 0)
                .sort((a, b) => (a.via === b.via ? b.offer - a.offer : a.via === 'primary' ? -1 : 1));
            const offerFte = holders.reduce((s, h) => s + h.offer, 0) / 100;
            return { c, holders, offerFte };
        }).filter(o => o.holders.length > 0 && (!craft || o.c.id === craft));
    }, [resources, projects, allocations, quarter, tribe, craft]);

    const totalOpen = openDemand.reduce((s, l) => s + l.gapFte, 0);
    const totalOffer = offers.reduce((s, o) => s + o.offerFte, 0);

    if (!quarter) return <div className="empty-state"><h3>No quarters</h3></div>;

    return (
        <div className="page-enter" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Filters */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 4, background: '#fff', border: '1px solid var(--n-300)', borderRadius: 999, padding: 3 }}>
                    {quarters.map(q => (
                        <button key={q.key} onClick={() => setQuarterKey(q.key)} title={`${q.name} · ${q.range}`} style={{
                            padding: '6px 14px', borderRadius: 999, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12,
                            background: q.key === quarter.key ? 'var(--brand-500)' : 'transparent', color: q.key === quarter.key ? '#fff' : 'var(--n-700)',
                        }}>{q.label}</button>
                    ))}
                </div>
                <select className="form-select" style={{ width: 'auto' }} value={tribe} onChange={e => setTribe(e.target.value)}>
                    <option value="">All tribes</option>
                    {tribes.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <select className="form-select" style={{ width: 'auto' }} value={craft} onChange={e => setCraft(e.target.value)}>
                    <option value="">All crafts</option>
                    {PMO_CRAFTS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 16, fontSize: 12, color: 'var(--n-600)' }}>
                    <span>Open demand <b style={{ color: totalOpen > 0 ? 'var(--over)' : 'var(--optimal)' }}>{totalOpen.toFixed(1)} FTE</b></span>
                    <span>Squad can offer <b style={{ color: 'var(--brand-600)' }}>{totalOffer.toFixed(1)} FTE</b></span>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(360px, 1.2fr) minmax(320px, 1fr)', gap: 20 }}>
                {/* Open demand with suggested matches */}
                <div className="panel">
                    <div className="panel-header">
                        <div>
                            <div className="panel-title">Open demand · {quarter.label} ({quarter.name})</div>
                            <div className="panel-subtitle">Unstaffed requirements, largest gap first. Expand a line to see who can take it.</div>
                        </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {openDemand.length === 0 && <div className="empty-state"><h3>Nothing open</h3><p>All captured requirements for {quarter.label} are staffed. Add demand on the Demand Roadmap when new projects are initiated.</p></div>}
                        {openDemand.map(line => {
                            const key = `${line.projectId}|${line.craftId}`;
                            const p = projects.find(x => x.id === line.projectId);
                            const isOpen = openLine === key;
                            const matches = isOpen ? suggestMatches(line, quarter, resources, projects, allocations) : [];
                            return (
                                <div key={key} style={{ borderBottom: '1px solid var(--n-200)' }}>
                                    <div onClick={() => setOpenLine(isOpen ? null : key)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px', cursor: 'pointer', background: isOpen ? 'var(--n-100)' : '#fff' }}>
                                        <span style={{ width: 10, height: 10, borderRadius: 3, background: p?.color || '#94a3b8', flexShrink: 0 }} />
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontWeight: 700, color: 'var(--n-800)', fontSize: 13 }}>{line.projectName}</div>
                                            <div style={{ fontSize: 11, color: 'var(--n-500)' }}>{line.tribe || 'No tribe'}{p?.stage ? ` · ${p.stage}` : ''}</div>
                                        </div>
                                        <CraftChip craftId={line.craftId} />
                                        <div style={{ textAlign: 'right', minWidth: 90 }}>
                                            <div style={{ fontWeight: 800, color: 'var(--over)' }}>{line.gapFte.toFixed(1)} FTE short</div>
                                            <div style={{ fontSize: 10, color: 'var(--n-500)' }}>{line.staffedFte.toFixed(1)} of {line.demandFte.toFixed(1)} staffed</div>
                                        </div>
                                        <span style={{ color: 'var(--n-400)' }}>{isOpen ? '▾' : '▸'}</span>
                                    </div>
                                    {isOpen && (
                                        <div style={{ padding: '4px 20px 14px', background: 'var(--n-100)' }}>
                                            {matches.length === 0 && <div style={{ fontSize: 12, color: 'var(--n-600)', padding: '8px 0' }}>Nobody in the squad has free capacity for {craftName(line.craftId)} in {quarter.label}. Consider a contractor or re-sequencing the demand.</div>}
                                            {matches.map(m => {
                                                const r = resources.find(x => x.id === m.resourceId)!;
                                                return (
                                                    <div key={m.resourceId} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fff', border: '1px solid var(--n-300)', borderRadius: 8, padding: '8px 12px', marginTop: 6 }}>
                                                        <Avatar r={r} size={30} />
                                                        <div style={{ flex: 1, minWidth: 0 }}>
                                                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                                                <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--n-800)' }}>{m.resourceName}</span>
                                                                <CraftChip craftId={m.craftId} via={m.via} small proficiency={m.via === 'secondary' ? m.proficiency : undefined} />
                                                            </div>
                                                            <div style={{ fontSize: 11, color: 'var(--n-600)' }}>{m.reasons.join(' · ')}</div>
                                                        </div>
                                                        <div style={{ textAlign: 'right' }}>
                                                            <div style={{ fontWeight: 800, color: 'var(--brand-600)' }}>{m.proposedPct}%</div>
                                                            <div style={{ fontSize: 10, color: 'var(--n-500)' }}>score {m.score}</div>
                                                        </div>
                                                        {canWrite && <button className="btn btn-primary" style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => onPropose(m, line, quarter)}>Propose</button>}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Service catalogue */}
                <div className="panel">
                    <div className="panel-header">
                        <div>
                            <div className="panel-title">What the squad can offer · {quarter.label}</div>
                            <div className="panel-subtitle">Per craft: who holds it above the table (solid) or below the table (outlined) and how much they can still give this quarter.</div>
                        </div>
                    </div>
                    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {offers.map(({ c, holders, offerFte }) => (
                            <div key={c.id} style={{ border: '1px solid var(--n-300)', borderLeft: `4px solid ${c.color}`, borderRadius: 8, padding: '10px 12px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                    <div style={{ fontWeight: 800, color: 'var(--n-800)', fontSize: 13 }}>{c.name}</div>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: offerFte > 0 ? 'var(--optimal)' : 'var(--n-500)' }}>{offerFte.toFixed(1)} FTE available</span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    {holders.map(h => (
                                        <div key={h.r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                                            <Avatar r={h.r} size={24} />
                                            <span style={{ flex: 1, color: 'var(--n-800)', fontWeight: 600 }}>{h.r.name}</span>
                                            <CraftChip craftId={c.id} via={h.via} small proficiency={h.via === 'secondary' ? h.proficiency : undefined} />
                                            <span style={{ minWidth: 70, textAlign: 'right', fontWeight: 700, color: h.offer > 0 ? 'var(--optimal)' : 'var(--n-400)' }}>{h.offer > 0 ? `${h.offer}% free` : 'full'}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                        {offers.length === 0 && <div className="empty-state"><h3>No crafts declared</h3><p>Set above/below-the-table crafts on people to build the service catalogue.</p></div>}
                    </div>
                </div>
            </div>
        </div>
    );
};
