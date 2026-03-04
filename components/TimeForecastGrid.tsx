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
    if (avail >= 80) return '#E3FCEF'; // Soft green bg (highly available)
    if (avail > 0) return '#FFF0B3';   // Soft amber bg (partially booked)
    return '#FFEBE6';                  // Soft red bg (fully booked)
}
function getAvailBorder(avail: number): string {
    if (avail >= 80) return '#00875A';
    if (avail > 0) return '#FF8B00';
    return '#DE350B';
}

function getAvailText(avail: number): string {
    if (avail >= 80) return '#006644';
    if (avail > 0) return '#974F0C';
    return '#BF2600';
}

const CalendarMonth: React.FC<{ year: number; month: number; forecast: DayForecast[] }> = ({ year, month, forecast }) => {
    // 0 = Sun, 1 = Mon ... 6 = Sat
    const firstDay = new Date(year, month, 1).getDay();
    // Adjust to make Monday = 0, Sunday = 6
    const emptyDays = (firstDay + 6) % 7;

    const days = [...Array(emptyDays).fill(null), ...forecast];

    return (
        <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 14, color: 'var(--n-800)', marginBottom: 16 }}>
                {MONTHS[month]} {year}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 8, textAlign: 'center' }}>
                {DAYS.map((d, i) => (
                    <div key={i} style={{ fontSize: 11, fontWeight: 600, color: 'var(--n-600)', padding: '4px 0' }}>{d}</div>
                ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
                {days.map((day, i) => {
                    if (!day) return <div key={i} />;

                    const isWeekend = day.date.getDay() === 0 || day.date.getDay() === 6;
                    const avail = Math.max(0, 100 - day.utilization);

                    return (
                        <div key={i} style={{ position: 'relative', display: 'flex', justifyContent: 'center' }} title={`Available: ${avail}%\nUtilized: ${day.utilization}%\n${day.projects.map(p => `- ${p.name} (${p.pct}%)`).join('\n')}`}>
                            <div style={{
                                width: 32,
                                height: 32,
                                borderRadius: 6,
                                background: isWeekend ? 'var(--n-100)' : getAvailColor(avail),
                                border: isWeekend ? '1px solid var(--n-300)' : `1px solid ${getAvailBorder(avail)}40`,
                                color: isWeekend ? 'var(--n-500)' : getAvailText(avail),
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: 'default',
                                opacity: isWeekend && day.utilization === 0 ? 0.5 : 1,
                                boxShadow: 'none',
                                transition: 'background 0.15s',
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
        <div style={{ marginTop: 12, padding: 20, background: '#fff', borderRadius: 8, border: '1px solid var(--n-400)', boxShadow: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--n-700)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                        Availability Calendar
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--n-600)', marginTop: 2 }}>
                        Daily individual capacity (Green = Open, Orange = Partial, Red = Booked)
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button
                        onClick={prevMonth}
                        style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', border: '1px solid var(--n-400)', borderRadius: 4, cursor: 'pointer', color: 'var(--n-600)', fontSize: 14 }}
                        title="Previous Month"
                    >
                        &larr;
                    </button>
                    {(currentMonth !== today.getMonth() || currentYear !== today.getFullYear()) && (
                        <button
                            onClick={resetToToday}
                            style={{ background: 'var(--brand-50)', border: '1px solid var(--brand-200)', borderRadius: 4, cursor: 'pointer', padding: '4px 10px', fontSize: 11, fontWeight: 600, color: 'var(--brand-500)' }}
                        >
                            TODAY
                        </button>
                    )}
                    <button
                        onClick={nextMonth}
                        style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', border: '1px solid var(--n-400)', borderRadius: 4, cursor: 'pointer', color: 'var(--n-600)', fontSize: 14 }}
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
