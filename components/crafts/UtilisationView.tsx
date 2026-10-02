import React, { useMemo, useState } from 'react';
import { Allocation, Project, Resource, Team } from '../../types';
import { Quarter } from '../../utils/quarters';
import { DEFAULT_TARGET_UTIL, personOutlook, quarterSummary } from '../../utils/craftEngine';
import { StatCard } from '../StatCard';
import { Avatar, CraftChip, LOAD_COLORS, LoadBar, LoadLegend, QuarterHeader, tribesFromProjects } from './shared';

interface Props {
    resources: Resource[];
    projects: Project[];
    allocations: Allocation[];
    quarters: Quarter[];
    teams: Team[];
    onGoTo: (tab: 'marketplace' | 'demand' | 'crafts') => void;
}

/**
 * Utilisation outlook — the "pan out" view: are we on track to have the PMO squad
 * fully used across the next four quarters, and where is the slack or the strain?
 */
export const UtilisationView: React.FC<Props> = ({ resources, projects, allocations, quarters, teams, onGoTo }) => {
    const [groupBy, setGroupBy] = useState<'person' | 'team' | 'tribe'>('person');

    const summaries = useMemo(() => quarters.map(q => quarterSummary(q, resources, projects, allocations)), [quarters, resources, projects, allocations]);
    const q1 = summaries[0];
    const outlooks = useMemo(() => resources.map(r => ({ r, outlook: personOutlook(r, quarters, allocations, projects) })), [resources, quarters, allocations, projects]);

    const groups = useMemo(() => {
        if (groupBy === 'person') return [{ label: 'Everyone', members: outlooks }];
        if (groupBy === 'team') {
            const map = new Map<string, typeof outlooks>();
            outlooks.forEach(o => {
                const t = teams.find(x => x.id === o.r.teamId)?.name || o.r.teamName || 'Unassigned';
                map.set(t, [...(map.get(t) || []), o]);
            });
            return Array.from(map.entries()).map(([label, members]) => ({ label, members }));
        }
        // tribe: a person belongs to each tribe they are allocated to in the window
        const tribes = tribesFromProjects(projects);
        return tribes.map(t => ({
            label: t,
            members: outlooks.filter(o => o.outlook.some(l => l.byProject.some(b => projects.find(p => p.id === b.projectId)?.clientName === t))),
        })).filter(g => g.members.length);
    }, [groupBy, outlooks, teams, projects]);

    const underUsed = outlooks
        .map(o => ({ ...o, avg: o.outlook.reduce((s, l) => s + l.total, 0) / Math.max(1, quarters.length) }))
        .filter(o => o.avg < (o.r.targetUtil ?? DEFAULT_TARGET_UTIL) - 10)
        .sort((a, b) => a.avg - b.avg);
    const overUsed = outlooks.filter(o => o.outlook.some(l => l.total > l.capacity));

    const maxFte = Math.max(...summaries.map(s => s.capacityFte), 0.01);

    return (
        <div className="page-enter" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {q1 && (
                <div className="stat-grid">
                    <StatCard label={`${quarters[0].label} utilisation`} value={`${q1.avgUtil}%`} icon="🎯" iconBg="#DEEBFF" glowColor="#0052CC" trend={`target ${DEFAULT_TARGET_UTIL}% · ${q1.underTarget} below target`} trendType={q1.avgUtil >= 90 ? 'up' : 'warn'} />
                    <StatCard label="Bench this quarter" value={`${q1.benchFte.toFixed(1)} FTE`} icon="💤" iconBg="#f0fdf4" glowColor="#10b981" trend={`of ${q1.capacityFte.toFixed(1)} FTE capacity`} trendType={q1.benchFte > 0.5 ? 'warn' : 'up'} />
                    <StatCard label="Below-the-table work" value={`${q1.belowTableFte.toFixed(1)} FTE`} icon="🧩" iconBg="#f5f3ff" glowColor="#8b5cf6" trend={`${q1.aboveTableFte.toFixed(1)} FTE above the table`} trendType="neu" />
                    <StatCard label="Unstaffed demand" value={`${q1.unstaffedFte.toFixed(1)} FTE`} icon="📣" iconBg="#fef2f2" glowColor="#ef4444" trend={`${q1.demandFte.toFixed(1)} FTE requested`} trendType={q1.unstaffedFte > 0 ? 'down' : 'up'} />
                    <StatCard label="Over-allocated" value={q1.overAllocated} icon="⚠️" iconBg="#fff7ed" glowColor="#f59e0b" trend={q1.overAllocated ? 'needs rebalancing' : 'all clear ✓'} trendType={q1.overAllocated ? 'down' : 'up'} />
                </div>
            )}

            {/* Four-quarter outlook */}
            <div className="panel">
                <div className="panel-header">
                    <div>
                        <div className="panel-title">Four-quarter outlook</div>
                        <div className="panel-subtitle">Squad capacity split into above-the-table, below-the-table and bench FTE, with demand overlaid.</div>
                    </div>
                    <LoadLegend />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${quarters.length}, 1fr)`, gap: 16, padding: 20 }}>
                    {summaries.map((s, i) => {
                        const q = quarters[i];
                        const h = (v: number) => `${(v / maxFte) * 100}%`;
                        return (
                            <div key={s.quarterKey} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                <QuarterHeader q={q} align="left" />
                                <div title={`Above ${s.aboveTableFte} · Below ${s.belowTableFte} · Bench ${s.benchFte} · Demand ${s.demandFte} FTE`} style={{ position: 'relative', height: 160, display: 'flex', alignItems: 'flex-end', gap: 10 }}>
                                    {/* capacity stack */}
                                    <div style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 2 }}>
                                        <div style={{ height: h(s.benchFte), background: LOAD_COLORS.bench, border: '1px dashed var(--n-400)', borderRadius: '4px 4px 0 0' }} />
                                        <div style={{ height: h(Math.max(0, s.committedFte - s.aboveTableFte - s.belowTableFte)), background: LOAD_COLORS.other }} />
                                        <div style={{ height: h(s.belowTableFte), background: LOAD_COLORS.below }} />
                                        <div style={{ height: h(s.aboveTableFte), background: LOAD_COLORS.above, borderRadius: '0 0 4px 4px' }} />
                                    </div>
                                    {/* demand bar */}
                                    <div style={{ width: 22, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }} title={`Demand ${s.demandFte} FTE (${s.unstaffedFte} unstaffed)`}>
                                        <div style={{ height: h(s.demandFte), background: 'repeating-linear-gradient(135deg, var(--n-500) 0 3px, transparent 3px 6px)', border: '1px solid var(--n-500)', borderRadius: 4 }} />
                                    </div>
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--n-600)', lineHeight: 1.6 }}>
                                    <div><b style={{ color: 'var(--n-800)', fontSize: 14 }}>{s.avgUtil}%</b> utilised · {s.committedFte.toFixed(1)} of {s.capacityFte.toFixed(1)} FTE</div>
                                    <div>Bench {s.benchFte.toFixed(1)} · Demand <span style={{ fontWeight: 700 }}>{s.demandFte.toFixed(1)}</span> ({s.unstaffedFte.toFixed(1)} open)</div>
                                </div>
                            </div>
                        );
                    })}
                </div>
                <div style={{ padding: '0 20px 16px', fontSize: 11, color: 'var(--n-500)' }}>Hatched bar = captured demand for the quarter. Bench above open demand means re-skilling or marketplace matching; demand above bench means hiring or re-sequencing.</div>
            </div>

            {/* Actions */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div className="panel">
                    <div className="panel-header">
                        <div>
                            <div className="panel-title">Under-used across the window</div>
                            <div className="panel-subtitle">Average below their target by more than 10 points. Offer them to projects via the marketplace.</div>
                        </div>
                        <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => onGoTo('marketplace')}>Open marketplace →</button>
                    </div>
                    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {underUsed.length === 0 && <div style={{ fontSize: 13, color: 'var(--optimal)', padding: 8 }}>✓ Everyone is within 10 points of target.</div>}
                        {underUsed.map(o => (
                            <div key={o.r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 8, background: 'var(--n-100)' }}>
                                <Avatar r={o.r} size={28} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--n-800)' }}>{o.r.name}</div>
                                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                                        <CraftChip craftId={o.r.primaryCraft} small />
                                        {(o.r.secondaryCrafts || []).map(s => <CraftChip key={s.craftId} craftId={s.craftId} via="secondary" small />)}
                                    </div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    <div style={{ fontWeight: 800, color: 'var(--high)' }}>{Math.round(o.avg)}%</div>
                                    <div style={{ fontSize: 10, color: 'var(--n-500)' }}>avg of {quarters.length} qtrs</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="panel">
                    <div className="panel-header">
                        <div>
                            <div className="panel-title">Strained in at least one quarter</div>
                            <div className="panel-subtitle">Over capacity somewhere in the window. Rebalance on the roadmap.</div>
                        </div>
                        <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => onGoTo('demand')}>Open roadmap →</button>
                    </div>
                    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {overUsed.length === 0 && <div style={{ fontSize: 13, color: 'var(--optimal)', padding: 8 }}>✓ Nobody is over capacity in the window.</div>}
                        {overUsed.map(o => (
                            <div key={o.r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 8, background: 'var(--over-bg)' }}>
                                <Avatar r={o.r} size={28} />
                                <div style={{ flex: 1, fontWeight: 700, fontSize: 13, color: 'var(--n-800)' }}>{o.r.name}</div>
                                <div style={{ display: 'flex', gap: 6 }}>
                                    {o.outlook.map((l, i) => (
                                        <span key={l.quarterKey} className={`badge ${l.total > l.capacity ? 'badge-over' : 'badge-under'}`} title={quarters[i].name}>{quarters[i].label} {Math.round(l.total)}%</span>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Per-person / team / tribe outlook table */}
            <div className="panel">
                <div className="panel-header">
                    <div>
                        <div className="panel-title">Outlook by {groupBy}</div>
                        <div className="panel-subtitle">Quarter-averaged load per person. Hover a bar for the split.</div>
                    </div>
                    <div style={{ display: 'flex', gap: 4, background: 'var(--n-100)', borderRadius: 999, padding: 3 }}>
                        {(['person', 'team', 'tribe'] as const).map(g => (
                            <button key={g} onClick={() => setGroupBy(g)} style={{ padding: '5px 12px', borderRadius: 999, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, background: groupBy === g ? '#fff' : 'transparent', color: groupBy === g ? 'var(--brand-600)' : 'var(--n-600)', boxShadow: groupBy === g ? 'var(--shadow-sm)' : 'none' }}>{g[0].toUpperCase() + g.slice(1)}</button>
                        ))}
                    </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th style={{ minWidth: 220 }}>Person</th>
                                {quarters.map(q => <th key={q.key} style={{ minWidth: 170 }}><QuarterHeader q={q} align="left" /></th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {groups.map(g => (
                                <React.Fragment key={g.label}>
                                    {groupBy !== 'person' && (
                                        <tr style={{ background: 'var(--n-100)' }}>
                                            <td style={{ fontWeight: 800, color: 'var(--n-700)', fontSize: 12 }}>{g.label} · {g.members.length}</td>
                                            {quarters.map((q, i) => {
                                                const avg = g.members.length ? Math.round(g.members.reduce((s, m) => s + m.outlook[i].total, 0) / g.members.length) : 0;
                                                return <td key={q.key} style={{ fontWeight: 800, color: avg > 100 ? 'var(--over)' : avg >= 90 ? 'var(--optimal)' : 'var(--n-700)' }}>{avg}% avg</td>;
                                            })}
                                        </tr>
                                    )}
                                    {g.members.map(({ r, outlook }) => (
                                        <tr key={r.id}>
                                            <td>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                    <Avatar r={r} size={28} />
                                                    <div>
                                                        <div style={{ fontWeight: 700, color: 'var(--n-800)', fontSize: 13 }}>{r.name}</div>
                                                        <div style={{ fontSize: 11, color: 'var(--n-500)' }}>{r.role}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            {outlook.map((l, i) => <td key={l.quarterKey}><LoadBar load={l} quarter={quarters[i]} /></td>)}
                                        </tr>
                                    ))}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
