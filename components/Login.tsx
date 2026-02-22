import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export const Login: React.FC<{ onSuccess?: () => void }> = ({ onSuccess }) => {
    const { login } = useAuth();
    const [isRegistering, setIsRegistering] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const API_URL = '/api/auth';

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        const endpoint = isRegistering ? '/register' : '/login';
        const payload = isRegistering ? { email, password, name } : { email, password };

        try {
            const res = await fetch(`${API_URL}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Authentication failed');
            login(data.token, data.user);
            if (onSuccess) onSuccess();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const inputStyle: React.CSSProperties = {
        width: '100%',
        padding: '12px 14px',
        borderRadius: 10,
        border: '1.5px solid #334155',
        background: '#0f172a',
        color: '#f1f5f9',
        fontSize: 14,
        outline: 'none',
        boxSizing: 'border-box',
        transition: 'border-color 0.2s',
    };

    const labelStyle: React.CSSProperties = {
        display: 'block',
        marginBottom: 6,
        fontSize: 13,
        fontWeight: 500,
        color: '#94a3b8',
        letterSpacing: '0.02em',
    };

    return (
        <div style={{
            background: 'linear-gradient(145deg, #1e293b 0%, #0f172a 100%)',
            borderRadius: 20,
            padding: '40px 36px',
            width: '100%',
            maxWidth: 420,
            boxShadow: '0 25px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(99,102,241,0.15)',
            fontFamily: "'Inter', -apple-system, sans-serif",
            color: '#f1f5f9',
            border: '1px solid #1e293b',
        }}>
            {/* Header */}
            <div style={{ textAlign: 'center', marginBottom: 32 }}>
                <div style={{
                    width: 56, height: 56, borderRadius: 16,
                    background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 26, margin: '0 auto 16px',
                    boxShadow: '0 8px 24px rgba(99,102,241,0.35)',
                }}>📊</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#f1f5f9', marginBottom: 4 }}>
                    {isRegistering ? 'Create Account' : 'Welcome Back'}
                </div>
                <div style={{ fontSize: 13, color: '#64748b' }}>
                    {isRegistering
                        ? 'Get started with PMO Capacity Planner'
                        : 'Sign in to manage your team capacity'}
                </div>
            </div>

            {/* Error */}
            {error && (
                <div style={{
                    background: 'rgba(239,68,68,0.12)',
                    border: '1px solid rgba(239,68,68,0.3)',
                    borderRadius: 10,
                    padding: '10px 14px',
                    marginBottom: 20,
                    fontSize: 13,
                    color: '#fca5a5',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                }}>
                    <span>⚠️</span> {error}
                </div>
            )}

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {isRegistering && (
                    <div>
                        <label style={labelStyle}>Full Name</label>
                        <input
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="Jane Smith"
                            required
                            style={inputStyle}
                            onFocus={e => (e.target.style.borderColor = '#6366f1')}
                            onBlur={e => (e.target.style.borderColor = '#334155')}
                        />
                    </div>
                )}

                <div>
                    <label style={labelStyle}>Email Address</label>
                    <input
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        placeholder="you@company.com"
                        required
                        style={inputStyle}
                        onFocus={e => (e.target.style.borderColor = '#6366f1')}
                        onBlur={e => (e.target.style.borderColor = '#334155')}
                    />
                </div>

                <div>
                    <label style={labelStyle}>Password</label>
                    <input
                        type="password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                        style={inputStyle}
                        onFocus={e => (e.target.style.borderColor = '#6366f1')}
                        onBlur={e => (e.target.style.borderColor = '#334155')}
                    />
                </div>

                <button
                    type="submit"
                    disabled={loading}
                    style={{
                        marginTop: 8,
                        padding: '13px',
                        borderRadius: 12,
                        background: loading
                            ? '#3730a3'
                            : 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                        color: '#fff',
                        border: 'none',
                        fontWeight: 700,
                        fontSize: 15,
                        cursor: loading ? 'not-allowed' : 'pointer',
                        opacity: loading ? 0.8 : 1,
                        letterSpacing: '0.01em',
                        boxShadow: loading ? 'none' : '0 4px 16px rgba(99,102,241,0.4)',
                        transition: 'all 0.2s',
                        width: '100%',
                    }}
                >
                    {loading ? (
                        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                            <span style={{
                                width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)',
                                borderTopColor: '#fff', borderRadius: '50%',
                                display: 'inline-block', animation: 'spin 0.8s linear infinite',
                            }} />
                            {isRegistering ? 'Creating Account...' : 'Signing In...'}
                        </span>
                    ) : (
                        isRegistering ? '🚀 Create Account' : '🔑 Sign In'
                    )}
                </button>
            </form>

            {/* Divider */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                margin: '24px 0 20px',
            }}>
                <div style={{ flex: 1, height: 1, background: '#1e293b' }} />
                <span style={{ fontSize: 12, color: '#475569' }}>
                    {isRegistering ? 'Already have an account?' : "Don't have an account?"}
                </span>
                <div style={{ flex: 1, height: 1, background: '#1e293b' }} />
            </div>

            <button
                onClick={() => { setIsRegistering(!isRegistering); setError(''); }}
                style={{
                    width: '100%', padding: '11px',
                    borderRadius: 12,
                    background: 'transparent',
                    border: '1.5px solid #334155',
                    color: '#94a3b8',
                    fontWeight: 600, fontSize: 14,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                }}
                onMouseEnter={e => {
                    (e.target as HTMLButtonElement).style.borderColor = '#6366f1';
                    (e.target as HTMLButtonElement).style.color = '#a5b4fc';
                }}
                onMouseLeave={e => {
                    (e.target as HTMLButtonElement).style.borderColor = '#334155';
                    (e.target as HTMLButtonElement).style.color = '#94a3b8';
                }}
            >
                {isRegistering ? '← Back to Sign In' : '✨ Create Free Account'}
            </button>

            <p style={{
                textAlign: 'center', fontSize: 11, color: '#475569',
                marginTop: 20, marginBottom: 0, lineHeight: 1.6,
            }}>
                Free to view · Log in to add & edit data
            </p>
        </div>
    );
};
