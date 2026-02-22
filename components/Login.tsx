import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Check, Mail, Lock, User, ArrowRight, ShieldCheck } from 'lucide-react';

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
        width: '100%',
        padding: '14px 16px 14px 44px',
        borderRadius: 12,
        border: '1px solid rgba(255, 255, 255, 0.1)',
        background: 'rgba(15, 23, 42, 0.6)',
        color: '#f8fafc',
        fontSize: 15,
        outline: 'none',
        boxSizing: 'border-box',
        transition: 'all 0.2s ease',
        boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.2)',
    };

    const inputFocusStyle = {
        ...inputStyle,
        border: '1px solid rgba(99, 102, 241, 0.5)',
        background: 'rgba(15, 23, 42, 0.8)',
        boxShadow: '0 0 0 3px rgba(99, 102, 241, 0.15), inset 0 2px 4px rgba(0,0,0,0.2)',
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
                setPendingToken(data.token);
                setPendingUser(data.user);
                await sendOtp(email);
                setStep('verify');
            } else {
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
        // Fallback for dev mode
        if (data.otp) setOtp(data.otp);
        if (!res.ok) throw new Error(data.error || 'Failed to send verification code');
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
            if (!res.ok) throw new Error(data.error || 'Invalid verification code');
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

    // Premium Container
    const containerStyle: React.CSSProperties = {
        position: 'relative',
        width: '100%',
        maxWidth: 440,
        background: 'linear-gradient(145deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%)',
        backdropFilter: 'blur(16px)',
        borderRadius: 24,
        padding: '48px 40px',
        boxShadow: '0 32px 64px -12px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.05), inset 0 1px 0 rgba(255,255,255,0.1)',
        fontFamily: "'Inter', -apple-system, sans-serif",
        color: '#f8fafc',
        overflow: 'hidden',
    };

    // Abstract glow effect behind container
    const glowStyle: React.CSSProperties = {
        position: 'absolute',
        top: -100,
        left: '20%',
        width: 300,
        height: 300,
        background: 'radial-gradient(circle, rgba(99,102,241,0.2) 0%, rgba(0,0,0,0) 70%)',
        borderRadius: '50%',
        zIndex: 0,
        pointerEvents: 'none',
    };

    /* ── OTP VERIFY SCREEN ─────────────────────────────────── */
    if (step === 'verify') {
        return (
            <div style={containerStyle}>
                <div style={glowStyle} />
                <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', marginBottom: 36 }}>
                    <div style={{
                        width: 64, height: 64, borderRadius: 20,
                        background: 'linear-gradient(135deg, rgba(99,102,241,0.2), rgba(139,92,246,0.2))',
                        border: '1px solid rgba(99,102,241,0.3)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        margin: '0 auto 20px',
                        boxShadow: '0 8px 16px rgba(0,0,0,0.2)'
                    }}>
                        <ShieldCheck size={32} color="#818cf8" strokeWidth={1.5} />
                    </div>
                    <h2 style={{ margin: '0 0 10px', fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', color: '#fff' }}>Secure Verification</h2>
                    <p style={{ margin: 0, fontSize: 14, color: '#94a3b8', lineHeight: 1.6 }}>
                        We sent a 6-digit access code to<br />
                        <strong style={{ color: '#e2e8f0', fontWeight: 600 }}>{email}</strong>
                    </p>
                </div>

                {error && (
                    <div style={{
                        background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
                        borderRadius: 12, padding: '12px 16px', marginBottom: 24, color: '#fca5a5', fontSize: 13,
                        display: 'flex', alignItems: 'center', gap: 10
                    }}>
                        <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#f87171' }} />
                        {error}
                    </div>
                )}

                <form onSubmit={handleVerify} style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 20 }}>
                    <div>
                        <input
                            type="text" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            placeholder="0 0 0 0 0 0" maxLength={6} required autoFocus
                            style={{
                                width: '100%', padding: '18px 0', borderRadius: 16, border: '1px solid rgba(255,255,255,0.1)',
                                background: 'rgba(15,23,42,0.5)', color: '#fff', fontSize: 32, letterSpacing: '0.4em',
                                textAlign: 'center', fontWeight: 600, outline: 'none', transition: 'all 0.2s',
                            }}
                            onFocus={e => { e.target.style.borderColor = 'rgba(99,102,241,0.5)'; e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.15)' }}
                            onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; e.target.style.boxShadow = 'none' }}
                        />
                    </div>

                    <button type="submit" disabled={loading || otp.length < 6} style={{
                        width: '100%', padding: '15px', borderRadius: 12, border: 'none',
                        background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                        color: '#fff', fontWeight: 600, fontSize: 15, cursor: loading ? 'wait' : 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        transition: 'all 0.2s',
                        boxShadow: '0 4px 12px rgba(99,102,241,0.3)',
                        opacity: (loading || otp.length < 6) ? 0.6 : 1,
                    }}>
                        {loading ? 'Authenticating...' : 'Unlock Workspace'}
                        {!loading && <ArrowRight size={18} />}
                    </button>

                    <button type="button" onClick={handleResend} disabled={resending}
                        style={{
                            background: 'transparent', border: 'none', color: '#94a3b8', fontSize: 13,
                            cursor: 'pointer', transition: 'color 0.2s', padding: 10,
                            fontWeight: 500, margin: '0 auto'
                        }}
                        onMouseOver={e => e.currentTarget.style.color = '#fff'}
                        onMouseOut={e => e.currentTarget.style.color = '#94a3b8'}
                    >
                        {resending ? 'Transmitting...' : "Didn't receive it? Click to resend"}
                    </button>
                </form>
            </div>
        );
    }

    /* ── REGISTER / LOGIN FORM ─────────────────────────────── */
    return (
        <div style={containerStyle}>
            <div style={glowStyle} />
            <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', marginBottom: 40 }}>
                <div style={{
                    width: 56, height: 56, borderRadius: 16,
                    background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    margin: '0 auto 20px',
                    boxShadow: '0 8px 24px rgba(99,102,241,0.4), inset 0 2px 4px rgba(255,255,255,0.2)',
                    color: '#fff', fontSize: 24, fontWeight: 'bold'
                }}>
                    PMO
                </div>
                <h2 style={{ margin: '0 0 10px', fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', color: '#fff' }}>
                    {isRegistering ? 'Start Your Free Trial' : 'Welcome back'}
                </h2>
                <p style={{ margin: 0, fontSize: 14, color: '#94a3b8' }}>
                    {isRegistering ? 'Transform your PMO capacity management.' : 'Enter your credentials to access your workspace.'}
                </p>
            </div>

            {error && (
                <div style={{
                    background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
                    borderRadius: 12, padding: '12px 16px', marginBottom: 24, color: '#fca5a5', fontSize: 13,
                    display: 'flex', alignItems: 'flex-start', gap: 10
                }}>
                    <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#f87171', marginTop: 7, flexShrink: 0 }} />
                    <span style={{ lineHeight: 1.4 }}>{error}</span>
                </div>
            )}

            <form onSubmit={handleFormSubmit} style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 18 }}>
                {isRegistering && (
                    <div style={{ position: 'relative' }}>
                        <div style={{ position: 'absolute', left: 14, top: 15, color: '#64748b' }}><User size={18} /></div>
                        <input type="text" value={name} onChange={e => setName(e.target.value)}
                            placeholder="Full Name" required={isRegistering}
                            style={inputStyle}
                            onFocus={e => Object.assign(e.target.style, inputFocusStyle)}
                            onBlur={e => Object.assign(e.target.style, inputStyle)}
                        />
                    </div>
                )}
                <div style={{ position: 'relative' }}>
                    <div style={{ position: 'absolute', left: 14, top: 15, color: '#64748b' }}><Mail size={18} /></div>
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                        placeholder="Work Email" required
                        style={inputStyle}
                        onFocus={e => Object.assign(e.target.style, inputFocusStyle)}
                        onBlur={e => Object.assign(e.target.style, inputStyle)}
                    />
                </div>
                <div style={{ position: 'relative' }}>
                    <div style={{ position: 'absolute', left: 14, top: 15, color: '#64748b' }}><Lock size={18} /></div>
                    <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                        placeholder="Password" required minLength={8}
                        style={inputStyle}
                        onFocus={e => Object.assign(e.target.style, inputFocusStyle)}
                        onBlur={e => Object.assign(e.target.style, inputStyle)}
                    />
                </div>

                {isRegistering && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '4px 0 8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#94a3b8' }}>
                            <Check size={14} color="#10b981" /> Free forever for up to 5 resources
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#94a3b8' }}>
                            <Check size={14} color="#10b981" /> Instant setup, no credit card required
                        </div>
                    </div>
                )}

                <button type="submit" disabled={loading} style={{
                    width: '100%', padding: '15px', borderRadius: 12, border: 'none',
                    background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                    color: '#fff', fontWeight: 600, fontSize: 15, cursor: loading ? 'wait' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    marginTop: 4, transition: 'all 0.2s',
                    boxShadow: '0 4px 12px rgba(99,102,241,0.3)',
                    opacity: loading ? 0.7 : 1,
                }}>
                    {loading ? 'Processing...' : isRegistering ? 'Create Workspace' : 'Sign In'}
                    {!loading && <ArrowRight size={18} />}
                </button>
            </form>

            <div style={{ position: 'relative', zIndex: 1, marginTop: 32, textAlign: 'center', paddingTop: 24, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <span style={{ fontSize: 13, color: '#64748b' }}>
                    {isRegistering ? 'Already have an account?' : "Don't have an account?"}
                </span>
                <button
                    type="button"
                    onClick={() => { setIsRegistering(!isRegistering); setError(''); }}
                    style={{
                        background: 'none', border: 'none', color: '#818cf8', fontWeight: 600,
                        fontSize: 13, cursor: 'pointer', padding: '0 0 0 8px', transition: 'color 0.2s'
                    }}
                    onMouseOver={e => e.currentTarget.style.color = '#a5b4fc'}
                    onMouseOut={e => e.currentTarget.style.color = '#818cf8'}
                >
                    {isRegistering ? 'Sign in instead' : 'Create workspace free'}
                </button>
            </div>
        </div>
    );
};
