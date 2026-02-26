
import React, { useState } from 'react';
import { Resource, Project, ResourceType, ProjectStatus } from '../types';

/* ── Add/Edit Resource Modal ─────────────────────────────────── */
interface ResourceModalProps {
    initial?: Resource;
    teams: { id: string; name: string }[];
    onSave: (r: Partial<Resource>) => void;
    onBulkSave?: (rs: Partial<Resource>[]) => void;
    onClose: () => void;
}

export const ResourceModal: React.FC<ResourceModalProps> = ({ initial, teams, onSave, onBulkSave, onClose }) => {
    const isEditing = !!initial?.id;
    const [form, setForm] = useState<Partial<Resource>>({
        name: '', role: '', department: '', type: ResourceType.PERMANENT, totalCapacity: 100, location: '', email: '',
        ...(initial || {}),
    });
    const [teamMode, setTeamMode] = useState<'preset' | 'custom'>(() => initial?.teamId ? 'preset' : (initial?.teamName ? 'custom' : 'preset'));
    const [customTeam, setCustomTeam] = useState(initial?.teamId ? '' : (initial?.teamName || ''));
    const [skillsText, setSkillsText] = useState((initial?.skills || []).join(', '));
    const [csvMode, setCsvMode] = useState(false);
    const [csvError, setCsvError] = useState('');

    const set = (k: keyof Resource, v: any) => setForm(f => ({ ...f, [k]: v }));

    const handleResourceFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            const text = evt.target?.result as string;
            if (!text) return;
            const lines = text.split('\n').filter(l => l.trim().length > 0);
            if (lines.length < 2) {
                setCsvError('File appears to be empty or missing data rows.');
                return;
            }

            const parsed: Partial<Resource>[] = [];
            for (let i = 1; i < lines.length; i++) {
                const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
                if (cols.length >= 1 && cols[0]) {
                    parsed.push({
                        name: cols[0],
                        role: cols[1] || '',
                        department: cols[2] || '',
                        type: (cols[3] as ResourceType) || ResourceType.PERMANENT,
                        totalCapacity: parseInt(cols[4] || '100', 10),
                        dailyRate: cols[5] ? parseFloat(cols[5]) : undefined,
                        location: cols[6] || '',
                        email: cols[7] || '',
                        skills: cols[8] ? cols[8].split(';').map(s => s.trim()) : [],
                        teamName: cols[9] || ''
                    });
                }
            }
            if (onBulkSave) onBulkSave(parsed);
        };
        reader.readAsText(file);
    };

    const downloadResourceTemplate = () => {
        const header = "Name,Role,Department,Type,TotalCapacity,DailyCost,Location,Email,Skills(semicolon-separated),TeamName\n";
        const example = "Jane Doe,Frontend Dev,Engineering,Permanent,100,500,Remote,jane@test.com,React;TypeScript,Core Web\n";
        const blob = new Blob([header + example], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'resource_template.csv';
        a.click();
    };

    return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="modal-box">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                    <div className="modal-title" style={{ marginBottom: 0 }}>{isEditing ? 'Edit Resource' : 'Add New Resource'}</div>
                    {!isEditing && onBulkSave && (
                        <button type="button" onClick={() => setCsvMode(!csvMode)} style={{ background: 'none', border: '1px solid #cbd5e1', borderRadius: 8, padding: '4px 12px', fontSize: 13, cursor: 'pointer', color: '#475569', fontWeight: 600 }}>
                            {csvMode ? 'Manual Entry' : 'Bulk Upload CSV'}
                        </button>
                    )}
                </div>

                {csvMode ? (
                    <div style={{ padding: 20, textAlign: 'center', background: '#f8fafc', borderRadius: 12, border: '2px dashed #cbd5e1' }}>
                        <span style={{ fontSize: 32, display: 'block', marginBottom: 12 }}>📥</span>
                        <h4 style={{ margin: '0 0 8px 0', color: '#1e293b' }}>Upload resources via CSV</h4>
                        <p style={{ margin: '0 0 16px 0', fontSize: 13, color: '#64748b' }}>Upload a file matching the required template format.</p>

                        {csvError && <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 16 }}>{csvError}</div>}

                        <input type="file" accept=".csv" onChange={handleResourceFile} style={{ display: 'block', margin: '0 auto 16px auto', fontSize: 13 }} />

                        <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 16 }}>
                            <button type="button" onClick={downloadResourceTemplate} style={{ background: 'none', border: 'none', color: '#6366f1', fontSize: 13, cursor: 'pointer', fontWeight: 600, textDecoration: 'underline' }}>
                                Download .csv template
                            </button>
                        </div>
                    </div>
                ) : (
                    <form
                        className="modal-body-scroll"
                        onSubmit={e => {
                            e.preventDefault();
                            if (!form.name?.trim()) return;
                            const parsedSkills = skillsText
                                .split(',')
                                .map(s => s.trim())
                                .filter(Boolean);
                            const normalizedTeamName = teamMode === 'custom'
                                ? customTeam.trim()
                                : (teams.find(t => t.id === form.teamId)?.name || undefined);
                            onSave({
                                ...form,
                                teamId: teamMode === 'preset' ? (form.teamId || undefined) : undefined,
                                teamName: normalizedTeamName || undefined,
                                skills: parsedSkills,
                            });
                        }}
                    >
                        <div className="form-row">
                            <div className="form-group">
                                <label className="form-label">Full Name *</label>
                                <input className="form-input" required value={form.name || ''} onChange={e => set('name', e.target.value)} placeholder="e.g. Jane Doe" />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Role / Title</label>
                                <input className="form-input" value={form.role || ''} onChange={e => set('role', e.target.value)} placeholder="e.g. Frontend Dev" />
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label className="form-label">Department</label>
                                <input className="form-input" value={form.department || ''} onChange={e => set('department', e.target.value)} placeholder="e.g. Engineering" />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Team</label>
                                <select
                                    className="form-select"
                                    value={teamMode === 'custom' ? '__custom__' : (form.teamId || '')}
                                    onChange={e => {
                                        if (e.target.value === '__custom__') {
                                            setTeamMode('custom');
                                            set('teamId', undefined);
                                            return;
                                        }
                                        setTeamMode('preset');
                                        set('teamId', e.target.value || undefined);
                                    }}
                                >
                                    <option value="">None</option>
                                    {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                    <option value="__custom__">Custom team...</option>
                                </select>
                                {teamMode === 'custom' && (
                                    <input
                                        className="form-input"
                                        style={{ marginTop: 8 }}
                                        value={customTeam}
                                        onChange={e => setCustomTeam(e.target.value)}
                                        placeholder="Enter custom team name"
                                    />
                                )}
                            </div>
                        </div>
                        <div className="form-row-3">
                            <div className="form-group">
                                <label className="form-label">Type</label>
                                <select className="form-select" value={form.type || ResourceType.PERMANENT} onChange={e => set('type', e.target.value as ResourceType)}>
                                    <option value="Permanent">Permanent</option>
                                    <option value="Contractor">Contractor</option>
                                    <option value="Part-Time">Part-Time</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Capacity %</label>
                                <input className="form-input" type="number" required min={10} max={100} value={form.totalCapacity ?? 100} onChange={e => set('totalCapacity', Number(e.target.value))} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Daily Cost (€)</label>
                                <input className="form-input" type="number" min={0} value={form.dailyRate || ''} onChange={e => set('dailyRate', Number(e.target.value) || undefined)} placeholder="e.g. 500" />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Location</label>
                                <input className="form-input" value={form.location || ''} onChange={e => set('location', e.target.value)} placeholder="City / Remote" />
                            </div>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Email</label>
                            <input className="form-input" type="email" value={form.email || ''} onChange={e => set('email', e.target.value)} placeholder="name@company.com" />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Skills</label>
                            <input
                                className="form-input"
                                value={skillsText}
                                onChange={e => setSkillsText(e.target.value)}
                                placeholder="e.g. React, Planning, Jira, Stakeholder Management"
                            />
                            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>Comma-separated skills</div>
                        </div>
                        <div className="modal-footer" style={{ marginTop: 20 }}>
                            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
                            <button type="submit" className="btn btn-primary" disabled={!form.name?.trim()}>
                                {isEditing ? 'Save Changes' : '+ Add Resource'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
};

/* ── Add/Edit Project Modal ─────────────────────────────────── */
interface ProjectModalProps {
    initial?: Project;
    onSave: (p: Partial<Project>) => void;
    onBulkSave?: (ps: Partial<Project>[]) => void;
    onClose: () => void;
}

export const ProjectModal: React.FC<ProjectModalProps> = ({ initial, onSave, onBulkSave, onClose }) => {
    const isEditing = !!initial?.id;
    const [form, setForm] = useState<Partial<Project>>({
        name: '', description: '', status: ProjectStatus.PLANNING, priority: 'Medium',
        startDate: '', endDate: '', clientName: '', budget: undefined, color: '#6366f1',
        ...(initial || {}),
    });
    const [csvMode, setCsvMode] = useState(false);
    const [csvError, setCsvError] = useState('');

    const set = (k: keyof Project, v: any) => setForm(f => ({ ...f, [k]: v }));

    const handleProjectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            const text = evt.target?.result as string;
            if (!text) return;
            const lines = text.split('\n').filter(l => l.trim().length > 0);
            if (lines.length < 2) {
                setCsvError('File appears to be empty or missing data rows.');
                return;
            }

            const parsed: Partial<Project>[] = [];
            for (let i = 1; i < lines.length; i++) {
                const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
                if (cols.length >= 1 && cols[0]) {
                    parsed.push({
                        name: cols[0],
                        description: cols[1] || '',
                        status: (cols[2] as ProjectStatus) || ProjectStatus.PLANNING,
                        priority: (cols[3] as any) || 'Medium',
                        startDate: cols[4] || '',
                        endDate: cols[5] || '',
                        clientName: cols[6] || '',
                        budget: cols[7] ? parseFloat(cols[7]) : undefined,
                        color: cols[8] || '#6366f1'
                    });
                }
            }
            if (onBulkSave) onBulkSave(parsed);
        };
        reader.readAsText(file);
    };

    const downloadProjectTemplate = () => {
        const header = "Name,Description,Status,Priority,StartDate,EndDate,Tribe/Client,Budget,Color\n";
        const example = "Website Redesign,Revamp corporate site,Planning,High,2024-01-01,2024-06-01,Marketing,50000,#ec4899\n";
        const blob = new Blob([header + example], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'project_template.csv';
        a.click();
    };

    const COLORS = ['#6366f1', '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#ef4444', '#14b8a6'];

    return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="modal-box">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                    <div className="modal-title" style={{ marginBottom: 0 }}>{isEditing ? 'Edit Project' : 'Add New Project'}</div>
                    {!isEditing && onBulkSave && (
                        <button type="button" onClick={() => setCsvMode(!csvMode)} style={{ background: 'none', border: '1px solid #cbd5e1', borderRadius: 8, padding: '4px 12px', fontSize: 13, cursor: 'pointer', color: '#475569', fontWeight: 600 }}>
                            {csvMode ? 'Manual Entry' : 'Bulk Upload CSV'}
                        </button>
                    )}
                </div>

                {csvMode ? (
                    <div style={{ padding: 20, textAlign: 'center', background: '#f8fafc', borderRadius: 12, border: '2px dashed #cbd5e1' }}>
                        <span style={{ fontSize: 32, display: 'block', marginBottom: 12 }}>📥</span>
                        <h4 style={{ margin: '0 0 8px 0', color: '#1e293b' }}>Upload projects via CSV</h4>
                        <p style={{ margin: '0 0 16px 0', fontSize: 13, color: '#64748b' }}>Upload a file matching the required template format.</p>

                        {csvError && <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 16 }}>{csvError}</div>}

                        <input type="file" accept=".csv" onChange={handleProjectFile} style={{ display: 'block', margin: '0 auto 16px auto', fontSize: 13 }} />

                        <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 16 }}>
                            <button type="button" onClick={downloadProjectTemplate} style={{ background: 'none', border: 'none', color: '#6366f1', fontSize: 13, cursor: 'pointer', fontWeight: 600, textDecoration: 'underline' }}>
                                Download .csv template
                            </button>
                        </div>
                    </div>
                ) : (
                    <form
                        className="modal-body-scroll"
                        onSubmit={e => {
                            e.preventDefault();
                            if (form.name?.trim()) onSave(form);
                        }}
                    >
                        <div className="form-group">
                            <label className="form-label">Project Name *</label>
                            <input className="form-input" required value={form.name || ''} onChange={e => set('name', e.target.value)} placeholder="e.g. Project Apollo" />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Description</label>
                            <textarea className="form-textarea" rows={2} value={form.description || ''} onChange={e => set('description', e.target.value)} placeholder="Brief project description..." />
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label className="form-label">Status</label>
                                <select className="form-select" value={form.status || ProjectStatus.PLANNING} onChange={e => set('status', e.target.value as ProjectStatus)}>
                                    <option value="Active">Active</option>
                                    <option value="Planning">Planning</option>
                                    <option value="On Hold">On Hold</option>
                                    <option value="Completed">Completed</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Priority</label>
                                <select className="form-select" value={form.priority || 'Medium'} onChange={e => set('priority', e.target.value)}>
                                    <option value="Critical">Critical</option>
                                    <option value="High">High</option>
                                    <option value="Medium">Medium</option>
                                    <option value="Low">Low</option>
                                </select>
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label className="form-label">Start Date</label>
                                <input className="form-input" type="date" value={form.startDate || ''} onChange={e => set('startDate', e.target.value)} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">End Date</label>
                                <input className="form-input" type="date" value={form.endDate || ''} onChange={e => set('endDate', e.target.value)} />
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label className="form-label">Tribe / Client / Owner</label>
                                <input className="form-input" value={form.clientName || ''} onChange={e => set('clientName', e.target.value)} placeholder="e.g. Consumer Tribe" />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Budget ($)</label>
                                <input className="form-input" type="number" min={0} value={form.budget || ''} onChange={e => set('budget', Number(e.target.value) || undefined)} placeholder="e.g. 150000" />
                            </div>
                        </div>
                        <div className="form-group">
                            <label className="form-label" style={{ marginBottom: 8 }}>Project Color Tag</label>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {COLORS.map(c => (
                                    <button key={c} type="button" onClick={() => set('color', c)}
                                        style={{
                                            width: 24, height: 24, borderRadius: '50%', background: c, border: 'none', cursor: 'pointer',
                                            boxShadow: form.color === c ? `0 0 0 2px #fff, 0 0 0 4px ${c}` : 'none',
                                            transform: form.color === c ? 'scale(1.1)' : 'scale(1)',
                                            transition: 'all .15s'
                                        }}
                                    />
                                ))}
                            </div>
                        </div>
                        <div className="modal-footer" style={{ marginTop: 20 }}>
                            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
                            <button type="submit" className="btn btn-primary" disabled={!form.name?.trim()}>
                                {isEditing ? 'Save Changes' : '+ Add Project'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
};

/* ── Confirm Delete Modal ──────────────────────────────────── */
interface ConfirmModalProps {
    title: string;
    message: string;
    onConfirm: () => void;
    onClose: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({ title, message, onConfirm, onClose }) => (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
        <div className="modal-box" style={{ maxWidth: 360 }}>
            <div className="modal-title" style={{ color: '#b91c1c' }}>⚠️ {title}</div>
            <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.6 }}>{message}</p>
            <div className="modal-footer">
                <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
                <button className="btn btn-danger" onClick={() => { onConfirm(); onClose(); }}>Delete</button>
            </div>
        </div>
    </div>
);
