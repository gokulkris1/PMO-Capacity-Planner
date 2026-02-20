
import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import { Resource, Allocation } from '../types';

interface Props {
  resources: Resource[];
  allocations: Allocation[];
  scenarioAllocations?: Allocation[] | null;
}

const COLOR_UNDER = '#94a3b8';
const COLOR_OPTIMAL = '#10b981';
const COLOR_HIGH = '#f59e0b';
const COLOR_OVER = '#ef4444';

function barColor(pct: number) {
  if (pct > 100) return COLOR_OVER;
  if (pct >= 80) return COLOR_HIGH;
  if (pct >= 60) return COLOR_OPTIMAL;
  return COLOR_UNDER;
}

interface TooltipPayload {
  payload?: { name: string; current: number; scenario?: number };
}

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 10, padding: '10px 14px', color: '#f1f5f9', fontSize: 12, boxShadow: '0 8px 24px rgba(0,0,0,.25)' }}>
      <div style={{ fontWeight: 700, marginBottom: 4, color: '#e2e8f0' }}>{d.name}</div>
      <div>Utilization: <span style={{ color: barColor(d.current), fontWeight: 700 }}>{d.current}%</span></div>
      {d.scenario !== undefined && d.scenario !== d.current && (
        <div style={{ color: '#818cf8', marginTop: 3 }}>Scenario: <b>{d.scenario}%</b></div>
      )}
    </div>
  );
};

export const CapacityChart: React.FC<Props> = ({ resources, allocations, scenarioAllocations }) => {
  const data = resources.map(r => {
    const current = allocations.filter(a => a.resourceId === r.id).reduce((s, a) => s + a.percentage, 0);
    const scenario = scenarioAllocations
      ? scenarioAllocations.filter(a => a.resourceId === r.id).reduce((s, a) => s + a.percentage, 0)
      : undefined;
    return { name: r.name.split(' ')[0], fullName: r.name, current, scenario };
  });

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} barGap={4} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 600 }} axisLine={false} tickLine={false} />
        <YAxis domain={[0, 130]} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(99,102,241,.06)' }} />
        <ReferenceLine y={100} stroke="#ef4444" strokeDasharray="4 3" strokeWidth={1.5} label={{ value: '100%', fill: '#ef4444', fontSize: 10, position: 'right' }} />
        <ReferenceLine y={80} stroke="#f59e0b" strokeDasharray="4 3" strokeWidth={1} label={{ value: '80%', fill: '#f59e0b', fontSize: 10, position: 'right' }} />
        <ReferenceLine y={60} stroke="#10b981" strokeDasharray="4 3" strokeWidth={1} label={{ value: '60%', fill: '#10b981', fontSize: 10, position: 'right' }} />
        <Bar dataKey="current" radius={[5, 5, 0, 0]} maxBarSize={36}>
          {data.map((entry, i) => (
            <Cell key={i} fill={barColor(entry.current)} />
          ))}
        </Bar>
        {scenarioAllocations && (
          <Bar dataKey="scenario" radius={[5, 5, 0, 0]} maxBarSize={36} fill="#818cf8" opacity={0.55} />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
};
