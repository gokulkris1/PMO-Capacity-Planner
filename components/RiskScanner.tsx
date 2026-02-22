import React, { useMemo } from 'react';
import { Resource, Project, Allocation } from '../types';

interface RiskScannerProps {
    resources: Resource[];
    projects: Project[];
    allocations: Allocation[];
}

export const RiskScanner: React.FC<RiskScannerProps> = ({ resources, projects, allocations }) => {
    const risks = useMemo(() => {
        const list: { level: 'High' | 'Medium', title: string, desc: string }[] = [];

        // Check over-allocated resources
        resources.forEach(res => {
            const load = allocations.filter(a => a.resourceId === res.id).reduce((s, a) => s + a.percentage, 0);
            if (load > 110) {
                list.push({ level: 'High', title: 'Severe Burnout Risk', desc: `${res.name} is allocated at ${load}% capacity.` });
            } else if (load > 90 && load <= 110) {
                list.push({ level: 'Medium', title: 'Over-allocation Warning', desc: `${res.name} is running hot at ${load}% capacity.` });
            }
        });

        // Check single point of failure (resource in Critical projects with >80% allocation)
        const criticalProjectIds = projects.filter(p => p.priority === 'Critical').map(p => p.id);
        allocations.forEach(alloc => {
            if (criticalProjectIds.includes(alloc.projectId) && alloc.percentage >= 80) {
                const res = resources.find(r => r.id === alloc.resourceId);
                const proj = projects.find(p => p.id === alloc.projectId);
                if (res && proj) {
                    list.push({
                        level: 'High',
                        title: 'Single Point of Failure',
                        desc: `${res.name} is dedicated ${alloc.percentage}% to Critical project "${proj.name}". Consider cross-training.`
                    });
                }
            }
        });

        return list;
    }, [resources, projects, allocations]);

    if (risks.length === 0) return null;

    return (
        <div style={{ background: 'var(--bg-panel)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)', marginTop: '1.5rem' }}>
            <h3 style={{ marginBottom: '1rem', color: 'var(--text-bright)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>⚠️</span> Risk Scanner
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {risks.map((risk, i) => (
                    <div key={i} style={{
                        padding: '12px',
                        borderRadius: '6px',
                        borderLeft: `4px solid ${risk.level === 'High' ? '#ef4444' : '#f59e0b'}`,
                        background: 'var(--bg-card)'
                    }}>
                        <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-main)', marginBottom: '4px' }}>
                            {risk.title}
                        </div>
                        <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{risk.desc}</div>
                    </div>
                ))}
            </div>
        </div>
    );
};
