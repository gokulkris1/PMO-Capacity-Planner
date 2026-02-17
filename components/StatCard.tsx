
import React from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: string;
  trendColor?: string;
}

export const StatCard: React.FC<StatCardProps> = ({ label, value, icon, trend, trendColor }) => {
  return (
    <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-2">
        <span className="text-slate-500 text-sm font-medium">{label}</span>
        <div className="text-blue-600 bg-blue-50 p-2 rounded-lg">
          {icon}
        </div>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-slate-900">{value}</span>
        {trend && (
          <span className={`text-xs font-semibold ${trendColor || 'text-green-600'}`}>
            {trend}
          </span>
        )}
      </div>
    </div>
  );
};
