import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Allocation, Project, ProjectStatus, Resource } from '../../types';
import { Quarter } from '../../utils/quarters';
import { allocationPctInQuarter } from '../../utils/craftEngine';
import { tribesFromProjects } from '../crafts/shared';

/* ── API shapes (mirrors netlify/functions/integrations.ts) ───── */
interface Calibration { pointsPerSprintPerFte: number; sprintLengthDays: number }
interface IntegrationConfig {
    jira: { configured: boolean; domain: string; email: string; projectKeys: string[]; boardIds: number[]; storyPointsFieldId?: string; hasSecret: boolean };
    planview: { configured: boolean; flavour: 'adaptivework' | 'generic'; baseUrl: string; username?: string; hasSecret: boolean; generic?: { projectsPath: string; assignmentsPath: string; authHeaderName?: string; fieldMap: Record<string, string> } };
    settings: { calibration: Record<string, Calibration>; mappings: { jira: Record<string, string>; planview: Record<string, string> } };
}
interface JiraUsage {
    storyPointsFieldId: string; issueCount: number; totalPoints: number; donePoints: number;
    byAssignee: { accountId: string; displayName: string; email?: string; points: number; donePoints: number; issues: number }[];
    byProject: { key: string; name: string; tribe: string; points: number; donePoints: number; issues: number }[];
    bySprint: { sprintId: number; sprintName: string; state: string; startDate?: string; endDate?: string; points: number; donePoints: number; issues: number; byAssignee: Record<string, number> }[];
    byQuarter: { quarterKey: string; points: number; donePoints: number; issues: number }[];
    fteEstimate: { byProject: Record<string, number>; bySprint: Record<string, number> };
}
interface PvProject { externalId: string; name: string; status?: string; startDate?: string; endDate?: string; manager?: string }
interface PvAssignment { externalId: string; projectExternalId: string; resourceName: string; resourceEmail?: string; role?: string; startDate?: string; endDate?: string; percent?: number | null; hours?: number }

interface Props {
    token: string;
    wsId: string;
    canWrite: boolean;
    resources: Resource[];
    projects: Project[];
    allocations: Allocation[];
    quarters: Quarter[];
    onImportProjects: (projects: Project[]) => void;
    onImportAllocations: (allocations: Allocation[]) => void;
    onLinkProject: (projectId: string, link: { jiraKey?: string; planviewId?: string }) => void;
}

const EMPTY: IntegrationConfig = {
    jira: { configured: false, domain: '', email: '', projectKeys: [], boardIds: [], hasSecret: false },
    planview: { configured: false, flavour: 'generic', baseUrl: '', hasSecret: false },
    settings: { calibration: { '*': { pointsPerSprintPerFte: 10, sprintLengthDays: 14 } }, mappings: { jira: {}, planview: {} } },
};

type Tab = 'jira' | 'planview' | 'calibration';

export const IntegrationsHub: React.FC<Props> = ({ token, wsId, canWrite, resources, projects, allocations, quarters, onImportProjects, onImportAllocations, onLinkProject }) => {
    const [tab, setTab] = useState<Tab>('jira');
    const [cfg, setCfg] = useState<IntegrationConfig>(EMPTY);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    // Jira form
    const [jDomain, setJDomain] = useState('');
    const [jEmail, setJEmail] = useState('');
    const [jToken, setJToken] = useState('');
    const [jiraProjects, setJiraProjects] = useState<{ key: string; name: string }[]>([]);
    const [usage, setUsage] = useState<JiraUsage | null>(null);
    const [usageFrom, setUsageFrom] = useState(quarters[0]?.start.toISOString().slice(0, 10) || '');
    const [usageTo, setUsageTo] = useState(quarters[0]?.end.toISOString().slice(0, 10) || '');

    // Planview form
    const [pFlavour, setPFlavour] = useState<'adaptivework' | 'generic'>('generic');
    const [pBase, setPBase] = useState('');
    const [pUser, setPUser] = useState('');
    const [pSecret, setPSecret] = useState('');
    const [pProjectsPath, setPProjectsPath] = useState('/odata/Projects');
    const [pAssignPath, setPAssignPath] = useState('/odata/Assignments');
    const [pAuthHeader, setPAuthHeader] = useState('');
    const [pFieldMap, setPFieldMap] = useState('{\n  "externalId": "Id",\n  "name": "Name",\n  "status": "Status",\n  "startDate": "StartDate",\n  "endDate": "EndDate",\n  "projectExternalId": "ProjectId",\n  "resourceName": "ResourceName",\n  "resourceEmail": "ResourceEmail",\n  "percent": "AllocationPercent"\n}');
    const [pvProjects, setPvProjects] = useState<PvProject[]>([]);
    const [pvAssignments, setPvAssignments] = useState<Record<string, PvAssignment[]>>({});

    const api = useCallback(async (path: string, init?: RequestInit) => {
        const sep = path.includes('?') ? '&' : '?';
        const res = await fetch(`/api/integrations${path}${sep}wsId=${encodeURIComponent(wsId)}`, {
            ...init,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers || {}) },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
        return data;
    }, [token, wsId]);

    const applyConfig = (c: IntegrationConfig) => {
        setCfg(c);
        setJDomain(c.jira.domain || ''); setJEmail(c.jira.email || '');
        setPFlavour(c.planview.flavour || 'generic'); setPBase(c.planview.baseUrl || ''); setPUser(c.planview.username || '');
        if (c.planview.generic) {
            setPProjectsPath(c.planview.generic.projectsPath || '');
            setPAssignPath(c.planview.generic.assignmentsPath || '');
            setPAuthHeader(c.planview.generic.authHeaderName || '');
            if (c.planview.generic.fieldMap && Object.keys(c.planview.generic.fieldMap).length) setPFieldMap(JSON.stringify(c.planview.generic.fieldMap, null, 2));
        }
    };

    useEffect(() => {
        let alive = true;
        setLoading(true);
        api('/config').then(c => { if (alive) applyConfig(c); }).catch(e => alive && setError(e.message)).finally(() => alive && setLoading(false));
        return () => { alive = false; };
    }, [api]);

    const run = async (label: string, fn: () => Promise<void>) => {
        setBusy(label); setError(''); setNotice('');
        try { await fn(); } catch (e: any) { setError(e.message || String(e)); } finally { setBusy(null); }
    };

    const saveSettings = (settings: Partial<IntegrationConfig['settings']>) => run('settings', async () => {
        const c = await api('/config', { method: 'POST', body: JSON.stringify({ settings: { ...cfg.settings, ...settings } }) });
        applyConfig(c); setNotice('Settings saved.');
    });

    /* ── Jira handlers ── */
    const saveJira = () => run('jira-save', async () => {
        const body: any = { jira: { domain: jDomain, email: jEmail } };
        if (jToken) body.jira.apiToken = jToken;
        const c = await api('/config', { method: 'POST', body: JSON.stringify(body) });
        applyConfig(c); setJToken(''); setNotice('Jira connection saved (token encrypted at rest).');
    });
    const testJira = () => run('jira-test', async () => {
        const r = await api('/jira/test', { method: 'POST', body: '{}' });
        setNotice(`Connected as ${r.displayName}. Story points field: ${r.storyPointsFieldId || 'not found'}; sprint field: ${r.sprintFieldId || 'not found'}.`);
        const c = await api('/config'); applyConfig(c);
    });
    const loadJiraProjects = () => run('jira-projects', async () => {
        const r = await api('/jira/projects'); setJiraProjects(r.projects || []);
    });
    const toggleJiraProject = (key: string) => run('jira-keys', async () => {
        const keys = cfg.jira.projectKeys.includes(key) ? cfg.jira.projectKeys.filter(k => k !== key) : [...cfg.jira.projectKeys, key];
        const c = await api('/config', { method: 'POST', body: JSON.stringify({ jira: { domain: cfg.jira.domain, email: cfg.jira.email, projectKeys: keys } }) });
        applyConfig(c);
    });
    const pullUsage = () => run('jira-usage', async () => {
        const tribeByProjectKey: Record<string, string> = {};
        for (const [jiraKey, pid] of Object.entries(cfg.settings.mappings.jira)) {
            const p = projects.find(x => x.id === pid);
            if (p?.clientName) tribeByProjectKey[jiraKey] = p.clientName;
        }
        projects.forEach(p => { if (p.jiraKey && p.clientName) tribeByProjectKey[p.jiraKey] = p.clientName; });
        const keys = Array.from(new Set([...cfg.jira.projectKeys, ...projects.map(p => p.jiraKey).filter(Boolean) as string[]]));
        if (!keys.length) throw new Error('Select at least one Jira project (or set a Jira key on a planner project) first.');
        const r = await api('/jira/usage', { method: 'POST', body: JSON.stringify({ projectKeys: keys, from: usageFrom, to: usageTo, tribeByProjectKey }) });
        setUsage(r);
        setNotice(`Pulled ${r.issueCount} issues · ${r.totalPoints} story points.`);
    });
    const mapJira = (jiraKey: string, projectId: string) => {
        const next = { ...cfg.settings.mappings.jira };
        if (projectId) next[jiraKey] = projectId; else delete next[jiraKey];
        saveSettings({ mappings: { ...cfg.settings.mappings, jira: next } });
        if (projectId) onLinkProject(projectId, { jiraKey });
    };

    /* ── Planview handlers ── */
    const savePlanview = () => run('pv-save', async () => {
        let fieldMap: Record<string, string> = {};
        if (pFlavour === 'generic') {
            try { fieldMap = JSON.parse(pFieldMap); } catch { throw new Error('Field map must be valid JSON.'); }
        }
        const body: any = { planview: { flavour: pFlavour, baseUrl: pBase, username: pUser || undefined } };
        if (pSecret) body.planview.secret = pSecret;
        if (pFlavour === 'generic') body.planview.generic = { projectsPath: pProjectsPath, assignmentsPath: pAssignPath, authHeaderName: pAuthHeader || undefined, fieldMap };
        const c = await api('/config', { method: 'POST', body: JSON.stringify(body) });
        applyConfig(c); setPSecret(''); setNotice('Planview connection saved (secret encrypted at rest).');
    });
    const testPlanview = () => run('pv-test', async () => {
        const r = await api('/planview/test', { method: 'POST', body: '{}' });
        setNotice(`Planview reachable (${r.flavour}${r.projectCount != null ? `, ${r.projectCount} projects` : ''}).`);
    });
    const loadPvProjects = () => run('pv-projects', async () => {
        const r = await api('/planview/projects'); setPvProjects(r.projects || []);
    });
    const loadPvAssignments = (externalId: string) => run(`pv-assign-${externalId}`, async () => {
        const r = await api(`/planview/assignments?projectId=${encodeURIComponent(externalId)}`);
        setPvAssignments(prev => ({ ...prev, [externalId]: r.assignments || [] }));
    });
    const mapPlanview = (externalId: string, projectId: string) => {
        const next = { ...cfg.settings.mappings.planview };
        if (projectId) next[externalId] = projectId; else delete next[externalId];
        saveSettings({ mappings: { ...cfg.settings.mappings, planview: next } });
        if (projectId) onLinkProject(projectId, { planviewId: externalId });
    };
    const importPvProject = (pv: PvProject) => {
        const id = `p-${crypto.randomUUID()}`;
        onImportProjects([{
            id, name: pv.name, status: /active|in progress|execut/i.test(pv.status || '') ? ProjectStatus.ACTIVE : ProjectStatus.PLANNING,
            priority: 'Medium', description: `Imported from Planview (${pv.externalId})${pv.manager ? ` · PM: ${pv.manager}` : ''}`,
            startDate: pv.startDate?.slice(0, 10), endDate: pv.endDate?.slice(0, 10), planviewId: pv.externalId, stage: 'Initiated', initiatedOn: new Date().toISOString().slice(0, 10), craftDemand: [], color: '#0ea5e9',
        }]);
        mapPlanview(pv.externalId, id);
    };
    const importPvAssignments = (externalId: string) => {
        const projectId = cfg.settings.mappings.planview[externalId] || projects.find(p => p.planviewId === externalId)?.id;
        if (!projectId) { setError('Map this Planview project to a planner project first.'); return; }
        const rows = pvAssignments[externalId] || [];
        const matched: Allocation[] = [];
        const unmatched: string[] = [];
        rows.forEach(a => {
            const r = resources.find(x => (a.resourceEmail && x.email && x.email.toLowerCase() === a.resourceEmail.toLowerCase()) || x.name.toLowerCase() === a.resourceName.toLowerCase());
            if (!r) { unmatched.push(a.resourceName); return; }
            const pct = a.percent != null ? Math.round(a.percent) : a.hours ? Math.min(100, Math.round((a.hours / 8 / 65) * 100)) : 0; // hours ≈ 65 working days per quarter
            if (pct <= 0) return;
            matched.push({ id: `a-${crypto.randomUUID()}`, resourceId: r.id, projectId, percentage: pct, startDate: a.startDate?.slice(0, 10), endDate: a.endDate?.slice(0, 10), craftId: r.primaryCraft, source: 'planview', notes: `Planview ${a.externalId}` });
        });
        if (matched.length) onImportAllocations(matched);
        setNotice(`Imported ${matched.length} allocation${matched.length === 1 ? '' : 's'}.${unmatched.length ? ` Not matched to a resource: ${unmatched.join(', ')}.` : ''}`);
    };

    /* ── Derived: delivery signal (planned vs Jira-implied FTE) ── */
    const signal = useMemo(() => {
        if (!usage || !quarters[0]) return [];
        const q = quarters[0];
        return usage.byProject.map(bp => {
            const pid = cfg.settings.mappings.jira[bp.key] || projects.find(p => p.jiraKey === bp.key)?.id;
            const p = projects.find(x => x.id === pid);
            const planned = p ? allocations.filter(a => a.projectId === p.id).reduce((s, a) => s + allocationPctInQuarter(a, q, p), 0) / 100 : 0;
            const implied = usage.fteEstimate.byProject[bp.key] ?? 0;
            return { ...bp, planner: p, plannedFte: Math.round(planned * 100) / 100, impliedFte: implied, delta: Math.round((implied - planned) * 100) / 100 };
        });
    }, [usage, cfg, projects, allocations, quarters]);

    const tribes = tribesFromProjects(projects);
    const cal = cfg.settings.calibration;

    const field = (label: string, el: React.ReactNode, hint?: string) => (
        <div className="form-group">
            <label className="form-label">{label}</label>
            {el}
            {hint && <div style={{ fontSize: 11, color: 'var(--n-500)', marginTop: 4 }}>{hint}</div>}
        </div>
    );

    if (loading) return <div style={{ padding: 40, color: 'var(--n-600)' }}>Loading integration settings…</div>;

    return (
        <div className="page-enter" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'flex', gap: 4, background: '#fff', border: '1px solid var(--n-300)', borderRadius: 999, padding: 3, alignSelf: 'flex-start' }}>
                {([['jira', 'Jira Cloud', cfg.jira.configured], ['planview', 'Planview', cfg.planview.configured], ['calibration', 'Calibration & mapping', true]] as [Tab, string, boolean][]).map(([id, label, ok]) => (
                    <button key={id} onClick={() => setTab(id)} style={{ padding: '7px 16px', borderRadius: 999, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12, background: tab === id ? 'var(--brand-500)' : 'transparent', color: tab === id ? '#fff' : 'var(--n-700)' }}>
                        {label} <span style={{ opacity: .7 }}>{ok ? '●' : '○'}</span>
                    </button>
                ))}
            </div>

            {error && <div style={{ background: 'var(--over-bg)', border: '1px solid var(--over)', color: '#BF2600', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>⚠️ {error}</div>}
            {notice && <div style={{ background: 'var(--optimal-bg)', border: '1px solid var(--optimal)', color: '#006644', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>✓ {notice}</div>}
            {!canWrite && <div style={{ fontSize: 12, color: 'var(--n-600)' }}>You can view integration data; saving connection details needs workspace admin rights.</div>}

            {/* ═══════════ JIRA ═══════════ */}
            {tab === 'jira' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 420px) 1fr', gap: 20, alignItems: 'start' }}>
                    <div className="panel">
                        <div className="panel-header"><div><div className="panel-title">Jira Cloud connection</div><div className="panel-subtitle">API token is stored encrypted on the server, never in the browser.</div></div></div>
                        <div className="panel-body">
                            {field('Site domain', <input className="form-input" value={jDomain} onChange={e => setJDomain(e.target.value)} placeholder="yourcompany.atlassian.net" disabled={!canWrite} />)}
                            {field('Account email', <input className="form-input" value={jEmail} onChange={e => setJEmail(e.target.value)} placeholder="you@company.com" disabled={!canWrite} />)}
                            {field('API token', <input className="form-input" type="password" value={jToken} onChange={e => setJToken(e.target.value)} placeholder={cfg.jira.hasSecret ? '•••••••• (saved — leave blank to keep)' : 'Paste an Atlassian API token'} disabled={!canWrite} />, 'Create one at id.atlassian.com → Security → API tokens.')}
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <button className="btn btn-primary" disabled={!canWrite || !!busy || !jDomain || !jEmail} onClick={saveJira}>{busy === 'jira-save' ? 'Saving…' : 'Save'}</button>
                                <button className="btn btn-secondary" disabled={!!busy || !cfg.jira.hasSecret} onClick={testJira}>{busy === 'jira-test' ? 'Testing…' : 'Test connection'}</button>
                                <button className="btn btn-secondary" disabled={!!busy || !cfg.jira.hasSecret} onClick={loadJiraProjects}>{busy === 'jira-projects' ? 'Loading…' : 'List projects'}</button>
                            </div>
                            {cfg.jira.storyPointsFieldId && <div style={{ fontSize: 11, color: 'var(--n-500)', marginTop: 10 }}>Story points field: <code>{cfg.jira.storyPointsFieldId}</code></div>}
                            {jiraProjects.length > 0 && (
                                <div style={{ marginTop: 14 }}>
                                    <div className="form-label">Track these projects</div>
                                    <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--n-300)', borderRadius: 6 }}>
                                        {jiraProjects.map(jp => (
                                            <label key={jp.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 12, borderBottom: '1px solid var(--n-200)', cursor: 'pointer' }}>
                                                <input type="checkbox" checked={cfg.jira.projectKeys.includes(jp.key)} onChange={() => toggleJiraProject(jp.key)} disabled={!canWrite || !!busy} />
                                                <b>{jp.key}</b> <span style={{ color: 'var(--n-600)' }}>{jp.name}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                        <div className="panel">
                            <div className="panel-header" style={{ flexWrap: 'wrap' }}>
                                <div style={{ flex: '1 1 260px' }}><div className="panel-title">Story-point usage</div><div className="panel-subtitle">Pull points per project, sprint and assignee, converted to FTE with the per-tribe calibration.</div></div>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                    <input className="form-input" type="date" style={{ width: 140 }} value={usageFrom} onChange={e => setUsageFrom(e.target.value)} />
                                    <span style={{ color: 'var(--n-500)' }}>→</span>
                                    <input className="form-input" type="date" style={{ width: 140 }} value={usageTo} onChange={e => setUsageTo(e.target.value)} />
                                    <button className="btn btn-primary" disabled={!!busy || !cfg.jira.hasSecret} onClick={pullUsage}>{busy === 'jira-usage' ? 'Pulling…' : 'Pull usage'}</button>
                                </div>
                            </div>
                            {!usage && <div className="empty-state"><h3>No usage pulled yet</h3><p>Connect Jira, tick the projects to track, then pull a date range (defaults to {quarters[0]?.label}).</p></div>}
                            {usage && (
                                <>
                                    <div style={{ overflowX: 'auto' }}>
                                        <table className="data-table">
                                            <thead><tr><th>Jira project</th><th>Planner project</th><th>Tribe</th><th>Issues</th><th>Points</th><th>Done</th><th>Implied FTE</th><th>Planned FTE ({quarters[0]?.label})</th><th>Signal</th></tr></thead>
                                            <tbody>
                                                {signal.map(s => (
                                                    <tr key={s.key}>
                                                        <td><b>{s.key}</b> <span style={{ color: 'var(--n-500)', fontSize: 11 }}>{s.name}</span></td>
                                                        <td>
                                                            <select className="form-select" style={{ fontSize: 11, padding: '4px 8px', width: 'auto' }} value={s.planner?.id || ''} onChange={e => mapJira(s.key, e.target.value)} disabled={!canWrite}>
                                                                <option value="">— map to —</option>
                                                                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                                            </select>
                                                        </td>
                                                        <td style={{ fontSize: 12 }}>{s.planner?.clientName || <span style={{ color: 'var(--n-400)' }}>default</span>}</td>
                                                        <td>{s.issues}</td>
                                                        <td style={{ fontWeight: 700 }}>{s.points}</td>
                                                        <td>{s.donePoints}</td>
                                                        <td style={{ fontWeight: 700 }}>{s.impliedFte.toFixed(2)}</td>
                                                        <td>{s.planner ? s.plannedFte.toFixed(2) : '—'}</td>
                                                        <td>
                                                            {!s.planner ? <span className="badge badge-under">unmapped</span>
                                                                : Math.abs(s.delta) < 0.15 ? <span className="badge badge-optimal">in line</span>
                                                                    : s.delta > 0 ? <span className="badge badge-over" title="Jira implies more effort than the PMO has allocated">under-allocated {s.delta.toFixed(1)}</span>
                                                                        : <span className="badge badge-high-util" title="PMO allocation exceeds what Jira throughput implies">over-allocated {Math.abs(s.delta).toFixed(1)}</span>}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, padding: 16, borderTop: '1px solid var(--n-200)' }}>
                                        <div>
                                            <div className="form-label">By sprint</div>
                                            <table className="data-table">
                                                <thead><tr><th>Sprint</th><th>State</th><th>Points</th><th>Done</th><th>FTE</th></tr></thead>
                                                <tbody>{usage.bySprint.map(s => <tr key={s.sprintId}><td style={{ fontSize: 12 }}>{s.sprintName}<div style={{ fontSize: 10, color: 'var(--n-500)' }}>{s.startDate?.slice(0, 10)} → {s.endDate?.slice(0, 10)}</div></td><td><span className={`badge ${s.state === 'active' ? 'badge-active' : s.state === 'closed' ? 'badge-completed' : 'badge-planning'}`}>{s.state}</span></td><td>{s.points}</td><td>{s.donePoints}</td><td style={{ fontWeight: 700 }}>{(usage.fteEstimate.bySprint[String(s.sprintId)] ?? 0).toFixed(2)}</td></tr>)}</tbody>
                                            </table>
                                        </div>
                                        <div>
                                            <div className="form-label">By assignee</div>
                                            <table className="data-table">
                                                <thead><tr><th>Person</th><th>In planner</th><th>Issues</th><th>Points</th></tr></thead>
                                                <tbody>{usage.byAssignee.map(a => {
                                                    const r = resources.find(x => (a.email && x.email?.toLowerCase() === a.email.toLowerCase()) || x.name.toLowerCase() === a.displayName.toLowerCase());
                                                    return <tr key={a.accountId}><td style={{ fontSize: 12 }}>{a.displayName}</td><td>{r ? <span className="badge badge-optimal">{r.name.split(' ')[0]}</span> : <span className="badge badge-under">no</span>}</td><td>{a.issues}</td><td style={{ fontWeight: 700 }}>{a.points}</td></tr>;
                                                })}</tbody>
                                            </table>
                                        </div>
                                    </div>
                                    <div style={{ padding: '0 16px 16px', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                                        {usage.byQuarter.map(q => <span key={q.quarterKey} className="badge badge-planning">{q.quarterKey}: {q.points} pts / {q.issues} issues</span>)}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ═══════════ PLANVIEW ═══════════ */}
            {tab === 'planview' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 440px) 1fr', gap: 20, alignItems: 'start' }}>
                    <div className="panel">
                        <div className="panel-header"><div><div className="panel-title">Planview connection</div><div className="panel-subtitle">AdaptiveWork (Clarizen) is supported natively. Planview Portfolios or any other REST/OData feed uses the generic adapter with a field map.</div></div></div>
                        <div className="panel-body">
                            {field('Flavour', <select className="form-select" value={pFlavour} onChange={e => setPFlavour(e.target.value as any)} disabled={!canWrite}><option value="adaptivework">Planview AdaptiveWork (Clarizen REST v2)</option><option value="generic">Generic REST / OData (Planview Portfolios, PPM Pro…)</option></select>)}
                            {field('Base URL', <input className="form-input" value={pBase} onChange={e => setPBase(e.target.value)} placeholder={pFlavour === 'adaptivework' ? 'https://api2.clarizen.com' : 'https://planview.company.com'} disabled={!canWrite} />)}
                            {pFlavour === 'adaptivework' && field('Username', <input className="form-input" value={pUser} onChange={e => setPUser(e.target.value)} disabled={!canWrite} />)}
                            {field(pFlavour === 'adaptivework' ? 'Password' : 'API token', <input className="form-input" type="password" value={pSecret} onChange={e => setPSecret(e.target.value)} placeholder={cfg.planview.hasSecret ? '•••••••• (saved — leave blank to keep)' : ''} disabled={!canWrite} />)}
                            {pFlavour === 'generic' && (
                                <>
                                    <div className="form-row">
                                        {field('Projects path', <input className="form-input" value={pProjectsPath} onChange={e => setPProjectsPath(e.target.value)} disabled={!canWrite} />)}
                                        {field('Assignments path', <input className="form-input" value={pAssignPath} onChange={e => setPAssignPath(e.target.value)} disabled={!canWrite} />, '?projectId= is appended')}
                                    </div>
                                    {field('Auth header name', <input className="form-input" value={pAuthHeader} onChange={e => setPAuthHeader(e.target.value)} placeholder="Authorization (Bearer) — or e.g. X-Api-Key" disabled={!canWrite} />)}
                                    {field('Field map (JSON)', <textarea className="form-textarea" rows={9} style={{ fontFamily: 'monospace', fontSize: 11 }} value={pFieldMap} onChange={e => setPFieldMap(e.target.value)} disabled={!canWrite} />, 'Left side = planner field, right side = dotted path in the feed row.')}
                                </>
                            )}
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <button className="btn btn-primary" disabled={!canWrite || !!busy || !pBase} onClick={savePlanview}>{busy === 'pv-save' ? 'Saving…' : 'Save'}</button>
                                <button className="btn btn-secondary" disabled={!!busy || !cfg.planview.hasSecret} onClick={testPlanview}>{busy === 'pv-test' ? 'Testing…' : 'Test connection'}</button>
                                <button className="btn btn-secondary" disabled={!!busy || !cfg.planview.hasSecret} onClick={loadPvProjects}>{busy === 'pv-projects' ? 'Loading…' : 'Load projects'}</button>
                            </div>
                        </div>
                    </div>
                    <div className="panel">
                        <div className="panel-header"><div><div className="panel-title">Planview projects</div><div className="panel-subtitle">Map to an existing planner project or import. Then pull assignments to seed allocations.</div></div></div>
                        {pvProjects.length === 0 && <div className="empty-state"><h3>Nothing loaded</h3><p>Save and test the connection, then load projects.</p></div>}
                        {pvProjects.length > 0 && (
                            <div style={{ overflowX: 'auto' }}>
                                <table className="data-table">
                                    <thead><tr><th>Planview</th><th>Status</th><th>Dates</th><th>Planner project</th><th>Assignments</th></tr></thead>
                                    <tbody>
                                        {pvProjects.map(pv => {
                                            const mapped = cfg.settings.mappings.planview[pv.externalId] || projects.find(p => p.planviewId === pv.externalId)?.id || '';
                                            const rows = pvAssignments[pv.externalId];
                                            return (
                                                <tr key={pv.externalId}>
                                                    <td><b>{pv.name}</b><div style={{ fontSize: 10, color: 'var(--n-500)' }}>{pv.externalId}{pv.manager ? ` · ${pv.manager}` : ''}</div></td>
                                                    <td style={{ fontSize: 12 }}>{pv.status || '—'}</td>
                                                    <td style={{ fontSize: 11, color: 'var(--n-600)' }}>{pv.startDate?.slice(0, 10) || '?'} → {pv.endDate?.slice(0, 10) || '?'}</td>
                                                    <td>
                                                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                                            <select className="form-select" style={{ fontSize: 11, padding: '4px 8px', width: 'auto' }} value={mapped} onChange={e => mapPlanview(pv.externalId, e.target.value)} disabled={!canWrite}>
                                                                <option value="">— map to —</option>
                                                                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                                            </select>
                                                            {!mapped && canWrite && <button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => importPvProject(pv)}>Import</button>}
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                                            <button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 8px' }} disabled={!!busy} onClick={() => loadPvAssignments(pv.externalId)}>{busy === `pv-assign-${pv.externalId}` ? '…' : rows ? `Reload (${rows.length})` : 'Load'}</button>
                                                            {rows && rows.length > 0 && canWrite && <button className="btn btn-primary" style={{ fontSize: 11, padding: '4px 8px' }} disabled={!mapped} onClick={() => importPvAssignments(pv.externalId)}>Import {rows.length} as allocations</button>}
                                                        </div>
                                                        {rows && rows.length > 0 && (
                                                            <div style={{ fontSize: 10, color: 'var(--n-600)', marginTop: 4 }}>
                                                                {rows.slice(0, 4).map(a => `${a.resourceName} ${a.percent != null ? a.percent + '%' : a.hours ? a.hours + 'h' : ''}`).join(' · ')}{rows.length > 4 ? ` · +${rows.length - 4}` : ''}
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ═══════════ CALIBRATION ═══════════ */}
            {tab === 'calibration' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
                    <div className="panel">
                        <div className="panel-header"><div><div className="panel-title">Story points → capacity, per tribe</div><div className="panel-subtitle">Tribes size differently. Calibrate how many points one full-time person burns per sprint so Jira usage converts to FTE honestly.</div></div></div>
                        <div style={{ overflowX: 'auto' }}>
                            <table className="data-table">
                                <thead><tr><th>Tribe</th><th>Points / sprint / FTE</th><th>Sprint length (days)</th><th>≈ points per quarter per FTE</th></tr></thead>
                                <tbody>
                                    {Array.from(new Set(['*', ...tribes, ...Object.keys(cal)])).map(t => {
                                        const c = cal[t] || cal['*'] || { pointsPerSprintPerFte: 10, sprintLengthDays: 14 };
                                        const isDefault = !cal[t] && t !== '*';
                                        const sprintsPerQuarter = Math.round((91 / Math.max(1, c.sprintLengthDays)) * 10) / 10;
                                        const update = (patch: Partial<Calibration>) => saveSettings({ calibration: { ...cal, [t]: { ...c, ...patch } } });
                                        return (
                                            <tr key={t}>
                                                <td style={{ fontWeight: 700 }}>{t === '*' ? 'Default (all tribes)' : t}{isDefault && <span style={{ fontSize: 10, color: 'var(--n-500)', fontWeight: 400 }}> · inherits default</span>}</td>
                                                <td><input className="form-input" type="number" min={1} step={0.5} style={{ width: 90 }} defaultValue={c.pointsPerSprintPerFte} onBlur={e => { const v = Number(e.target.value); if (v > 0 && v !== c.pointsPerSprintPerFte) update({ pointsPerSprintPerFte: v }); }} disabled={!canWrite} /></td>
                                                <td><input className="form-input" type="number" min={1} style={{ width: 90 }} defaultValue={c.sprintLengthDays} onBlur={e => { const v = Number(e.target.value); if (v > 0 && v !== c.sprintLengthDays) update({ sprintLengthDays: v }); }} disabled={!canWrite} /></td>
                                                <td style={{ color: 'var(--n-600)', fontSize: 12 }}>{Math.round(c.pointsPerSprintPerFte * sprintsPerQuarter)} pts ({sprintsPerQuarter} sprints)</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        <div style={{ padding: 16, fontSize: 12, color: 'var(--n-600)', borderTop: '1px solid var(--n-200)' }}>
                            How to calibrate: take a tribe's last three closed sprints, divide completed points by the number of full-time people on the board. That number is the tribe's points per sprint per FTE. Re-check each QBR.
                        </div>
                    </div>
                    <div className="panel">
                        <div className="panel-header"><div><div className="panel-title">Project links</div><div className="panel-subtitle">Which external records feed each planner project.</div></div></div>
                        <div style={{ overflowX: 'auto' }}>
                            <table className="data-table">
                                <thead><tr><th>Planner project</th><th>Tribe</th><th>Jira key</th><th>Planview id</th></tr></thead>
                                <tbody>
                                    {projects.map(p => {
                                        const jira = p.jiraKey || Object.entries(cfg.settings.mappings.jira).find(([, pid]) => pid === p.id)?.[0];
                                        const pv = p.planviewId || Object.entries(cfg.settings.mappings.planview).find(([, pid]) => pid === p.id)?.[0];
                                        return <tr key={p.id}><td style={{ fontWeight: 600 }}>{p.name}</td><td style={{ fontSize: 12 }}>{p.clientName || '—'}</td><td>{jira ? <span className="badge" style={{ background: '#DEEBFF', color: '#0052CC' }}>{jira}</span> : <span style={{ color: 'var(--n-400)' }}>—</span>}</td><td>{pv ? <span className="badge badge-planning">{pv}</span> : <span style={{ color: 'var(--n-400)' }}>—</span>}</td></tr>;
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
