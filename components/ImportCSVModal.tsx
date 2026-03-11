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
    const [processedData, setProcessedData] = useState<{ resources: Resource[], projects: Project[], allocations: Allocation[] } | null>(null);
    const [previewPage, setPreviewPage] = useState(0);

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
        const generateId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

        const skippedRows: number[] = [];
        const requiredHeaders = {
            resource: ['resource', 'resource name', 'name', 'individual', 'employee'],
            project: ['project', 'project name', 'project title', 'initiative'],
            allocation: ['allocation %', 'allocation', 'percentage', 'utilization', 'alloc %', 'fte %', 'util %']
        };

        // Check for missing required headers (BUG #9)
        const sampleRow = preview[0];
        const keys = Object.keys(sampleRow).map(k => k.trim().toLowerCase());
        const missing = Object.entries(requiredHeaders).filter(([_, matches]) =>
            !matches.some(m => keys.includes(m))
        ).map(([name]) => name);

        if (missing.length > 0) {
            setError(`Missing required columns: ${missing.join(', ')}`);
            return;
        }

        preview.forEach((row, i) => {
            const getCol = (keyMatches: string[]) => {
                const foundKey = Object.keys(row).find(k => keyMatches.includes(k.trim().toLowerCase()));
                return foundKey ? row[foundKey]?.trim() : '';
            };

            const resName = getCol(requiredHeaders.resource);
            const projName = getCol(requiredHeaders.project);
            const percentStr = getCol(requiredHeaders.allocation);

            if (!resName || !projName || !percentStr) {
                skippedRows.push(i + 1);
                return;
            }

            const percentage = parseInt(percentStr, 10);
            if (isNaN(percentage)) {
                skippedRows.push(i + 1);
                return;
            }

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

        setProcessedData({ resources: newResources, projects: newProjects, allocations: newAllocations });

        if (skippedRows.length > 0) {
            setError(`Imported successfully, but ${skippedRows.length} rows were skipped due to malformed data (Rows: ${skippedRows.slice(0, 5).join(', ')}${skippedRows.length > 5 ? '...' : ''})`);
        } else {
            onConfirm(newResources, newProjects, newAllocations);
            onClose();
        }
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

                    {error && (
                        <div style={{ padding: 12, background: '#fef2f2', color: '#b91c1c', borderRadius: 8, fontSize: 13, marginBottom: 16, border: '1px solid #fee2e2' }}>
                            {error}
                            {error.includes('skipped') && processedData && (
                                <button
                                    onClick={() => { onConfirm(processedData.resources, processedData.projects, processedData.allocations); onClose(); }}
                                    style={{ display: 'block', marginTop: 8, background: '#ef4444', color: 'white', border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer', fontWeight: 600 }}
                                >
                                    Proceed Anyway
                                </button>
                            )}
                        </div>
                    )}

                    {preview.length > 0 && (
                        <div style={{ marginTop: '1rem' }}>
                            <div style={{ fontSize: '14px', marginBottom: '8px', fontWeight: 600 }}>Preview ({preview.length} rows found):</div>
                            <div style={{ maxHeight: '300px', overflowY: 'auto', background: 'var(--bg-app)', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
                                <table className="alloc-table" style={{ fontSize: '12px', width: '100%' }}>
                                    <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-secondary)', zIndex: 1 }}>
                                        <tr>
                                            <th>Resource</th>
                                            <th>Project</th>
                                            <th>Allocation %</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {preview.slice(previewPage * 20, (previewPage + 1) * 20).map((r, i) => (
                                            <tr key={previewPage * 20 + i}>
                                                <td>{r['Resource'] || '-'}</td>
                                                <td>{r['Project'] || '-'}</td>
                                                <td>{r['Allocation %'] || '-'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {preview.length > 20 && (
                                <div style={{ display: 'flex', gap: '8px', marginTop: '8px', alignItems: 'center', justifyContent: 'center' }}>
                                    <button 
                                        onClick={() => setPreviewPage(Math.max(0, previewPage - 1))}
                                        disabled={previewPage === 0}
                                        style={{ padding: '4px 12px', fontSize: '12px', cursor: previewPage === 0 ? 'default' : 'pointer', opacity: previewPage === 0 ? 0.5 : 1 }}
                                    >
                                        ← Previous
                                    </button>
                                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                        Page {previewPage + 1} of {Math.ceil(preview.length / 20)} (Rows {previewPage * 20 + 1}-{Math.min((previewPage + 1) * 20, preview.length)})
                                    </span>
                                    <button 
                                        onClick={() => setPreviewPage(Math.min(Math.ceil(preview.length / 20) - 1, previewPage + 1))}
                                        disabled={previewPage >= Math.ceil(preview.length / 20) - 1}
                                        style={{ padding: '4px 12px', fontSize: '12px', cursor: previewPage >= Math.ceil(preview.length / 20) - 1 ? 'default' : 'pointer', opacity: previewPage >= Math.ceil(preview.length / 20) - 1 ? 0.5 : 1 }}
                                    >
                                        Next →
                                    </button>
                                </div>
                            )}
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
