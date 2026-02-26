import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

interface ManagedUser {
    id: string;
    email: string;
    name: string;
    role: 'ADMIN' | 'USER';
    plan: 'BASIC' | 'PRO' | 'MAX';
    created_at: string;
}

const PLAN_COLORS: Record<string, string> = {
    BASIC: '#6366f1',
    PRO: '#f59e0b',
    MAX: '#10b981',
};

const ROLE_COLORS: Record<string, string> = {
    ADMIN: '#ef4444',
    USER: '#64748b',
};

export const AdminPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const { token } = useAuth();
    const [users, setUsers] = useState<ManagedUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');

    // Invite state
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole] = useState<'ADMIN' | 'USER'>('USER');
    const [inviting, setInviting] = useState(false);
    const [inviteSuccess, setInviteSuccess] = useState('');

    useEffect(() => {
        fetchUsers();
    }, []);

    const fetchUsers = async () => {
        setLoading(true);
        setError('');
        try {
            const res = await fetch('/api/auth/users', {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to load users');
            setUsers(data.users);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const updateUser = async (userId: string, field: 'plan' | 'role', value: string) => {
        setSaving(userId + field);
        try {
            const res = await fetch(`/api/auth/users/${userId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ [field]: value }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Update failed');
            setUsers(prev => prev.map(u => u.id === userId ? { ...u, ...data.user } : u));
        } catch (e: any) {
            alert('Error: ' + e.message);
        } finally {
            setSaving(null);
        }
    };

    const inviteUser = async () => {
        if (!inviteEmail.trim()) return;
        setInviting(true);
        setError('');
        setInviteSuccess('');
        try {
            const res = await fetch('/api/auth/users/invite', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Invite failed');

            setInviteSuccess(`User created! Temporary Password: ${data.password}`);
            setInviteEmail('');
            setUsers(prev => [data.user, ...prev]);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setInviting(false);
        }
    };

    const filtered = users.filter(u =>
        u.email.toLowerCase().includes(search.toLowerCase()) ||
        (u.name || '').toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div style={{
            position: 'fixed', inset: 0,
            background: 'rgba(5, 8, 20, 0.92)', backdropFilter: 'blur(8px)',
            zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1rem',
        }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div style={{
                background: '#0f172a', borderRadius: 20, border: '1px solid #1e293b',
                width: '100%', maxWidth: 820, maxHeight: '88vh',
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
                boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
            }}>
                {/* Header */}
                <div style={{
                    padding: '20px 24px 16px', borderBottom: '1px solid #1e293b',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                    <div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: '#f1f5f9' }}>⚙️ Admin Panel</div>
                        <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
                            Manage user plans, roles, and access
                        </div>
                    </div>
                    <button onClick={onClose} style={{
                        background: '#1e293b', border: '1px solid #334155', borderRadius: 8,
                        color: '#94a3b8', fontSize: 20, width: 36, height: 36, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>×</button>
                </div>

                {/* Stats */}
                <div style={{ display: 'flex', gap: 12, padding: '16px 24px 0' }}>
                    {(['BASIC', 'PRO', 'MAX'] as const).map(p => {
                        const count = users.filter(u => (u.plan || 'BASIC') === p).length;
                        return (
                            <div key={p} style={{
                                flex: 1, background: '#1e293b', borderRadius: 10, padding: '10px 14px',
                                textAlign: 'center', border: `1px solid ${PLAN_COLORS[p]}22`,
                            }}>
                                <div style={{ fontSize: 20, fontWeight: 800, color: PLAN_COLORS[p] }}>{count}</div>
                                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{p}</div>
                            </div>
                        );
                    })}
                    <div style={{ flex: 1, background: '#1e293b', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
                        <div style={{ fontSize: 20, fontWeight: 800, color: '#f1f5f9' }}>{users.length}</div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Total</div>
                    </div>
                </div>

                {/* Search & Invite */}
                <div style={{ padding: '16px 24px 0', display: 'flex', gap: 12 }}>
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search users..."
                        style={{
                            flex: 1, padding: '9px 14px', background: '#1e293b', border: '1px solid #334155',
                            borderRadius: 10, color: '#f1f5f9', fontSize: 13, outline: 'none'
                        }}
                    />
                    <div style={{ display: 'flex', gap: 6, background: '#1e293b', border: '1px solid #334155', borderRadius: 10, padding: 4 }}>
                        <input
                            value={inviteEmail}
                            onChange={e => setInviteEmail(e.target.value)}
                            placeholder="New member email"
                            style={{
                                width: 180, padding: '5px 10px', background: 'transparent', border: 'none',
                                color: '#f1f5f9', fontSize: 13, outline: 'none'
                            }}
                        />
                        <select
                            value={inviteRole}
                            onChange={e => setInviteRole(e.target.value as any)}
                            style={{
                                background: '#334155', border: 'none', borderRadius: 6, color: '#f1f5f9',
                                fontSize: 12, padding: '0 8px', outline: 'none', cursor: 'pointer'
                            }}
                        >
                            <option value="USER">User</option>
                            <option value="ADMIN">Admin</option>
                        </select>
                        <button
                            onClick={inviteUser}
                            disabled={inviting || !inviteEmail}
                            style={{
                                background: '#2563eb', border: 'none', borderRadius: 6, color: '#fff',
                                padding: '0 12px', fontSize: 13, fontWeight: 600, cursor: inviting || !inviteEmail ? 'not-allowed' : 'pointer',
                                opacity: inviting || !inviteEmail ? 0.6 : 1
                            }}
                        >
                            {inviting ? '...' : 'Invite'}
                        </button>
                    </div>
                </div>

                {inviteSuccess && (
                    <div style={{ margin: '16px 24px 0', padding: '10px 14px', background: '#ecfdf5', border: '1px solid #10b981', color: '#047857', borderRadius: 8, fontSize: 13, fontWeight: 500 }}>
                        {inviteSuccess} <span style={{ color: '#065f46', fontSize: 11, marginLeft: 8 }}>(Please supply this password to the user. They can log in immediately.)</span>
                    </div>
                )}

                {/* Table */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '12px 24px 20px' }}>
                    {loading ? (
                        <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>Loading users...</div>
                    ) : error ? (
                        <div style={{ textAlign: 'center', padding: 40, color: '#ef4444' }}>
                            {error}
                            <br /><br />
                            <button onClick={fetchUsers} style={{ padding: '8px 16px', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#94a3b8', cursor: 'pointer' }}>
                                Retry
                            </button>
                        </div>
                    ) : filtered.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>No users found.</div>
                    ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid #1e293b' }}>
                                    {['User', 'Joined', 'Role', 'Plan', 'Actions'].map(h => (
                                        <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: '#64748b', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map(u => (
                                    <tr key={u.id} style={{ borderBottom: '1px solid #0f1629' }}>
                                        <td style={{ padding: '12px 10px' }}>
                                            <div style={{ fontWeight: 600, color: '#f1f5f9' }}>{u.name || '—'}</div>
                                            <div style={{ color: '#64748b', fontSize: 12 }}>{u.email}</div>
                                        </td>
                                        <td style={{ padding: '12px 10px', color: '#64748b', fontSize: 12 }}>
                                            {new Date(u.created_at).toLocaleDateString('en-GB')}
                                        </td>
                                        <td style={{ padding: '12px 10px' }}>
                                            <select
                                                value={u.role || 'USER'}
                                                disabled={saving === u.id + 'role'}
                                                onChange={e => updateUser(u.id, 'role', e.target.value)}
                                                style={{
                                                    background: '#1e293b', border: '1px solid #334155',
                                                    borderRadius: 6, color: ROLE_COLORS[u.role || 'USER'], fontSize: 12,
                                                    padding: '4px 8px', cursor: 'pointer', fontWeight: 600,
                                                }}
                                            >
                                                <option value="ADMIN">Admin</option>
                                                <option value="USER">User</option>
                                            </select>
                                        </td>
                                        <td style={{ padding: '12px 10px' }}>
                                            <select
                                                value={u.plan || 'BASIC'}
                                                disabled={saving === u.id + 'plan'}
                                                onChange={e => updateUser(u.id, 'plan', e.target.value)}
                                                style={{
                                                    background: '#1e293b', border: '1px solid #334155',
                                                    borderRadius: 6, color: PLAN_COLORS[u.plan || 'BASIC'], fontSize: 12,
                                                    padding: '4px 8px', cursor: 'pointer', fontWeight: 700,
                                                }}
                                            >
                                                <option value="BASIC">Basic</option>
                                                <option value="PRO">Pro</option>
                                                <option value="MAX">Max</option>
                                            </select>
                                        </td>
                                        <td style={{ padding: '12px 10px' }}>
                                            <div style={{
                                                display: 'inline-block',
                                                width: 8, height: 8, borderRadius: '50%',
                                                background: saving?.startsWith(u.id) ? '#f59e0b' : '#10b981',
                                                marginRight: 6,
                                            }} />
                                            <span style={{ fontSize: 11, color: saving?.startsWith(u.id) ? '#f59e0b' : '#64748b' }}>
                                                {saving?.startsWith(u.id) ? 'Saving...' : 'Saved'}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* Footer */}
                <div style={{ padding: '12px 24px', borderTop: '1px solid #1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: 12, color: '#64748b' }}>
                        💡 Changes take effect immediately. Users see their new plan on next login.
                    </div>
                    <button onClick={fetchUsers} style={{
                        padding: '7px 16px', background: '#1e293b', border: '1px solid #334155',
                        borderRadius: 8, color: '#94a3b8', cursor: 'pointer', fontSize: 13,
                    }}>↻ Refresh</button>
                </div>
            </div>
        </div>
    );
};
