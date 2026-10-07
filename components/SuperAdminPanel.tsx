import React from 'react';
import { Link } from 'react-router-dom';

/**
 * @deprecated Platform administration now lives in the dedicated `/cockpit`
 * route. This compatibility panel intentionally does not expose user creation
 * or password controls.
 */
export const SuperAdminPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => (
    <div
        role="dialog"
        aria-modal="true"
        aria-label="Platform administration"
        style={{
            position: 'fixed', inset: 0, zIndex: 10000, padding: 20,
            background: 'rgba(9, 30, 66, .42)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        onClick={event => { if (event.currentTarget === event.target) onClose(); }}
    >
        <div className="glass-panel" style={{ width: 'min(480px, 100%)', padding: 28, textAlign: 'center' }}>
            <div style={{ color: 'var(--brand-500)', fontWeight: 800, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.08em' }}>Platform administration</div>
            <h2 style={{ color: 'var(--n-800)', fontSize: 22, margin: '8px 0' }}>Use the platform cockpit</h2>
            <p style={{ color: 'var(--n-600)', lineHeight: 1.55, margin: '0 0 22px' }}>
                The cockpit provides organization-level management. Account access is provisioned through scoped invitations and password reset, not direct passwords.
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
                <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
                <Link to="/cockpit" className="btn btn-primary" onClick={onClose} style={{ textDecoration: 'none' }}>Open cockpit</Link>
            </div>
        </div>
    </div>
);
