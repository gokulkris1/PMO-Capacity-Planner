
import React, { useState, useEffect, useCallback, useRef } from 'react';

export interface TourStep {
    id: string;
    title: string;
    description: string;
    voiceText: string;
    targetTab?: string;
    spotlight?: { top: string; left: string; width: string; height: string };
    position?: 'center' | 'top-right' | 'bottom-center' | 'left' | 'right';
}

interface Props {
    onClose: () => void;
    onNavigate: (tab: string) => void;
}

const TOUR_STEPS: TourStep[] = [
    {
        id: 'welcome',
        title: 'Welcome to PMO Capacity Planner 👋',
        description: "Tom's team capacity tool — manage resources, projects, and allocations in one place. This tour will walk you through every view in about 2 minutes.",
        voiceText: "Welcome to the PMO Capacity Planner. This is your central hub for managing team resources and project allocations. Let me walk you through the key features.",
        position: 'center',
    },
    {
        id: 'sidebar',
        title: 'Navigation Sidebar',
        description: 'The dark sidebar gives you instant access to all 6 views. The red badge on Dashboard shows how many resources are currently over-allocated — keep it at zero!',
        voiceText: 'This is your navigation sidebar. It gives you access to all six dashboard views. Notice the red badge which alerts you when resources are over-allocated.',
        targetTab: 'dashboard',
        spotlight: { top: '0', left: '0', width: '240px', height: '100%' },
        position: 'right',
    },
    {
        id: 'dashboard',
        title: '📊 Dashboard – Your Command Centre',
        description: 'See your whole team at a glance: average utilisation, active projects, over-allocated names, and FTE deployed. The colour-coded chart shows who is Under, Optimal, High, or Over.',
        voiceText: 'The Dashboard is your command centre. It shows key metrics: average utilisation, active projects, over-allocated team members, and the total FTE deployed across projects. The chart uses traffic-light colours to instantly highlight capacity issues.',
        targetTab: 'dashboard',
        position: 'center',
    },
    {
        id: 'allocation-matrix',
        title: '⊞ Allocation Matrix – Edit Assignments',
        description: 'This grid shows every resource × project combination. Type a percentage in any cell to assign capacity. Cells turn green (optimal), amber (high), or red (over-allocated) automatically.',
        voiceText: 'The Allocation Matrix is your main editing tool. Each row is a team member, each column is a project. Simply type a percentage into any cell to assign that person to a project. Cells automatically colour-code based on utilisation thresholds.',
        targetTab: 'allocations',
        position: 'center',
    },
    {
        id: 'by-project',
        title: '🚀 By Project – Who is on what?',
        description: "Click any project pill at the top to see exactly which team members are committed, at what percentage, and their total workload. Great for a project kick-off briefing.",
        voiceText: "The By Project view lets you drill into any single project. Click a project at the top to see who's working on it, what percentage of their time they've committed, and whether they're at risk of overload.",
        targetTab: 'by-project',
        position: 'center',
    },
    {
        id: 'by-individual',
        title: '👤 By Individual – Spread across projects',
        description: "Each person appears as a card showing all their project commitments as colour-coded bars. Over-allocated team members get a red warning banner — like Noma and Maria currently.",
        voiceText: "The By Individual view shows how each person is spread across projects. Each card displays coloured bars for every project assignment. If someone is over-allocated, a red warning banner appears at the bottom of their card.",
        targetTab: 'by-resource',
        position: 'center',
    },
    {
        id: 'by-team',
        title: '👥 By Team – Team-level heatmap',
        description: "Resources are grouped by team. Each cell is colour-coded: green = optimal, amber = high, red = over. Use this to spot which entire team is under pressure.",
        voiceText: "The By Team view groups your people by team and shows a colour-coded heatmap across all projects. This is the fastest way to spot which team is under the most pressure, and where you have spare capacity.",
        targetTab: 'by-team',
        position: 'center',
    },
    {
        id: 'what-if',
        title: '🔬 What-If Scenarios – Safe experiments',
        description: "Activate What-If mode to create a sandboxed copy of all allocations. Experiment freely — the live data never changes until you hit Apply. The Change Summary panel shows exactly what changed.",
        voiceText: "What If Scenarios let you experiment safely. Click Start What If Scenario to enter a sandbox. Any changes you make here are isolated from live data. You can see a real-time change summary on the right, and compare before and after for every team member. When you're happy, click Apply — or Discard to cancel.",
        targetTab: 'what-if',
        position: 'center',
    },
    {
        id: 'ai-advisor',
        title: '🤖 AI Capacity Advisor',
        description: "The AI panel at the bottom of the sidebar and inside What-If Scenarios can answer questions like: \"Who can absorb 20% more work?\" or \"Summarise current project risks.\"",
        voiceText: "The AI Capacity Advisor is available in the sidebar and inside the What If panel. Ask it anything about your team — for example, who can absorb more work, or which projects are understaffed. It analyses your live allocation data to give you actionable insights.",
        targetTab: 'what-if',
        position: 'center',
    },
    {
        id: 'add-resource',
        title: '+ Add Resources & Projects',
        description: "Use the '+ Add Resource' and '+ Add Project' buttons in the header to extend your team and portfolio. All data persists in the browser until you reset.",
        voiceText: "Finally, you can add new team members and projects using the buttons in the top right. Fill in the details in the modal form and the data is saved instantly. You can also export all allocations as a CSV file from the sidebar.",
        targetTab: 'dashboard',
        position: 'center',
    },
    {
        id: 'done',
        title: "You're all set! 🎉",
        description: "That's everything. Start by reviewing the Dashboard — if the red badge shows over-allocations, head to the Allocation Matrix or use What-If mode to rebalance. Good luck!",
        voiceText: "That's the full tour! You're ready to start managing your team's capacity. Remember to check the Dashboard regularly, use What If scenarios before making big changes, and tap the AI Advisor when you need a second opinion. Enjoy the tool!",
        position: 'center',
    },
];

function useSpeech() {
    const synthRef = useRef<SpeechSynthesis | null>(null);

    useEffect(() => {
        synthRef.current = window.speechSynthesis;
        return () => { synthRef.current?.cancel(); };
    }, []);

    const speak = useCallback((text: string) => {
        if (!synthRef.current) return;
        synthRef.current.cancel();
        const u = new SpeechSynthesisUtterance(text);
        // Try to use a natural English voice
        const voices = synthRef.current.getVoices();
        const preferred = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Samantha') || v.name.includes('Google UK') || v.name.includes('Daniel')));
        if (preferred) u.voice = preferred;
        u.rate = 0.95;
        u.pitch = 1.0;
        u.volume = 1.0;
        synthRef.current.speak(u);
    }, []);

    const cancel = useCallback(() => { synthRef.current?.cancel(); }, []);

    return { speak, cancel };
}

const POSITION_STYLE: Record<string, React.CSSProperties> = {
    'center': { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' },
    'top-right': { top: 80, right: 20 },
    'bottom-center': { bottom: 80, left: '50%', transform: 'translateX(-50%)' },
    'left': { top: '50%', left: 260, transform: 'translateY(-50%)' },
    'right': { top: '50%', right: 20, transform: 'translateY(-50%)' },
};

export const TourOverlay: React.FC<Props> = ({ onClose, onNavigate }) => {
    const [step, setStep] = useState(0);
    const [voiceEnabled, setVoiceEnabled] = useState(true);
    const { speak, cancel } = useSpeech();
    const current = TOUR_STEPS[step];
    const isLast = step === TOUR_STEPS.length - 1;

    // Navigate & speak when step changes
    useEffect(() => {
        if (current.targetTab) onNavigate(current.targetTab);
        if (voiceEnabled) speak(current.voiceText);
    }, [step, voiceEnabled]); // eslint-disable-line

    const goNext = () => {
        if (isLast) { cancel(); onClose(); return; }
        setStep(s => s + 1);
    };

    const goPrev = () => { if (step > 0) setStep(s => s - 1); };

    const skipTour = () => { cancel(); onClose(); };

    const toggleVoice = () => {
        setVoiceEnabled(v => {
            if (v) cancel();
            else speak(current.voiceText);
            return !v;
        });
    };

    const progress = Math.round(((step + 1) / TOUR_STEPS.length) * 100);

    return (
        <>
            {/* Dark overlay */}
            <div style={{
                position: 'fixed', inset: 0, zIndex: 2000,
                background: 'rgba(0,0,0,.55)',
                backdropFilter: 'blur(2px)',
                pointerEvents: 'none',
            }} />

            {/* Tour Card */}
            <div
                style={{
                    position: 'fixed',
                    zIndex: 2001,
                    width: 440,
                    maxWidth: '95vw',
                    background: '#fff',
                    borderRadius: 20,
                    boxShadow: '0 24px 64px rgba(0,0,0,.28), 0 0 0 1px rgba(99,102,241,.15)',
                    overflow: 'hidden',
                    ...(POSITION_STYLE[current.position || 'center']),
                    animation: 'slideUp .3s cubic-bezier(.4,0,.2,1)',
                }}
            >
                {/* Progress bar */}
                <div style={{ height: 4, background: '#f1f5f9' }}>
                    <div style={{ height: '100%', width: `${progress}%`, background: 'linear-gradient(90deg, #6366f1, #818cf8)', borderRadius: 99, transition: 'width .4s' }} />
                </div>

                {/* Header */}
                <div style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', padding: '20px 24px 16px', position: 'relative' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
                            Step {step + 1} of {TOUR_STEPS.length}
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                            {/* Voice toggle */}
                            <button
                                onClick={toggleVoice}
                                title={voiceEnabled ? 'Mute voice' : 'Enable voice'}
                                style={{ background: voiceEnabled ? '#6366f1' : 'rgba(255,255,255,.1)', border: 'none', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontSize: 14, color: '#fff', transition: 'background .15s' }}
                            >
                                {voiceEnabled ? '🔊' : '🔇'}
                            </button>
                            <button
                                onClick={skipTour}
                                style={{ background: 'rgba(255,255,255,.08)', border: 'none', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontSize: 12, color: '#94a3b8', fontWeight: 600 }}
                            >
                                Skip tour
                            </button>
                        </div>
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: '#f1f5f9', lineHeight: 1.3 }}>{current.title}</div>

                    {/* Step dots */}
                    <div style={{ display: 'flex', gap: 5, marginTop: 14 }}>
                        {TOUR_STEPS.map((_, i) => (
                            <button
                                key={i}
                                onClick={() => setStep(i)}
                                style={{
                                    width: i === step ? 20 : 7,
                                    height: 7,
                                    borderRadius: 99,
                                    background: i === step ? '#818cf8' : i < step ? '#6366f1' : 'rgba(255,255,255,.2)',
                                    border: 'none',
                                    cursor: 'pointer',
                                    padding: 0,
                                    transition: 'all .25s',
                                }}
                            />
                        ))}
                    </div>
                </div>

                {/* Body */}
                <div style={{ padding: '20px 24px 24px' }}>
                    <p style={{ color: '#475569', fontSize: 14, lineHeight: 1.75, margin: 0 }}>{current.description}</p>

                    {voiceEnabled && (
                        <div style={{ marginTop: 12, background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 10, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#166534' }}>
                            <span style={{ animation: 'pulse-dot 1.5s infinite', display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#16a34a', flexShrink: 0 }}></span>
                            Voice narration active – or press <kbd style={{ background: '#dcfce7', border: '1px solid #86efac', borderRadius: 4, padding: '1px 5px', fontFamily: 'monospace', fontSize: 11 }}>🔊</kbd> to mute
                        </div>
                    )}

                    {/* Nav buttons */}
                    <div style={{ display: 'flex', gap: 10, marginTop: 20, alignItems: 'center' }}>
                        {step > 0 && (
                            <button
                                onClick={goPrev}
                                style={{ padding: '9px 18px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}
                            >
                                ← Back
                            </button>
                        )}
                        <button
                            onClick={goNext}
                            style={{
                                flex: 1,
                                padding: '10px 18px',
                                borderRadius: 10,
                                border: 'none',
                                background: isLast ? 'linear-gradient(135deg, #10b981, #059669)' : 'linear-gradient(135deg, #6366f1, #4f46e5)',
                                color: '#fff',
                                fontWeight: 700,
                                fontSize: 14,
                                cursor: 'pointer',
                                fontFamily: 'inherit',
                                boxShadow: isLast ? '0 4px 14px rgba(16,185,129,.35)' : '0 4px 14px rgba(99,102,241,.35)',
                                transition: 'all .15s',
                            }}
                        >
                            {isLast ? '🎉 Start using the Planner' : 'Next →'}
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
};
