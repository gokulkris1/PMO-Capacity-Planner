/**
 * components/WorkspaceSwitcher.tsx
 *
 * Dropdown that lets users switch between workspaces they belong to.
 * Shows org › workspace and the user's role in each.
 * Drop this wherever the old static workspace name was displayed in the sidebar.
 *
 * Usage:
 *   import WorkspaceSwitcher from './WorkspaceSwitcher';
 *   <WorkspaceSwitcher />
 */
import React from 'react';
import { useAuth } from '../context/AuthContext';

// ── tiny inline styles so this has zero external dependencies ─────────────────
const styles = {
    wrapper: {
        position: 'relative' as const,
        width: '100%',
    },
    label: {
        fontSize: '0.65rem',
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase' as const,
        color: 'rgba(255,255,255,0.45)',
        marginBottom: '4px',
        display: 'block',
    },
    select: {
        width: '100%',
        background: 'rgba(255,255,255,0.07)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: '6px',
        color: '#fff',
        padding: '7px 28px 7px 10px',
        fontSize: '0.82rem',
        fontWeight: 500,
        cursor: 'pointer',
        appearance: 'none' as const,
        WebkitAppearance: 'none' as const,
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.5)' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 8px center',
        outline: 'none',
    },
    single: {
        fontSize: '0.85rem',
        fontWeight: 600,
        color: '#fff',
        padding: '4px 0',
    },
    badge: (role: string) => ({
        display: 'inline-block',
        fontSize: '0.6rem',
        fontWeight: 700,
        letterSpacing: '0.05em',
        textTransform: 'uppercase' as const,
        background: role === 'WORKSPACE_ADMIN' ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.1)',
        color: role === 'WORKSPACE_ADMIN' ? '#a5b4fc' : 'rgba(255,255,255,0.6)',
        padding: '2px 6px',
        borderRadius: '4px',
        marginLeft: '6px',
        verticalAlign: 'middle',
    }),
};

const WorkspaceSwitcher: React.FC = () => {
    const { availableWorkspaces, activeWorkspace, switchWorkspace, workspaceRole } = useAuth();

    // Nothing to render if no workspace yet
    if (!activeWorkspace) return null;

    // Single workspace — just show the name
    if (availableWorkspaces.length <= 1) {
        return (
            <div style={styles.wrapper}>
                <span style={styles.label}>Workspace</span>
                <div style={styles.single}>
                    {activeWorkspace.orgName} › {activeWorkspace.name}
                    {workspaceRole && (
                        <span style={styles.badge(workspaceRole)}>
                            {workspaceRole === 'WORKSPACE_ADMIN' ? 'Admin' : 'Member'}
                        </span>
                    )}
                </div>
            </div>
        );
    }

    // Multiple workspaces — show a dropdown
    return (
        <div style={styles.wrapper}>
            <span style={styles.label}>Workspace</span>
            <select
                value={activeWorkspace.id}
                onChange={(e) => switchWorkspace(e.target.value)}
                style={styles.select}
            >
                {availableWorkspaces.map((ws) => (
                    <option key={ws.id} value={ws.id}>
                        {ws.orgName} › {ws.name}
                        {ws.role === 'WORKSPACE_ADMIN' ? ' (Admin)' : ' (Member)'}
                    </option>
                ))}
            </select>
        </div>
    );
};

export default WorkspaceSwitcher;
