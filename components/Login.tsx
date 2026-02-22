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

    // Use relative path for API so it works smoothly with a proxy or in production
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
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Authenication failed');
            }

            login(data.token, data.user);
            if (onSuccess) onSuccess();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            minHeight: '100vh', background: 'var(--bg-app)', color: 'var(--text-main)',
            fontFamily: 'Inter, sans-serif'
        }}>
            <div style={{
                background: 'var(--bg-panel)', padding: '2rem', borderRadius: '12px',
                boxShadow: '0 8px 32px rgba(0,0,0,0.4)', width: '100%', maxWidth: '400px',
                border: '1px solid var(--border-color)'
            }}>
                <h2 style={{ marginBottom: '1.5rem', textAlign: 'center', color: 'var(--text-bright)' }}>
                    {isRegistering ? 'Create Account' : 'Welcome Back'}
                </h2>

                {error && (
                    <div style={{
                        background: 'rgba(239,68,68,0.1)', color: '#ef4444',
                        padding: '0.75rem', borderRadius: '6px', marginBottom: '1rem',
                        fontSize: '14px', border: '1px solid rgba(239,68,68,0.2)'
                    }}>
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {isRegistering && (
                        <div>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '14px' }}>Name</label>
                            <input
                                type="text"
                                value={name} onChange={e => setName(e.target.value)}
                                style={{
                                    width: '100%', padding: '0.75rem', borderRadius: '6px',
                                    background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                                    color: 'var(--text-main)'
                                }}
                            />
                        </div>
                    )}
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '14px' }}>Email</label>
                        <input
                            type="email" required
                            value={email} onChange={e => setEmail(e.target.value)}
                            style={{
                                width: '100%', padding: '0.75rem', borderRadius: '6px',
                                background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                                color: 'var(--text-main)'
                            }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '14px' }}>Password</label>
                        <input
                            type="password" required
                            value={password} onChange={e => setPassword(e.target.value)}
                            style={{
                                width: '100%', padding: '0.75rem', borderRadius: '6px',
                                background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                                color: 'var(--text-main)'
                            }}
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={loading}
                        style={{
                            marginTop: '0.5rem', padding: '0.75rem', borderRadius: '6px',
                            background: 'var(--primary-light)', color: '#fff', border: 'none',
                            fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
                            opacity: loading ? 0.7 : 1
                        }}
                    >
                        {loading ? 'Please wait...' : (isRegistering ? 'Sign Up' : 'Sign In')}
                    </button>
                </form>

                <div style={{ marginTop: '1.5rem', textAlign: 'center', fontSize: '14px', color: 'var(--text-muted)' }}>
                    {isRegistering ? 'Already have an account?' : "Don't have an account?"}
                    <button
                        onClick={() => { setIsRegistering(!isRegistering); setError(''); }}
                        style={{
                            background: 'none', border: 'none', color: 'var(--primary-light)',
                            cursor: 'pointer', marginLeft: '0.5rem', fontWeight: 500, padding: 0
                        }}
                    >
                        {isRegistering ? 'Sign In' : 'Sign Up'}
                    </button>
                </div>
            </div>
        </div>
    );
};
