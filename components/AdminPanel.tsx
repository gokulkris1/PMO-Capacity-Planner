import React from 'react';
import { canManageMembers, useAuth } from '../context/AuthContext';
import MemberManagement from './MemberManagement';

/**
 * @deprecated Use the settings route for member administration. Retained as a
 * safe compatibility modal for any older caller.
 */
export const AdminPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const { user, workspaceRole } = useAuth();
    const mayManageMembers = canManageMembers(user, workspaceRole);

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Workspace member access"
            style={{
                position: 'fixed', inset: 0, zIndex: 9999, padding: 20,
                background: 'rgba(9, 30, 66, .42)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            onClick={event => { if (event.currentTarget === event.target) onClose(); }}
        >
            <div className="glass-panel" style={{ width: 'min(900px, 100%)', maxHeight: '90vh', overflow: 'auto', padding: 24 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
                    <div>
                        <h2 style={{ color: 'var(--n-800)', fontSize: 20, margin: 0 }}>Workspace member access</h2>
                        <p style={{ color: 'var(--n-600)', fontSize: 13, margin: '5px 0 0' }}>Roles are scoped to the active workspace and invitations never expose passwords.</p>
                    </div>
                    <button type="button" className="btn btn-secondary" onClick={onClose} aria-label="Close member access">Close</button>
                </div>
                {mayManageMembers ? (
                    <MemberManagement />
                ) : (
                    <p style={{ color: 'var(--n-600)', margin: 0 }}>You do not have permission to manage members in the active workspace.</p>
                )}
            </div>
        </div>
    );
};
