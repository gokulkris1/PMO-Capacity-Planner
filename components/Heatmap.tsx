import React, { useMemo } from 'react';
import { Resource, Allocation, getAllocationStatus, AllocationStatus } from '../types';

interface HeatmapProps {
    resources: Resource[];
    allocations: Allocation[];
}

export const Heatmap: React.FC<HeatmapProps> = ({ resources, allocations }) => {
    // Aggregate total percentage per resource
    const resourceLoads = useMemo(() => {
        return resources.map(res => {
            const total = allocations
                .filter(a => a.resourceId === res.id)
                .reduce((sum, a) => sum + a.percentage, 0);
            return { resource: res, total };
        }).sort((a, b) => b.total - a.total); // Highest load first
    }, [resources, allocations]);

    const getColor = (pct: number) => {
        const s = getAllocationStatus(pct);
        if (s === AllocationStatus.OVER) return 'rgba(239, 68, 68, 0.8)'; // Red
        if (s === AllocationStatus.HIGH) return 'rgba(245, 158, 11, 0.8)'; // Amber
        if (s === AllocationStatus.OPTIMAL) return 'rgba(16, 185, 129, 0.8)'; // Green
        return 'rgba(107, 114, 128, 0.5)'; // Gray
    };

    return (
        <div style={{ background: 'var(--bg-panel)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
            <h3 style={{ marginBottom: '1rem', color: 'var(--text-bright)' }}>Resource Load Heatmap</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {resourceLoads.map(({ resource, total }) => (
                    <div
                        key={resource.id}
                        title={`${resource.name} - ${total}%`}
                        style={{
                            width: '40px',
                            height: '40px',
                            borderRadius: '6px',
                            background: getColor(total),
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#fff',
                            fontSize: '11px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            border: total > 100 ? '2px solid #fff' : 'none'
                        }}
                    >
                        {resource.avatarInitials || resource.name.slice(0, 2).toUpperCase()}
                    </div>
                ))}
            </div>
            <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', fontSize: '12px', color: 'var(--text-muted)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><div style={{ width: 12, height: 12, background: 'rgba(107, 114, 128, 0.5)', borderRadius: 2 }} /> Under</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><div style={{ width: 12, height: 12, background: 'rgba(16, 185, 129, 0.8)', borderRadius: 2 }} /> Optimal (60-80%)</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><div style={{ width: 12, height: 12, background: 'rgba(245, 158, 11, 0.8)', borderRadius: 2 }} /> High (80-100%)</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><div style={{ width: 12, height: 12, background: 'rgba(239, 68, 68, 0.8)', borderRadius: 2 }} /> Overly Allocated (&gt;100%)</div>
            </div>
        </div>
    );
};
