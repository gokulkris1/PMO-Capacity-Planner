import React from 'react';

interface SliderProps {
    min: number;
    max: number;
    value: number;
    onChange: (val: number) => void;
    orientation?: 'horizontal' | 'vertical';
    step?: number;
    color?: string;
    label?: string;
}

export const Slider: React.FC<SliderProps> = ({
    min, max, value, onChange, orientation = 'horizontal', step = 1, color = 'var(--primary-light)', label
}) => {
    const isVert = orientation === 'vertical';

    return (
        <div style={{
            display: 'flex',
            flexDirection: isVert ? 'column' : 'row',
            alignItems: 'center',
            gap: '8px'
        }}>
            {label && <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{label}</span>}
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                style={{
                    appearance: 'none',
                    width: isVert ? '8px' : '100%',
                    height: isVert ? '100px' : '6px',
                    background: 'var(--bg-card)',
                    borderRadius: '4px',
                    outline: 'none',
                    writingMode: isVert ? 'bt-lr' : 'horizontal-tb',
                    WebkitAppearance: isVert ? 'slider-vertical' : 'none',
                    cursor: 'pointer',
                    accentColor: color
                }}
            />
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)', minWidth: '3ch', textAlign: 'right' }}>
                {value}
            </span>
        </div>
    );
};
