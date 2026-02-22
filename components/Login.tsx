import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

type Step = 'form' | 'verify';

export const Login: React.FC<{ onSuccess?: () => void }> = ({ onSuccess }) => {
    const { login } = useAuth();
    const [isRegistering, setIsRegistering] = useState(false);
    const [step, setStep] = useState<Step>('form');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [otp, setOtp] = useState('');
    const [pendingToken, setPendingToken] = useState('');
    const [pendingUser, setPendingUser] = useState<any>(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [resending, setResending] = useState(false);

    const inputStyle: React.CSSProperties = {
        width: '100%', padding: '12px 14px', borderRadius: 10,
        border: '1.5px solid #334155', background: '#0f172a', color: '#f1f5f9',
        fontSize: 14, outline: 'none', boxSizing: 'border-box',
    };

    const handleFormSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(''); setLoading(true);

        const endpoint = isRegistering ? '/register' : '/login';
        const payload = isRegistering ? { email, password, name } : { email, password };

        try {
            const res = await fetch(`/api/auth${endpoint}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Authentication failed');

            if (isRegistering) {
                // Store creds, send OTP, move to verify step
                setPendingToken(data.token);
                setPendingUser(data.user);
                await sendOtp(email);
                setStep('verify');
            } else {
                // Login — no OTP needed (email already verified at signup)
                login(data.token, data.user);
                onSuccess?.();
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const sendOtp = async (emailAddr: string) => {
        const res = await fetch('/api/verify/send', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: emailAddr }),
        });
        const data = await res.json();
        // In dev mode without Resend, the OTP is returned in the response
        if (data.otp) setOtp(data.otp);
        if (!res.ok) throw new Error(data.error || 'Failed to send code');
    };

    const handleVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(''); setLoading(true);
        try {
            const res = await fetch('/api/verify/check', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, otp }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Invalid code');
            login(pendingToken, pendingUser);
            onSuccess?.();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleResend = async () => {
        setResending(true); setError('');
        try { await sendOtp(email); }
        catch (err: any) { setError(err.message); }
        setResending(false);
    };

    const containerStyle: React.CSSProperties = {
        background: 'linear-gradient(145deg, #1e293b 0%, #0f172a 100%)',
        borderRadius: 20, padding: '40px 36px', width: '100%', maxWidth: 420,
        boxShadow: '0 25px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(99,102,241,0.15)',
        fontFamily: "'Inter', -apple-system, sans-serif", color: '#f1f5f9',
        border: '1px solid #1e293b',
    };

    /* ── OTP VERIFY SCREEN ─────────────────────────────────── */
    if (step === 'verify') {
        return (
            <div style={containerStyle}>
                <div style={{ textAlign: 'center', marginBottom: 28 }}>
                    <div style={{
                        width: 56, height: 56, borderRadius: 16,
                        background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 26, margin: '0 auto 16px',
                    }}>📧</div>
                    <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 800 }}>Check your email</h2>
                    <p style={{ margin: 0, fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
                        We sent a 6-digit code to<br />
                        <strong style={{ color: '#818cf8' }}>{email}</strong>
                    </p>
                </div>

                {error && (
                    <div style={{
                        background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.3)',
                        borderRadius: 10, padding: '10px 14px', marginBottom: 16, color: '#fca5a5', fontSize: 13
                    }}>
                        ⚠ {error}
                    </div>
                )}

                <form onSubmit={handleVerify} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: '#94a3b8' }}>
                            Verification code
                        </label>
                        <input
                            type="text" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            placeholder="000000" maxLength={6} required autoFocus
                            style={{ ...inputStyle, fontSize: 28, letterSpacing: 16, textAlign: 'center', fontWeight: 800 }}
                        />
                    </div>
                    <button type="submit" disabled={loading || otp.length < 6} style={{
                        width: '100%', padding: '13px', borderRadius: 12, border: 'none',
                        background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff',
                        fontWeight: 700, fontSize: 15, cursor: loading ? 'wait' : 'pointer',
                        opacity: (loading || otp.length < 6) ? 0.7 : 1,
                    }}>
                        {loading ? 'Verifying…' : '✓ Verify & Enter'}
                    </button>
                    <button type="button" onClick={handleResend} disabled={resending}
                        style={{
                            background: 'none', border: 'none', color: '#6366f1', fontSize: 13,
                            cursor: 'pointer', textDecoration: 'underline', padding: 0
                        }}>
                        {resending ? 'Sending…' : 'Resend code'}
                    </button>
                </form>

                <p style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: '#334155' }}>
                    Free to view · Log in to add &amp; edit data
                </p>
            </div>
        );
    }

    /* ── REGISTER / LOGIN FORM ─────────────────────────────── */
    return (
        <div style={containerStyle}>
            <div style={{ textAlign: 'center', marginBottom: 32 }}>
                <div style={{
                    width: 56, height: 56, borderRadius: 16,
                    background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 26, margin: '0 auto 16px',
                }}>📊</div>
                <h2 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>
                    {isRegistering ? 'Create Account' : 'Welcome back'}
                </h2>
                <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
                    {isRegistering ? 'Get started with PMO Capacity Planner' : 'Sign in to your workspace'}
                </p>
            </div>

            {error && (
                <div style={{
                    background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.3)',
                    borderRadius: 10, padding: '10px 14px', marginBottom: 20,
                    color: '#fca5a5', fontSize: 13, display: 'flex', gap: 8, alignItems: 'flex-start'
                }}>
                    <span>⚠</span><span>{error}</span>
                </div>
            )}

            <form onSubmit={handleFormSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {isRegistering && (
                    <div>
                        <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 500, color: '#94a3b8' }}>Full Name</label>
                        <input type="text" value={name} onChange={e => setName(e.target.value)}
                            placeholder="Jane Smith" required={isRegistering} style={inputStyle} />
                    </div>
                )}
                <div>
                    <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 500, color: '#94a3b8' }}>Email Address</label>
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                        placeholder="you@company.com" required autoFocus={!isRegistering} style={inputStyle} />
                </div>
                <div>
                    <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 500, color: '#94a3b8' }}>Password</label>
                    <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                        placeholder="Min 8 characters" required minLength={8} style={inputStyle} />
                </div>

                <button type="submit" disabled={loading} style={{
                    padding: '13px', borderRadius: 12, border: 'none', marginTop: 4,
                    background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                    color: '#fff', fontWeight: 700, fontSize: 15,
                    cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1,
                }}>
                    {loading ? 'Please wait…' : isRegistering ? '🚀 Create Account' : '🔑 Sign In'}
                </button>

                <button type="button" onClick={() => { setIsRegistering(!isRegistering); setError(''); setStep('form'); }}
                    style={{
                        width: '100%', padding: '12px', borderRadius: 12,
                        background: 'rgba(255,255,255,0.04)', border: '1px solid #334155',
                        color: '#94a3b8', fontWeight: 600, fontSize: 14, cursor: 'pointer'
                    }}>
                    {isRegistering ? '← Back to Sign In' : 'Create new account →'}
                </button>
            </form>

            <p style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: '#334155' }}>
                Free to view · Log in to add &amp; edit data
            </p>
        </div>
    );
};
