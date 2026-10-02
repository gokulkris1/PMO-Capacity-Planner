import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    QBRTribe, QBRChapter, QBRCoE, QBRQuarter, QBRSprint,
    QBRMember, QBRProject, QBRBooking, QBRScenario, QBROKR, QBRSquad
} from '../../types';
import { QBRCapacityGrid } from './QBRCapacityGrid';
import { QBRMemberCard } from './QBRMemberCard';

/* ── Colours (light design-system tokens, see index.css) ───────── */
const c = {
    card: '#fff', cardHover: 'var(--n-100)', surface: 'var(--n-200)',
    border: 'var(--n-300)', text: 'var(--n-800)', muted: 'var(--n-600)',
    accent: 'var(--brand-500)', accentBg: 'var(--brand-50)',
    green: 'var(--optimal)', greenBg: 'var(--optimal-bg)',
    red: 'var(--over)', redBg: 'var(--over-bg)',
    // --high (#FFAB00) is too light to read as text on white; use a dark amber for text
    amber: '#974F0C', amberBg: 'var(--high-bg)',
    purple: '#6554C0', purpleBg: '#EAE6FF',
    pink: '#C9357E', pinkBg: '#FFE9F3',
    cyan: '#00A3BF', cyanBg: '#E6FCFF',
};

interface Props {
    token: string;
    wsId: string;
    orgId: string;
}

type QBRView = 'capacity' | 'tribes' | 'okrs' | 'squads' | 'members';

export function QBRPlanner({ token, wsId, orgId }: Props) {
    const [view, setView] = useState<QBRView>('capacity');
    const [tribes, setTribes] = useState<QBRTribe[]>([]);
    const [chapters, setChapters] = useState<QBRChapter[]>([]);
    const [coe, setCoe] = useState<QBRCoE[]>([]);
    const [quarters, setQuarters] = useState<QBRQuarter[]>([]);
    const [selectedQuarter, setSelectedQuarter] = useState<string>('');
    const [members, setMembers] = useState<QBRMember[]>([]);
    const [projects, setProjects] = useState<QBRProject[]>([]);
    const [sprints, setSprints] = useState<QBRSprint[]>([]);
    const [bookings, setBookings] = useState<QBRBooking[]>([]);
    const [okrs, setOkrs] = useState<QBROKR[]>([]);
    const [squads, setSquads] = useState<QBRSquad[]>([]);
    const [scenarios, setScenarios] = useState<QBRScenario[]>([]);
    const [activeScenario, setActiveScenario] = useState<string | null>(null);
    const [scenarioBookings, setScenarioBookings] = useState<QBRBooking[]>([]);
    const [stats, setStats] = useState<any>({});
    const [loading, setLoading] = useState(true);
    const [seeding, setSeeding] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedMember, setSelectedMember] = useState<QBRMember | null>(null);
    const [selectedTribe, setSelectedTribe] = useState<string | null>(null);

    const headers = useMemo<Record<string, string>>(() => ({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
    }), [token]);

    const apiBase = `/api/qbr`;
    const qs = useMemo(() => `wsId=${wsId}&orgId=${orgId}`, [wsId, orgId]);

    /** fetch wrapper: appends workspace query, throws on non-OK responses, parses JSON (empty body → {}). */
    const apiFetch = useCallback(async (path: string, init?: RequestInit): Promise<any> => {
        const url = `${apiBase}${path}${path.includes('?') ? '&' : '?'}${qs}`;
        const r = await fetch(url, { ...init, headers });
        if (!r.ok) {
            let msg = `${r.status} ${r.statusText || 'Request failed'}`;
            try {
                const body = await r.json();
                if (body?.error) msg = typeof body.error === 'string' ? body.error : JSON.stringify(body.error);
            } catch { /* non-JSON body */ }
            throw new Error(msg);
        }
        const text = await r.text();
        return text ? JSON.parse(text) : {};
    }, [headers, qs]);

    const reportError = (context: string, e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`QBR ${context} error`, e);
        setError(`${context}: ${msg}`);
    };

    const fetchOverview = useCallback(async () => {
        try {
            const d = await apiFetch('/overview');
            const list: QBRQuarter[] = d.quarters || [];
            setTribes(d.tribes || []);
            setChapters(d.chapters || []);
            setCoe(d.coe || []);
            setQuarters(list);
            setStats(d.stats || {});
            // Keep the user's selection unless it is empty or no longer exists
            setSelectedQuarter(prev => {
                if (prev && list.some(q => q.id === prev)) return prev;
                if (!list.length) return '';
                const active = list.find(q => q.is_active);
                return active?.id || list[list.length - 1].id;
            });
        } catch (e) { reportError('Overview', e); }
    }, [apiFetch]);

    const fetchQuarterData = useCallback(async (qId: string) => {
        try {
            const [qr, mr, pr, or, sq, sc] = await Promise.all([
                apiFetch(`/quarter/${qId}`),
                apiFetch('/members'),
                apiFetch('/projects'),
                apiFetch('/okrs'),
                apiFetch('/squads'),
                apiFetch(`/scenarios?quarterId=${qId}`),
            ]);
            setSprints(qr.sprints || []);
            setBookings(qr.bookings || []);
            setMembers(mr.members || []);
            setProjects(pr.projects || []);
            setOkrs(or.okrs || []);
            // Attach squad members
            const squadsWithMembers = (sq.squads || []).map((s: any) => ({
                ...s,
                members: (sq.squadMembers || []).filter((sm: any) => sm.squad_id === s.id),
            }));
            setSquads(squadsWithMembers);
            setScenarios(sc.scenarios || []);
        } catch (e) { reportError('Quarter data', e); }
    }, [apiFetch]);

    const fetchScenarioBookings = useCallback(async (scenarioId: string) => {
        try {
            const d = await apiFetch(`/scenario/${scenarioId}`);
            setScenarioBookings(d.bookings || []);
        } catch (e) { reportError('Scenario', e); }
    }, [apiFetch]);

    useEffect(() => {
        (async () => {
            setLoading(true);
            await fetchOverview();
            setLoading(false);
        })();
    }, [fetchOverview]);

    useEffect(() => {
        if (selectedQuarter) fetchQuarterData(selectedQuarter);
    }, [selectedQuarter, fetchQuarterData]);

    const handleSeed = async () => {
        if (!confirm('Seed QBR demo data? This will replace any existing QBR data in this workspace.')) return;
        setSeeding(true);
        setError(null);
        try {
            await apiFetch('/seed', { method: 'POST' });
            await fetchOverview();
            if (selectedQuarter) await fetchQuarterData(selectedQuarter);
        } catch (e) { reportError('Seed', e); }
        setSeeding(false);
    };

    const handleBooking = async (memberId: string, projectId: string, sprintId: string, percentage: number) => {
        setError(null);
        try {
            await apiFetch('/booking', {
                method: 'POST',
                body: JSON.stringify({ memberId, projectId, sprintId, percentage, scenarioId: activeScenario }),
            });
            if (selectedQuarter) await fetchQuarterData(selectedQuarter);
            if (activeScenario) await fetchScenarioBookings(activeScenario);
        } catch (e) { reportError('Booking', e); }
    };

    const handleCreateScenario = async () => {
        const name = prompt('Scenario name:');
        if (!name?.trim()) return;
        setError(null);
        try {
            const d = await apiFetch('/scenario', {
                method: 'POST',
                body: JSON.stringify({ name, quarterId: selectedQuarter }),
            });
            if (d.scenario) {
                setActiveScenario(d.scenario.id);
                await fetchQuarterData(selectedQuarter);
                await fetchScenarioBookings(d.scenario.id);
            }
        } catch (e) { reportError('Create scenario', e); }
    };

    const handleCommitScenario = async (scenarioId: string) => {
        if (!confirm('Commit this scenario? This replaces the current live plan.')) return;
        setError(null);
        try {
            await apiFetch(`/scenario/${scenarioId}/commit`, { method: 'POST' });
            setActiveScenario(null);
            setScenarioBookings([]);
            await fetchQuarterData(selectedQuarter);
        } catch (e) { reportError('Commit scenario', e); }
    };

    const handleDiscardScenario = async (scenarioId: string) => {
        if (!confirm('Discard this scenario?')) return;
        setError(null);
        try {
            await apiFetch(`/scenario/${scenarioId}`, { method: 'DELETE' });
            if (activeScenario === scenarioId) { setActiveScenario(null); setScenarioBookings([]); }
            await fetchQuarterData(selectedQuarter);
        } catch (e) { reportError('Discard scenario', e); }
    };

    const loadScenarioBookings = async (scenarioId: string) => {
        setError(null);
        setActiveScenario(scenarioId);
        await fetchScenarioBookings(scenarioId);
    };

    const currentQuarter = quarters.find(q => q.id === selectedQuarter);
    const effectiveBookings = activeScenario ? scenarioBookings : bookings;

    // ── Styles ──
    const pill = (active: boolean) => ({
        padding: '7px 16px', borderRadius: 'var(--radius-md)', fontSize: 12, fontWeight: 700 as const,
        cursor: 'pointer' as const, border: 'none', fontFamily: 'inherit',
        background: active ? c.accent : 'transparent',
        color: active ? '#fff' : c.muted,
        transition: 'all 0.15s',
    });

    const tagStyle = (color: string, bg: string): React.CSSProperties => ({
        fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--radius-sm)',
        background: bg, color, textTransform: 'uppercase', letterSpacing: '0.04em',
        whiteSpace: 'nowrap',
    });

    const priorityTag = (priority: string) => (
        <span style={tagStyle(
            priority === 'CRITICAL' ? c.red : priority === 'HIGH' ? c.amber : c.muted,
            priority === 'CRITICAL' ? c.redBg : priority === 'HIGH' ? c.amberBg : c.surface,
        )}>{priority}</span>
    );

    const statCard = (label: string, value: number | string, color: string, icon: string) => (
        <div key={label} className="panel" style={{
            padding: '16px 20px', minWidth: 140, flex: '1 1 140px',
        }}>
            <div style={{ fontSize: 22, marginBottom: 4 }}>{icon}</div>
            <div style={{ fontSize: 26, fontWeight: 800, color, letterSpacing: '-0.03em' }}>{value}</div>
            <div style={{ fontSize: 11, color: c.muted, fontWeight: 600, marginTop: 2 }}>{label}</div>
        </div>
    );

    const errorBanner = error && (
        <div role="alert" style={{
            margin: '12px 24px 0', padding: '8px 12px', borderRadius: 'var(--radius-md)',
            background: c.redBg, color: c.red, border: `1px solid ${c.red}`,
            fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 10,
        }}>
            <span style={{ flex: 1 }}>⚠ {error}</span>
            <button onClick={() => setError(null)} aria-label="Dismiss error" style={{
                background: 'transparent', border: 'none', color: c.red, cursor: 'pointer',
                fontSize: 14, fontWeight: 700, padding: '0 4px', fontFamily: 'inherit',
            }}>✕</button>
        </div>
    );

    if (loading) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: c.muted }}>
                <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>Loading QBR Planning...</div>
                </div>
            </div>
        );
    }

    // Empty state — no data yet
    if (tribes.length === 0 && !loading) {
        return (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', color: c.text }}>
                {errorBanner}
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ textAlign: 'center', maxWidth: 460, padding: 40 }}>
                        <div style={{ fontSize: 56, marginBottom: 20 }}>📋</div>
                        <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 8, letterSpacing: '-0.03em', color: c.text }}>QBR Planning Module</h2>
                        <p style={{ color: c.muted, fontSize: 14, lineHeight: 1.7, marginBottom: 28 }}>
                            Plan your quarters with full visibility of resources, capacity, and cross-functional squads.
                            Start by seeding demo data to explore the module.
                        </p>
                        <button className="btn btn-primary" onClick={handleSeed} disabled={seeding} style={{
                            fontSize: 14, fontWeight: 700, padding: '12px 28px', opacity: seeding ? 0.6 : 1,
                        }}>
                            {seeding ? '⏳ Seeding...' : '🌱 Seed Demo Data'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', color: c.text }}>
            {/* ── Header ───────────────────────────────────────── */}
            <div style={{
                padding: '16px 24px', borderBottom: `1px solid ${c.border}`, background: c.card,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                flexWrap: 'wrap', gap: 12,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 22 }}>📋</span>
                    <h1 style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.03em', margin: 0, color: c.text }}>QBR Planning</h1>
                    {currentQuarter && (
                        <select
                            className="form-select"
                            value={selectedQuarter}
                            onChange={e => setSelectedQuarter(e.target.value)}
                            style={{ width: 'auto', fontSize: 12, fontWeight: 700, padding: '6px 12px', cursor: 'pointer' }}
                        >
                            {quarters.map(q => (
                                <option key={q.id} value={q.id}>{q.label} {q.is_active ? '(Active)' : ''}</option>
                            ))}
                        </select>
                    )}
                </div>

                {/* Nav pills */}
                <div style={{ display: 'flex', gap: 4, background: c.surface, borderRadius: 'var(--radius-lg)', padding: 3 }}>
                    {([
                        { id: 'capacity', icon: '📊', label: 'Capacity Grid' },
                        { id: 'tribes', icon: '🏛️', label: 'Tribes' },
                        { id: 'okrs', icon: '🎯', label: 'OKRs' },
                        { id: 'squads', icon: '👥', label: 'Squads' },
                        { id: 'members', icon: '👤', label: 'Members' },
                    ] as { id: QBRView; icon: string; label: string }[]).map(tab => (
                        <button key={tab.id} onClick={() => setView(tab.id)} style={pill(view === tab.id)}>
                            {tab.icon} {tab.label}
                        </button>
                    ))}
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {activeScenario ? (
                        <>
                            <span className="badge" style={{ background: c.amberBg, color: c.amber }}>
                                🧪 Scenario Mode
                            </span>
                            <button className="btn btn-success" onClick={() => handleCommitScenario(activeScenario)} style={{ fontSize: 12 }}>✓ Commit</button>
                            <button className="btn btn-danger" onClick={() => handleDiscardScenario(activeScenario)} style={{ fontSize: 12 }}>✕ Discard</button>
                            <button className="btn btn-secondary" onClick={() => { setActiveScenario(null); setScenarioBookings([]); }} style={{ fontSize: 12 }}>Exit</button>
                        </>
                    ) : (
                        <>
                            <button className="btn btn-warning" onClick={handleCreateScenario} style={{ fontSize: 12 }}>🧪 New Scenario</button>
                            <button className="btn btn-secondary" onClick={handleSeed} disabled={seeding} style={{ fontSize: 11 }}>
                                {seeding ? '⏳' : '🔄'} Re-seed
                            </button>
                        </>
                    )}
                </div>
            </div>

            {errorBanner}

            {/* ── Stats row ────────────────────────────────────── */}
            <div style={{ padding: '12px 24px', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {statCard('Tribes', stats.tribes || 0, c.accent, '🏛️')}
                {statCard('Chapters', stats.chapters || 0, c.pink, '📚')}
                {statCard('CoE Groups', stats.coe || 0, c.amber, '⭐')}
                {statCard('Members', stats.members || 0, c.green, '👥')}
                {statCard('Projects', stats.projects || 0, c.cyan, '📦')}
                {statCard('Scenarios', scenarios.length, c.purple, '🧪')}
            </div>

            {/* ── Scenario list (if any) ─────────────────────── */}
            {scenarios.length > 0 && !activeScenario && (
                <div style={{ padding: '0 24px 12px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {scenarios.map(sc => (
                        <button key={sc.id} className="btn btn-secondary" onClick={() => loadScenarioBookings(sc.id)} style={{
                            fontSize: 11, padding: '6px 14px',
                        }}>
                            <span style={{ color: sc.is_committed ? c.green : c.amber }}>
                                {sc.is_committed ? '✓' : '🧪'}
                            </span>
                            {sc.name}
                        </button>
                    ))}
                </div>
            )}

            {/* ── Main content ─────────────────────────────────── */}
            <div style={{ flex: 1, overflow: 'auto', padding: '0 24px 24px' }}>
                {view === 'capacity' && (
                    <QBRCapacityGrid
                        members={members}
                        projects={projects}
                        sprints={sprints}
                        bookings={effectiveBookings}
                        tribes={tribes}
                        chapters={chapters}
                        coe={coe}
                        onBooking={handleBooking}
                        onSelectMember={setSelectedMember}
                        selectedTribe={selectedTribe}
                        onSelectTribe={setSelectedTribe}
                        scenarioMode={!!activeScenario}
                    />
                )}

                {view === 'tribes' && renderTribesView()}
                {view === 'okrs' && renderOKRsView()}
                {view === 'squads' && renderSquadsView()}
                {view === 'members' && renderMembersView()}
            </div>

            {/* ── Member detail slide-over ──────────────────── */}
            {selectedMember && (
                <QBRMemberCard
                    member={selectedMember}
                    bookings={effectiveBookings.filter(b => b.member_id === selectedMember.id)}
                    sprints={sprints}
                    projects={projects}
                    onClose={() => setSelectedMember(null)}
                />
            )}
        </div>
    );

    // ── Sub-views ────────────────────────────────────────────

    function renderTribesView() {
        return (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
                {tribes.map(tribe => {
                    const tribeMembers = members.filter(m => m.tribe_id === tribe.id);
                    const tribeProjects = projects.filter(p => p.tribe_id === tribe.id);
                    const tribeSquads = squads.filter(s => s.tribe_id === tribe.id);
                    return (
                        <div key={tribe.id} className="panel" style={{ padding: 24, position: 'relative' }}>
                            <div style={{
                                position: 'absolute', top: 0, left: 0, right: 0, height: 4,
                                background: tribe.color,
                            }} />
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                                <div style={{
                                    width: 42, height: 42, borderRadius: 'var(--radius-lg)',
                                    background: tribe.color + '20', color: tribe.color,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: 18, fontWeight: 800,
                                }}>{tribe.name.charAt(0)}</div>
                                <div>
                                    <div style={{ fontSize: 16, fontWeight: 700, color: c.text }}>{tribe.name}</div>
                                    <div style={{ fontSize: 11, color: c.muted }}>{tribe.lead_name && `Lead: ${tribe.lead_name}`}</div>
                                </div>
                            </div>
                            <p style={{ fontSize: 12, color: c.muted, lineHeight: 1.6, marginBottom: 16 }}>
                                {tribe.description}
                            </p>
                            <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{ fontSize: 22, fontWeight: 800, color: tribe.color }}>{tribeMembers.length}</div>
                                    <div style={{ fontSize: 10, color: c.muted }}>Members</div>
                                </div>
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{ fontSize: 22, fontWeight: 800, color: c.cyan }}>{tribeProjects.length}</div>
                                    <div style={{ fontSize: 10, color: c.muted }}>Projects</div>
                                </div>
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{ fontSize: 22, fontWeight: 800, color: c.green }}>{tribeSquads.length}</div>
                                    <div style={{ fontSize: 10, color: c.muted }}>Squads</div>
                                </div>
                            </div>
                            {/* Projects list */}
                            <div style={{ fontSize: 10, fontWeight: 700, color: c.muted, textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.06em' }}>Projects</div>
                            {tribeProjects.map(p => (
                                <div key={p.id} style={{
                                    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
                                    padding: '6px 10px', background: c.cardHover, borderRadius: 'var(--radius-md)',
                                }}>
                                    <div style={{ width: 8, height: 8, borderRadius: 4, background: p.color }} />
                                    <span style={{ fontSize: 12, fontWeight: 600, color: c.text }}>{p.name}</span>
                                    {priorityTag(p.priority)}
                                </div>
                            ))}
                            <button onClick={() => { setSelectedTribe(tribe.id); setView('capacity'); }} style={{
                                marginTop: 12, width: '100%', padding: '8px 0', borderRadius: 'var(--radius-md)',
                                background: tribe.color + '15', border: `1px solid ${tribe.color}40`,
                                color: tribe.color, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                            }}>View Capacity →</button>
                        </div>
                    );
                })}
                {/* Chapters overview */}
                <div className="panel" style={{ padding: 24 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: c.text }}>📚 Chapters</div>
                    {chapters.map(ch => (
                        <div key={ch.id} style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '10px 12px', marginBottom: 6, background: c.cardHover,
                            borderRadius: 'var(--radius-md)',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ width: 8, height: 8, borderRadius: 4, background: ch.color }} />
                                <span style={{ fontSize: 13, fontWeight: 600, color: c.text }}>{ch.name}</span>
                            </div>
                            <span style={{ fontSize: 12, fontWeight: 800, color: ch.color }}>{ch.member_count}</span>
                        </div>
                    ))}
                </div>
                {/* CoE overview */}
                <div className="panel" style={{ padding: 24 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: c.text }}>⭐ Centers of Excellence</div>
                    {coe.map(g => (
                        <div key={g.id} style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '10px 12px', marginBottom: 6, background: c.cardHover,
                            borderRadius: 'var(--radius-md)',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ width: 8, height: 8, borderRadius: 4, background: g.color }} />
                                <span style={{ fontSize: 13, fontWeight: 600, color: c.text }}>{g.name}</span>
                            </div>
                            <span style={{ fontSize: 12, fontWeight: 800, color: g.color }}>{g.member_count}</span>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    function renderOKRsView() {
        const leadership = okrs.filter(o => o.level === 'LEADERSHIP');
        const tribeOkrs = okrs.filter(o => o.level === 'TRIBE');

        return (
            <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: c.muted, textTransform: 'uppercase', marginBottom: 16, letterSpacing: '0.06em' }}>
                    🎯 OKR Hierarchy
                </div>
                {leadership.map(okr => (
                    <div key={okr.id} style={{ marginBottom: 24 }}>
                        <div className="panel" style={{ padding: '18px 22px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                <span style={tagStyle(c.accent, c.accentBg)}>LEADERSHIP</span>
                                <span style={{ fontSize: 15, fontWeight: 700, color: c.text }}>{okr.title}</span>
                            </div>
                            <p style={{ fontSize: 12, color: c.muted, margin: 0 }}>{okr.description}</p>
                        </div>
                        {/* Child tribe OKRs */}
                        <div style={{ marginLeft: 28, borderLeft: `2px solid ${c.border}`, paddingLeft: 20, marginTop: 8 }}>
                            {tribeOkrs.filter(t => t.parent_okr_id === okr.id).map(to => {
                                const tribe = tribes.find(t => t.id === to.tribe_id);
                                const linkedProjects = projects.filter(p => p.okr_id === to.id);
                                return (
                                    <div key={to.id} className="panel" style={{ padding: '14px 18px', marginBottom: 10 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                            <span style={tribe?.color
                                                ? tagStyle(tribe.color, tribe.color + '20')
                                                : tagStyle(c.accent, c.accentBg)
                                            }>TRIBE · {tribe?.name || 'Unknown'}</span>
                                            <span style={{ fontSize: 13, fontWeight: 700, color: c.text }}>{to.title}</span>
                                        </div>
                                        {linkedProjects.length > 0 && (
                                            <div style={{ marginTop: 8 }}>
                                                {linkedProjects.map(p => (
                                                    <div key={p.id} style={{
                                                        display: 'inline-flex', alignItems: 'center', gap: 6,
                                                        padding: '4px 10px', marginRight: 6, marginBottom: 4,
                                                        background: p.color + '15', borderRadius: 'var(--radius-md)',
                                                        fontSize: 11, fontWeight: 600, color: p.color,
                                                    }}>
                                                        <div style={{ width: 6, height: 6, borderRadius: 3, background: p.color }} />
                                                        {p.name}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    function renderSquadsView() {
        return (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
                {squads.map(squad => {
                    const tribe = tribes.find(t => t.id === squad.tribe_id);
                    return (
                        <div key={squad.id} className="panel" style={{ padding: 22, position: 'relative' }}>
                            <div style={{
                                position: 'absolute', top: 0, left: 0, right: 0, height: 3,
                                background: tribe?.color || c.accent,
                            }} />
                            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4, color: c.text }}>{squad.name}</div>
                            <div style={{ fontSize: 11, color: c.muted, marginBottom: 16 }}>
                                {tribe?.name || 'Cross-functional'} {squad.project_name && `· ${squad.project_name}`}
                            </div>
                            {(squad.members || []).map((sm: any) => (
                                <div key={sm.id} style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                    padding: '8px 10px', marginBottom: 4, background: c.cardHover,
                                    borderRadius: 'var(--radius-md)',
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <div style={{
                                            width: 26, height: 26, borderRadius: 'var(--radius-md)',
                                            background: sm.squad_role === 'LEAD' ? c.accentBg : c.surface,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontSize: 9, fontWeight: 800, color: sm.squad_role === 'LEAD' ? c.accent : c.text,
                                        }}>{(sm.member_name || '').slice(0, 2).toUpperCase()}</div>
                                        <div>
                                            <div style={{ fontSize: 12, fontWeight: 600, color: c.text }}>{sm.member_name}</div>
                                            <div style={{ fontSize: 10, color: c.muted }}>
                                                {sm.chapter_name || sm.coe_name || sm.tribe_name || ''}
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: 6 }}>
                                        <span style={tagStyle(
                                            sm.squad_role === 'LEAD' ? c.accent : sm.squad_role === 'ADVISOR' ? c.amber : c.muted,
                                            sm.squad_role === 'LEAD' ? c.accentBg : sm.squad_role === 'ADVISOR' ? c.amberBg : c.surface,
                                        )}>{sm.squad_role}</span>
                                        {sm.member_type !== 'INTERNAL' && (
                                            <span style={tagStyle(c.amber, c.amberBg)}>{sm.member_type}</span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    );
                })}
            </div>
        );
    }

    function renderMembersView() {
        const grouped: Record<string, QBRMember[]> = {};
        members.forEach(m => {
            const key = m.tribe_name || m.coe_name || 'Unassigned';
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(m);
        });

        return (
            <div>
                {Object.entries(grouped).map(([group, gMembers]) => (
                    <div key={group} style={{ marginBottom: 24 }}>
                        <div style={{
                            fontSize: 11, fontWeight: 700, color: c.muted, textTransform: 'uppercase',
                            letterSpacing: '0.06em', marginBottom: 12, paddingBottom: 6,
                            borderBottom: `1px solid ${c.border}`,
                        }}>{group} ({gMembers.length})</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
                            {gMembers.map(m => {
                                const memberBookings = effectiveBookings.filter(b => b.member_id === m.id);
                                const totalBooked = memberBookings.reduce((sum, b) => sum + b.percentage, 0) / Math.max(sprints.length, 1);
                                const utilPct = Math.round(totalBooked);
                                return (
                                    <div key={m.id} className="panel" onClick={() => setSelectedMember(m)} style={{
                                        padding: '14px 16px', cursor: 'pointer', transition: 'border-color 0.15s',
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                            <div style={{
                                                width: 34, height: 34, borderRadius: 'var(--radius-lg)',
                                                background: m.avatar_color + '25', color: m.avatar_color,
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: 11, fontWeight: 800,
                                            }}>{m.name.slice(0, 2).toUpperCase()}</div>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontSize: 13, fontWeight: 700, color: c.text }}>{m.name}</div>
                                                <div style={{ fontSize: 10, color: c.muted }}>{m.role_title}</div>
                                            </div>
                                            <div style={{ textAlign: 'right' }}>
                                                <div style={{
                                                    fontSize: 16, fontWeight: 800,
                                                    color: utilPct > 100 ? c.red : utilPct > 80 ? c.amber : utilPct > 50 ? c.green : c.muted,
                                                }}>{utilPct}%</div>
                                                <div style={{ fontSize: 9, color: c.muted }}>avg util</div>
                                            </div>
                                        </div>
                                        {m.member_type !== 'INTERNAL' && (
                                            <span style={{ ...tagStyle(c.amber, c.amberBg), marginTop: 8, display: 'inline-block' }}>{m.member_type}</span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        );
    }
}
