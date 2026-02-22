import React from 'react';

export type TimeGranularity = 'Month' | 'Sprint' | 'Quarter' | 'Half-Year' | 'Year';

interface TimeSelectorProps {
    value: TimeGranularity;
    onChange: (val: TimeGranularity) => void;
}

export const TimeSelector: React.FC<TimeSelectorProps> = ({ value, onChange }) => {
    const options: TimeGranularity[] = ['Sprint', 'Month', 'Quarter', 'Half-Year', 'Year'];

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{ fontSize: '13px', color: 'var(--text-muted)' }}>View By:</label>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value as TimeGranularity)}
                style={{
                    background: 'var(--bg-panel)',
                    color: 'var(--text-main)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    padding: '4px 8px',
                    fontSize: '13px',
                    outline: 'none',
                    cursor: 'pointer'
                }}
            >
                {options.map(o => (
                    <option key={o} value={o}>{o}</option>
                ))}
            </select>
        </div>
    );
};
