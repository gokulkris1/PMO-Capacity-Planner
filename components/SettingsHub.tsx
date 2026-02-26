import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

interface ManagedUser {
    id: string; email: string; name: string;
    role: 'PMO' | 'PM' | 'VIEWER' | 'SUPERUSER';
    plan: 'FREE' | 'BASIC' | 'PRO' | 'MAX';
    created_at: string;
}

const ROLE_COLORS: Record<string, string> = { SUPERUSER: '#f43f5e', PMO: '#8b5cf6', PM: '#f59e0b', VIEWER: '#64748b' };
const PLAN_COLORS: Record<string, string> = { FREE: '#64748b', BASIC: '#6366f1', PRO: '#f59e0b', MAX: '#10b981' };

export const SettingsHub: React.FC = () => {
    const { token, user: currentUser } = useAuth();
    const [users, setUsers] = useState<ManagedUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);
    const [error, setError] = useState('');

    // Invite state
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole] = useState<'ADMIN' | 'USER'>('USER');
    const [inviting, setInviting] = useState(false);
    const [inviteSuccess, setInviteSuccess] = useState('');

    useEffect(() => { fetchUsers(); }, []);

    const fetchUsers = async () => {
        setLoading(true); setError('');
        try {
            const res = await fetch('/api/auth/users', { headers: { Authorization: `Bearer ${token}` } });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to load users');
            setUsers(data.users);
        } catch (e: any) { setError(e.message); } finally { setLoading(false); }
    };

    const updateUser = async (userId: string, field: 'plan' | 'role', value: string) => {
        setSaving(userId + field);
        setError('');
        try {
            const res = await fetch(`/api/auth/users/${userId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ [field]: value }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            setUsers(prev => prev.map(u => u.id === userId ? { ...u, ...data.user } : u));
        } catch (e: any) { setError('Error: ' + e.message); } finally { setSaving(null); }
    };

    const deleteUser = async (userId: string) => {
        if (!confirm('Are you sure you want to permanently remove this user?')) return;
        setSaving(userId + 'delete');
        setError('');
        try {
            const res = await fetch(`/api/auth/admin/users/${userId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            setUsers(prev => prev.filter(u => u.id !== userId));
        } catch (e: any) { setError('Error: ' + e.message); } finally { setSaving(null); }
    };

    const inviteUser = async () => {
        if (!inviteEmail.trim()) return;
        setInviting(true); setError(''); setInviteSuccess('');
        try {
            const res = await fetch('/api/auth/users/invite', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Invite failed');
            setInviteSuccess(`Invited! Temp password: ${data.password}`);
            setInviteEmail('');
            setUsers(prev => [data.user, ...prev]);
        } catch (e: any) { setError(e.message); } finally { setInviting(false); }
    };

    return (
        <div style={{ padding: 40, background: '#f8fafc', minHeight: '100%', borderRadius: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
                <span style={{ fontSize: 32 }}>{currentUser?.role === 'SUPERUSER' ? '🚀' : '⚙️'}</span>
                <div>
                    <h2 style={{ fontSize: 24, fontWeight: 700, color: '#1e293b', margin: 0 }}>
                        {currentUser?.role === 'SUPERUSER' ? 'Superuser Cockpit' : 'Workspace Settings'}
                    </h2>
                    <p style={{ color: '#64748b', margin: 0, fontSize: 14 }}>Manage your B2B workspace, billing, and teams</p>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) 2fr', gap: 24, alignItems: 'start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                    <div className="glass-panel" style={{ padding: 24, borderRadius: 16, border: '1px solid #cbd5e1' }}>
                        <h3 style={{ fontSize: 18, color: '#1e293b', marginBottom: 16 }}>Workspace Details</h3>
                        <p style={{ fontSize: 14, color: '#64748b' }}>Configure global workspace attributes. Orbit custom domains coming soon.</p>
                        {currentUser?.email === 'gokulkris1@gmail.com' && (
                            <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(244,63,94,0.1)', color: '#f43f5e', borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
                                🦸 Global Superuser Active
                            </div>
                        )}
                    </div>

                    <div className="glass-panel" style={{ padding: 24, borderRadius: 16, border: '1px solid #cbd5e1' }}>
                        <h3 style={{ fontSize: 18, color: '#1e293b', marginBottom: 16 }}>Billing & Quotas</h3>
                        <p style={{ fontSize: 14, color: '#64748b' }}>Review seat usage, upgrade plans, and manage Stripe subscriptions.</p>
                    </div>
                </div>

                <div className="glass-panel" style={{ padding: 24, borderRadius: 16, border: '1px solid #cbd5e1' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                        <div>
                            <h3 style={{ fontSize: 18, color: '#1e293b', marginBottom: 4 }}>User Directory</h3>
                            <p style={{ fontSize: 14, color: '#64748b', margin: 0 }}>Invite members and manage row-level access controls</p>
                        </div>

                        <div style={{ display: 'flex', gap: 8, background: '#f1f5f9', padding: '6px', borderRadius: 12 }}>
                            <input
                                value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                                placeholder="name@company.com"
                                style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #cbd5e1', outline: 'none', fontSize: 13, width: 200 }}
                            />
                            <select
                                value={inviteRole} onChange={e => setInviteRole(e.target.value as any)}
                                style={{ padding: '8px 24px 8px 12px', borderRadius: 8, border: '1px solid #cbd5e1', outline: 'none', fontSize: 13, cursor: 'pointer', appearance: 'none', background: '#fff' }}
                            >
                                <option value="USER">User</option>
                                <option value="ADMIN">Admin</option>
                            </select>
                            <button onClick={inviteUser} disabled={inviting || !inviteEmail} className="btn btn-primary" style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
                                {inviting ? '...' : '+ Invite'}
                            </button>
                        </div>
                    </div>

                    {inviteSuccess && (
                        <div style={{ padding: 12, background: '#ecfdf5', color: '#047857', border: '1px solid #10b981', borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
                            {inviteSuccess}
                        </div>
                    )}
                    {error && (
                        <div style={{ padding: 12, background: '#fef2f2', color: '#b91c1c', border: '1px solid #f87171', borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
                            {error}
                        </div>
                    )}

                    {loading ? (
                        <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>Loading roster...</div>
                    ) : (
                        <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
                                <thead>
                                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                                        <th style={{ padding: '12px 16px', color: '#475569', fontWeight: 600 }}>Member</th>
                                        <th style={{ padding: '12px 16px', color: '#475569', fontWeight: 600 }}>Role</th>
                                        <th style={{ padding: '12px 16px', color: '#475569', fontWeight: 600 }}>Plan Seats</th>
                                        <th style={{ padding: '12px 16px', color: '#475569', fontWeight: 600 }}>Joined</th>
                                        {currentUser?.role === 'SUPERUSER' && (
                                            <th style={{ padding: '12px 16px', color: '#475569', fontWeight: 600 }}>Actions</th>
                                        )}
                                    </tr>
                                </thead>
                                <tbody>
                                    {users.map(u => (
                                        <tr key={u.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                                            <td style={{ padding: '16px' }}>
                                                <div style={{ fontWeight: 600, color: '#1e293b' }}>{u.name || 'Pending Invite'}</div>
                                                <div style={{ color: '#64748b', fontSize: 12 }}>{u.email}</div>
                                            </td>
                                            <td style={{ padding: '16px' }}>
                                                <select
                                                    value={u.role} disabled={saving === u.id + 'role' || u.id === currentUser?.id}
                                                    onChange={e => updateUser(u.id, 'role', e.target.value)}
                                                    style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 8, color: ROLE_COLORS[u.role] || '#475569', padding: '6px 10px', fontSize: 12, fontWeight: 600, outline: 'none' }}
                                                >
                                                    <option value="SUPERUSER" disabled>Superuser</option>
                                                    <option value="ADMIN">Admin</option>
                                                    <option value="USER">User</option>
                                                </select>
                                            </td>
                                            <td style={{ padding: '16px' }}>
                                                {currentUser?.role === 'SUPERUSER' ? (
                                                    <select
                                                        value={u.plan || 'BASIC'} disabled={saving === u.id + 'plan'}
                                                        onChange={e => updateUser(u.id, 'plan', e.target.value)}
                                                        style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 8, color: PLAN_COLORS[u.plan || 'BASIC'], padding: '6px 10px', fontSize: 12, fontWeight: 700, outline: 'none' }}
                                                    >
                                                        <option value="BASIC">Basic</option>
                                                        <option value="PRO">Pro</option>
                                                        <option value="MAX">Max</option>
                                                    </select>
                                                ) : (
                                                    <span style={{ fontWeight: 700, color: PLAN_COLORS[u.plan || 'BASIC'] }}>{u.plan || 'BASIC'}</span>
                                                )}
                                            </td>
                                            <td style={{ padding: '16px', color: '#64748b' }}>
                                                {new Date(u.created_at).toLocaleDateString()}
                                            </td>
                                            {currentUser?.role === 'SUPERUSER' && (
                                                <td style={{ padding: '16px' }}>
                                                    <button
                                                        disabled={u.id === currentUser?.id || saving === u.id + 'delete'}
                                                        onClick={() => deleteUser(u.id)}
                                                        style={{ padding: '6px 10px', background: '#fee2e2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: (u.id === currentUser?.id) ? 'not-allowed' : 'pointer', opacity: (u.id === currentUser?.id) ? 0.5 : 1 }}
                                                    >
                                                        Remove
                                                    </button>
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
