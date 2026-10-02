import React from 'react';
import { Craft, Resource } from '../../types';
import { CRAFT_BY_ID, PMO_CRAFTS } from '../../constants';
import { PersonQuarterLoad } from '../../utils/craftEngine';
import { Quarter } from '../../utils/quarters';

/* Series colours for the load bars (validated for colour-vision safety) */
export const LOAD_COLORS = {
    above: '#0052CC',   // above-the-table craft
    below: '#8b5cf6',   // below-the-table craft
    other: '#b45309',   // craft not declared on the person
    bench: 'var(--n-200)',
    over: 'var(--over)',
};

export function craftOf(id?: string): Craft | undefined {
    return id ? CRAFT_BY_ID[id] : undefined;
}

export function craftName(id?: string): string {
    return craftOf(id)?.name || id || 'Unassigned';
}

export const CraftChip: React.FC<{ craftId?: string; via?: 'primary' | 'secondary'; small?: boolean; proficiency?: number; title?: string }> = ({ craftId, via = 'primary', small, proficiency, title }) => {
    const c = craftOf(craftId);
    const color = c?.color || '#64748b';
    const label = c ? (small ? c.short : c.name) : (craftId || 'None');
    return (
        <span title={title || c?.description || label} style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: small ? '2px 7px' : '3px 10px', borderRadius: 999,
            fontSize: small ? 10 : 11, fontWeight: 700, whiteSpace: 'nowrap',
            background: via === 'primary' ? color : '#fff',
            color: via === 'primary' ? '#fff' : color,
            border: `1px solid ${color}`,
            letterSpacing: '.02em',
        }}>
            {via === 'secondary' && <span style={{ width: 6, height: 6, borderRadius: 999, background: color }} />}
            {label}
            {proficiency ? <span style={{ opacity: .8, fontWeight: 600 }}>·L{proficiency}</span> : null}
        </span>
    );
};

/** Stacked load bar for one person in one quarter. Bench is the empty track; over-allocation turns the edge red. */
export const LoadBar: React.FC<{ load: PersonQuarterLoad; height?: number; showLabel?: boolean; quarter?: Quarter }> = ({ load, height = 14, showLabel = true, quarter }) => {
    const cap = load.capacity || 100;
    const scale = Math.max(cap, load.total); // if over capacity, scale to total so the bar does not clip
    const seg = (v: number) => `${(v / scale) * 100}%`;
    const over = load.total > cap;
    const tip = `${quarter ? quarter.label + ' · ' : ''}Above the table ${load.aboveTable}% · Below the table ${load.belowTable}%${load.other ? ` · Other ${load.other}%` : ''} · Bench ${load.bench}%${over ? ` · OVER by ${Math.round(load.total - cap)}%` : ''}`;
    return (
        <div title={tip} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
            <div style={{ flex: 1, height, borderRadius: 4, background: LOAD_COLORS.bench, overflow: 'hidden', display: 'flex', border: over ? `1px solid ${LOAD_COLORS.over}` : '1px solid transparent' }}>
                {load.aboveTable > 0 && <div style={{ width: seg(load.aboveTable), background: LOAD_COLORS.above, marginRight: 2 }} />}
                {load.belowTable > 0 && <div style={{ width: seg(load.belowTable), background: LOAD_COLORS.below, marginRight: 2 }} />}
                {load.other > 0 && <div style={{ width: seg(load.other), background: LOAD_COLORS.other }} />}
            </div>
            {showLabel && (
                <span style={{ fontSize: 12, fontWeight: 800, minWidth: 38, textAlign: 'right', color: over ? 'var(--over)' : load.total >= 90 ? 'var(--optimal)' : 'var(--n-700)' }}>
                    {Math.round(load.total)}%
                </span>
            )}
        </div>
    );
};

export const LoadLegend: React.FC = () => (
    <div className="legend">
        <span className="legend-item"><span className="legend-dot" style={{ background: LOAD_COLORS.above }} />Above the table</span>
        <span className="legend-item"><span className="legend-dot" style={{ background: LOAD_COLORS.below }} />Below the table</span>
        <span className="legend-item"><span className="legend-dot" style={{ background: LOAD_COLORS.other }} />Undeclared craft</span>
        <span className="legend-item"><span className="legend-dot" style={{ background: LOAD_COLORS.bench, border: '1px solid var(--n-400)' }} />Bench</span>
    </div>
);

export const QuarterHeader: React.FC<{ q: Quarter; align?: 'left' | 'center' }> = ({ q, align = 'center' }) => (
    <div style={{ textAlign: align, lineHeight: 1.2 }}>
        <div style={{ fontWeight: 800, color: 'var(--n-800)', fontSize: 12 }}>{q.label}</div>
        <div style={{ fontSize: 10, color: 'var(--n-500)', fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>{q.name} · {q.range}</div>
    </div>
);

export const GapBadge: React.FC<{ gap: number; unit?: string }> = ({ gap, unit = 'FTE' }) => {
    if (Math.abs(gap) < 0.05) return <span className="badge badge-optimal">✓ Staffed</span>;
    if (gap > 0) return <span className="badge badge-over">▲ {gap.toFixed(1)} {unit} short</span>;
    return <span className="badge badge-under">▼ {Math.abs(gap).toFixed(1)} {unit} spare</span>;
};

export function tribesFromProjects(projects: { clientName?: string }[]): string[] {
    return Array.from(new Set(projects.map(p => (p.clientName || '').trim()).filter(Boolean))).sort();
}

export function initials(name: string) {
    return (name || '??').split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

export const Avatar: React.FC<{ r: Resource; size?: number }> = ({ r, size = 32 }) => {
    const c = craftOf(r.primaryCraft);
    return (
        <div className="avatar" style={{ width: size, height: size, fontSize: size * .34, background: (c?.color || '#64748b') + '22', color: c?.color || '#475569', flexShrink: 0 }}>
            {initials(r.name)}
        </div>
    );
};

export const ALL_CRAFTS = PMO_CRAFTS;
