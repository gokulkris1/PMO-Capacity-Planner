import React from 'react';
import { Link } from 'react-router-dom';
import { canAccessSettings, canManageMembers, useAuth } from '../context/AuthContext';
import MemberManagement from './MemberManagement';

const platformRoleLabel: Record<string, string> = {
    SUPERUSER: 'Superuser',
    ORG_ADMIN: 'Organization admin',
    PMO_ADMIN: 'PMO admin',
    WORKSPACE_OWNER: 'Workspace owner',
    USER: 'Member',
};

const workspaceRoleLabel: Record<string, string> = {
    PMO_ADMIN: 'PMO admin',
    WORKSPACE_OWNER: 'Workspace owner',
    USER: 'Member',
};

export const SettingsHub: React.FC = () => {
    const { user, activeWorkspace, workspaceRole } = useAuth();
    const mayManageMembers = canManageMembers(user, workspaceRole);
    const mayAccessSettings = canAccessSettings(user) || mayManageMembers;

    if (!mayAccessSettings) {
        return (
            <section className="page-enter" style={{ maxWidth: 760, margin: '48px auto', textAlign: 'center' }}>
                <div className="glass-card" style={{ padding: 32 }}>
                    <h1 style={{ fontSize: 22, color: 'var(--n-800)', marginBottom: 8 }}>Workspace access</h1>
                    <p style={{ color: 'var(--n-600)', lineHeight: 1.6 }}>
                        Workspace settings and member access are managed by an organization or PMO administrator.
                    </p>
                </div>
            </section>
        );
    }

    return (
        <section className="page-enter" style={{ maxWidth: 1160, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                <div>
                    <div style={{ color: 'var(--brand-500)', fontWeight: 800, fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6 }}>Governance</div>
                    <h1 style={{ fontSize: 26, lineHeight: 1.2, color: 'var(--n-800)', margin: 0 }}>Organization & workspace controls</h1>
                    <p style={{ color: 'var(--n-600)', margin: '8px 0 0', lineHeight: 1.5 }}>
                        Review the active workspace and manage member access with scoped, least-privilege roles.
                    </p>
                </div>
                {user?.role === 'SUPERUSER' && (
                    <Link to="/cockpit" className="btn btn-secondary" style={{ textDecoration: 'none' }}>
                        Open platform cockpit
                    </Link>
                )}
            </header>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
                <article className="glass-card" style={{ padding: 18 }}>
                    <div style={{ color: 'var(--n-600)', fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase' }}>Active workspace</div>
                    <div style={{ color: 'var(--n-800)', fontSize: 17, fontWeight: 800, marginTop: 7 }}>{activeWorkspace?.name || 'No workspace selected'}</div>
                    <div style={{ color: 'var(--n-600)', fontSize: 12, marginTop: 5 }}>{activeWorkspace?.org_name || '—'}</div>
                </article>
                <article className="glass-card" style={{ padding: 18 }}>
                    <div style={{ color: 'var(--n-600)', fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase' }}>Platform role</div>
                    <div style={{ color: 'var(--n-800)', fontSize: 17, fontWeight: 800, marginTop: 7 }}>{platformRoleLabel[user?.role || 'USER']}</div>
                    <div style={{ color: 'var(--n-600)', fontSize: 12, marginTop: 5 }}>Organization-wide authority</div>
                </article>
                <article className="glass-card" style={{ padding: 18 }}>
                    <div style={{ color: 'var(--n-600)', fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase' }}>Workspace role</div>
                    <div style={{ color: 'var(--n-800)', fontSize: 17, fontWeight: 800, marginTop: 7 }}>{workspaceRoleLabel[workspaceRole || 'USER']}</div>
                    <div style={{ color: 'var(--n-600)', fontSize: 12, marginTop: 5 }}>Authority in this workspace only</div>
                </article>
            </div>

            <div className="glass-card" style={{ padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 16 }}>
                    <div>
                        <h2 style={{ color: 'var(--n-800)', fontSize: 18, margin: 0 }}>Member access</h2>
                        <p style={{ color: 'var(--n-600)', fontSize: 13, margin: '5px 0 0' }}>
                            Invite members only into this workspace. New members receive secure instructions to set their own password.
                        </p>
                    </div>
                    <span className="badge badge-perm">Scoped to active workspace</span>
                </div>
                <MemberManagement />
            </div>

            <aside style={{ border: '1px solid var(--brand-100)', background: 'var(--brand-50)', borderRadius: 8, padding: '13px 16px', color: 'var(--brand-700)', fontSize: 13, lineHeight: 1.55 }}>
                <strong>Access rule:</strong> PMO admins can manage members only in workspaces they administer. Organization admins retain organization-scoped authority; platform administration is available only in the platform cockpit.
            </aside>
        </section>
    );
};
