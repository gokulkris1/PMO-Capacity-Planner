import React, { useState } from 'react';
import { Resource, Project, Allocation } from '../types';
import { PMO_CRAFTS } from '../constants';

interface AllocationModalProps {
    resource: Resource;
    project: Project;
    allocations: Allocation[]; // All existing allocations for this specific Res/Proj pair
    onSave: (allocations: Allocation[]) => void;
    onClose: () => void;
}

export const AllocationModal: React.FC<AllocationModalProps> = ({ resource, project, allocations, onSave, onClose }) => {
    // If no allocations exist yet, start with a 0% entry
    const [slices, setSlices] = useState<Partial<Allocation>[]>(
        allocations.length > 0 ? allocations : [{ percentage: 0, startDate: '', endDate: '', craftId: resource.primaryCraft }]
    );
    const craftOptions = [
        ...(resource.primaryCraft ? [{ id: resource.primaryCraft, label: `${PMO_CRAFTS.find(c => c.id === resource.primaryCraft)?.name || resource.primaryCraft} (above the table)` }] : []),
        ...(resource.secondaryCrafts || []).map(s => ({ id: s.craftId, label: `${PMO_CRAFTS.find(c => c.id === s.craftId)?.name || s.craftId} (below the table · L${s.proficiency})` })),
    ];
    const otherCrafts = PMO_CRAFTS.filter(c => !craftOptions.some(o => o.id === c.id));

    const updateSlice = (idx: number, key: string, value: any) => {
        const newSlices = [...slices];
        newSlices[idx] = { ...newSlices[idx], [key]: value };
        setSlices(newSlices);
    };

    const addSlice = () => setSlices([...slices, { percentage: 0, startDate: '', endDate: '', craftId: resource.primaryCraft }]);

    const removeSlice = (idx: number) => {
        const newSlices = [...slices];
        newSlices.splice(idx, 1);
        setSlices(newSlices);
    };

    const handleSave = () => {
        let clamped = false;
        // Build slices and automatically clamp to project end date
        const builtSlices = slices.filter(s => s.percentage && s.percentage > 0).map(s => {
            let finalEndDate = s.endDate;
            if (project.endDate) {
                if (!finalEndDate || finalEndDate > project.endDate) {
                    finalEndDate = project.endDate;
                    clamped = true;
                }
            }
            return {
                id: s.id || crypto.randomUUID(),
                resourceId: resource.id,
                projectId: project.id,
                percentage: s.percentage!,
                startDate: s.startDate || undefined,
                endDate: finalEndDate || undefined,
                craftId: s.craftId || resource.primaryCraft || undefined,
                source: s.source || 'manual',
            };
        });

        if (clamped) {
            alert(`Note: One or more allocation end dates were shortened to match the project's end date (${project.endDate}).`);
        }

        onSave(builtSlices as Allocation[]);
    };

    return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="modal-box" style={{ maxWidth: 500 }}>
                <div className="modal-title">Allocate to {project.name}</div>
                <div style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
                    Resource: <strong style={{ color: '#1e293b' }}>{resource.name}</strong> ({resource.role})
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {slices.map((slice, i) => (
                        <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center', background: '#f8fafc', padding: 12, borderRadius: 8, flexWrap: 'wrap' }}>
                            <div style={{ flexBasis: '100%' }}>
                                <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Craft performed on this project</label>
                                <select className="form-select" value={slice.craftId || ''} onChange={e => updateSlice(i, 'craftId', e.target.value || undefined)}>
                                    {craftOptions.length === 0 && <option value="">— no craft set on this person —</option>}
                                    {craftOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                                    {otherCrafts.length > 0 && <optgroup label="Other (not declared on this person)">{otherCrafts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>}
                                </select>
                            </div>
                            <div style={{ flex: 1 }}>
                                <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>% Allocated</label>
                                <div style={{ display: 'flex', alignItems: 'center', background: '#fff', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0 8px', overflow: 'hidden' }}>
                                    <input type="number" min={0} max={100} value={slice.percentage || ''} onChange={e => updateSlice(i, 'percentage', Number(e.target.value))} style={{ width: '60px', border: 'none', outline: 'none', fontSize: '16px', fontWeight: 700, padding: '8px 0', textAlign: 'right', background: 'transparent', WebkitAppearance: 'none', MozAppearance: 'textfield' }} />
                                    <span style={{ fontSize: '14px', color: '#64748b', fontWeight: 600, marginLeft: '4px' }}>%</span>
                                </div>
                            </div>
                            <div style={{ flex: 1 }}>
                                <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Start Date</label>
                                <input className="form-input" type="date" value={slice.startDate || ''} onChange={e => updateSlice(i, 'startDate', e.target.value)} />
                            </div>
                            <div style={{ flex: 1 }}>
                                <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>End Date</label>
                                <input className="form-input" type="date" max={project.endDate || ''} value={slice.endDate || ''} onChange={e => updateSlice(i, 'endDate', e.target.value)} />
                            </div>
                            <button onClick={() => removeSlice(i)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', marginTop: 18, fontSize: 16 }}>×</button>
                        </div>
                    ))}
                </div>

                <button onClick={addSlice} style={{ background: 'none', border: '1px dashed #cbd5e1', color: '#64748b', padding: '8px 12px', borderRadius: 8, cursor: 'pointer', marginTop: 12, fontSize: 13, width: '100%' }}>
                    + Add specific dates (e.g. Ramp-up phase)
                </button>
                <div className="modal-footer" style={{ marginTop: 24 }}>
                    <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
                    <button className="btn btn-primary" onClick={handleSave}>Save Allocations</button>
                </div>
            </div>
        </div>
    );
};
