import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';

interface PlatformUser {
    id: string; email: string; name: string;
    role: 'SUPERUSER' | 'ADMIN' | 'USER';
    plan: 'BASIC' | 'PRO' | 'MAX';
    created_at: string;
}
interface Stats {
    total_users: number; basic_users: number;
    pro_users: number; max_users: number; new_this_week: number; mrr_eur: number;
}

const PLAN_COLOR: Record<string, string> = { BASIC: '#6366f1', PRO: '#f59e0b', MAX: '#10b981' };
const ROLE_COLOR: Record<string, string> = { SUPERUSER: '#f43f5e', ADMIN: '#ef4444', USER: '#64748b' };
const PLANS = ['BASIC', 'PRO', 'MAX'] as const;
const ROLES = ['SUPERUSER', 'ADMIN', 'USER'] as const;

/* ── small reusable select ── */
const PlanSelect = ({ value, userId, onChange, saving }: {
    value: string; userId: string; onChange: (id: string, field: string, val: string) => void; saving: string | null;
}) => (
    <select
        value={value} disabled={saving?.startsWith(userId)}
        onChange={e => onChange(userId, 'plan', e.target.value)}
        style={{
            background: '#1e293b', border: '1px solid #334155', borderRadius: 6,
            color: PLAN_COLOR[value], fontSize: 12, padding: '4px 8px', cursor: 'pointer', fontWeight: 700
        }}
    >
        {PLANS.map(p => <option key={p} value={p}>{p}</option>)}
    </select>
);

const RoleSelect = ({ value, userId, onChange, saving }: {
    value: string; userId: string; onChange: (id: string, field: string, val: string) => void; saving: string | null;
}) => (
    <select
        value={value} disabled={saving?.startsWith(userId)}
        onChange={e => onChange(userId, 'role', e.target.value)}
        style={{
            background: '#1e293b', border: '1px solid #334155', borderRadius: 6,
            color: ROLE_COLOR[value] || '#64748b', fontSize: 12, padding: '4px 8px', cursor: 'pointer', fontWeight: 600
        }}
    >
        {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
    </select>
);

export const SuperAdminPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const { token } = useAuth();
    const [users, setUsers] = useState<PlatformUser[]>([]);
    const [stats, setStats] = useState<Stats | null>(null);
    const [saving, setSaving] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState('');
    const [search, setSearch] = useState('');
    const [tab, setTab] = useState<'users' | 'create'>('users');
    const [deleting, setDeleting] = useState<string | null>(null);

    /* create-user form */
    const [form, setForm] = useState({ email: '', password: '', name: '', role: 'USER', plan: 'BASIC' });
    const [creating, setCreating] = useState(false);
    const [createMsg, setCreateMsg] = useState('');

    const authHdr = { Authorization: `Bearer ${token}` };

    const fetchAll = useCallback(async () => {
        setLoading(true); setErr('');
        try {
            const [uRes, sRes] = await Promise.all([
                fetch('/api/auth/users', { headers: authHdr }),
                fetch('/api/auth/admin/stats', { headers: authHdr }),
            ]);
            if (!uRes.ok) throw new Error((await uRes.json()).error || 'Load failed');
            setUsers((await uRes.json()).users);
            if (sRes.ok) setStats((await sRes.json()).stats);
        } catch (e: any) { setErr(e.message); }
        setLoading(false);
    }, [token]);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    const updateUser = async (userId: string, field: string, value: string) => {
        setSaving(userId + field);
        try {
            const r = await fetch(`/api/auth/users/${userId}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHdr },
                body: JSON.stringify({ [field]: value }),
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error);
            setUsers(prev => prev.map(u => u.id === userId ? { ...u, ...d.user } : u));
        } catch (e: any) { alert('Error: ' + e.message); }
        setSaving(null);
    };

    const deleteUser = async (userId: string, email: string) => {
        if (!window.confirm(`Permanently delete ${email}? This cannot be undone.`)) return;
        setDeleting(userId);
        try {
            const r = await fetch(`/api/auth/admin/users/${userId}`, { method: 'DELETE', headers: authHdr });
            if (!r.ok) throw new Error((await r.json()).error);
            setUsers(prev => prev.filter(u => u.id !== userId));
        } catch (e: any) { alert('Error: ' + e.message); }
        setDeleting(null);
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault(); setCreating(true); setCreateMsg('');
        try {
            const r = await fetch('/api/auth/admin/users', {
                method: 'POST', headers: { 'Content-Type': 'application/json', ...authHdr },
                body: JSON.stringify(form),
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error);
            setUsers(prev => [d.user, ...prev]);
            setCreateMsg(`✅ Created: ${d.user.email} (${d.user.role} / ${d.user.plan})`);
            setForm({ email: '', password: '', name: '', role: 'USER', plan: 'BASIC' });
        } catch (e: any) { setCreateMsg('❌ ' + e.message); }
        setCreating(false);
    };

    const filtered = users.filter(u =>
        u.email.toLowerCase().includes(search.toLowerCase()) ||
        (u.name || '').toLowerCase().includes(search.toLowerCase())
    );

    /* ── STATS CARDS ── */
    const StatCard = ({ label, value, color }: { label: string; value: string | number; color?: string }) => (
        <div style={{
            flex: 1, minWidth: 100, background: '#1e293b', borderRadius: 12, padding: '12px 16px',
            border: `1px solid ${color || '#334155'}33`, textAlign: 'center'
        }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: color || '#f1f5f9' }}>{value}</div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>{label}</div>
        </div>
    );

    return (
        <div style={{
            position: 'fixed', inset: 0, background: 'rgba(2,6,18,.94)', backdropFilter: 'blur(8px)',
            zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem'
        }}
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div style={{
                background: '#0a0f1e', borderRadius: 22, border: '1px solid #1e293b',
                width: '100%', maxWidth: 960, maxHeight: '92vh',
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
                boxShadow: '0 40px 100px rgba(0,0,0,.7)'
            }}>

                {/* ── HEADER ── */}
                <div style={{
                    padding: '18px 24px', borderBottom: '1px solid #1e293b',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: 'linear-gradient(135deg,rgba(244,63,94,.08),rgba(99,102,241,.06))'
                }}>
                    <div>
                        <div style={{ fontSize: 20, fontWeight: 900, color: '#f1f5f9' }}>
                            🦸 Superuser Console
                        </div>
                        <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                            Platform administration · all tenants · all plans
                        </div>
                    </div>
                    <button onClick={onClose} style={{
                        background: '#1e293b', border: '1px solid #334155',
                        borderRadius: 8, color: '#94a3b8', fontSize: 20, width: 36, height: 36, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>×</button>
                </div>

                {/* ── STATS ── */}
                {stats && (
                    <div style={{ display: 'flex', gap: 10, padding: '14px 24px 0', flexWrap: 'wrap' }}>
                        <StatCard label="Total Users" value={stats.total_users} />
                        <StatCard label="Basic" value={stats.basic_users} color={PLAN_COLOR.BASIC} />
                        <StatCard label="Pro" value={stats.pro_users} color={PLAN_COLOR.PRO} />
                        <StatCard label="Max" value={stats.max_users} color={PLAN_COLOR.MAX} />
                        <StatCard label="New (7d)" value={stats.new_this_week} color="#38bdf8" />
                        <StatCard label="MRR (€)" value={`€${stats.mrr_eur}`} color="#10b981" />
                    </div>
                )}

                {/* ── TABS ── */}
                <div style={{ display: 'flex', gap: 6, padding: '14px 24px 0' }}>
                    {(['users', 'create'] as const).map(t => (
                        <button key={t} onClick={() => setTab(t)} style={{
                            padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                            background: tab === t ? '#6366f1' : '#1e293b',
                            color: tab === t ? '#fff' : '#64748b',
                        }}>
                            {t === 'users' ? `👥 Users (${users.length})` : '➕ Create User'}
                        </button>
                    ))}
                    <div style={{ flex: 1 }} />
                    <button onClick={fetchAll} style={{
                        padding: '6px 14px', background: '#1e293b',
                        border: '1px solid #334155', borderRadius: 8, color: '#94a3b8', cursor: 'pointer', fontSize: 13
                    }}>
                        ↻ Refresh
                    </button>
                </div>

                {/* ── CONTENT ── */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '12px 24px 20px' }}>
                    {err && <div style={{
                        padding: 16, color: '#ef4444', background: 'rgba(239,68,68,.08)',
                        borderRadius: 10, marginBottom: 12
                    }}>{err}</div>}

                    {/* USERS TAB */}
                    {tab === 'users' && (
                        <>
                            <input value={search} onChange={e => setSearch(e.target.value)}
                                placeholder="Search by name or email..."
                                style={{
                                    width: '100%', padding: '9px 14px', background: '#1e293b',
                                    border: '1px solid #334155', borderRadius: 10, color: '#f1f5f9',
                                    fontSize: 13, outline: 'none', boxSizing: 'border-box', marginBottom: 12
                                }} />

                            {loading ? (
                                <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>Loading…</div>
                            ) : (
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                    <thead>
                                        <tr style={{ borderBottom: '1px solid #1e293b' }}>
                                            {['User', 'Joined', 'Role', 'Plan', 'License', 'Delete'].map(h => (
                                                <th key={h} style={{
                                                    textAlign: 'left', padding: '8px 10px', color: '#64748b',
                                                    fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em'
                                                }}>{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filtered.map(u => (
                                            <tr key={u.id} style={{ borderBottom: '1px solid #0f1629' }}>
                                                <td style={{ padding: '11px 10px' }}>
                                                    <div style={{ fontWeight: 700, color: '#f1f5f9' }}>{u.name || '—'}</div>
                                                    <div style={{ color: '#64748b', fontSize: 11 }}>{u.email}</div>
                                                </td>
                                                <td style={{ padding: '11px 10px', color: '#64748b', fontSize: 12 }}>
                                                    {new Date(u.created_at).toLocaleDateString('en-GB')}
                                                </td>
                                                <td style={{ padding: '11px 10px' }}>
                                                    <RoleSelect value={u.role || 'USER'} userId={u.id} onChange={updateUser} saving={saving} />
                                                </td>
                                                <td style={{ padding: '11px 10px' }}>
                                                    <PlanSelect value={u.plan || 'BASIC'} userId={u.id} onChange={updateUser} saving={saving} />
                                                </td>
                                                {/* Quick license buttons */}
                                                <td style={{ padding: '11px 10px' }}>
                                                    <div style={{ display: 'flex', gap: 4 }}>
                                                        {(['BASIC', 'PRO', 'MAX'] as const).map(p => (
                                                            <button key={p} onClick={() => updateUser(u.id, 'plan', p)}
                                                                disabled={u.plan === p || saving?.startsWith(u.id)}
                                                                style={{
                                                                    padding: '3px 7px', background: u.plan === p ? PLAN_COLOR[p] + '33' : '#1e293b',
                                                                    border: `1px solid ${u.plan === p ? PLAN_COLOR[p] : '#334155'}`,
                                                                    borderRadius: 5, color: u.plan === p ? PLAN_COLOR[p] : '#475569',
                                                                    fontSize: 10, cursor: u.plan === p ? 'default' : 'pointer', fontWeight: 700
                                                                }}>
                                                                {p}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </td>
                                                <td style={{ padding: '11px 10px' }}>
                                                    <button onClick={() => deleteUser(u.id, u.email)}
                                                        disabled={deleting === u.id || u.role === 'SUPERUSER'}
                                                        style={{
                                                            background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)',
                                                            borderRadius: 6, color: '#ef4444', fontSize: 12, padding: '4px 10px',
                                                            cursor: u.role === 'SUPERUSER' ? 'not-allowed' : 'pointer', opacity: u.role === 'SUPERUSER' ? .4 : 1
                                                        }}>
                                                        {deleting === u.id ? '…' : '🗑'}
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </>
                    )}

                    {/* CREATE USER TAB */}
                    {tab === 'create' && (
                        <form onSubmit={handleCreate} style={{ maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 14 }}>
                            <h3 style={{ color: '#f1f5f9', margin: 0, fontWeight: 800 }}>Create new user account</h3>
                            {[
                                { label: 'Full Name', key: 'name', type: 'text', placeholder: 'Jane Smith' },
                                { label: 'Email Address', key: 'email', type: 'email', placeholder: 'jane@company.com' },
                                { label: 'Password', key: 'password', type: 'password', placeholder: 'Minimum 8 chars' },
                            ].map(f => (
                                <div key={f.key}>
                                    <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 5 }}>{f.label}</label>
                                    <input
                                        type={f.type} value={form[f.key as keyof typeof form]}
                                        onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                                        placeholder={f.placeholder} required={f.key === 'email' || f.key === 'password'}
                                        style={{
                                            width: '100%', padding: '10px 14px', background: '#1e293b',
                                            border: '1px solid #334155', borderRadius: 10, color: '#f1f5f9',
                                            fontSize: 13, outline: 'none', boxSizing: 'border-box'
                                        }}
                                    />
                                </div>
                            ))}
                            <div style={{ display: 'flex', gap: 12 }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 5 }}>Role</label>
                                    <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
                                        style={{
                                            width: '100%', padding: '10px 14px', background: '#1e293b', border: '1px solid #334155',
                                            borderRadius: 10, color: ROLE_COLOR[form.role] || '#f1f5f9', fontSize: 13, outline: 'none'
                                        }}>
                                        {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                                    </select>
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 5 }}>Plan</label>
                                    <select value={form.plan} onChange={e => setForm(p => ({ ...p, plan: e.target.value }))}
                                        style={{
                                            width: '100%', padding: '10px 14px', background: '#1e293b', border: '1px solid #334155',
                                            borderRadius: 10, color: PLAN_COLOR[form.plan] || '#f1f5f9', fontSize: 13, outline: 'none'
                                        }}>
                                        {PLANS.map(p => <option key={p} value={p}>{p}</option>)}
                                    </select>
                                </div>
                            </div>
                            {createMsg && (
                                <div style={{
                                    padding: 10, borderRadius: 8, fontSize: 13,
                                    background: createMsg.startsWith('✅') ? 'rgba(16,185,129,.1)' : 'rgba(239,68,68,.1)',
                                    color: createMsg.startsWith('✅') ? '#10b981' : '#ef4444'
                                }}>
                                    {createMsg}
                                </div>
                            )}
                            <button type="submit" disabled={creating} style={{
                                padding: '12px 24px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
                                border: 'none', borderRadius: 10, color: '#fff', fontWeight: 700, fontSize: 14,
                                cursor: creating ? 'not-allowed' : 'pointer', opacity: creating ? .7 : 1,
                            }}>
                                {creating ? 'Creating…' : '🚀 Create Account'}
                            </button>
                        </form>
                    )}
                </div>

                {/* FOOTER */}
                <div style={{
                    padding: '10px 24px', borderTop: '1px solid #1e293b',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                }}>
                    <div style={{ fontSize: 11, color: '#334155' }}>
                        Changes are live instantly · Set SUPER_ADMIN_EMAIL env var for permanent superuser access
                    </div>
                    <div style={{ fontSize: 11, color: '#475569' }}>
                        🦸 SUPERUSER console · PMO Planner
                    </div>
                </div>
            </div>
        </div>
    );
};
