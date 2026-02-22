
import React, { useState } from 'react';
import { Resource, Project, ResourceType, ProjectStatus } from '../types';

/* ── Add/Edit Resource Modal ─────────────────────────────────── */
interface ResourceModalProps {
    initial?: Resource;
    teams: { id: string; name: string }[];
    onSave: (r: Partial<Resource>) => void;
    onClose: () => void;
}

export const ResourceModal: React.FC<ResourceModalProps> = ({ initial, teams, onSave, onClose }) => {
    const isEditing = !!initial?.id;
    const [form, setForm] = useState<Partial<Resource>>({
        name: '', role: '', department: '', type: ResourceType.PERMANENT, totalCapacity: 100, location: '', email: '',
        ...(initial || {}),
    });

    const set = (k: keyof Resource, v: any) => setForm(f => ({ ...f, [k]: v }));

    return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="modal-box">
                <div className="modal-title">{isEditing ? 'Edit Resource' : 'Add New Resource'}</div>
                <div className="form-row">
                    <div className="form-group">
                        <label className="form-label">Full Name *</label>
                        <input className="form-input" value={form.name || ''} onChange={e => set('name', e.target.value)} placeholder="e.g. Jane Doe" />
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
                        <select className="form-select" value={form.teamId || ''} onChange={e => set('teamId', e.target.value)}>
                            <option value="">None</option>
                            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
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
                        <input className="form-input" type="number" min={10} max={100} value={form.totalCapacity ?? 100} onChange={e => set('totalCapacity', Number(e.target.value))} />
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
                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
                    <button className="btn btn-primary" onClick={() => { if (form.name?.trim()) onSave(form); }}>
                        {isEditing ? 'Save Changes' : '+ Add Resource'}
                    </button>
                </div>
            </div>
        </div>
    );
};

/* ── Add/Edit Project Modal ─────────────────────────────────── */
interface ProjectModalProps {
    initial?: Project;
    onSave: (p: Partial<Project>) => void;
    onClose: () => void;
}

export const ProjectModal: React.FC<ProjectModalProps> = ({ initial, onSave, onClose }) => {
    const isEditing = !!initial?.id;
    const [form, setForm] = useState<Partial<Project>>({
        name: '', description: '', status: ProjectStatus.PLANNING, priority: 'Medium',
        startDate: '', endDate: '', clientName: '', budget: undefined, color: '#6366f1',
        ...(initial || {}),
    });

    const set = (k: keyof Project, v: any) => setForm(f => ({ ...f, [k]: v }));

    const COLORS = ['#6366f1', '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#ef4444', '#14b8a6'];

    return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="modal-box">
                <div className="modal-title">{isEditing ? 'Edit Project' : 'Add New Project'}</div>
                <div className="form-group">
                    <label className="form-label">Project Name *</label>
                    <input className="form-input" value={form.name || ''} onChange={e => set('name', e.target.value)} placeholder="e.g. Project Apollo" />
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
                        <label className="form-label">Client / Owner</label>
                        <input className="form-input" value={form.clientName || ''} onChange={e => set('clientName', e.target.value)} placeholder="Client name" />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Budget ($)</label>
                        <input className="form-input" type="number" value={form.budget ?? ''} onChange={e => set('budget', e.target.value ? Number(e.target.value) : undefined)} placeholder="0" />
                    </div>
                </div>
                <div className="form-group">
                    <label className="form-label">Project Color</label>
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                        {COLORS.map(c => (
                            <button
                                key={c}
                                onClick={() => set('color', c)}
                                style={{ width: 28, height: 28, borderRadius: 8, background: c, border: form.color === c ? '3px solid #334155' : '3px solid transparent', cursor: 'pointer', transition: 'border .15s' }}
                            />
                        ))}
                    </div>
                </div>
                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
                    <button className="btn btn-primary" onClick={() => { if (form.name?.trim()) onSave(form); }}>
                        {isEditing ? 'Save Changes' : '+ Add Project'}
                    </button>
                </div>
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
