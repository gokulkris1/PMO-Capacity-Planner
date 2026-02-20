
import React, { useState } from 'react';
import { Resource, Project, Allocation, getAllocationStatus, AllocationStatus } from '../types';

interface Props {
    resources: Resource[];
    projects: Project[];
    baseAllocations: Allocation[];
    scenarioAllocations: Allocation[] | null;
    scenarioMode: boolean;
    onEnter: () => void;
    onApply: () => void;
    onDiscard: () => void;
    onUpdate: (resId: string, projId: string, val: string) => void;
    aiResponse: string | null;
    isAiLoading: boolean;
    onAiAsk: (prompt: string) => void;
}

function utilColor(pct: number) {
    const s = getAllocationStatus(pct);
    if (s === AllocationStatus.OVER) return '#ef4444';
    if (s === AllocationStatus.HIGH) return '#f59e0b';
    if (s === AllocationStatus.OPTIMAL) return '#10b981';
    return '#94a3b8';
}

function getUtil(allocs: Allocation[], resId: string) {
    return allocs.filter(a => a.resourceId === resId).reduce((s, a) => s + a.percentage, 0);
}

const PRESETS = [
    { label: 'Shift 20% from James to Aiden on Apollo', res: 'r2', proj: 'p1', to: 'r10', toProj: 'p1', pct: 50, toPct: 70 },
];

export const WhatIfPanel: React.FC<Props> = ({
    resources, projects, baseAllocations, scenarioAllocations, scenarioMode,
    onEnter, onApply, onDiscard, onUpdate, aiResponse, isAiLoading, onAiAsk
}) => {
    const [aiPrompt, setAiPrompt] = useState('');

    const liveAlloc = scenarioAllocations ?? baseAllocations;

    // Compute diffs
    const diffs: { res: Resource; proj: Project; before: number; after: number }[] = [];
    if (scenarioMode && scenarioAllocations) {
        const allResIds = new Set([...baseAllocations.map(a => a.resourceId), ...scenarioAllocations.map(a => a.resourceId)]);
        const allProjIds = new Set([...baseAllocations.map(a => a.projectId), ...scenarioAllocations.map(a => a.projectId)]);
        allResIds.forEach(rId => {
            allProjIds.forEach(pId => {
                const before = baseAllocations.find(a => a.resourceId === rId && a.projectId === pId)?.percentage || 0;
                const after = scenarioAllocations.find(a => a.resourceId === rId && a.projectId === pId)?.percentage || 0;
                if (before !== after) {
                    const res = resources.find(r => r.id === rId);
                    const proj = projects.find(p => p.id === pId);
                    if (res && proj) diffs.push({ res, proj, before, after });
                }
            });
        });
    }

    return (
        <div className="page-enter" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Hero card */}
            <div style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', borderRadius: 20, padding: 28, color: '#f1f5f9', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: -40, right: -40, width: 200, height: 200, borderRadius: '50%', background: '#6366f1', opacity: .08 }} />
                <div style={{ position: 'absolute', bottom: -30, left: 40, width: 150, height: 150, borderRadius: '50%', background: '#818cf8', opacity: .06 }} />
                <div style={{ fontSize: 28, marginBottom: 8 }}>🔬</div>
                <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>What-If Scenario Planner</div>
                <div style={{ fontSize: 14, color: '#94a3b8', maxWidth: 560, lineHeight: 1.7, marginBottom: 20 }}>
                    Safely experiment with reallocation scenarios without affecting live data. Changes are sandboxed until you choose to apply them.
                </div>
                {!scenarioMode ? (
                    <button className="btn btn-primary" onClick={onEnter} style={{ fontSize: 13 }}>
                        🚀 Start What-If Scenario
                    </button>
                ) : (
                    <div style={{ display: 'flex', gap: 10 }}>
                        <button className="btn btn-success" onClick={onApply}>✅ Apply Scenario to Live Data</button>
                        <button className="btn btn-danger" onClick={onDiscard}>✕ Discard Scenario</button>
                    </div>
                )}
            </div>

            {scenarioMode && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                    {/* Allocation editor */}
                    <div className="panel">
                        <div className="panel-header">
                            <div>
                                <div className="panel-title">Edit Allocations (Sandboxed)</div>
                                <div className="panel-subtitle">Changes here do not affect live data</div>
                            </div>
                        </div>
                        <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th style={{ position: 'sticky', left: 0, background: '#f8fafc', zIndex: 5 }}>Resource</th>
                                        {projects.map(p => <th key={p.id} style={{ textAlign: 'center', minWidth: 90, fontSize: 10 }}>{p.name}</th>)}
                                        <th>Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {resources.map(res => {
                                        const util = getUtil(liveAlloc, res.id);
                                        return (
                                            <tr key={res.id} style={{ background: util > 100 ? '#fef2f2' : 'transparent' }}>
                                                <td style={{ position: 'sticky', left: 0, background: util > 100 ? '#fef2f2' : '#fff', zIndex: 4, fontSize: 12, fontWeight: 600 }}>
                                                    {res.name.split(' ')[0]}
                                                </td>
                                                {projects.map(proj => {
                                                    const pct = liveAlloc.find(a => a.resourceId === res.id && a.projectId === proj.id)?.percentage || 0;
                                                    return (
                                                        <td key={proj.id} style={{ textAlign: 'center' }}>
                                                            <input
                                                                type="number" min={0} max={100}
                                                                value={pct || ''}
                                                                placeholder="0"
                                                                onChange={e => onUpdate(res.id, proj.id, e.target.value)}
                                                                className="matrix-cell-input"
                                                                style={{ width: 60 }}
                                                            />
                                                        </td>
                                                    );
                                                })}
                                                <td>
                                                    <span style={{ fontWeight: 800, fontSize: 13, color: utilColor(util) }}>{util}%</span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Diff panel */}
                    <div className="panel">
                        <div className="panel-header">
                            <div>
                                <div className="panel-title">Change Summary</div>
                                <div className="panel-subtitle">{diffs.length} allocation{diffs.length !== 1 ? 's' : ''} changed</div>
                            </div>
                        </div>
                        <div style={{ padding: '8px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {diffs.length === 0 ? (
                                <div style={{ padding: '32px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                                    No changes yet – edit allocations in the table on the left.
                                </div>
                            ) : (
                                diffs.map((d, i) => {
                                    const changed = d.after - d.before;
                                    const isIncrease = changed > 0;
                                    return (
                                        <div key={i} style={{
                                            background: isIncrease ? '#fef2f2' : '#ecfdf5',
                                            border: `1px solid ${isIncrease ? '#fecaca' : '#86efac'}`,
                                            borderRadius: 10, padding: '10px 14px',
                                            fontSize: 13,
                                        }}>
                                            <div style={{ fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>
                                                {d.res.name} × {d.proj.name}
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <span style={{ color: '#94a3b8', textDecoration: 'line-through' }}>{d.before}%</span>
                                                <span>→</span>
                                                <span style={{ fontWeight: 800, color: isIncrease ? '#ef4444' : '#10b981' }}>{d.after}%</span>
                                                <span style={{ marginLeft: 'auto', fontWeight: 700, color: isIncrease ? '#ef4444' : '#10b981', fontSize: 12 }}>
                                                    {isIncrease ? '▲' : '▼'} {Math.abs(changed)}%
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Before / After summary (only when active scenario) */}
            {scenarioMode && (
                <div className="panel">
                    <div className="panel-header">
                        <div className="panel-title">Before vs After – Resource Utilization</div>
                    </div>
                    <div style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: 12 }}>
                        {resources.map(res => {
                            const before = getUtil(baseAllocations, res.id);
                            const after = getUtil(liveAlloc, res.id);
                            const delta = after - before;
                            return (
                                <div key={res.id} style={{ background: '#f8fafc', borderRadius: 10, padding: '10px 14px' }}>
                                    <div style={{ fontWeight: 700, fontSize: 12, color: '#334155', marginBottom: 6 }}>{res.name.split(' ')[0]}</div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                                        <span style={{ color: utilColor(before), fontWeight: 700 }}>{before}%</span>
                                        <span style={{ color: '#cbd5e1' }}>→</span>
                                        <span style={{ color: utilColor(after), fontWeight: 800, fontSize: 14 }}>{after}%</span>
                                        {delta !== 0 && (
                                            <span style={{ marginLeft: 'auto', fontWeight: 700, fontSize: 11, color: delta > 0 ? '#ef4444' : '#10b981' }}>
                                                {delta > 0 ? `+${delta}` : delta}%
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ marginTop: 6, height: 5, background: '#e2e8f0', borderRadius: 99, overflow: 'hidden' }}>
                                        <div style={{ height: '100%', width: `${Math.min(100, after)}%`, background: utilColor(after), borderRadius: 99, transition: 'width .4s' }} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* AI Assistant */}
            <div className="panel">
                <div className="panel-header">
                    <div>
                        <div className="panel-title">🤖 AI Capacity Advisor</div>
                        <div className="panel-subtitle">Ask about rebalancing, risks, or what-if suggestions</div>
                    </div>
                </div>
                <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <input
                            type="text"
                            className="form-input"
                            placeholder="e.g. Who can absorb 20% more work if James is unavailable?"
                            value={aiPrompt}
                            onChange={e => setAiPrompt(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && aiPrompt.trim()) { onAiAsk(aiPrompt); setAiPrompt(''); } }}
                        />
                        <button className="btn btn-primary" onClick={() => { if (aiPrompt.trim()) { onAiAsk(aiPrompt); setAiPrompt(''); } }}>Ask</button>
                    </div>
                    {/* Quick prompts */}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {[
                            'Who is over-allocated and how can I fix it?',
                            'Which resources have capacity for a new project?',
                            'Summarize project staffing risks',
                        ].map(p => (
                            <button key={p} className="btn btn-secondary" style={{ fontSize: 11, padding: '5px 10px' }} onClick={() => { onAiAsk(p); }}>
                                {p}
                            </button>
                        ))}
                    </div>
                    {isAiLoading && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#64748b', fontSize: 13 }}>
                            <div className="spinner" />
                            Analyzing data...
                        </div>
                    )}
                    {aiResponse && !isAiLoading && (
                        <div className="ai-response-box">
                            {aiResponse.split('\n').map((line, i) => <p key={i} style={{ marginBottom: 6 }}>{line}</p>)}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
