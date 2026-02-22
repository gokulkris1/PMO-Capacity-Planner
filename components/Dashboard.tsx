
import React, { useMemo } from 'react';
import { Resource, Project, Allocation, getAllocationStatus, AllocationStatus, ProjectStatus } from '../types';
import { Team } from '../types';
import { StatCard } from './StatCard';
import { CapacityChart } from './CapacityChart';
import { Heatmap } from './Heatmap';
import { RiskScanner } from './RiskScanner';

interface Props {
    resources: Resource[];
    projects: Project[];
    allocations: Allocation[];
    scenarioAllocations?: Allocation[] | null;
    onTabChange: (tab: string) => void;
    teams: Team[];
}

function getUtil(allocations: Allocation[], resourceId: string) {
    return allocations.filter(a => a.resourceId === resourceId).reduce((s, a) => s + a.percentage, 0);
}

function projectStatusBadge(status: string) {
    const map: Record<string, string> = {
        Active: 'badge badge-active',
        Planning: 'badge badge-planning',
        'On Hold': 'badge badge-hold',
        Completed: 'badge badge-completed',
    };
    return map[status] || 'badge badge-hold';
}

function priorityBadge(p: string) {
    const map: Record<string, string> = {
        Critical: 'badge badge-critical',
        High: 'badge badge-high',
        Medium: 'badge badge-medium',
        Low: 'badge badge-low',
    };
    return map[p] || 'badge badge-medium';
}

export const Dashboard: React.FC<Props> = ({ resources, projects, allocations, scenarioAllocations, onTabChange, teams }) => {
    const liveAllocations = scenarioAllocations ?? allocations;

    const stats = useMemo(() => {
        const totalResources = resources.length;
        const activeProjects = projects.filter(p => p.status === ProjectStatus.ACTIVE).length;
        const overAllocated = resources.filter(r => getUtil(liveAllocations, r.id) > 100);
        const underAllocated = resources.filter(r => getUtil(liveAllocations, r.id) < 60);
        const totalPct = resources.reduce((s, r) => s + getUtil(liveAllocations, r.id), 0);
        const avgUtil = resources.length ? Math.round(totalPct / resources.length) : 0;
        const totalFte = liveAllocations.reduce((s, a) => s + a.percentage, 0) / 100;
        return { totalResources, activeProjects, overAllocated, underAllocated, avgUtil, totalFte };
    }, [resources, projects, liveAllocations]);

    // resource util breakdown for donut-like summary
    const utilBuckets = useMemo(() => {
        const b = { over: 0, high: 0, optimal: 0, under: 0 };
        resources.forEach(r => {
            const u = getUtil(liveAllocations, r.id);
            const s = getAllocationStatus(u);
            if (s === AllocationStatus.OVER) b.over++;
            else if (s === AllocationStatus.HIGH) b.high++;
            else if (s === AllocationStatus.OPTIMAL) b.optimal++;
            else b.under++;
        });
        return b;
    }, [resources, liveAllocations]);

    return (
        <div className="page-enter" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* KPI Row */}
            <div className="stat-grid">
                <StatCard
                    label="Avg Utilization"
                    value={`${stats.avgUtil}%`}
                    icon="📊"
                    iconBg="#eef2ff"
                    glowColor="#6366f1"
                    trend="+2.4% vs last month"
                    trendType="up"
                />
                <StatCard
                    label="Active Projects"
                    value={stats.activeProjects}
                    icon="🚀"
                    iconBg="#dbeafe"
                    glowColor="#3b82f6"
                    trend={`${projects.length} total`}
                    trendType="neu"
                />
                <StatCard
                    label="Over Allocated"
                    value={stats.overAllocated.length}
                    icon="⚠️"
                    iconBg="#fef2f2"
                    glowColor="#ef4444"
                    trend={stats.overAllocated.length > 0 ? stats.overAllocated.map(r => r.name.split(' ')[0]).join(', ') : 'All clear ✓'}
                    trendType={stats.overAllocated.length > 0 ? 'down' : 'up'}
                />
                <StatCard
                    label="Under Utilized"
                    value={stats.underAllocated.length}
                    icon="💤"
                    iconBg="#f0fdf4"
                    glowColor="#10b981"
                    trend="Below 60% capacity"
                    trendType={stats.underAllocated.length > 0 ? 'warn' : 'up'}
                />
                <StatCard
                    label="Total Team Size"
                    value={stats.totalResources}
                    icon="👥"
                    iconBg="#f5f3ff"
                    glowColor="#8b5cf6"
                    trend={`${resources.filter(r => r.type === 'Permanent').length}P / ${resources.filter(r => r.type === 'Contractor').length}C`}
                    trendType="neu"
                />
                <StatCard
                    label="FTE Deployed"
                    value={stats.totalFte.toFixed(1)}
                    icon="⚡"
                    iconBg="#fff7ed"
                    glowColor="#f59e0b"
                    trend="Full-time equivalents"
                    trendType="neu"
                />
            </div>

            {/* Chart + Summary Row */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20 }}>
                {/* Capacity Chart Panel */}
                <div className="panel">
                    <div className="panel-header">
                        <div>
                            <div className="panel-title">Resource Utilization Overview</div>
                            <div className="panel-subtitle">Color-coded by allocation threshold</div>
                        </div>
                        <div className="legend">
                            <div className="legend-item"><div className="legend-dot" style={{ background: '#94a3b8' }}></div>Under</div>
                            <div className="legend-item"><div className="legend-dot" style={{ background: '#10b981' }}></div>Optimal</div>
                            <div className="legend-item"><div className="legend-dot" style={{ background: '#f59e0b' }}></div>High</div>
                            <div className="legend-item"><div className="legend-dot" style={{ background: '#ef4444' }}></div>Over</div>
                        </div>
                    </div>
                    <div className="panel-body">
                        <CapacityChart resources={resources} allocations={liveAllocations} scenarioAllocations={scenarioAllocations ?? undefined} />
                    </div>
                </div>

                {/* Allocation Breakdown */}
                <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
                    <div className="panel-header">
                        <div>
                            <div className="panel-title">Allocation Health</div>
                            <div className="panel-subtitle">Resource distribution</div>
                        </div>
                    </div>
                    <div className="panel-body" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {([
                            { key: 'over', label: 'Over Allocated', color: '#ef4444', bg: '#fef2f2' },
                            { key: 'high', label: 'High (80–100%)', color: '#f59e0b', bg: '#fffbeb' },
                            { key: 'optimal', label: 'Optimal (60–80%)', color: '#10b981', bg: '#ecfdf5' },
                            { key: 'under', label: 'Under (<60%)', color: '#94a3b8', bg: '#f8fafc' },
                        ] as any[]).map(({ key, label, color, bg }) => {
                            const count = utilBuckets[key as keyof typeof utilBuckets];
                            const pct = resources.length ? Math.round((count / resources.length) * 100) : 0;
                            return (
                                <div key={key} style={{ background: bg, borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
                                    <div style={{ width: 32, height: 32, borderRadius: 8, background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 14, flexShrink: 0 }}>
                                        {count}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>{label}</div>
                                        <div className="alloc-bar-bg">
                                            <div className="alloc-bar-fill" style={{ width: `${pct}%`, background: color }} />
                                        </div>
                                    </div>
                                    <div style={{ fontSize: 12, fontWeight: 700, color, minWidth: 32, textAlign: 'right' }}>{pct}%</div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Heatmap Section */}
            <Heatmap resources={resources} allocations={liveAllocations} />

            {/* Project Staffing Summary */}
            <div className="panel">
                <div className="panel-header">
                    <div>
                        <div className="panel-title">Project Staffing Status</div>
                        <div className="panel-subtitle">Resources and FTE committed per project</div>
                    </div>
                    <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => onTabChange('by-project')}>
                        View Detail →
                    </button>
                </div>
                <div style={{ overflowX: 'auto' }}>
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Project</th>
                                <th>Status</th>
                                <th>Priority</th>
                                <th>Team Size</th>
                                <th>FTE Committed</th>
                                <th>Capacity Bar</th>
                                <th>Timeline</th>
                            </tr>
                        </thead>
                        <tbody>
                            {projects.map(proj => {
                                const pAllocs = liveAllocations.filter(a => a.projectId === proj.id);
                                const fte = pAllocs.reduce((s, a) => s + a.percentage, 0) / 100;
                                const barPct = Math.min(100, fte * 33);
                                return (
                                    <tr key={proj.id}>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                <div style={{ width: 10, height: 10, borderRadius: 3, background: proj.color || '#6366f1', flexShrink: 0 }} />
                                                <span style={{ fontWeight: 600, color: '#1e293b' }}>{proj.name}</span>
                                            </div>
                                        </td>
                                        <td><span className={projectStatusBadge(proj.status)}>{proj.status}</span></td>
                                        <td><span className={priorityBadge(proj.priority)}>{proj.priority}</span></td>
                                        <td style={{ fontWeight: 600, color: '#475569' }}>{pAllocs.length} members</td>
                                        <td style={{ fontWeight: 700 }}>{fte.toFixed(1)} FTE</td>
                                        <td style={{ minWidth: 140 }}>
                                            <div className="alloc-bar-wrap">
                                                <div className="alloc-bar-bg">
                                                    <div className="alloc-bar-fill" style={{ width: `${barPct}%`, background: proj.color || '#6366f1' }} />
                                                </div>
                                            </div>
                                        </td>
                                        <td style={{ fontSize: 12, color: '#64748b' }}>
                                            {proj.startDate && proj.endDate
                                                ? `${proj.startDate} → ${proj.endDate}`
                                                : proj.startDate || '—'}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Risk Scanner replacing the old Alert panel */}
            <RiskScanner resources={resources} projects={projects} allocations={liveAllocations} />
        </div>
    );
};
