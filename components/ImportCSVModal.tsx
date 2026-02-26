import React, { useState } from 'react';
import Papa from 'papaparse';
import { Resource, Project, Allocation, ResourceType, ProjectStatus } from '../types';

interface ImportCSVModalProps {
    currentResources: Resource[];
    currentProjects: Project[];
    currentAllocations: Allocation[];
    onConfirm: (r: Resource[], p: Project[], a: Allocation[]) => void;
    onClose: () => void;
}

export const ImportCSVModal: React.FC<ImportCSVModalProps> = ({
    currentResources, currentProjects, currentAllocations, onConfirm, onClose
}) => {
    const [file, setFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<any[]>([]);
    const [error, setError] = useState<string>('');

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
        }
    };

    const processFile = () => {
        if (!file) return;
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                setPreview(results.data);
            },
            error: (err) => {
                setError(err.message);
            }
        });
    };

    const handleImport = () => {
        if (preview.length === 0) return;

        // Deep clone current state
        const newResources = [...currentResources];
        const newProjects = [...currentProjects];
        let newAllocations = [...currentAllocations];

        const generateId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        preview.forEach((row, i) => {
            // Flexible column matching to handle Excel whitespace
            const getCol = (keyMatches: string[]) => {
                const foundKey = Object.keys(row).find(k => keyMatches.includes(k.trim().toLowerCase()));
                return foundKey ? row[foundKey]?.trim() : '';
            };

            const resName = getCol(['resource', 'resource name']);
            const projName = getCol(['project', 'project name']);
            const percentStr = getCol(['allocation %', 'allocation', 'percentage']);

            if (!resName || !projName || !percentStr) return; // Skip invalid rows

            const percentage = parseInt(percentStr, 10);
            if (isNaN(percentage)) return;

            // Find or create resource
            let res = newResources.find(r => r.name.toLowerCase() === resName.toLowerCase());
            if (!res) {
                const rtSource = getCol(['type', 'resource type']);
                const derivedType = Object.values(ResourceType).find(t => t.toLowerCase() === rtSource.toLowerCase()) || ResourceType.PERMANENT;

                res = {
                    id: generateId('r'),
                    name: resName,
                    role: getCol(['role']) || 'Team Member',
                    department: getCol(['department']) || 'General',
                    type: derivedType,
                    totalCapacity: 100
                };
                newResources.push(res);
            }

            // Find or create project
            let proj = newProjects.find(p => p.name.toLowerCase() === projName.toLowerCase());
            if (!proj) {
                const stSource = getCol(['project status', 'status']);
                const derivedStatus = Object.values(ProjectStatus).find(s => s.toLowerCase() === stSource.toLowerCase()) || ProjectStatus.PLANNING;

                proj = {
                    id: generateId('p'),
                    name: projName,
                    status: derivedStatus,
                    priority: 'Medium',
                    description: 'Imported from CSV'
                };
                newProjects.push(proj);
            }

            // Update allocation (overwrite if exists, else create)
            const existingAllocIndex = newAllocations.findIndex(a => a.resourceId === res.id && a.projectId === proj.id);

            if (existingAllocIndex > -1) {
                if (percentage === 0) {
                    newAllocations.splice(existingAllocIndex, 1);
                } else {
                    newAllocations[existingAllocIndex].percentage = percentage;
                }
            } else if (percentage > 0) {
                newAllocations.push({
                    id: generateId('a'),
                    resourceId: res.id,
                    projectId: proj.id,
                    percentage
                });
            }
        });

        onConfirm(newResources, newProjects, newAllocations);
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '600px', width: '90%' }}>
                <div className="modal-header">
                    <h3>Import Allocations (CSV)</h3>
                    <button className="modal-close" onClick={onClose}>×</button>
                </div>

                <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
                        Upload a CSV file containing columns for <b>Resource</b>, <b>Role</b>, <b>Department</b>, <b>Project</b>, <b>Project Status</b>, and <b>Allocation %</b>.
                    </p>

                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                        <input type="file" accept=".csv" onChange={handleFileChange} />
                        <button className="btn btn-secondary" onClick={processFile} disabled={!file}>Preview Data</button>
                    </div>

                    {error && <div style={{ color: '#ef4444', fontSize: '14px' }}>{error}</div>}

                    {preview.length > 0 && (
                        <div style={{ marginTop: '1rem' }}>
                            <div style={{ fontSize: '14px', marginBottom: '8px', fontWeight: 600 }}>Preview ({preview.length} rows found):</div>
                            <div style={{ maxHeight: '200px', overflowY: 'auto', background: 'var(--bg-app)', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
                                <table className="alloc-table" style={{ fontSize: '12px', width: '100%' }}>
                                    <thead>
                                        <tr>
                                            <th>Resource</th>
                                            <th>Project</th>
                                            <th>Allocation %</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {preview.slice(0, 10).map((r, i) => (
                                            <tr key={i}>
                                                <td>{r['Resource'] || '-'}</td>
                                                <td>{r['Project'] || '-'}</td>
                                                <td>{r['Allocation %'] || '-'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {preview.length > 10 && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>Showing first 10 rows.</div>}
                        </div>
                    )}
                </div>

                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
                    <button className="btn btn-primary" onClick={handleImport} disabled={preview.length === 0}>
                        Confirm Import
                    </button>
                </div>
            </div>
        </div>
    );
};
