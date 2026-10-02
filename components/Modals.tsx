import React, { useState, useEffect, useRef } from 'react';
import { Resource, Project, ResourceType, ProjectStatus, SecondaryCraft, CraftProficiency, CraftDemand } from '../types';
import { PMO_CRAFTS, PROJECT_STAGES } from '../constants';
import { getRollingQuarters } from '../utils/quarters';
import { upsertDemand } from '../utils/craftEngine';

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
    const [isDirty, setIsDirty] = useState(false);
    const modalRef = useRef<HTMLDivElement>(null);
    const [teamMode, setTeamMode] = useState<'preset' | 'custom'>(() => initial?.teamId ? 'preset' : (initial?.teamName ? 'custom' : 'preset'));
    const [customTeam, setCustomTeam] = useState(initial?.teamId ? '' : (initial?.teamName || ''));
    const [skillsText, setSkillsText] = useState((initial?.skills || []).join(', '));
    const [tribeText, setTribeText] = useState((initial?.tribeAffinity || []).join(', '));
    const [secondary, setSecondary] = useState<SecondaryCraft[]>(initial?.secondaryCrafts || []);
    const [csvMode, setCsvMode] = useState(false);
    const [csvError, setCsvError] = useState('');

    const addSecondary = (craftId: string) => {
        if (!craftId || secondary.some(s => s.craftId === craftId) || craftId === form.primaryCraft) return;
        setSecondary(prev => [...prev, { craftId, proficiency: 2, maxPct: 40 }]);
        setIsDirty(true);
    };
    const updateSecondary = (craftId: string, patch: Partial<SecondaryCraft>) => {
        setSecondary(prev => prev.map(s => s.craftId === craftId ? { ...s, ...patch } : s));
        setIsDirty(true);
    };
    const removeSecondary = (craftId: string) => { setSecondary(prev => prev.filter(s => s.craftId !== craftId)); setIsDirty(true); };

    const set = (k: keyof Resource, v: any) => {
        setForm(f => ({ ...f, [k]: v }));
        setIsDirty(true);
    };

    const handleClose = () => {
        if (isDirty && !window.confirm('You have unsaved changes. Are you sure you want to close?')) return;
        onClose();
    };

    useEffect(() => {
        const handleKeys = (e: KeyboardEvent) => {
            if (e.key === 'Escape') handleClose();
            if (e.key === 'Tab') {
                const focusable = modalRef.current?.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') as NodeListOf<HTMLElement>;
                if (!focusable || focusable.length === 0) return;
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        };
        window.addEventListener('keydown', handleKeys);
        modalRef.current?.querySelector('input')?.focus();
        return () => window.removeEventListener('keydown', handleKeys);
    }, [isDirty]);

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
        a.download = `resources_template.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 100);
    };

    return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && handleClose()}>
            <div className="modal-box" ref={modalRef} tabIndex={-1}>
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
                                primaryCraft: form.primaryCraft || undefined,
                                secondaryCrafts: secondary.filter(s => s.craftId !== form.primaryCraft),
                                tribeAffinity: tribeText.split(',').map(t => t.trim()).filter(Boolean),
                                targetUtil: form.targetUtil ? Math.max(10, Math.min(120, Number(form.targetUtil))) : undefined,
                            });
                        }}
                    >
                        <div className="form-row">
                            <div className="form-group">
                                <label className="form-label">Full Name *</label>
                                <input className="form-input" required value={form.name || ''}
                                    onChange={e => set('name', e.target.value)} placeholder="e.g. John Doe" maxLength={100} />
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label className="form-label">Primary Role</label>
                                <input className="form-input" value={form.role || ''}
                                    onChange={e => set('role', e.target.value)} placeholder="e.g. Senior Frontend Dev" maxLength={100} />
                            </div>
                        </div>

                        {/* ── Crafts: above the table / below the table ── */}
                        <div style={{ background: 'var(--n-100)', border: '1px solid var(--n-300)', borderRadius: 8, padding: 12, marginBottom: 14 }}>
                            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--n-800)', marginBottom: 8 }}>🎓 Crafts</div>
                            <div className="form-row">
                                <div className="form-group" style={{ marginBottom: 8 }}>
                                    <label className="form-label">Above the table (primary craft)</label>
                                    <select className="form-select" value={form.primaryCraft || ''} onChange={e => { set('primaryCraft', e.target.value || undefined); setSecondary(prev => prev.filter(s => s.craftId !== e.target.value)); }}>
                                        <option value="">— not set —</option>
                                        {PMO_CRAFTS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                </div>
                                <div className="form-group" style={{ marginBottom: 8 }}>
                                    <label className="form-label">Utilisation target %</label>
                                    <input className="form-input" type="number" min={10} max={120} value={form.targetUtil ?? ''} placeholder="100" onChange={e => set('targetUtil', e.target.value ? Number(e.target.value) : undefined)} />
                                </div>
                            </div>
                            <label className="form-label">Below the table (what else they can serve)</label>
                            {secondary.map(sc => {
                                const c = PMO_CRAFTS.find(x => x.id === sc.craftId);
                                return (
                                    <div key={sc.craftId} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                                        <span style={{ fontSize: 12, fontWeight: 700, color: c?.color || 'var(--n-700)' }}>{c?.name || sc.craftId}</span>
                                        <select className="form-select" style={{ width: 'auto', fontSize: 11, padding: '5px 8px' }} value={sc.proficiency} onChange={e => updateSecondary(sc.craftId, { proficiency: Number(e.target.value) as CraftProficiency })} title="1 = can assist · 2 = can own with support · 3 = can own independently">
                                            <option value={1}>L1 assist</option><option value={2}>L2 own w/ support</option><option value={3}>L3 own</option>
                                        </select>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="Max share of their capacity for this craft">
                                            <input className="form-input" type="number" min={5} max={100} style={{ width: 62, fontSize: 11, padding: '5px 8px' }} value={sc.maxPct ?? 40} onChange={e => updateSecondary(sc.craftId, { maxPct: Math.max(5, Math.min(100, Number(e.target.value) || 40)) })} />
                                            <span style={{ fontSize: 11, color: 'var(--n-500)' }}>% max</span>
                                        </div>
                                        <button type="button" onClick={() => removeSecondary(sc.craftId)} style={{ background: 'none', border: 'none', color: 'var(--over)', cursor: 'pointer', fontSize: 16 }}>×</button>
                                    </div>
                                );
                            })}
                            <select className="form-select" value="" onChange={e => addSecondary(e.target.value)} style={{ fontSize: 12 }}>
                                <option value="">+ add a below-the-table craft…</option>
                                {PMO_CRAFTS.filter(c => c.id !== form.primaryCraft && !secondary.some(s => s.craftId === c.id)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                            <div className="form-group" style={{ marginTop: 10, marginBottom: 0 }}>
                                <label className="form-label">Tribe familiarity</label>
                                <input className="form-input" value={tribeText} onChange={e => { setTribeText(e.target.value); setIsDirty(true); }} placeholder="e.g. Payments, Digital (comma-separated)" />
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
                                        onChange={e => setCustomTeam(e.target.value.substring(0, 50))}
                                        placeholder="Enter custom team name (max 50 chars)"
                                        maxLength={50}
                                        title="Team names are limited to 50 characters"
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
        stage: 'Pipeline', initiatedOn: new Date().toISOString().slice(0, 10), craftDemand: [],
        ...(initial || {}),
    });
    const quarters = getRollingQuarters(new Date(), 4);
    const [demandQuarter, setDemandQuarter] = useState(quarters[0]?.key || '');
    const [demandCraft, setDemandCraft] = useState(PMO_CRAFTS[1].id);
    const [demandFte, setDemandFte] = useState('0.5');
    const addDemand = () => {
        const fte = Math.max(0, Math.min(50, parseFloat(demandFte) || 0));
        if (!demandQuarter || !demandCraft || fte <= 0) return;
        set('craftDemand', upsertDemand(form.craftDemand, { quarterKey: demandQuarter, craftId: demandCraft, fte }));
    };
    const removeDemand = (d: CraftDemand) => set('craftDemand', upsertDemand(form.craftDemand, { ...d, fte: 0 }));
    const [csvMode, setCsvMode] = useState(false);
    const [csvError, setCsvError] = useState('');
    const [isDirty, setIsDirty] = useState(false);
    const modalRef = useRef<HTMLDivElement>(null);

    const set = (k: keyof Project, v: any) => {
        setForm(f => ({ ...f, [k]: v }));
        setIsDirty(true);
    };

    const handleClose = () => {
        if (isDirty && !window.confirm('You have unsaved changes. Are you sure you want to close?')) return;
        onClose();
    };

    useEffect(() => {
        const handleKeys = (e: KeyboardEvent) => {
            if (e.key === 'Escape') handleClose();
            if (e.key === 'Tab') {
                const focusable = modalRef.current?.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') as NodeListOf<HTMLElement>;
                if (!focusable || focusable.length === 0) return;
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        };
        window.addEventListener('keydown', handleKeys);
        modalRef.current?.querySelector('input')?.focus();
        return () => window.removeEventListener('keydown', handleKeys);
    }, [isDirty]);

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
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && handleClose()}>
            <div className="modal-box" ref={modalRef} tabIndex={-1}>
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
                            <input className="form-input" required value={form.name || ''}
                                onChange={e => set('name', e.target.value)} placeholder="e.g. Project Apollo" maxLength={200} />
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
                        <div className="form-row">
                            <div className="form-group">
                                <label className="form-label">Stage</label>
                                <select className="form-select" value={form.stage || 'Pipeline'} onChange={e => set('stage', e.target.value)}>
                                    {PROJECT_STAGES.map(st => <option key={st.id} value={st.id}>{st.id} — {st.hint}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Initiated on</label>
                                <input className="form-input" type="date" value={form.initiatedOn || ''} onChange={e => set('initiatedOn', e.target.value)} />
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label className="form-label">Jira project key</label>
                                <input className="form-input" value={form.jiraKey || ''} onChange={e => set('jiraKey', e.target.value.toUpperCase().trim())} placeholder="e.g. APOLLO" maxLength={20} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Planview id</label>
                                <input className="form-input" value={form.planviewId || ''} onChange={e => set('planviewId', e.target.value.trim())} placeholder="e.g. PRJ-00123" maxLength={60} />
                            </div>
                        </div>

                        {/* ── Craft demand per quarter ── */}
                        <div style={{ background: 'var(--n-100)', border: '1px solid var(--n-300)', borderRadius: 8, padding: 12, marginBottom: 14 }}>
                            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--n-800)', marginBottom: 2 }}>📣 Anticipated craft requirements</div>
                            <div style={{ fontSize: 11, color: 'var(--n-600)', marginBottom: 8 }}>FTE needed from the PMO squad per quarter. 1.0 = one full person.</div>
                            {(form.craftDemand || []).length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                                    {(form.craftDemand || []).map(d => {
                                        const q = quarters.find(x => x.key === d.quarterKey);
                                        const c = PMO_CRAFTS.find(x => x.id === d.craftId);
                                        return (
                                            <div key={`${d.quarterKey}-${d.craftId}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, background: '#fff', border: '1px solid var(--n-300)', borderRadius: 6, padding: '4px 8px' }}>
                                                <span style={{ fontWeight: 800, color: 'var(--n-700)', minWidth: 110 }}>{q ? `${q.label} · ${q.name}` : d.quarterKey}</span>
                                                <span style={{ flex: 1, color: c?.color || 'var(--n-700)', fontWeight: 700 }}>{c?.name || d.craftId}</span>
                                                <span style={{ fontWeight: 800 }}>{d.fte} FTE</span>
                                                <button type="button" onClick={() => removeDemand(d)} style={{ background: 'none', border: 'none', color: 'var(--over)', cursor: 'pointer', fontSize: 15 }}>×</button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr 70px auto', gap: 6, alignItems: 'center' }}>
                                <select className="form-select" style={{ fontSize: 11, padding: '5px 8px' }} value={demandQuarter} onChange={e => setDemandQuarter(e.target.value)}>
                                    {quarters.map(q => <option key={q.key} value={q.key}>{q.label} · {q.name}</option>)}
                                </select>
                                <select className="form-select" style={{ fontSize: 11, padding: '5px 8px' }} value={demandCraft} onChange={e => setDemandCraft(e.target.value)}>
                                    {PMO_CRAFTS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                                <input className="form-input" type="number" step="0.1" min={0} max={50} style={{ fontSize: 11, padding: '5px 8px' }} value={demandFte} onChange={e => setDemandFte(e.target.value)} />
                                <button type="button" className="btn btn-secondary" style={{ padding: '5px 10px', fontSize: 12 }} onClick={addDemand}>+ Add</button>
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

export const ConfirmModal: React.FC<ConfirmModalProps> = ({ title, message, onConfirm, onClose }) => {
    const modalRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleKeys = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'Tab') {
                const focusable = modalRef.current?.querySelectorAll('button, [tabindex]:not([tabindex="-1"])') as NodeListOf<HTMLElement>;
                if (!focusable || focusable.length === 0) return;
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        };
        window.addEventListener('keydown', handleKeys);
        modalRef.current?.querySelector('button')?.focus();
        return () => window.removeEventListener('keydown', handleKeys);
    }, []);

    return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="modal-box" style={{ maxWidth: 360 }} ref={modalRef} tabIndex={-1}>
                <div className="modal-title" style={{ color: '#b91c1c' }}>⚠️ {title}</div>
                <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.6 }}>{message}</p>
                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
                    <button className="btn btn-danger" onClick={() => { onConfirm(); onClose(); }}>Delete</button>
                </div>
            </div>
        </div>
    );
};
