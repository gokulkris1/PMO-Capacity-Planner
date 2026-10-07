import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { getAvatarInitials } from '../utils/avatarInitials';

// ── Types ────────────────────────────────────────────────────────────────
interface Org {
    id: string; name: string; slug: string; logo_url?: string; primary_color?: string;
    user_count: number; admin_count: number; workspace_count: number; project_count: number; resource_count: number;
    admins: { id: string; email: string; name: string; role: string }[];
    workspaces: { id: string; name: string; member_count: number }[];
}

interface Stats {
    total_users: number; basic_users: number; pro_users: number; max_users: number;
    org_admins: number; pmo_admins: number; new_this_week: number; mrr_eur: number;
    total_orgs: number; total_workspaces: number;
}

// ── Style tokens ─────────────────────────────────────────────────────────
const c = {
    bg: '#0a0d14', card: '#0f1219', border: 'rgba(255,255,255,0.07)',
    text: '#f1f5f9', muted: '#64748b', accent: '#6366f1', accentBg: 'rgba(99,102,241,0.12)',
    green: '#34d399', amber: '#fbbf24', red: '#f87171',
};

const cardStyle: React.CSSProperties = {
    background: c.card, borderRadius: 16, border: `1px solid ${c.border}`,
    padding: '20px 24px',
};

// ── Main Component ───────────────────────────────────────────────────────
export const SuperuserCockpit: React.FC<{ onViewOrg?: (orgSlug: string) => void }> = ({ onViewOrg }) => {
    const { token, logout } = useAuth();
    const [orgs, setOrgs] = useState<Org[]>([]);
    const [stats, setStats] = useState<Stats | null>(null);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);
    const [expandedOrg, setExpandedOrg] = useState<string | null>(null);

    // Create org form
    const [newOrgName, setNewOrgName] = useState('');
    const [newAdminEmail, setNewAdminEmail] = useState('');
    const [newPlan, setNewPlan] = useState<'BASIC' | 'PRO' | 'MAX'>('BASIC');
    const [creating, setCreating] = useState(false);

    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

    const fetchData = useCallback(async () => {
        try {
            const [orgRes, statsRes] = await Promise.all([
                fetch('/api/org_manage', { headers }),
                fetch('/api/auth/admin/stats', { headers }),
            ]);
            const orgData = await orgRes.json();
            const statsData = await statsRes.json();
            setOrgs(orgData.orgs || []);
            setStats(statsData.stats || null);
        } catch (e) { console.error('Cockpit fetch error:', e); }
        finally { setLoading(false); }
    }, [token]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleCreateOrg = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newOrgName.trim()) return;
        setCreating(true);
        try {
            const res = await fetch('/api/org_manage', {
                method: 'POST', headers,
                body: JSON.stringify({ orgName: newOrgName, adminEmail: newAdminEmail || undefined, plan: newPlan }),
            });
            const data = await res.json();
            if (!res.ok) { alert(data.error); return; }
            setShowCreate(false);
            setNewOrgName(''); setNewAdminEmail('');
            fetchData();
        } catch (e: any) { alert('Failed: ' + e.message); }
        finally { setCreating(false); }
    };

    const handleAssignWorkspace = async (orgId: string, adminId: string, workspaceId: string) => {
        if (!workspaceId) return;
        await fetch(`/api/org_manage/${orgId}/admin/${adminId}/workspace`, {
            method: 'POST', headers,
            body: JSON.stringify({ workspaceId, role: 'PMO_ADMIN' }),
        });
        alert('Admin assigned to workspace successfully');
        fetchData();
    };

    const handleCreateWorkspace = async (orgId: string) => {
        const name = prompt('Workspace name:');
        if (!name?.trim()) return;
        await fetch(`/api/org_manage/${orgId}/workspace`, {
            method: 'POST', headers,
            body: JSON.stringify({ name }),
        });
        fetchData();
    };

    // ── Stat card ────────────────────────────────────────────────────
    const StatCard: React.FC<{ label: string; value: string | number; color?: string; sub?: string }> = ({ label, value, color, sub }) => (
        <div style={{ ...cardStyle, flex: '1 1 180px', minWidth: 160 }}>
            <div style={{ fontSize: 11, color: c.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{label}</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: color || c.text, letterSpacing: '-0.03em' }}>{value}</div>
            {sub && <div style={{ fontSize: 11, color: c.muted, marginTop: 4 }}>{sub}</div>}
        </div>
    );

    if (loading) return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: c.bg }}>
            <div style={{ fontSize: 40 }}>🪐</div>
        </div>
    );

    return (
        <div style={{
            height: '100vh', width: '100vw', background: c.bg, color: c.text,
            fontFamily: "'Inter', -apple-system, sans-serif",
            padding: '32px 40px', overflowY: 'auto', boxSizing: 'border-box'
        }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                        <div style={{
                            width: 44, height: 44, borderRadius: 14,
                            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
                            boxShadow: '0 8px 24px rgba(99,102,241,0.4)',
                        }}>🪐</div>
                        <div>
                            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, letterSpacing: '-0.03em' }}>Orbit Cockpit</h1>
                            <p style={{ margin: 0, fontSize: 12, color: c.muted }}>Platform Overview · Superuser Dashboard</p>
                        </div>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <button onClick={logout} style={{
                        padding: '12px 16px', borderRadius: 12, border: `1px solid ${c.border}`,
                        background: 'transparent', color: c.muted, fontWeight: 600, fontSize: 13, cursor: 'pointer',
                    }}>
                        Logout
                    </button>
                    <button onClick={() => setShowCreate(true)} style={{
                        padding: '12px 24px', borderRadius: 12, border: 'none',
                        background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                        color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer',
                        boxShadow: '0 4px 20px rgba(99,102,241,0.4)',
                        display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                        <span style={{ fontSize: 18 }}>+</span> Create Organization
                    </button>
                </div>
            </div>

            {/* Stats Grid */}
            {stats && (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
                    <StatCard label="Organizations" value={stats.total_orgs} color={c.accent} />
                    <StatCard label="Total Users" value={stats.total_users} />
                    <StatCard label="Workspaces" value={stats.total_workspaces} />
                    <StatCard label="MRR" value={`€${stats.mrr_eur}`} color={c.green} />
                    <StatCard label="New This Week" value={stats.new_this_week} color={c.amber} />
                    <StatCard label="Org Admins" value={stats.org_admins} sub={`${stats.pmo_admins} PMO admins`} />
                </div>
            )}

            {/* Org Grid */}
            <div style={{ fontSize: 14, fontWeight: 700, color: c.muted, marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Organizations ({orgs.length})
            </div>

            {orgs.length === 0 ? (
                <div style={{ ...cardStyle, textAlign: 'center', padding: '60px 20px' }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>🏢</div>
                    <div style={{ fontSize: 16, color: c.muted }}>No organizations yet. Create one to get started.</div>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {orgs.map(org => (
                        <div key={org.id} style={{
                            ...cardStyle,
                            transition: 'border-color 0.15s',
                            borderColor: expandedOrg === org.id ? c.accent : c.border,
                        }}>
                            {/* Org header row */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 200 }}>
                                    <div style={{
                                        width: 40, height: 40, borderRadius: 12,
                                        background: org.primary_color || c.accentBg,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: 18, fontWeight: 900, color: c.text,
                                        border: `1px solid ${c.border}`,
                                    }}>{org.name.charAt(0).toUpperCase()}</div>
                                    <div>
                                        <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: '-0.02em' }}>{org.name}</div>
                                        <div style={{ fontSize: 11, color: c.muted }}>{org.slug}</div>
                                    </div>
                                </div>

                                {/* Quick stats */}
                                <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
                                    <div style={{ textAlign: 'center' }}>
                                        <div style={{ fontSize: 18, fontWeight: 900, color: c.text }}>{org.user_count}</div>
                                        <div style={{ fontSize: 10, color: c.muted }}>Users</div>
                                    </div>
                                    <div style={{ textAlign: 'center' }}>
                                        <div style={{ fontSize: 18, fontWeight: 900, color: c.text }}>{org.workspace_count}</div>
                                        <div style={{ fontSize: 10, color: c.muted }}>Workspaces</div>
                                    </div>
                                    <div style={{ textAlign: 'center' }}>
                                        <div style={{ fontSize: 18, fontWeight: 900, color: c.text }}>{org.project_count}</div>
                                        <div style={{ fontSize: 10, color: c.muted }}>Projects</div>
                                    </div>

                                    {/* Actions */}
                                    <button onClick={() => setExpandedOrg(expandedOrg === org.id ? null : org.id)}
                                        style={{ background: c.accentBg, border: `1px solid ${c.accent}40`, borderRadius: 8, color: c.accent, fontSize: 11, fontWeight: 700, padding: '6px 14px', cursor: 'pointer' }}>
                                        {expandedOrg === org.id ? 'Collapse' : 'Details'}
                                    </button>
                                    {onViewOrg && (
                                        <button onClick={() => onViewOrg(org.slug)}
                                            style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.3)', borderRadius: 8, color: c.green, fontSize: 11, fontWeight: 700, padding: '6px 14px', cursor: 'pointer' }}>
                                            View As →
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Expanded details */}
                            {expandedOrg === org.id && (
                                <div style={{ marginTop: 20, paddingTop: 20, borderTop: `1px solid ${c.border}` }}>
                                    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                                        {/* Admins */}
                                        <div style={{ flex: '1 1 250px' }}>
                                            <div style={{ fontSize: 11, fontWeight: 700, color: c.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                                                Admins ({org.admins.length})
                                            </div>
                                            {org.admins.length === 0 ? (
                                                <div style={{ fontSize: 12, color: c.muted }}>No admins assigned</div>
                                            ) : (
                                                org.admins.map(a => (
                                                    <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, background: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: 8 }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                            <div style={{
                                                                width: 28, height: 28, borderRadius: 8,
                                                                background: 'rgba(99,102,241,0.2)', color: '#a5b4fc',
                                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                fontSize: 10, fontWeight: 800,
                                                            }}>{getAvatarInitials(a.name)}</div>
                                                            <div>
                                                                <div style={{ fontSize: 12, fontWeight: 600, color: c.text }}>{a.name || a.email}</div>
                                                                <div style={{ fontSize: 10, color: c.muted }}>{a.email} · {a.role}</div>
                                                            </div>
                                                        </div>
                                                        <select
                                                            onChange={e => handleAssignWorkspace(org.id, a.id, e.target.value)}
                                                            style={{
                                                                background: 'rgba(255,255,255,0.05)', border: `1px solid ${c.border}`,
                                                                borderRadius: 6, color: c.text, fontSize: 10, padding: '4px 6px',
                                                                cursor: 'pointer', outline: 'none', maxWidth: 120
                                                            }}
                                                        >
                                                            <option value="">+ Assign WS</option>
                                                            {org.workspaces.map(ws => (
                                                                <option key={ws.id} value={ws.id}>{ws.name}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                ))
                                            )}
                                        </div>

                                        {/* Workspaces */}
                                        <div style={{ flex: '1 1 250px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                                                <div style={{ fontSize: 11, fontWeight: 700, color: c.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                                    Workspaces ({org.workspaces.length})
                                                </div>
                                                <button onClick={() => handleCreateWorkspace(org.id)}
                                                    style={{ background: 'none', border: 'none', color: c.accent, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                                                    + Add
                                                </button>
                                            </div>
                                            {org.workspaces.map(ws => (
                                                <div key={ws.id} style={{
                                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                    padding: '8px 12px', borderRadius: 8, marginBottom: 4,
                                                    background: 'rgba(255,255,255,0.03)', border: `1px solid ${c.border}`,
                                                }}>
                                                    <span style={{ fontSize: 13, fontWeight: 600 }}>{ws.name}</span>
                                                    <span style={{ fontSize: 10, color: c.muted }}>{ws.member_count} members</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* ── Create Org Modal ─────────────────────────────────────────── */}
            {showCreate && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
                }} onClick={() => setShowCreate(false)}>
                    <div style={{
                        ...cardStyle, width: '100%', maxWidth: 440,
                        boxShadow: '0 32px 64px rgba(0,0,0,0.6)',
                    }} onClick={e => e.stopPropagation()}>
                        <h2 style={{ margin: '0 0 20px', fontSize: 20, fontWeight: 900, letterSpacing: '-0.02em' }}>Create Organization</h2>
                        <form onSubmit={handleCreateOrg} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                            <div>
                                <label style={{ fontSize: 11, fontWeight: 700, color: c.muted, display: 'block', marginBottom: 6 }}>Organization Name *</label>
                                <input value={newOrgName} onChange={e => setNewOrgName(e.target.value)} required placeholder="e.g. Vodafone"
                                    style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: `1px solid ${c.border}`, background: 'rgba(255,255,255,0.04)', color: c.text, fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
                            </div>
                            <div>
                                <label style={{ fontSize: 11, fontWeight: 700, color: c.muted, display: 'block', marginBottom: 6 }}>Admin Email (optional — auto-creates account)</label>
                                <input value={newAdminEmail} onChange={e => setNewAdminEmail(e.target.value)} type="email" placeholder="admin@vodafone.com"
                                    style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: `1px solid ${c.border}`, background: 'rgba(255,255,255,0.04)', color: c.text, fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
                            </div>
                            <div>
                                <label style={{ fontSize: 11, fontWeight: 700, color: c.muted, display: 'block', marginBottom: 6 }}>Plan</label>
                                <select value={newPlan} onChange={e => setNewPlan(e.target.value as any)}
                                    style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: `1px solid ${c.border}`, background: 'rgba(255,255,255,0.04)', color: c.text, fontSize: 14, outline: 'none' }}>
                                    <option value="BASIC">Basic — $29/mo</option>
                                    <option value="PRO">Pro — $49/mo</option>
                                    <option value="MAX">Max — $199/mo</option>
                                </select>
                            </div>
                            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                                <button type="button" onClick={() => setShowCreate(false)}
                                    style={{ flex: 1, padding: '12px', borderRadius: 10, border: `1px solid ${c.border}`, background: 'none', color: c.muted, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                                    Cancel
                                </button>
                                <button type="submit" disabled={creating}
                                    style={{
                                        flex: 1, padding: '12px', borderRadius: 10, border: 'none',
                                        background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                                        color: '#fff', fontWeight: 700, fontSize: 14, cursor: creating ? 'wait' : 'pointer',
                                    }}>
                                    {creating ? 'Creating…' : 'Create Organization'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};
