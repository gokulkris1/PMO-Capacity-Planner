import React, { useState, useEffect, useCallback } from 'react';
import {
    QBRTribe, QBRChapter, QBRCoE, QBRQuarter, QBRSprint,
    QBRMember, QBRProject, QBRBooking, QBRScenario, QBROKR, QBRSquad
} from '../../types';
import { QBRCapacityGrid } from './QBRCapacityGrid';
import { QBRMemberCard } from './QBRMemberCard';
import { getAvatarInitials } from '../../utils/avatarInitials';

/* ── Colours ─────────────────────────────────────────────── */
const c = {
    bg: '#0a0a0f', card: '#12121a', cardHover: '#1a1a28',
    border: '#1e1e2e', text: '#e2e8f0', muted: '#64748b',
    accent: '#818cf8', accentBg: 'rgba(129,140,248,0.08)',
    green: '#34d399', red: '#f87171', amber: '#fbbf24',
    purple: '#a78bfa', pink: '#f472b6', cyan: '#22d3ee',
};

interface Props {
    token: string;
    wsId: string;
    canWrite: boolean;
    canSeedDemo: boolean;
}

type QBRView = 'capacity' | 'tribes' | 'okrs' | 'squads' | 'members';

async function readApiResponse(response: Response): Promise<any> {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
    return body;
}

export function QBRPlanner({ token, wsId, canWrite, canSeedDemo }: Props) {
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
    const [error, setError] = useState<string | null>(null);
    const [seeding, setSeeding] = useState(false);
    const [selectedMember, setSelectedMember] = useState<QBRMember | null>(null);
    const [selectedTribe, setSelectedTribe] = useState<string | null>(null);

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
    };

    const apiBase = `/api/qbr`;
    const qs = new URLSearchParams({ wsId }).toString();

    const fetchOverview = useCallback(async () => {
        try {
            const r = await fetch(`${apiBase}/overview?${qs}`, { headers });
            const d = await readApiResponse(r);
            setTribes(d.tribes || []);
            setChapters(d.chapters || []);
            setCoe(d.coe || []);
            setQuarters(d.quarters || []);
            setStats(d.stats || {});
            if (d.quarters?.length) {
                const active = d.quarters.find((q: QBRQuarter) => q.is_active);
                setSelectedQuarter(active?.id || d.quarters[d.quarters.length - 1].id);
            }
            setError(null);
        } catch (e) {
            console.error('QBR overview error', e);
            setError(e instanceof Error ? e.message : 'Unable to load QBR data.');
        }
    }, [token, wsId]);

    const fetchQuarterData = useCallback(async (qId: string) => {
        try {
            const [qr, mr, pr, or, sq, sc] = await Promise.all([
                fetch(`${apiBase}/quarter/${qId}?${qs}`, { headers }).then(readApiResponse),
                fetch(`${apiBase}/members?${qs}`, { headers }).then(readApiResponse),
                fetch(`${apiBase}/projects?${qs}`, { headers }).then(readApiResponse),
                fetch(`${apiBase}/okrs?${qs}`, { headers }).then(readApiResponse),
                fetch(`${apiBase}/squads?${qs}`, { headers }).then(readApiResponse),
                fetch(`${apiBase}/scenarios?${qs}&quarterId=${qId}`, { headers }).then(readApiResponse),
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
            setError(null);
        } catch (e) {
            console.error('QBR quarter data error', e);
            setError(e instanceof Error ? e.message : 'Unable to load QBR planning data.');
        }
    }, [token, wsId]);

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
        if (!canSeedDemo) return;
        if (!confirm('Seed QBR demo data? This will replace any existing QBR data in this workspace.')) return;
        setSeeding(true);
        try {
            await readApiResponse(await fetch(`${apiBase}/seed?${qs}`, { method: 'POST', headers }));
            await fetchOverview();
            if (selectedQuarter) await fetchQuarterData(selectedQuarter);
        } catch (e) {
            console.error('Seed error', e);
            setError(e instanceof Error ? e.message : 'Unable to seed demo data.');
        }
        setSeeding(false);
    };

    const handleBooking = async (memberId: string, projectId: string, sprintId: string, percentage: number) => {
        if (!canWrite) return;
        try {
            await readApiResponse(await fetch(`${apiBase}/booking?${qs}`, {
                method: 'POST', headers,
                body: JSON.stringify({ memberId, projectId, sprintId, percentage, scenarioId: activeScenario }),
            }));
            if (activeScenario) {
                const scenario = await readApiResponse(await fetch(`${apiBase}/scenario/${activeScenario}?${qs}`, { headers }));
                setScenarioBookings(scenario.bookings || []);
            } else if (selectedQuarter) {
                await fetchQuarterData(selectedQuarter);
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Unable to update booking.');
        }
    };

    const handleCreateScenario = async () => {
        if (!canWrite) return;
        const name = prompt('Scenario name:');
        if (!name?.trim()) return;
        try {
            const d = await readApiResponse(await fetch(`${apiBase}/scenario?${qs}`, {
                method: 'POST', headers,
                body: JSON.stringify({ name, quarterId: selectedQuarter }),
            }));
            if (d.scenario) {
                setActiveScenario(d.scenario.id);
                const scenario = await readApiResponse(await fetch(`${apiBase}/scenario/${d.scenario.id}?${qs}`, { headers }));
                setScenarioBookings(scenario.bookings || []);
                await fetchQuarterData(selectedQuarter);
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Unable to create scenario.');
        }
    };

    const handleCommitScenario = async (scenarioId: string) => {
        if (!canWrite) return;
        if (!confirm('Commit this scenario? This replaces the current live plan.')) return;
        try {
            await readApiResponse(await fetch(`${apiBase}/scenario/${scenarioId}/commit?${qs}`, { method: 'POST', headers }));
            setActiveScenario(null);
            await fetchQuarterData(selectedQuarter);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Unable to commit scenario.');
        }
    };

    const handleDiscardScenario = async (scenarioId: string) => {
        if (!canWrite) return;
        if (!confirm('Discard this scenario?')) return;
        try {
            await readApiResponse(await fetch(`${apiBase}/scenario/${scenarioId}?${qs}`, { method: 'DELETE', headers }));
            if (activeScenario === scenarioId) setActiveScenario(null);
            await fetchQuarterData(selectedQuarter);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Unable to discard scenario.');
        }
    };

    const loadScenarioBookings = async (scenarioId: string) => {
        try {
            const d = await readApiResponse(await fetch(`${apiBase}/scenario/${scenarioId}?${qs}`, { headers }));
            setActiveScenario(scenarioId);
            setScenarioBookings(d.bookings || []);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Unable to load scenario.');
        }
    };

    const currentQuarter = quarters.find(q => q.id === selectedQuarter);

    // ── Styles ──
    const pill = (active: boolean, color: string = c.accent) => ({
        padding: '8px 18px', borderRadius: 10, fontSize: 12, fontWeight: 700 as const,
        cursor: 'pointer' as const, border: 'none',
        background: active ? color : 'transparent',
        color: active ? '#fff' : c.muted,
        transition: 'all 0.15s',
    });

    const statCard = (label: string, value: number | string, color: string, icon: string) => (
        <div key={label} style={{
            background: c.card, border: `1px solid ${c.border}`, borderRadius: 14,
            padding: '18px 22px', minWidth: 140, flex: '1 1 140px',
        }}>
            <div style={{ fontSize: 24, marginBottom: 4 }}>{icon}</div>
            <div style={{ fontSize: 26, fontWeight: 900, color, letterSpacing: '-0.03em' }}>{value}</div>
            <div style={{ fontSize: 11, color: c.muted, fontWeight: 600, marginTop: 2 }}>{label}</div>
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

    if (error && tribes.length === 0 && !loading) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: c.text }}>
                <div style={{ textAlign: 'center', maxWidth: 460, padding: 40 }} role="alert">
                    <h2 style={{ fontSize: 24, fontWeight: 900, marginBottom: 8, letterSpacing: '-0.03em' }}>QBR data is unavailable</h2>
                    <p style={{ color: c.muted, fontSize: 14, lineHeight: 1.7, marginBottom: 28 }}>{error}</p>
                    <button onClick={() => void fetchOverview()} style={{
                        background: c.accent, border: 'none', borderRadius: 10, color: '#fff',
                        fontSize: 13, fontWeight: 800, padding: '10px 18px', cursor: 'pointer',
                    }}>Retry</button>
                </div>
            </div>
        );
    }

    // Empty state — no data yet
    if (tribes.length === 0 && !loading) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: c.text }}>
                <div style={{ textAlign: 'center', maxWidth: 460, padding: 40 }}>
                    <div style={{ fontSize: 56, marginBottom: 20 }}>📋</div>
                    <h2 style={{ fontSize: 24, fontWeight: 900, marginBottom: 8, letterSpacing: '-0.03em' }}>QBR Planning Module</h2>
                    <p style={{ color: c.muted, fontSize: 14, lineHeight: 1.7, marginBottom: 28 }}>
                        Plan your quarters with full visibility of resources, capacity, and cross-functional squads.
                        {canSeedDemo ? ' Start by seeding demo data to explore the module.' : ' Ask a workspace planner to configure QBR data for this workspace.'}
                    </p>
                    {canSeedDemo && (
                        <button onClick={handleSeed} disabled={seeding} style={{
                            background: `linear-gradient(135deg, ${c.accent}, ${c.purple})`,
                            border: 'none', borderRadius: 12, color: '#fff',
                            fontSize: 14, fontWeight: 800, padding: '14px 32px',
                            cursor: 'pointer', opacity: seeding ? 0.6 : 1,
                        }}>
                            {seeding ? '⏳ Seeding...' : '🌱 Seed Demo Data'}
                        </button>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* ── Header ───────────────────────────────────────── */}
            <div style={{
                padding: '16px 24px', borderBottom: `1px solid ${c.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                flexWrap: 'wrap', gap: 12,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 22 }}>📋</span>
                    <h1 style={{ fontSize: 18, fontWeight: 900, letterSpacing: '-0.03em', margin: 0 }}>QBR Planning</h1>
                    {currentQuarter && (
                        <select
                            value={selectedQuarter}
                            onChange={e => setSelectedQuarter(e.target.value)}
                            style={{
                                background: c.card, border: `1px solid ${c.border}`, borderRadius: 8,
                                color: c.text, fontSize: 12, fontWeight: 700, padding: '6px 12px',
                                cursor: 'pointer', outline: 'none',
                            }}
                        >
                            {quarters.map(q => (
                                <option key={q.id} value={q.id}>{q.label} {q.is_active ? '(Active)' : ''}</option>
                            ))}
                        </select>
                    )}
                </div>

                {/* Nav pills */}
                <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: 3 }}>
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

                <div style={{ display: 'flex', gap: 8 }}>
                    {activeScenario ? (
                        <>
                            <span style={{ fontSize: 11, color: c.amber, fontWeight: 700, padding: '8px 0' }}>
                                🧪 Scenario Mode
                            </span>
                            {canWrite && (
                                <button onClick={() => handleCommitScenario(activeScenario)} style={{
                                    ...pill(false, c.green), border: `1px solid ${c.green}40`, color: c.green
                                }}>✓ Commit</button>
                            )}
                            {canWrite && (
                                <button onClick={() => handleDiscardScenario(activeScenario)} style={{
                                    ...pill(false, c.red), border: `1px solid ${c.red}40`, color: c.red
                                }}>✕ Discard</button>
                            )}
                            <button onClick={() => { setActiveScenario(null); setScenarioBookings([]); }} style={{
                                ...pill(false), border: `1px solid ${c.border}`, color: c.muted
                            }}>Exit</button>
                        </>
                    ) : (
                        <>
                            {canWrite && (
                                <button onClick={handleCreateScenario} style={{
                                    ...pill(false, c.amber), border: `1px solid ${c.amber}40`, color: c.amber
                                }}>🧪 New Scenario</button>
                            )}
                            {canSeedDemo && (
                                <button onClick={handleSeed} disabled={seeding} style={{
                                    ...pill(false), border: `1px solid ${c.border}`, color: c.muted, fontSize: 11
                                }}>{seeding ? '⏳' : '🔄'} Re-seed</button>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* ── Stats row ────────────────────────────────────── */}
            {error && (
                <div role="alert" style={{ margin: '12px 24px 0', color: c.red, fontSize: 12, fontWeight: 600 }}>
                    {error}
                </div>
            )}
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
                        <button key={sc.id} onClick={() => loadScenarioBookings(sc.id)} style={{
                            background: c.card, border: `1px solid ${c.border}`, borderRadius: 8,
                            color: c.text, fontSize: 11, fontWeight: 600, padding: '6px 14px',
                            cursor: 'pointer', display: 'flex', gap: 6, alignItems: 'center',
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
                        bookings={activeScenario ? scenarioBookings : bookings}
                        tribes={tribes}
                        chapters={chapters}
                        coe={coe}
                        onBooking={handleBooking}
                        onSelectMember={setSelectedMember}
                        selectedTribe={selectedTribe}
                        onSelectTribe={setSelectedTribe}
                        scenarioMode={!!activeScenario}
                        canEdit={canWrite}
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
                    bookings={bookings.filter(b => b.member_id === selectedMember.id)}
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
                        <div key={tribe.id} style={{
                            background: c.card, border: `1px solid ${c.border}`, borderRadius: 16,
                            padding: 24, position: 'relative', overflow: 'hidden',
                        }}>
                            <div style={{
                                position: 'absolute', top: 0, left: 0, right: 0, height: 4,
                                background: tribe.color,
                            }} />
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                                <div style={{
                                    width: 42, height: 42, borderRadius: 12,
                                    background: tribe.color + '20', color: tribe.color,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: 18, fontWeight: 900,
                                }}>{tribe.name.charAt(0)}</div>
                                <div>
                                    <div style={{ fontSize: 16, fontWeight: 800 }}>{tribe.name}</div>
                                    <div style={{ fontSize: 11, color: c.muted }}>{tribe.lead_name && `Lead: ${tribe.lead_name}`}</div>
                                </div>
                            </div>
                            <p style={{ fontSize: 12, color: c.muted, lineHeight: 1.6, marginBottom: 16 }}>
                                {tribe.description}
                            </p>
                            <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{ fontSize: 22, fontWeight: 900, color: tribe.color }}>{tribeMembers.length}</div>
                                    <div style={{ fontSize: 10, color: c.muted }}>Members</div>
                                </div>
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{ fontSize: 22, fontWeight: 900, color: c.cyan }}>{tribeProjects.length}</div>
                                    <div style={{ fontSize: 10, color: c.muted }}>Projects</div>
                                </div>
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{ fontSize: 22, fontWeight: 900, color: c.green }}>{tribeSquads.length}</div>
                                    <div style={{ fontSize: 10, color: c.muted }}>Squads</div>
                                </div>
                            </div>
                            {/* Projects list */}
                            <div style={{ fontSize: 10, fontWeight: 700, color: c.muted, textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.06em' }}>Projects</div>
                            {tribeProjects.map(p => (
                                <div key={p.id} style={{
                                    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
                                    padding: '6px 10px', background: 'rgba(255,255,255,0.02)', borderRadius: 8,
                                }}>
                                    <div style={{ width: 8, height: 8, borderRadius: 4, background: p.color }} />
                                    <span style={{ fontSize: 12, fontWeight: 600 }}>{p.name}</span>
                                    <span style={{
                                        fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                                        background: p.priority === 'CRITICAL' ? `${c.red}20` : p.priority === 'HIGH' ? `${c.amber}20` : `${c.muted}20`,
                                        color: p.priority === 'CRITICAL' ? c.red : p.priority === 'HIGH' ? c.amber : c.muted,
                                    }}>{p.priority}</span>
                                </div>
                            ))}
                            <button onClick={() => { setSelectedTribe(tribe.id); setView('capacity'); }} style={{
                                marginTop: 12, width: '100%', padding: '8px 0', borderRadius: 8,
                                background: tribe.color + '15', border: `1px solid ${tribe.color}30`,
                                color: tribe.color, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                            }}>View Capacity →</button>
                        </div>
                    );
                })}
                {/* Chapters overview */}
                <div style={{
                    background: c.card, border: `1px solid ${c.border}`, borderRadius: 16, padding: 24,
                }}>
                    <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 16 }}>📚 Chapters</div>
                    {chapters.map(ch => (
                        <div key={ch.id} style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '10px 12px', marginBottom: 6, background: 'rgba(255,255,255,0.02)',
                            borderRadius: 8,
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ width: 8, height: 8, borderRadius: 4, background: ch.color }} />
                                <span style={{ fontSize: 13, fontWeight: 600 }}>{ch.name}</span>
                            </div>
                            <span style={{ fontSize: 12, fontWeight: 800, color: ch.color }}>{ch.member_count}</span>
                        </div>
                    ))}
                </div>
                {/* CoE overview */}
                <div style={{
                    background: c.card, border: `1px solid ${c.border}`, borderRadius: 16, padding: 24,
                }}>
                    <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 16 }}>⭐ Centers of Excellence</div>
                    {coe.map(g => (
                        <div key={g.id} style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '10px 12px', marginBottom: 6, background: 'rgba(255,255,255,0.02)',
                            borderRadius: 8,
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ width: 8, height: 8, borderRadius: 4, background: g.color }} />
                                <span style={{ fontSize: 13, fontWeight: 600 }}>{g.name}</span>
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
                        <div style={{
                            background: c.card, border: `1px solid ${c.border}`, borderRadius: 14,
                            padding: '18px 22px',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                <span style={{
                                    fontSize: 9, fontWeight: 800, padding: '3px 10px', borderRadius: 6,
                                    background: `${c.accent}20`, color: c.accent,
                                }}>LEADERSHIP</span>
                                <span style={{ fontSize: 15, fontWeight: 800 }}>{okr.title}</span>
                            </div>
                            <p style={{ fontSize: 12, color: c.muted, margin: 0 }}>{okr.description}</p>
                        </div>
                        {/* Child tribe OKRs */}
                        <div style={{ marginLeft: 28, borderLeft: `2px solid ${c.border}`, paddingLeft: 20, marginTop: 8 }}>
                            {tribeOkrs.filter(t => t.parent_okr_id === okr.id).map(to => {
                                const tribe = tribes.find(t => t.id === to.tribe_id);
                                const linkedProjects = projects.filter(p => p.okr_id === to.id);
                                return (
                                    <div key={to.id} style={{
                                        background: c.card, border: `1px solid ${c.border}`, borderRadius: 12,
                                        padding: '14px 18px', marginBottom: 10,
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                            <span style={{
                                                fontSize: 9, fontWeight: 800, padding: '3px 10px', borderRadius: 6,
                                                background: (tribe?.color || c.accent) + '20', color: tribe?.color || c.accent,
                                            }}>TRIBE · {tribe?.name || 'Unknown'}</span>
                                            <span style={{ fontSize: 13, fontWeight: 700 }}>{to.title}</span>
                                        </div>
                                        {linkedProjects.length > 0 && (
                                            <div style={{ marginTop: 8 }}>
                                                {linkedProjects.map(p => (
                                                    <div key={p.id} style={{
                                                        display: 'inline-flex', alignItems: 'center', gap: 6,
                                                        padding: '4px 10px', marginRight: 6, marginBottom: 4,
                                                        background: p.color + '15', borderRadius: 6,
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
                        <div key={squad.id} style={{
                            background: c.card, border: `1px solid ${c.border}`, borderRadius: 16,
                            padding: 22, position: 'relative', overflow: 'hidden',
                        }}>
                            <div style={{
                                position: 'absolute', top: 0, left: 0, right: 0, height: 3,
                                background: tribe?.color || c.accent,
                            }} />
                            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>{squad.name}</div>
                            <div style={{ fontSize: 11, color: c.muted, marginBottom: 16 }}>
                                {tribe?.name || 'Cross-functional'} {squad.project_name && `· ${squad.project_name}`}
                            </div>
                            {(squad.members || []).map((sm: any) => (
                                <div key={sm.id} style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                    padding: '8px 10px', marginBottom: 4, background: 'rgba(255,255,255,0.02)',
                                    borderRadius: 8,
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <div style={{
                                            width: 26, height: 26, borderRadius: 8,
                                            background: sm.squad_role === 'LEAD' ? `${c.accent}30` : 'rgba(255,255,255,0.06)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontSize: 9, fontWeight: 800, color: sm.squad_role === 'LEAD' ? c.accent : c.text,
                                        }}>{getAvatarInitials(sm.member_name)}</div>
                                        <div>
                                            <div style={{ fontSize: 12, fontWeight: 600 }}>{sm.member_name}</div>
                                            <div style={{ fontSize: 10, color: c.muted }}>
                                                {sm.chapter_name || sm.coe_name || sm.tribe_name || ''}
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: 6 }}>
                                        <span style={{
                                            fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                                            background: sm.squad_role === 'LEAD' ? `${c.accent}20` : sm.squad_role === 'ADVISOR' ? `${c.amber}20` : `${c.muted}20`,
                                            color: sm.squad_role === 'LEAD' ? c.accent : sm.squad_role === 'ADVISOR' ? c.amber : c.muted,
                                        }}>{sm.squad_role}</span>
                                        {sm.member_type !== 'INTERNAL' && (
                                            <span style={{
                                                fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                                                background: `${c.amber}20`, color: c.amber,
                                            }}>{sm.member_type}</span>
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
                                const memberBookings = bookings.filter(b => b.member_id === m.id);
                                const totalBooked = memberBookings.reduce((sum, b) => sum + b.percentage, 0) / Math.max(sprints.length, 1);
                                const utilPct = Math.round(totalBooked);
                                return (
                                    <div key={m.id} onClick={() => setSelectedMember(m)} style={{
                                        background: c.card, border: `1px solid ${c.border}`, borderRadius: 12,
                                        padding: '14px 16px', cursor: 'pointer', transition: 'border-color 0.15s',
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                            <div style={{
                                                width: 34, height: 34, borderRadius: 10,
                                                background: m.avatar_color + '25', color: m.avatar_color,
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: 11, fontWeight: 900,
                                            }}>{getAvatarInitials(m.name)}</div>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontSize: 13, fontWeight: 700 }}>{m.name}</div>
                                                <div style={{ fontSize: 10, color: c.muted }}>{m.role_title}</div>
                                            </div>
                                            <div style={{ textAlign: 'right' }}>
                                                <div style={{
                                                    fontSize: 16, fontWeight: 900,
                                                    color: utilPct > 100 ? c.red : utilPct > 80 ? c.amber : utilPct > 50 ? c.green : c.muted,
                                                }}>{utilPct}%</div>
                                                <div style={{ fontSize: 9, color: c.muted }}>avg util</div>
                                            </div>
                                        </div>
                                        {m.member_type !== 'INTERNAL' && (
                                            <span style={{
                                                fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 6, marginTop: 8, display: 'inline-block',
                                                background: `${c.amber}20`, color: c.amber,
                                            }}>{m.member_type}</span>
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
