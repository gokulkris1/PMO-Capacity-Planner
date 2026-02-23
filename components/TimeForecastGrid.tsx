import React from 'react';
import { Resource, Allocation, AllocationStatus } from '../types';
import { buildTimeForecast, forecastColor } from '../utils/timeGrid';

interface Props {
    resource: Resource;
    allocations: Allocation[]; // These should be ONLY the allocations for this specific resource
    monthsCount?: number;
}

export const TimeForecastGrid: React.FC<Props> = ({ resource, allocations, monthsCount = 6 }) => {
    const [monthOffset, setMonthOffset] = React.useState(0);

    // Generate the next N months of utilization for this resource
    const forecast = buildTimeForecast(allocations, monthsCount, monthOffset);

    return (
        <div style={{ marginTop: 12, padding: 12, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                    Availability Forecast
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                    <button
                        onClick={() => setMonthOffset(prev => prev - monthsCount)}
                        style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 4, cursor: 'pointer', padding: '2px 8px', fontSize: 12, color: '#64748b' }}
                        title="Previous Term"
                    >
                        &larr;
                    </button>
                    {monthOffset !== 0 && (
                        <button
                            onClick={() => setMonthOffset(0)}
                            style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 4, cursor: 'pointer', padding: '2px 8px', fontSize: 11, fontWeight: 600, color: '#64748b' }}
                            title="Reset to Present"
                        >
                            TODAY
                        </button>
                    )}
                    <button
                        onClick={() => setMonthOffset(prev => prev + monthsCount)}
                        style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 4, cursor: 'pointer', padding: '2px 8px', fontSize: 12, color: '#64748b' }}
                        title="Next Term"
                    >
                        &rarr;
                    </button>
                </div>
            </div>

            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
                {forecast.map((fc, i) => {
                    const isAvailable = fc.percentage < 100 && fc.status !== AllocationStatus.OVER && fc.status !== AllocationStatus.HIGH;

                    return (
                        <div key={i} style={{
                            flex: '1 1 0',
                            minWidth: 50,
                            padding: '6px 4px',
                            background: '#fff',
                            borderRadius: 6,
                            border: `1px solid ${forecastColor(fc.status)}`,
                            textAlign: 'center',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 4
                        }}>
                            <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600 }}>{fc.label}</div>
                            <div style={{
                                fontSize: 13,
                                fontWeight: 800,
                                color: forecastColor(fc.status)
                            }}>
                                {fc.percentage}%
                            </div>
                            <div style={{
                                fontSize: 9,
                                fontWeight: 700,
                                color: isAvailable ? '#10b981' : '#94a3b8',
                                opacity: isAvailable ? 1 : 0.6
                            }}>
                                {isAvailable ? 'AVAILABLE' : 'BOOKED'}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
