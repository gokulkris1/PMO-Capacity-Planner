/**
 * components/SettingsHub.MemberManagement.tsx
 *
 * Drop-in replacement for the member management section of SettingsHub.
 * Shows workspace members, allows invite (with role) and removal.
 * Only rendered for WORKSPACE_ADMIN / ORG_ADMIN / SUPERUSER.
 */
import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

interface Member {
    id: string;
    email: string;
    name?: string;
    platform_role: string;
    workspace_role: 'WORKSPACE_ADMIN' | 'USER';
}

interface Props {
    /** Pass the members array returned from the workspace GET endpoint */
    initialMembers?: Member[];
}

const MemberManagement: React.FC<Props> = ({ initialMembers = [] }) => {
    const { token, user, activeWorkspace } = useAuth();

    const [members, setMembers]         = useState<Member[]>(initialMembers);
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole]   = useState<'USER' | 'WORKSPACE_ADMIN'>('USER');
    const [loading, setLoading]         = useState(false);
    const [feedback, setFeedback]       = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

    // Refresh members whenever workspace changes
    useEffect(() => { setMembers(initialMembers); }, [initialMembers]);

    if (!activeWorkspace) return null;

    // ── Invite ────────────────────────────────────────────────────────────────
    const handleInvite = async () => {
        if (!inviteEmail.trim()) return;
        setLoading(true);
        setFeedback(null);

        try {
            const res = await fetch('/.netlify/functions/auth/invite', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    email: inviteEmail.trim(),
                    workspaceId: activeWorkspace.id,
                    workspaceRole: inviteRole,
                }),
            });
            const data = await res.json();

            if (!res.ok) {
                setFeedback({ type: 'err', msg: data.error || 'Invite failed' });
            } else {
                setFeedback({ type: 'ok', msg: data.message });
                setInviteEmail('');
                // Optimistically add to list if not already present
                setMembers((prev) => {
                    if (prev.some((m) => m.email === inviteEmail.trim())) {
                        return prev.map((m) =>
                            m.email === inviteEmail.trim()
                                ? { ...m, workspace_role: inviteRole }
                                : m,
                        );
                    }
                    return [
                        ...prev,
                        {
                            id: 'pending',
                            email: inviteEmail.trim(),
                            platform_role: 'MEMBER',
                            workspace_role: inviteRole,
                        },
                    ];
                });
            }
        } catch (e) {
            setFeedback({ type: 'err', msg: 'Network error' });
        } finally {
            setLoading(false);
        }
    };

    // ── Remove ────────────────────────────────────────────────────────────────
    const handleRemove = async (memberId: string, memberEmail: string) => {
        if (!confirm(`Remove ${memberEmail} from this workspace?`)) return;

        try {
            const res = await fetch('/.netlify/functions/auth/remove-member', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    userId: memberId,
                    workspaceId: activeWorkspace.id,
                }),
            });
            if (res.ok) {
                setMembers((prev) => prev.filter((m) => m.id !== memberId));
            }
        } catch (e) {
            console.error('Remove failed', e);
        }
    };

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div style={{ padding: '0 0 24px' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', color: '#fff' }}>
                Workspace Members
                <span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'rgba(255,255,255,0.45)', marginLeft: 8 }}>
                    {activeWorkspace.name}
                </span>
            </h3>

            {/* Current members list */}
            <div style={{ marginBottom: '24px' }}>
                {members.length === 0 ? (
                    <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.85rem' }}>No members yet.</p>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                        <thead>
                            <tr style={{ color: 'rgba(255,255,255,0.4)', textAlign: 'left' }}>
                                <th style={{ padding: '4px 0', fontWeight: 500 }}>Email</th>
                                <th style={{ padding: '4px 0', fontWeight: 500 }}>Workspace Role</th>
                                <th />
                            </tr>
                        </thead>
                        <tbody>
                            {members.map((m) => (
                                <tr key={m.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                                    <td style={{ padding: '8px 0', color: '#e2e8f0' }}>
                                        {m.name || m.email}
                                        {m.id === user?.id && (
                                            <span style={{ color: 'rgba(255,255,255,0.3)', marginLeft: 6, fontSize: '0.75rem' }}>(you)</span>
                                        )}
                                    </td>
                                    <td style={{ padding: '8px 0' }}>
                                        <span style={{
                                            fontSize: '0.7rem',
                                            fontWeight: 700,
                                            textTransform: 'uppercase',
                                            background: m.workspace_role === 'WORKSPACE_ADMIN' ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.08)',
                                            color: m.workspace_role === 'WORKSPACE_ADMIN' ? '#a5b4fc' : 'rgba(255,255,255,0.55)',
                                            padding: '2px 8px',
                                            borderRadius: '4px',
                                        }}>
                                            {m.workspace_role === 'WORKSPACE_ADMIN' ? 'Admin' : 'Member'}
                                        </span>
                                    </td>
                                    <td style={{ padding: '8px 0', textAlign: 'right' }}>
                                        {m.id !== user?.id && (
                                            <button
                                                onClick={() => handleRemove(m.id, m.email)}
                                                style={{
                                                    background: 'none',
                                                    border: '1px solid rgba(255,80,80,0.35)',
                                                    color: 'rgba(255,100,100,0.8)',
                                                    borderRadius: '4px',
                                                    padding: '3px 10px',
                                                    fontSize: '0.75rem',
                                                    cursor: 'pointer',
                                                }}
                                            >
                                                Remove
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Invite form */}
            <div>
                <h4 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'rgba(255,255,255,0.7)', marginBottom: '10px' }}>
                    Invite to workspace
                </h4>

                {feedback && (
                    <div style={{
                        marginBottom: '10px',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        fontSize: '0.82rem',
                        background: feedback.type === 'ok' ? 'rgba(52,211,153,0.15)' : 'rgba(255,80,80,0.15)',
                        color: feedback.type === 'ok' ? '#6ee7b7' : '#fca5a5',
                        border: `1px solid ${feedback.type === 'ok' ? 'rgba(52,211,153,0.3)' : 'rgba(255,80,80,0.3)'}`,
                    }}>
                        {feedback.msg}
                    </div>
                )}

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <input
                        type="email"
                        placeholder="user@example.com"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
                        style={{
                            flex: 1,
                            minWidth: '200px',
                            background: 'rgba(255,255,255,0.06)',
                            border: '1px solid rgba(255,255,255,0.12)',
                            borderRadius: '6px',
                            color: '#fff',
                            padding: '8px 12px',
                            fontSize: '0.85rem',
                            outline: 'none',
                        }}
                    />
                    <select
                        value={inviteRole}
                        onChange={(e) => setInviteRole(e.target.value as any)}
                        style={{
                            background: 'rgba(255,255,255,0.06)',
                            border: '1px solid rgba(255,255,255,0.12)',
                            borderRadius: '6px',
                            color: '#fff',
                            padding: '8px 10px',
                            fontSize: '0.85rem',
                            cursor: 'pointer',
                        }}
                    >
                        <option value="USER">Member</option>
                        <option value="WORKSPACE_ADMIN">Admin</option>
                    </select>
                    <button
                        onClick={handleInvite}
                        disabled={loading || !inviteEmail.trim()}
                        style={{
                            background: loading ? 'rgba(99,102,241,0.3)' : 'rgba(99,102,241,0.8)',
                            border: 'none',
                            borderRadius: '6px',
                            color: '#fff',
                            padding: '8px 16px',
                            fontSize: '0.85rem',
                            fontWeight: 600,
                            cursor: loading ? 'wait' : 'pointer',
                        }}
                    >
                        {loading ? 'Inviting…' : 'Invite'}
                    </button>
                </div>
                <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.3)', marginTop: '6px' }}>
                    The user must already have an account. Admins can edit resources, projects &amp; allocations.
                </p>
            </div>
        </div>
    );
};

export default MemberManagement;
