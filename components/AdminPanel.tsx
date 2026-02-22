import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

interface ManagedUser {
    id: string;
    email: string;
    name: string;
    role: 'PMO' | 'PM' | 'VIEWER';
    plan: 'FREE' | 'BASIC' | 'PRO' | 'MAX';
    created_at: string;
}

const PLAN_COLORS: Record<string, string> = {
    FREE: '#64748b',
    BASIC: '#6366f1',
    PRO: '#f59e0b',
    MAX: '#10b981',
};

const ROLE_COLORS: Record<string, string> = {
    PMO: '#ef4444',
    PM: '#f59e0b',
    VIEWER: '#64748b',
};

export const AdminPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const { token } = useAuth();
    const [users, setUsers] = useState<ManagedUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');

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
                    {(['FREE', 'BASIC', 'PRO', 'MAX'] as const).map(p => {
                        const count = users.filter(u => (u.plan || 'FREE') === p).length;
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

                {/* Search */}
                <div style={{ padding: '12px 24px 0' }}>
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search users by name or email..."
                        style={{
                            width: '100%', padding: '9px 14px', background: '#1e293b', border: '1px solid #334155',
                            borderRadius: 10, color: '#f1f5f9', fontSize: 13, outline: 'none', boxSizing: 'border-box',
                        }}
                    />
                </div>

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
                                                value={u.role}
                                                disabled={saving === u.id + 'role'}
                                                onChange={e => updateUser(u.id, 'role', e.target.value)}
                                                style={{
                                                    background: '#1e293b', border: '1px solid #334155',
                                                    borderRadius: 6, color: ROLE_COLORS[u.role], fontSize: 12,
                                                    padding: '4px 8px', cursor: 'pointer', fontWeight: 600,
                                                }}
                                            >
                                                <option value="PMO">PMO (Admin)</option>
                                                <option value="PM">PM (Editor)</option>
                                                <option value="VIEWER">Viewer</option>
                                            </select>
                                        </td>
                                        <td style={{ padding: '12px 10px' }}>
                                            <select
                                                value={u.plan || 'FREE'}
                                                disabled={saving === u.id + 'plan'}
                                                onChange={e => updateUser(u.id, 'plan', e.target.value)}
                                                style={{
                                                    background: '#1e293b', border: '1px solid #334155',
                                                    borderRadius: 6, color: PLAN_COLORS[u.plan || 'FREE'], fontSize: 12,
                                                    padding: '4px 8px', cursor: 'pointer', fontWeight: 700,
                                                }}
                                            >
                                                <option value="FREE">Free</option>
                                                <option value="BASIC">Basic (€29)</option>
                                                <option value="PRO">Pro (€79)</option>
                                                <option value="MAX">Max (€199)</option>
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
