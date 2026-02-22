import React, { useState } from 'react';

interface JiraModalProps {
    onClose: () => void;
}

export const JiraImportModal: React.FC<JiraModalProps> = ({ onClose }) => {
    const [domain, setDomain] = useState(localStorage.getItem('pcp_jira_domain') || '');
    const [email, setEmail] = useState(localStorage.getItem('pcp_jira_email') || '');
    const [token, setToken] = useState(localStorage.getItem('pcp_jira_token') || '');
    const [projectKey, setProjectKey] = useState('');

    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<any>(null);
    const [error, setError] = useState('');

    const handleSync = async () => {
        if (!domain || !email || !token || !projectKey) {
            setError('All fields are required.');
            return;
        }

        setError('');
        setLoading(true);

        // Save creds locally so user doesn't have to re-type
        localStorage.setItem('pcp_jira_domain', domain);
        localStorage.setItem('pcp_jira_email', email);
        localStorage.setItem('pcp_jira_token', token);

        try {
            const res = await fetch('/api/jira', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ domain, email, token, projectKey })
            });
            const data = await res.json();

            if (!res.ok) throw new Error(data.error || 'Failed to connect to Jira');

            setResult(data);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="modal-box" style={{ maxWidth: 450 }}>
                <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#2684FF' }}>Jira</span> Capacity Sync
                </div>
                <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
                    Connect to your Jira Cloud workspace to automatically estimate FTE requirements based on active Story Points.
                </p>

                <div className="form-group">
                    <label className="form-label">Jira Domain</label>
                    <input className="form-input" value={domain} onChange={e => setDomain(e.target.value)} placeholder="e.g. yourcompany.atlassian.net" />
                </div>

                <div className="form-row">
                    <div className="form-group">
                        <label className="form-label">Jira Email</label>
                        <input className="form-input" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email address" />
                    </div>
                    <div className="form-group">
                        <label className="form-label">API Token</label>
                        <input className="form-input" type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="Jira API Token" />
                    </div>
                </div>

                <div className="form-group">
                    <label className="form-label">Target Project Key</label>
                    <input className="form-input" value={projectKey} onChange={e => setProjectKey(e.target.value.toUpperCase())} placeholder="e.g. ENG, PROD" />
                </div>

                {error && <div style={{ background: '#fef2f2', color: '#b91c1c', padding: 12, borderRadius: 8, fontSize: 13, marginTop: 16 }}>{error}</div>}

                {loading ? (
                    <div style={{ textAlign: 'center', padding: 20, color: '#64748b' }}>
                        <div className="ai-pulse" style={{ display: 'inline-block', marginRight: 8 }} />
                        Analyzing Jira tickets...
                    </div>
                ) : result ? (
                    <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', padding: 16, borderRadius: 8, marginTop: 16 }}>
                        <div style={{ fontWeight: 600, color: '#1e3a8a', marginBottom: 8 }}>Analysis Complete for {result.projectKey}</div>
                        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#1e40af', display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <li>Active Issues: <strong>{result.issueCount}</strong></li>
                            <li>Total Story Points: <strong>{result.totalStoryPoints}</strong></li>
                            <li style={{ color: '#b45309', fontWeight: 600, marginTop: 4 }}>► Estimated Capacity Needed: {result.estimatedFteRequired} FTEs / month</li>
                        </ul>
                    </div>
                ) : null}

                <div className="modal-footer" style={{ marginTop: 24 }}>
                    <button className="btn btn-secondary" onClick={onClose}>{result ? 'Close' : 'Cancel'}</button>
                    {!result && (
                        <button className="btn btn-primary" onClick={handleSync} style={{ background: '#2684FF', borderColor: '#0052CC' }}>
                            Sync Story Points
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
