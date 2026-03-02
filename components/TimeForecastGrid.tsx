import React, { useState } from 'react';
import { Resource, Project, Allocation } from '../types';
import { buildMonthDayForecast, DayForecast } from '../utils/timeGrid';

interface Props {
    resource: Resource;
    projects: Project[];
    allocations: Allocation[];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function getAvailColor(avail: number): string {
    if (avail >= 80) return '#10b981'; // Green (Highly available)
    if (avail > 0) return '#f59e0b';   // Orange (Partially booked)
    return '#ef4444';                  // Red (Fully booked or overbooked)
}

function getAvailText(avail: number): string {
    if (avail >= 80) return '#fff';
    if (avail > 0) return '#fff';
    return '#fff';
}

const CalendarMonth: React.FC<{ year: number; month: number; forecast: DayForecast[] }> = ({ year, month, forecast }) => {
    // 0 = Sun, 1 = Mon ... 6 = Sat
    const firstDay = new Date(year, month, 1).getDay();
    // Adjust to make Monday = 0, Sunday = 6
    const emptyDays = (firstDay + 6) % 7;

    const days = [...Array(emptyDays).fill(null), ...forecast];

    return (
        <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ textAlign: 'center', fontWeight: 800, fontSize: 16, color: '#1e293b', marginBottom: 16 }}>
                {MONTHS[month]} {year}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, marginBottom: 8, textAlign: 'center' }}>
                {DAYS.map((d, i) => (
                    <div key={i} style={{ fontSize: 12, fontWeight: 700, color: '#64748b' }}>{d}</div>
                ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
                {days.map((day, i) => {
                    if (!day) return <div key={i} />;

                    const isWeekend = day.date.getDay() === 0 || day.date.getDay() === 6;
                    const avail = Math.max(0, 100 - day.utilization);

                    return (
                        <div key={i} style={{ position: 'relative', display: 'flex', justifyContent: 'center' }} title={`Available: ${avail}%\nUtilized: ${day.utilization}%\n${day.projects.map(p => `- ${p.name} (${p.pct}%)`).join('\n')}`}>
                            <div style={{
                                width: 34,
                                height: 34,
                                borderRadius: '50%',
                                background: isWeekend ? '#f1f5f9' : getAvailColor(avail),
                                color: isWeekend ? '#94a3b8' : getAvailText(avail),
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 13,
                                fontWeight: 800,
                                cursor: 'default',
                                opacity: isWeekend && day.utilization === 0 ? 0.5 : 1,
                                boxShadow: isWeekend ? 'none' : '0 2px 4px rgba(0,0,0,0.1)'
                            }}>
                                {day.dayOfMonth}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export const TimeForecastGrid: React.FC<Props> = ({ resource, projects, allocations }) => {
    const today = new Date();
    const [currentYear, setCurrentYear] = useState(today.getFullYear());
    const [currentMonth, setCurrentMonth] = useState(today.getMonth());

    const nextMonth = () => {
        if (currentMonth === 11) {
            setCurrentMonth(0);
            setCurrentYear(prev => prev + 1);
        } else {
            setCurrentMonth(prev => prev + 1);
        }
    };

    const prevMonth = () => {
        if (currentMonth === 0) {
            setCurrentMonth(11);
            setCurrentYear(prev => prev - 1);
        } else {
            setCurrentMonth(prev => prev - 1);
        }
    };

    const resetToToday = () => {
        setCurrentYear(today.getFullYear());
        setCurrentMonth(today.getMonth());
    };

    // We'll show 2 months side-by-side
    const nextY = currentMonth === 11 ? currentYear + 1 : currentYear;
    const nextM = currentMonth === 11 ? 0 : currentMonth + 1;

    const forecastMonth1 = buildMonthDayForecast(currentYear, currentMonth, allocations, projects);
    const forecastMonth2 = buildMonthDayForecast(nextY, nextM, allocations, projects);

    return (
        <div style={{ marginTop: 12, padding: 20, background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                        Availability Calendar
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                        Daily individual capacity (Green = Open, Orange = Partial, Red = Booked)
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button
                        onClick={prevMonth}
                        style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '50%', cursor: 'pointer', color: '#64748b' }}
                        title="Previous Month"
                    >
                        &larr;
                    </button>
                    {(currentMonth !== today.getMonth() || currentYear !== today.getFullYear()) && (
                        <button
                            onClick={resetToToday}
                            style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 16, cursor: 'pointer', padding: '4px 12px', fontSize: 11, fontWeight: 700, color: '#64748b' }}
                        >
                            TODAY
                        </button>
                    )}
                    <button
                        onClick={nextMonth}
                        style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '50%', cursor: 'pointer', color: '#64748b' }}
                        title="Next Month"
                    >
                        &rarr;
                    </button>
                </div>
            </div>

            <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap' }}>
                <CalendarMonth year={currentYear} month={currentMonth} forecast={forecastMonth1} />
                <CalendarMonth year={nextY} month={nextM} forecast={forecastMonth2} />
            </div>
        </div>
    );
};
