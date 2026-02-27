import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

type Step = 'form' | 'verify' | 'forgot' | 'reset' | '2fa';

// ── Icons (inline SVG for zero extra deps) ──────────────────────────────────
const IconMail = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
);
const IconLock = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
);
const IconUser = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="5" /><path d="M20 21a8 8 0 1 0-16 0" />
    </svg>
);
const IconArrow = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h14m-7-7 7 7-7 7" />
    </svg>
);
const IconShield = () => (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" />
    </svg>
);
const IconCheck = () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2.5">
        <path d="M20 6 9 17 4 12" />
    </svg>
);

// ── Helper: animated number display ──────────────────────────────────────────
const Stat: React.FC<{ value: string; label: string }> = ({ value, label }) => (
    <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 28, fontWeight: 800, color: '#fff', letterSpacing: '-0.03em', lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 4, fontWeight: 500 }}>{label}</div>
    </div>
);

// ── Feature pill ─────────────────────────────────────────────────────────────
const FeaturePill: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 14px', borderRadius: 12,
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.1)',
        fontSize: 13, color: 'rgba(255,255,255,0.8)', fontWeight: 500,
    }}>
        <IconCheck /> {children}
    </div>
);

// ── Shared input style helper ─────────────────────────────────────────────────
const useInputStyle = () => {
    const base: React.CSSProperties = {
        width: '100%', padding: '14px 16px 14px 44px',
        borderRadius: 14, border: '1.5px solid rgba(255,255,255,0.08)',
        background: 'rgba(255,255,255,0.04)', color: '#f8fafc',
        fontSize: 15, outline: 'none', boxSizing: 'border-box',
        transition: 'border-color 0.2s, box-shadow 0.2s',
        fontFamily: "'Inter', -apple-system, sans-serif",
        WebkitFontSmoothing: 'antialiased',
    };
    const onFocus = (e: React.FocusEvent<HTMLInputElement>) => {
        e.target.style.borderColor = 'rgba(129,140,248,0.6)';
        e.target.style.boxShadow = '0 0 0 4px rgba(99,102,241,0.12)';
        e.target.style.background = 'rgba(255,255,255,0.07)';
    };
    const onBlur = (e: React.FocusEvent<HTMLInputElement>) => {
        e.target.style.borderColor = 'rgba(255,255,255,0.08)';
        e.target.style.boxShadow = 'none';
        e.target.style.background = 'rgba(255,255,255,0.04)';
    };
    return { base, onFocus, onBlur };
};

// ── Shared submit button ──────────────────────────────────────────────────────
const SubmitBtn: React.FC<{ loading: boolean; disabled?: boolean; label: string }> = ({ loading, disabled, label }) => (
    <button type="submit" disabled={loading || disabled} style={{
        width: '100%', padding: '15px', borderRadius: 14, border: 'none',
        background: loading || disabled
            ? 'rgba(99,102,241,0.4)'
            : 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
        color: '#fff', fontWeight: 700, fontSize: 15,
        cursor: loading || disabled ? 'not-allowed' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        transition: 'all 0.2s',
        boxShadow: loading || disabled ? 'none' : '0 4px 20px rgba(99,102,241,0.4)',
        letterSpacing: '-0.01em',
        fontFamily: "'Inter', -apple-system, sans-serif",
    }}
        onMouseEnter={e => { if (!loading && !disabled) { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 8px 28px rgba(99,102,241,0.5)'; } }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(99,102,241,0.4)'; }}
    >
        {loading ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
                Processing…
            </span>
        ) : (
            <><span>{label}</span><IconArrow /></>
        )}
    </button>
);

// ── Error banner ──────────────────────────────────────────────────────────────
const ErrorBanner: React.FC<{ msg: string }> = ({ msg }) => (
    <div style={{
        background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)',
        borderRadius: 12, padding: '12px 16px', color: '#fca5a5', fontSize: 13,
        display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 4,
        backdropFilter: 'blur(4px)',
    }}>
        <span style={{ flexShrink: 0, fontSize: 16, lineHeight: 1 }}>⚠</span>
        <span style={{ lineHeight: 1.5 }}>{msg}</span>
    </div>
);

// ── LEFT PANEL (brand / marketing) ───────────────────────────────────────────
const LeftPanel: React.FC = () => {
    const [tick, setTick] = useState(0);
    useEffect(() => { const t = setInterval(() => setTick(v => v + 1), 3000); return () => clearInterval(t); }, []);
    const quotes = [
        '"Clarity is the starting point of velocity."',
        '"Great teams ship faster with better visibility."',
        '"Capacity planning is a competitive advantage."',
    ];
    return (
        <div style={{
            flex: 1, position: 'relative', overflow: 'hidden',
            background: 'linear-gradient(160deg, #0f0c29 0%, #1a1040 40%, #0d1b2a 100%)',
            display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
            padding: '56px 52px',
        }}>
            {/* Ambient glow orbs */}
            <div style={{ position: 'absolute', top: '-15%', left: '-10%', width: 550, height: 550, borderRadius: '50%', background: 'radial-gradient(circle, rgba(99,102,241,0.18) 0%, transparent 65%)', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', bottom: '-20%', right: '-15%', width: 700, height: 700, borderRadius: '50%', background: 'radial-gradient(circle, rgba(139,92,246,0.14) 0%, transparent 65%)', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', top: '40%', right: '5%', width: 300, height: 300, borderRadius: '50%', background: 'radial-gradient(circle, rgba(6,182,212,0.08) 0%, transparent 65%)', pointerEvents: 'none' }} />

            {/* Logo row */}
            <div style={{ position: 'relative', zIndex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                        width: 44, height: 44, borderRadius: 14,
                        background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 22, boxShadow: '0 8px 24px rgba(99,102,241,0.4)',
                    }}>🪐</div>
                    <span style={{ fontSize: 18, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' }}>Orbit Space</span>
                </div>
            </div>

            {/* Hero text */}
            <div style={{ position: 'relative', zIndex: 1 }}>
                <div style={{
                    fontSize: 11, fontWeight: 700, color: '#818cf8',
                    textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 20
                }}>Resource Intelligence Platform</div>
                <h1 style={{
                    margin: '0 0 20px', fontSize: 44, fontWeight: 900, color: '#fff',
                    lineHeight: 1.1, letterSpacing: '-0.03em'
                }}>
                    Your team,<br />
                    <span style={{ background: 'linear-gradient(135deg, #818cf8, #c4b5fd)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                        fully visible.
                    </span>
                </h1>
                <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.55)', lineHeight: 1.7, margin: '0 0 40px', maxWidth: 380 }}>
                    From allocation matrices to AI-powered capacity insights — manage every resource with precision.
                </p>

                {/* Feature list */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 360 }}>
                    <FeaturePill>Real-time allocation matrix</FeaturePill>
                    <FeaturePill>AI capacity forecasting</FeaturePill>
                    <FeaturePill>Multi-workspace role control</FeaturePill>
                    <FeaturePill>What-if scenario modelling</FeaturePill>
                </div>
            </div>

            {/* Stats row */}
            <div style={{ position: 'relative', zIndex: 1 }}>
                <div style={{
                    display: 'flex', gap: 32, justifyContent: 'space-between',
                    padding: '24px 0', borderTop: '1px solid rgba(255,255,255,0.08)',
                }}>
                    <Stat value="2,400+" label="Teams worldwide" />
                    <Stat value="98%" label="Uptime SLA" />
                    <Stat value="4.9★" label="User rating" />
                </div>
                {/* Rotating quote */}
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', fontStyle: 'italic', marginTop: 8, minHeight: 20, transition: 'opacity 0.4s' }}>
                    {quotes[tick % quotes.length]}
                </div>
            </div>
        </div>
    );
};

// ── OTP input (large, centred digits) ────────────────────────────────────────
const OTPInput: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => (
    <input
        type="text" inputMode="numeric" value={value}
        onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        placeholder="· · · · · ·" maxLength={6} required autoFocus
        style={{
            width: '100%', padding: '20px 0', borderRadius: 18,
            border: '1.5px solid rgba(255,255,255,0.1)',
            background: 'rgba(255,255,255,0.04)', color: '#fff',
            fontSize: 36, letterSpacing: '0.5em', textAlign: 'center',
            fontWeight: 700, outline: 'none', transition: 'all 0.2s',
            boxSizing: 'border-box', fontFamily: "'Inter', monospace",
        }}
        onFocus={e => { e.target.style.borderColor = 'rgba(129,140,248,0.6)'; e.target.style.boxShadow = '0 0 0 4px rgba(99,102,241,0.12)'; }}
        onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; e.target.style.boxShadow = 'none'; }}
    />
);

// ── MAIN EXPORT ───────────────────────────────────────────────────────────────
export const Login: React.FC<{ onSuccess?: () => void; compact?: boolean; force2fa?: boolean }> = ({ onSuccess, compact = false }) => {
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

    const { base: inputBase, onFocus: inputFocus, onBlur: inputBlur } = useInputStyle();

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
            if (data.require2FA) { setStep('2fa'); return; }
            login(data.token, data.user);
            onSuccess?.();
        } catch (err: any) { setError(err.message); }
        finally { setLoading(false); }
    };

    const sendOtp = async (emailAddr: string) => {
        const res = await fetch('/api/verify/send', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: emailAddr }),
        });
        const data = await res.json();
        if (data.otp) setOtp(data.otp);
        if (!res.ok) throw new Error(data.error || 'Failed to send code');
    };

    const handleVerify = async (e: React.FormEvent) => {
        e.preventDefault(); setError(''); setLoading(true);
        try {
            const res = await fetch('/api/verify/check', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, otp }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Invalid code');
            login(pendingToken, pendingUser); onSuccess?.();
        } catch (err: any) { setError(err.message); }
        finally { setLoading(false); }
    };

    const handle2FASubmit = async (e: React.FormEvent) => {
        e.preventDefault(); setError(''); setLoading(true);
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, otp }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Authentication failed');
            login(data.token, data.user); onSuccess?.();
        } catch (err: any) { setError(err.message); }
        finally { setLoading(false); }
    };

    const handleForgotSubmit = async (e: React.FormEvent) => {
        e.preventDefault(); setError(''); setLoading(true);
        try {
            const res = await fetch('/api/auth/reset/send-otp', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to start reset');
            setStep('reset'); setOtp(''); setPassword('');
        } catch (err: any) { setError(err.message); }
        finally { setLoading(false); }
    };

    const handleResetSubmit = async (e: React.FormEvent) => {
        e.preventDefault(); setError(''); setLoading(true);
        try {
            const res = await fetch('/api/auth/reset/confirm', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, otp, newPassword: password }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Reset failed');
            setStep('form'); setPassword(''); setOtp('');
            setError('✅ Password reset! Please sign in.');
        } catch (err: any) { setError(err.message); }
        finally { setLoading(false); }
    };

    // ── Right-panel wrapper (glass card within dark bg) ──
    const rightBg: React.CSSProperties = {
        width: '100%', maxWidth: 480,
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: '0 52px',
    };

    // ── Small link button ────────────────────────────────────────────────────
    const LinkBtn: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({ onClick, children }) => (
        <button type="button" onClick={onClick} style={{
            background: 'none', border: 'none', color: '#818cf8', fontSize: 13,
            cursor: 'pointer', fontWeight: 600, padding: 0,
            fontFamily: "'Inter', -apple-system, sans-serif",
            transition: 'color 0.15s',
        }}
            onMouseEnter={e => e.currentTarget.style.color = '#a5b4fc'}
            onMouseLeave={e => e.currentTarget.style.color = '#818cf8'}
        >{children}</button>
    );

    // ── Full-screen split container ──────────────────────────────────────────
    const wrap: React.CSSProperties = {
        display: 'flex', width: '100vw', height: '100vh',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        WebkitFontSmoothing: 'antialiased',
    };
    const rightSide: React.CSSProperties = {
        flex: '0 0 480px', background: '#0b0f1a',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative', overflow: 'hidden',
    };

    // Shared heading style
    const heading = (sub: string) => (
        <div style={{ marginBottom: 36 }}>
            <h2 style={{ margin: '0 0 8px', fontSize: 30, fontWeight: 900, color: '#fff', letterSpacing: '-0.03em' }}>{sub}</h2>
        </div>
    );

    // ── OTP / 2FA / Forgot / Reset panels (same right col) ──────────────────
    const renderStep = () => {
        if (step === 'verify' || step === '2fa') {
            const is2fa = step === '2fa';
            const submitHandler = is2fa ? handle2FASubmit : handleVerify;
            return (
                <div style={rightBg}>
                    {heading(is2fa ? 'Two-Factor Auth' : 'Verify Your Identity')}
                    <div style={{ textAlign: 'center', marginBottom: 28 }}>
                        <div style={{ width: 64, height: 64, borderRadius: 20, background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                            <IconShield />
                        </div>
                        <p style={{ fontSize: 14, color: '#94a3b8', margin: 0, lineHeight: 1.6 }}>
                            6-digit code sent to <strong style={{ color: '#e2e8f0' }}>{email}</strong>
                        </p>
                    </div>
                    {error && <ErrorBanner msg={error} />}
                    <form onSubmit={submitHandler} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8 }}>
                        <OTPInput value={otp} onChange={setOtp} />
                        <SubmitBtn loading={loading} disabled={otp.length < 6} label={is2fa ? 'Verify & Sign In' : 'Unlock Workspace'} />
                    </form>
                    {!is2fa && (
                        <div style={{ textAlign: 'center', marginTop: 20 }}>
                            <button type="button" onClick={async () => { setResending(true); try { await sendOtp(email); } catch (e: any) { setError(e.message); } setResending(false); }}
                                style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                                {resending ? 'Sending…' : "Didn't get it? Resend code"}
                            </button>
                        </div>
                    )}
                    <div style={{ textAlign: 'center', marginTop: 12 }}>
                        <LinkBtn onClick={() => setStep('form')}>← Back to Sign In</LinkBtn>
                    </div>
                </div>
            );
        }

        if (step === 'forgot') {
            return (
                <div style={rightBg}>
                    {heading('Reset Password')}
                    <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 28px', lineHeight: 1.6 }}>
                        Enter your email address and we'll send you a reset code.
                    </p>
                    {error && <ErrorBanner msg={error} />}
                    <form onSubmit={handleForgotSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <div style={{ position: 'relative' }}>
                            <div style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#475569' }}><IconMail /></div>
                            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" required style={inputBase} onFocus={inputFocus} onBlur={inputBlur} />
                        </div>
                        <SubmitBtn loading={loading} label="Send Reset Code" />
                    </form>
                    <div style={{ textAlign: 'center', marginTop: 20 }}>
                        <LinkBtn onClick={() => { setStep('form'); setError(''); }}>← Back to Sign In</LinkBtn>
                    </div>
                </div>
            );
        }

        if (step === 'reset') {
            return (
                <div style={rightBg}>
                    {heading('Set New Password')}
                    <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 28px', lineHeight: 1.6 }}>
                        Enter the 6-digit code from the email sent to <strong style={{ color: '#94a3b8' }}>{email}</strong>.
                    </p>
                    {error && <ErrorBanner msg={error} />}
                    <form onSubmit={handleResetSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <OTPInput value={otp} onChange={setOtp} />
                        <div style={{ position: 'relative' }}>
                            <div style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#475569' }}><IconLock /></div>
                            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="New password (min 8 chars)" required minLength={8} style={inputBase} onFocus={inputFocus} onBlur={inputBlur} />
                        </div>
                        <SubmitBtn loading={loading} disabled={otp.length !== 6 || password.length < 8} label="Save New Password" />
                    </form>
                    <div style={{ textAlign: 'center', marginTop: 20 }}>
                        <LinkBtn onClick={() => setStep('form')}>Cancel</LinkBtn>
                    </div>
                </div>
            );
        }

        // ── Main sign-in / register ──────────────────────────────────────────
        return (
            <div style={rightBg}>
                <div style={{ marginBottom: 40 }}>
                    <h2 style={{ margin: '0 0 8px', fontSize: 30, fontWeight: 900, color: '#fff', letterSpacing: '-0.03em' }}>
                        {isRegistering ? 'Create your workspace' : 'Welcome back'}
                    </h2>
                    <p style={{ margin: 0, fontSize: 15, color: '#64748b', lineHeight: 1.6 }}>
                        {isRegistering
                            ? 'Start your 30-day free trial, no credit card required.'
                            : 'Enter your credentials to access your workspace.'}
                    </p>
                </div>

                {error && <div style={{ marginBottom: 16 }}><ErrorBanner msg={error} /></div>}

                <form onSubmit={handleFormSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {isRegistering && (
                        <div style={{ position: 'relative' }}>
                            <div style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#475569' }}><IconUser /></div>
                            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Full name" required={isRegistering} style={inputBase} onFocus={inputFocus} onBlur={inputBlur} />
                        </div>
                    )}
                    <div style={{ position: 'relative' }}>
                        <div style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#475569' }}><IconMail /></div>
                        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Work email" required style={inputBase} onFocus={inputFocus} onBlur={inputBlur} />
                    </div>
                    <div style={{ position: 'relative' }}>
                        <div style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#475569' }}><IconLock /></div>
                        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" required minLength={8} style={inputBase} onFocus={inputFocus} onBlur={inputBlur} />
                    </div>

                    {!isRegistering && (
                        <div style={{ textAlign: 'right', marginTop: -2 }}>
                            <LinkBtn onClick={() => { setStep('forgot'); setError(''); }}>Forgot password?</LinkBtn>
                        </div>
                    )}

                    {isRegistering && (
                        <div style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)', borderRadius: 12, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#6ee7b7', fontWeight: 500 }}><IconCheck /> 30-day free trial included</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#6ee7b7', fontWeight: 500 }}><IconCheck /> No credit card required</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#6ee7b7', fontWeight: 500 }}><IconCheck /> Cancel anytime</div>
                        </div>
                    )}

                    <div style={{ paddingTop: 4 }}>
                        <SubmitBtn loading={loading} label={isRegistering ? 'Create Workspace' : 'Sign In'} />
                    </div>
                </form>

                <div style={{ marginTop: 32, paddingTop: 24, borderTop: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>
                    <span style={{ fontSize: 13, color: '#3f4d60' }}>
                        {isRegistering ? 'Already have an account? ' : "Don't have an account? "}
                    </span>
                    <LinkBtn onClick={() => { setIsRegistering(!isRegistering); setError(''); }}>
                        {isRegistering ? 'Sign in' : 'Create workspace free'}
                    </LinkBtn>
                </div>
            </div>
        );
    };


    // ── Compact card (used inside modal / homepage wrapper) ──────────────────
    if (compact) {
        return (
            <div style={{
                background: 'linear-gradient(145deg, rgba(15,23,42,0.98) 0%, rgba(9,12,26,1) 100%)',
                borderRadius: 20, padding: '36px 32px',
                boxShadow: '0 32px 64px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.06)',
                fontFamily: "'Inter', -apple-system, sans-serif",
                WebkitFontSmoothing: 'antialiased',
            }}>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                {renderStep()}
            </div>
        );
    }

    return (
        <>
            {/* Keyframe for spinner */}
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <div style={{ display: 'flex', width: '100vw', height: '100vh', fontFamily: "'Inter', -apple-system, sans-serif", WebkitFontSmoothing: 'antialiased' }}>
                {/* Left brand panel */}
                <LeftPanel />
                {/* Right form panel */}
                <div style={{ flex: '0 0 480px', background: '#0b0f1a', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden', minWidth: 360 }}>
                    <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 30% 20%, rgba(99,102,241,0.07) 0%, transparent 55%), radial-gradient(ellipse at 70% 80%, rgba(139,92,246,0.05) 0%, transparent 55%)', pointerEvents: 'none' }} />
                    <div style={{ position: 'relative', zIndex: 1, width: '100%', display: 'flex', justifyContent: 'center', padding: '0 0 0 0' }}>
                        {renderStep()}
                    </div>
                </div>
            </div>
        </>
    );
};

