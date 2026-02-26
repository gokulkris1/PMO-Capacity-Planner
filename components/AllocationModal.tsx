import React, { useState, useMemo, useEffect } from 'react';
import { Resource, Project, Allocation, Sprint } from '../types';
import { getAvailableYears, getQuartersForYear, isSprintWithinProject } from '../src/utils/sprintUtils';

interface AllocationModalProps {
    resource: Resource;
    project: Project;
    allocations: Allocation[]; // All existing allocations for this specific Res/Proj pair
    onSave: (allocations: Allocation[]) => void;
    onClose: () => void;
}

export const AllocationModal: React.FC<AllocationModalProps> = ({ resource, project, allocations, onSave, onClose }) => {
    // Determine default year + quarter based on today
    const currentYear = new Date().getUTCFullYear();
    const currentQ = Math.floor(new Date().getUTCMonth() / 3) + 1;

    const [selectedYear, setSelectedYear] = useState<number>(currentYear);
    const [selectedQuarterId, setSelectedQuarterId] = useState<string>(`${currentYear}-Q${currentQ}`);

    // Flattened dictionary of all Sprints in loaded state vs their allocated percentage
    const [allocMap, setAllocMap] = useState<Record<string, number>>({});

    // Populate the state mapping on mount matching existing slices to Sprints
    useEffect(() => {
        const loaded: Record<string, number> = {};
        allocations.forEach(a => {
            // Find which sprint this allocation ID belongs to, based on start date
            if (a.startDate) {
                // To keep it simple, we use the exact ISO date as the token since sprints bounds are precise
                loaded[a.startDate] = a.percentage;
            }
        });
        setAllocMap(loaded);
    }, [allocations]);

    const availableYears = getAvailableYears();
    const quarters = useMemo(() => getQuartersForYear(selectedYear), [selectedYear]);
    const activeQuarter = quarters.find(q => q.id === selectedQuarterId) || quarters[0];

    const handleSprintChange = (sprintStart: string, pct: number) => {
        setAllocMap(prev => {
            const next = { ...prev };
            if (pct <= 0 || isNaN(pct)) delete next[sprintStart];
            else next[sprintStart] = Math.min(100, pct);
            return next;
        });
    };

    const handleSave = () => {
        // Hydrate the simple key-value map back up into standard Allocation objects
        const validSlices: Allocation[] = [];

        // Iterate through ALL quarters across ALL years that might have been modified
        // In highly complex setups we would map entirely, but since we are modifying via `sprint.startDate` directly:

        availableYears.forEach(year => {
            const qs = getQuartersForYear(year);
            qs.forEach(q => {
                q.sprints.forEach(sprint => {
                    const pct = allocMap[sprint.startDate];
                    if (pct && pct > 0) {
                        validSlices.push({
                            id: crypto.randomUUID(),
                            resourceId: resource.id,
                            projectId: project.id,
                            percentage: pct,
                            startDate: sprint.startDate,
                            endDate: sprint.endDate
                        });
                    }
                });
            });
        });

        onSave(validSlices);
    };

    return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="modal-box" style={{ maxWidth: 500 }}>
                <div className="modal-title">Allocate to {project.name}</div>
                <div style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
                    Resource: <strong style={{ color: '#1e293b' }}>{resource.name}</strong> ({resource.role})
                </div>

                <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                    <div style={{ flex: 1 }}>
                        <label className="form-label" style={{ marginBottom: 4 }}>Select Year</label>
                        <select className="form-select" value={selectedYear} onChange={e => {
                            const y = parseInt(e.target.value);
                            setSelectedYear(y);
                            setSelectedQuarterId(`${y}-Q1`); // Reset to Q1 when jumping years
                        }}>
                            {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                    </div>
                    <div style={{ flex: 1 }}>
                        <label className="form-label" style={{ marginBottom: 4 }}>Select Quarter</label>
                        <select className="form-select" value={selectedQuarterId} onChange={e => setSelectedQuarterId(e.target.value)}>
                            {quarters.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}
                        </select>
                    </div>
                </div>

                <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
                    <div style={{ background: '#f8fafc', padding: '10px 16px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', fontWeight: 600, fontSize: 12, color: '#64748b', textTransform: 'uppercase' }}>
                        <span>Sprint Dates</span>
                        <span>% Allocation</span>
                    </div>
                    <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                        {activeQuarter.sprints.map((sprint, idx) => {
                            const isWithin = isSprintWithinProject(sprint, project.startDate, project.endDate);
                            const val = allocMap[sprint.startDate] || '';

                            return (
                                <div key={sprint.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: idx < activeQuarter.sprints.length - 1 ? '1px solid #f1f5f9' : 'none', background: isWithin ? '#fff' : '#f8fafc', opacity: isWithin ? 1 : 0.6 }}>
                                    <div>
                                        <div style={{ fontWeight: 600, color: '#1e293b', fontSize: 13 }}>{sprint.name}</div>
                                        <div style={{ fontSize: 11, color: '#64748b' }}>{sprint.startDate} to {sprint.endDate}</div>
                                        {!isWithin && <div style={{ fontSize: 10, color: '#ef4444', marginTop: 4 }}>Outside project dates</div>}
                                    </div>
                                    <input
                                        type="number"
                                        className="form-input"
                                        style={{ width: 80, textAlign: 'right' }}
                                        min={0} max={100}
                                        placeholder="0"
                                        value={val}
                                        disabled={!isWithin}
                                        onChange={e => handleSprintChange(sprint.startDate, parseInt(e.target.value))}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="modal-footer" style={{ marginTop: 24 }}>
                    <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
                    <button className="btn btn-primary" onClick={handleSave}>Save Allocations</button>
                </div>
            </div>
        </div>
    );
};
