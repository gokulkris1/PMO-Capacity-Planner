
import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import { Resource, Allocation } from '../types';

interface CapacityChartProps {
  resources: Resource[];
  allocations: Allocation[];
}

export const CapacityChart: React.FC<CapacityChartProps> = ({ resources, allocations }) => {
  const data = resources.map(res => {
    const totalAllocated = allocations
      .filter(a => a.resourceId === res.id)
      .reduce((sum, a) => sum + a.percentage, 0);
    
    return {
      name: res.name,
      allocated: totalAllocated,
      remaining: Math.max(0, 100 - totalAllocated),
      isOver: totalAllocated > 100
    };
  });

  const getBarColor = (val: number) => {
    if (val > 100) return '#ef4444'; // Overloaded (Red)
    if (val > 80) return '#f59e0b';  // High Load (Amber)
    if (val > 60) return '#3b82f6';  // Optimal (Blue)
    return '#94a3b8';                // Under-utilized (Slate)
  };

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 20, right: 30, top: 10, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#e2e8f0" />
          <XAxis type="number" domain={[0, 120]} hide />
          <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 11, fill: '#64748b' }} />
          <Tooltip 
            cursor={{ fill: '#f1f5f9' }}
            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
          />
          <Bar dataKey="allocated" radius={[0, 4, 4, 0]} barSize={20}>
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={getBarColor(entry.allocated)} />
            ))}
          </Bar>
          <ReferenceLine x={60} stroke="#94a3b8" strokeDasharray="3 3" label={{ position: 'top', value: '60%', fill: '#94a3b8', fontSize: 10 }} />
          <ReferenceLine x={80} stroke="#f59e0b" strokeDasharray="3 3" label={{ position: 'top', value: '80%', fill: '#f59e0b', fontSize: 10 }} />
          <ReferenceLine x={100} stroke="#ef4444" strokeDasharray="3 3" label={{ position: 'top', value: '100%', fill: '#ef4444', fontSize: 10 }} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
