import React, { useState, useEffect } from 'react';
import { useAuth, canManageMembers } from '../context/AuthContext';

interface Member {
    id: string;
    email: string;
    name?: string;
    platform_role: string;
    workspace_role: string;
}

const ROLE_COLOR: Record<string, string> = {
    WORKSPACE_ADMIN: '#10b981',
    USER: '#64748b',
};

const MemberManagement: React.FC = () => {
    const { user, token, activeWorkspace } = useAuth();
    const [members, setMembers] = useState<Member[]>([]);
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole] = useState<'WORKSPACE_ADMIN' | 'USER'>('USER');
    const [loading, setLoading] = useState(false);
    const [removing, setRemoving] = useState<string | null>(null);
    const [msg, setMsg] = useState('');
    const [err, setErr] = useState('');

    const authHdr = { Authorization: `Bearer ${token}` };
    const isAdmin = canManageMembers(user);

    // Fetch members from the workspace GET endpoint
    useEffect(() => {
        if (!activeWorkspace || !token) return;
        fetch(`/api/workspace?orgSlug=${activeWorkspace.orgSlug}&workspaceId=${activeWorkspace.id}`, {
            headers: authHdr
        })
            .then(r => r.json())
            .then(data => { if (data.members) setMembers(data.members); })
            .catch(console.error);
    }, [activeWorkspace?.id, token]);

    const handleInvite = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!activeWorkspace) return;
        setLoading(true); setMsg(''); setErr('');
        try {
            const r = await fetch('/api/auth/users/invite', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHdr },
                body: JSON.stringify({ email: inviteEmail, workspaceId: activeWorkspace.id, workspaceRole: inviteRole }),
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error);
            setMsg(`✅ ${inviteEmail} added as ${inviteRole === 'WORKSPACE_ADMIN' ? 'Workspace Admin' : 'Viewer'}`);
            setInviteEmail('');
            // Re-fetch members
            const updated = await fetch(`/api/workspace?orgSlug=${activeWorkspace.orgSlug}&workspaceId=${activeWorkspace.id}`, { headers: authHdr });
            const ud = await updated.json();
            if (ud.members) setMembers(ud.members);
        } catch (e: any) { setErr('❌ ' + e.message); }
        setLoading(false);
    };

    const handleRemove = async (memberId: string, email: string) => {
        if (!activeWorkspace || !window.confirm(`Remove ${email} from this workspace?`)) return;
        setRemoving(memberId);
        try {
            const r = await fetch('/api/auth/remove-member', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHdr },
                body: JSON.stringify({ userId: memberId, workspaceId: activeWorkspace.id }),
            });
            if (!r.ok) throw new Error((await r.json()).error);
            setMembers(prev => prev.filter(m => m.id !== memberId));
        } catch (e: any) { alert('Error: ' + e.message); }
        setRemoving(null);
    };

    const inputStyle: React.CSSProperties = {
        width: '100%', padding: '9px 12px', background: '#1e293b',
        border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9',
        fontSize: 13, outline: 'none', boxSizing: 'border-box'
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Header */}
            <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#f1f5f9', marginBottom: 4 }}>
                    👥 Workspace Members
                </div>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                    {activeWorkspace?.name} · {members.length} member{members.length !== 1 ? 's' : ''}
                </div>
            </div>

            {/* Invite form — ORG_ADMIN/SUPERUSER only */}
            {isAdmin && (
                <form onSubmit={handleInvite} style={{
                    background: '#0f1629', border: '1px solid #1e293b', borderRadius: 12, padding: 16,
                    display: 'flex', flexDirection: 'column', gap: 12
                }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8' }}>Invite member</div>
                    <div style={{ display: 'flex', gap: 10 }}>
                        <input
                            type="email" required value={inviteEmail}
                            onChange={e => setInviteEmail(e.target.value)}
                            placeholder="colleague@company.com"
                            style={{ ...inputStyle, flex: 1 }}
                        />
                        <select
                            value={inviteRole}
                            onChange={e => setInviteRole(e.target.value as any)}
                            style={{ ...inputStyle, width: 'auto', paddingRight: 28, flex: '0 0 160px' }}
                        >
                            <option value="WORKSPACE_ADMIN">Workspace Admin</option>
                            <option value="USER">Viewer</option>
                        </select>
                    </div>
                    {msg && <div style={{ fontSize: 12, color: '#10b981' }}>{msg}</div>}
                    {err && <div style={{ fontSize: 12, color: '#ef4444' }}>{err}</div>}
                    <button type="submit" disabled={loading} style={{
                        padding: '9px 20px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
                        border: 'none', borderRadius: 8, color: '#fff', fontWeight: 700,
                        fontSize: 13, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
                        alignSelf: 'flex-start'
                    }}>
                        {loading ? 'Adding…' : '+ Add to Workspace'}
                    </button>
                </form>
            )}

            {/* Members table */}
            <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid #1e293b' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                        <tr style={{ background: '#0f1629' }}>
                            {['Member', 'Platform Role', 'Workspace Role', isAdmin ? 'Actions' : ''].filter(Boolean).map(h => (
                                <th key={h} style={{
                                    padding: '10px 14px', textAlign: 'left', color: '#64748b',
                                    fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em'
                                }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {members.length === 0 ? (
                            <tr>
                                <td colSpan={4} style={{ padding: 24, textAlign: 'center', color: '#475569', fontSize: 13 }}>
                                    No members found
                                </td>
                            </tr>
                        ) : members.map(m => (
                            <tr key={m.id} style={{ borderTop: '1px solid #1e293b' }}>
                                <td style={{ padding: '11px 14px' }}>
                                    <div style={{ fontWeight: 600, color: '#f1f5f9' }}>{m.name || '—'}</div>
                                    <div style={{ color: '#64748b', fontSize: 11 }}>{m.email}</div>
                                </td>
                                <td style={{ padding: '11px 14px', color: '#64748b', fontSize: 12 }}>
                                    {m.platform_role}
                                </td>
                                <td style={{ padding: '11px 14px' }}>
                                    <span style={{
                                        fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 5,
                                        background: (ROLE_COLOR[m.workspace_role] || '#64748b') + '22',
                                        color: ROLE_COLOR[m.workspace_role] || '#64748b',
                                        border: `1px solid ${(ROLE_COLOR[m.workspace_role] || '#64748b')}44`
                                    }}>
                                        {m.workspace_role === 'WORKSPACE_ADMIN' ? 'Admin' : 'Viewer'}
                                    </span>
                                </td>
                                {isAdmin && (
                                    <td style={{ padding: '11px 14px' }}>
                                        <button
                                            onClick={() => handleRemove(m.id, m.email)}
                                            disabled={removing === m.id || m.id === user?.id}
                                            style={{
                                                background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)',
                                                borderRadius: 6, color: '#ef4444', fontSize: 11, padding: '4px 10px',
                                                cursor: m.id === user?.id ? 'not-allowed' : 'pointer',
                                                opacity: m.id === user?.id ? 0.4 : 1
                                            }}>
                                            {removing === m.id ? '…' : 'Remove'}
                                        </button>
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default MemberManagement;
