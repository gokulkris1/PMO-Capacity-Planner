import React from 'react';
import { useAuth } from '../context/AuthContext';

const ROLE_BADGE: Record<string, { label: string; color: string }> = {
    PMO_ADMIN: { label: 'PMO Admin', color: '#6366f1' },
    WORKSPACE_OWNER: { label: 'Owner', color: '#10b981' },
    USER: { label: 'Member', color: '#64748b' },
};

const WorkspaceSwitcher: React.FC = () => {
    const { user, activeWorkspace, availableWorkspaces, switchWorkspace } = useAuth();

    if (!activeWorkspace || availableWorkspaces.length === 0) return null;

    // WORKSPACE_OWNER + USER only see one workspace — no switcher needed
    const showSwitcher = user && ['SUPERUSER', 'ORG_ADMIN', 'PMO_ADMIN'].includes(user.role);
    const badge = ROLE_BADGE[activeWorkspace.role] || { label: activeWorkspace.role, color: '#64748b' };

    // Single workspace or no switch privilege — show name only
    if (!showSwitcher || availableWorkspaces.length <= 1) {
        return (
            <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 12px', borderRadius: 10,
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
                marginBottom: 4
            }}>
                <span style={{ fontSize: 14 }}>🏢</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#f1f5f9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {activeWorkspace.name}
                    </div>
                    <div style={{ fontSize: 10, color: '#64748b' }}>
                        {activeWorkspace.org_name}
                    </div>
                </div>
                <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                    background: badge.color + '22', color: badge.color, border: `1px solid ${badge.color}44`
                }}>
                    {badge.label}
                </span>
            </div>
        );
    }

    // Multiple workspaces — show dropdown
    return (
        <div style={{ position: 'relative', marginBottom: 4 }}>
            <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 8px 4px 12px', borderRadius: 10,
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)'
            }}>
                <span style={{ fontSize: 13 }}>🏢</span>
                <select
                    value={activeWorkspace.id}
                    onChange={e => switchWorkspace(e.target.value)}
                    style={{
                        flex: 1, background: 'transparent', border: 'none', outline: 'none',
                        color: '#f1f5f9', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        appearance: 'none', WebkitAppearance: 'none'
                    }}
                >
                    {availableWorkspaces.map(ws => (
                        <option key={ws.id} value={ws.id} style={{ background: '#1e293b', color: '#f1f5f9' }}>
                            {ws.org_name} › {ws.name} ({ROLE_BADGE[ws.role]?.label || ws.role})
                        </option>
                    ))}
                </select>
                <span style={{ color: '#64748b', fontSize: 10, pointerEvents: 'none' }}>▾</span>
            </div>
            <div style={{ fontSize: 10, color: '#64748b', paddingLeft: 12, marginTop: 2 }}>
                <span style={{ color: badge.color, fontWeight: 700 }}>{badge.label}</span>
                {' · '}{availableWorkspaces.length} workspace{availableWorkspaces.length > 1 ? 's' : ''}
            </div>
        </div>
    );
};

export default WorkspaceSwitcher;
