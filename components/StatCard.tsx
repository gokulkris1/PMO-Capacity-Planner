
import React from 'react';

interface Props {
  label: string;
  value: string | number;
  icon: string; // emoji
  iconBg?: string;
  iconColor?: string;
  trend?: string;
  trendType?: 'up' | 'down' | 'warn' | 'neu';
  glowColor?: string;
}

export const StatCard: React.FC<Props> = ({ label, value, icon, iconBg = '#eef2ff', trend, trendType = 'neu', glowColor }) => {
  const trendClass = trendType === 'up' ? 'trend-up' : trendType === 'down' ? 'trend-down' : trendType === 'warn' ? 'trend-warn' : 'trend-neu';
  const trendArrow = trendType === 'up' ? '↑' : trendType === 'down' ? '↓' : '';

  return (
    <div className="stat-card">
      {glowColor && (
        <div className="stat-card-glow" style={{ background: glowColor }} />
      )}
      <div className="stat-card-icon" style={{ background: iconBg }}>
        <span style={{ fontSize: 20 }}>{icon}</span>
      </div>
      <div className="stat-card-value">{value}</div>
      <div className="stat-card-label">{label}</div>
      {trend && (
        <div className={`stat-card-trend ${trendClass}`}>
          {trendArrow && <span>{trendArrow}</span>}
          <span>{trend}</span>
        </div>
      )}
    </div>
  );
};
