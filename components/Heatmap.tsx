import React, { useMemo } from 'react';
import { Resource, Project, Allocation, getAllocationStatus, AllocationStatus } from '../types';
import { getCurrentUtil } from '../utils/dateFilteredUtil';
import { getAvatarInitials } from '../utils/avatarInitials';

interface HeatmapProps {
    resources: Resource[];
    projects: Project[];
    allocations: Allocation[];
}

export const Heatmap: React.FC<HeatmapProps> = ({ resources, projects, allocations }) => {
    // Aggregate total percentage per resource
    const resourceLoads = useMemo(() => {
        return resources.map(res => {
            const total = getCurrentUtil(allocations, res.id, projects);
            return { resource: res, total };
        }).sort((a, b) => b.total - a.total); // Highest load first
    }, [resources, projects, allocations]);

    const getColor = (pct: number) => {
        const s = getAllocationStatus(pct);
        if (s === AllocationStatus.OVER) return 'rgba(239, 68, 68, 0.8)'; // Red
        if (s === AllocationStatus.HIGH) return 'rgba(245, 158, 11, 0.8)'; // Amber
        if (s === AllocationStatus.OPTIMAL) return 'rgba(16, 185, 129, 0.8)'; // Green
        return 'rgba(107, 114, 128, 0.5)'; // Gray
    };

    return (
        <div className="panel">
            <div className="panel-header" style={{ alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div>
                    <div className="panel-title">Resource load heatmap</div>
                    <div className="panel-subtitle">Live Active and Planning capacity, ordered by highest load</div>
                </div>
                <div className="legend" style={{ marginLeft: 'auto' }}>
                    {[
                        { label: 'Under', color: 'rgba(107, 114, 128, 0.5)' },
                        { label: 'Optimal', color: 'rgba(16, 185, 129, 0.8)' },
                        { label: 'High', color: 'rgba(245, 158, 11, 0.8)' },
                        { label: 'Over', color: 'rgba(239, 68, 68, 0.8)' },
                    ].map(item => (
                        <span key={item.label} className="legend-item">
                            <span className="legend-dot" style={{ background: item.color }} />
                            {item.label}
                        </span>
                    ))}
                </div>
            </div>
            <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 10 }}>
                {resourceLoads.map(({ resource, total }) => {
                    const status = getAllocationStatus(total);
                    const color = getColor(total);
                    return (
                        <div
                            key={resource.id}
                            title={`${resource.name} — ${total}% live load`}
                            aria-label={`${resource.name}: ${total}% live load, ${status.toLowerCase()}`}
                            style={{
                                minHeight: 74,
                                borderRadius: 10,
                                padding: '11px 12px',
                                border: total > 100 ? '1px solid #fecaca' : '1px solid var(--n-300)',
                                borderLeft: `4px solid ${color}`,
                                background: total > 100 ? '#fffafa' : '#fff',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 8,
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                                <div className="avatar" style={{ width: 32, height: 32, fontSize: 11, background: color, color: '#fff' }}>
                                    {getAvatarInitials(resource.name)}
                                </div>
                                <div style={{ minWidth: 0, flex: 1 }}>
                                    <div style={{ fontSize: 12, color: 'var(--n-800)', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{resource.name}</div>
                                    <div style={{ fontSize: 10, color: 'var(--n-600)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{resource.role}</div>
                                </div>
                                <strong style={{ color, fontSize: 17 }}>{total}%</strong>
                            </div>
                            <div style={{ height: 5, background: 'var(--n-200)', borderRadius: 99, overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${Math.min(total, 100)}%`, background: color, borderRadius: 99 }} />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
