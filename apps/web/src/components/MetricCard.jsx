import React from 'react';

export default function MetricCard({
  id,
  label,
  value,
  subtext,
  icon: Icon,
  variant = 'default',
  progressPercent = null,
  progressColor = 'var(--accent-emerald)'
}) {
  return (
    <div className={`metric-card glass-panel ${variant}`} id={id}>
      <div className="metric-card-header">
        <span className="metric-label">{label}</span>
        {Icon && (
          <div className="metric-icon-box">
            <Icon size={18} />
          </div>
        )}
      </div>

      <div className="metric-value font-mono">
        {value}
      </div>

      {subtext && (
        <div className="metric-subtext">
          {subtext}
        </div>
      )}

      {progressPercent !== null && (
        <div className="progress-bar-bg" title={`Margin Level: ${progressPercent}%`}>
          <div
            className="progress-bar-fill"
            style={{
              width: `${Math.min(100, Math.max(0, progressPercent))}%`,
              backgroundColor: progressColor
            }}
          />
        </div>
      )}
    </div>
  );
}
