import React, { useState } from 'react';
import { useParams } from 'react-router-dom';

interface Plan {
    name: string;
    emoji: string;
    price: number | null;
    period: string;
    tagline: string;
    color: string;
    gradient: string;
    badge?: string;
    features: { text: string; included: boolean }[];
    cta: string;
    ctaStyle: React.CSSProperties;
}

const PLANS: Plan[] = [
    {
        name: 'Basic',
        emoji: '🚀',
        price: 29,
        period: '/month',
        tagline: '1 Month Free. Perfect for a single project team.',
        color: '#6366f1',
        gradient: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
        features: [
            { text: 'Up to 5 active projects', included: true },
            { text: 'Up to 5 users', included: true },
            { text: '1 admin seat', included: true },
            { text: 'AI Advisor', included: false },
            { text: 'What-If scenarios', included: false },
            { text: 'CSV import & export', included: false },
            { text: 'Priority support', included: false },
        ],
        cta: 'Start Basic',
        ctaStyle: { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: '#fff', boxShadow: '0 4px 20px rgba(99,102,241,0.4)' },
    },
    {
        name: 'Pro',
        emoji: '⚡',
        price: 49,
        period: '/month',
        tagline: 'For growing teams managing a portfolio',
        color: '#f59e0b',
        gradient: 'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
        badge: 'Most Popular',
        features: [
            { text: 'Up to 10 active projects', included: true },
            { text: 'Up to 20 users', included: true },
            { text: '1 admin seat', included: true },
            { text: '50 AI questions / month', included: true },
            { text: 'CSV import & export', included: true },
            { text: 'What-If scenarios', included: true },
            { text: 'Priority support', included: false },
        ],
        cta: 'Start Pro',
        ctaStyle: { background: 'linear-gradient(135deg, #f59e0b, #ef4444)', color: '#fff', boxShadow: '0 4px 20px rgba(245,158,11,0.4)' },
    },
    {
        name: 'Max',
        emoji: '👑',
        price: null,
        period: '',
        tagline: 'Enterprise-grade, unlimited scale',
        color: '#10b981',
        gradient: 'linear-gradient(135deg, #10b981 0%, #0891b2 100%)',
        features: [
            { text: 'Unlimited projects', included: true },
            { text: 'Unlimited users', included: true },
            { text: 'Unlimited admin seats', included: true },
            { text: 'Unlimited AI questions', included: true },
            { text: 'API access & webhooks', included: true },
            { text: 'SLA & dedicated support', included: true },
            { text: 'SSO / SAML integration', included: true },
        ],
        cta: 'Contact Us',
        ctaStyle: { background: 'linear-gradient(135deg, #10b981, #0891b2)', color: '#fff', boxShadow: '0 4px 20px rgba(16,185,129,0.4)' },
    },
];

interface Props {
    onClose: () => void;
    currentPlan?: string;
}

export const PricingPage: React.FC<Props> = ({ onClose, currentPlan = 'Basic' }) => {
    const { orgSlug } = useParams<{ orgSlug: string }>();
    const [billing, setBilling] = useState<'monthly' | 'annual'>('monthly');

    const annualDiscount = 0.2; // 20% off annual

    const effectivePrice = (p: Plan) => {
        if (!p.price) return 0;
        if (billing === 'annual') return Math.round(p.price * (1 - annualDiscount));
        return p.price;
    };

    const [isCheckingOut, setIsCheckingOut] = useState<string | null>(null);

    const handleCheckout = async (plan: Plan) => {
        if (plan.name.toUpperCase() === currentPlan.toUpperCase()) return;

        setIsCheckingOut(plan.name);
        try {
            const token = localStorage.getItem('pcp_token');
            if (!token) {
                alert('Please sign in to upgrade.');
                return;
            }

            const res = await fetch('/api/checkout', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ plan: plan.name.toUpperCase(), orgSlug })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Checkout failed');

            if (data.url) {
                window.location.href = data.url;
            }
        } catch (err: any) {
            console.error('Checkout error:', err);
            alert(err.message || 'Failed to initialize checkout.');
        } finally {
            setIsCheckingOut(null);
        }
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 9998,
            background: 'rgba(5,10,20,0.9)', backdropFilter: 'blur(10px)',
            overflowY: 'auto', fontFamily: "'Inter', -apple-system, sans-serif",
        }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div style={{ maxWidth: 1100, margin: '0 auto', padding: '48px 24px 80px' }}>

                {/* Close */}
                <button onClick={onClose} style={{
                    position: 'fixed', top: 20, right: 24,
                    background: '#1e293b', border: '1px solid #334155',
                    color: '#94a3b8', borderRadius: '50%',
                    width: 36, height: 36, cursor: 'pointer', fontSize: 18,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 10,
                }}>✕</button>

                {/* Header */}
                <div style={{ textAlign: 'center', marginBottom: 48 }}>
                    <div style={{
                        display: 'inline-flex', alignItems: 'center', gap: 8,
                        background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)',
                        borderRadius: 100, padding: '6px 16px', fontSize: 13,
                        color: '#a5b4fc', marginBottom: 20, fontWeight: 500,
                    }}>
                        ✨ Simple, transparent pricing
                    </div>
                    <h1 style={{
                        fontSize: 42, fontWeight: 900, color: '#f1f5f9',
                        margin: '0 0 12px', letterSpacing: '-0.03em',
                    }}>
                        Plans for every team
                    </h1>
                    <p style={{ fontSize: 17, color: '#64748b', margin: '0 auto 32px', maxWidth: 480, lineHeight: 1.6 }}>
                        Start free — upgrade when your team is ready. Cancel any time.
                    </p>

                    {/* Billing toggle */}
                    <div style={{
                        display: 'inline-flex', background: '#1e293b',
                        borderRadius: 12, padding: 4, border: '1px solid #334155',
                        gap: 4,
                    }}>
                        {(['monthly', 'annual'] as const).map(b => (
                            <button key={b} onClick={() => setBilling(b)} style={{
                                padding: '8px 20px', borderRadius: 9, border: 'none',
                                fontWeight: 600, fontSize: 13, cursor: 'pointer',
                                transition: 'all 0.2s',
                                background: billing === b ? '#6366f1' : 'transparent',
                                color: billing === b ? '#fff' : '#64748b',
                            }}>
                                {b === 'monthly' ? 'Monthly' : 'Annual'}{b === 'annual' && <span style={{ marginLeft: 6, background: '#10b981', color: '#fff', fontSize: 10, borderRadius: 6, padding: '1px 6px' }}>-20%</span>}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Cards */}
                <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                    gap: 20, alignItems: 'start',
                }}>
                    {PLANS.map(plan => (
                        <div key={plan.name} style={{
                            background: plan.badge ? 'linear-gradient(160deg,#1a1f35 0%,#0f1629 100%)' : '#111827',
                            borderRadius: 20,
                            border: plan.badge ? `1.5px solid ${plan.color}50` : '1px solid #1e293b',
                            padding: 28,
                            position: 'relative',
                            transform: plan.badge ? 'scale(1.03)' : 'none',
                            boxShadow: plan.badge ? `0 16px 48px ${plan.color}25` : '0 2px 12px rgba(0,0,0,0.3)',
                        }}>
                            {plan.badge && (
                                <div style={{
                                    position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
                                    background: `linear-gradient(135deg, ${plan.color}, #ef4444)`,
                                    color: '#fff', fontSize: 11, fontWeight: 700,
                                    padding: '4px 14px', borderRadius: 20, letterSpacing: '0.04em',
                                    whiteSpace: 'nowrap',
                                }}>⭐ {plan.badge}</div>
                            )}

                            {/* Plan header */}
                            <div style={{ marginBottom: 20 }}>
                                <div style={{ fontSize: 28, marginBottom: 8 }}>{plan.emoji}</div>
                                <div style={{ fontSize: 18, fontWeight: 800, color: '#f1f5f9', marginBottom: 2 }}>{plan.name}</div>
                                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>{plan.tagline}</div>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                                    {plan.price !== null ? (
                                        <>
                                            <span style={{ fontSize: 38, fontWeight: 900, color: plan.badge ? plan.color : '#f1f5f9' }}>
                                                €{effectivePrice(plan)}
                                            </span>
                                            <span style={{ fontSize: 13, color: '#64748b' }}>{plan.period}</span>
                                        </>
                                    ) : (
                                        <span style={{ fontSize: 38, fontWeight: 900, color: '#f1f5f9' }}>Free</span>
                                    )}
                                </div>
                                {billing === 'annual' && plan.price ? (
                                    <div style={{ fontSize: 11, color: '#10b981', marginTop: 2 }}>
                                        €{plan.price}/mo billed monthly
                                    </div>
                                ) : null}
                            </div>

                            {/* CTA */}
                            <button
                                onClick={() => handleCheckout(plan)}
                                disabled={isCheckingOut === plan.name}
                                style={{
                                    width: '100%', padding: '12px',
                                    borderRadius: 12, border: 'none',
                                    fontWeight: 700, fontSize: 14,
                                    display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8,
                                    cursor: plan.name === currentPlan || isCheckingOut ? 'default' : 'pointer',
                                    marginBottom: 24, transition: 'all 0.2s', opacity: isCheckingOut === plan.name ? 0.7 : 1,
                                    ...plan.ctaStyle,
                                }}>
                                {isCheckingOut === plan.name ? (
                                    <div style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                                ) : plan.name.toUpperCase() === currentPlan.toUpperCase() ? (
                                    '✓ Current Plan'
                                ) : plan.cta}
                            </button>

                            {/* Features */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {plan.features.map(f => (
                                    <div key={f.text} style={{
                                        display: 'flex', alignItems: 'flex-start', gap: 10,
                                        opacity: f.included ? 1 : 0.35,
                                    }}>
                                        <span style={{
                                            flexShrink: 0, width: 18, height: 18,
                                            borderRadius: '50%',
                                            background: f.included ? `${plan.color}25` : '#1e293b',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontSize: 10, color: f.included ? plan.color : '#475569',
                                            marginTop: 1,
                                        }}>
                                            {f.included ? '✓' : '✕'}
                                        </span>
                                        <span style={{ fontSize: 13, color: f.included ? '#cbd5e1' : '#475569' }}>
                                            {f.text}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Footer reassurance */}
                <div style={{
                    textAlign: 'center', marginTop: 48,
                    display: 'flex', justifyContent: 'center', gap: 40, flexWrap: 'wrap',
                }}>
                    {[
                        { icon: '↩️', text: 'Cancel anytime' },
                        { icon: '🇪🇺', text: 'GDPR compliant' },
                        { icon: '🛡️', text: 'Data encrypted in transit' },
                    ].map(item => (
                        <div key={item.text} style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#475569', fontSize: 13 }}>
                            <span>{item.icon}</span><span>{item.text}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
