import React from 'react';
import { Resource, Allocation, AllocationStatus } from '../types';
import { buildTimeForecast, forecastColor } from '../utils/timeGrid';

interface Props {
    resource: Resource;
    allocations: Allocation[]; // These should be ONLY the allocations for this specific resource
    monthsCount?: number;
}

export const TimeForecastGrid: React.FC<Props> = ({ resource, allocations, monthsCount = 6 }) => {
    // Generate the next N months of utilization for this resource
    const forecast = buildTimeForecast(allocations, monthsCount);

    return (
        <div style={{ marginTop: 12, padding: 12, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
                Availability Forecast
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
