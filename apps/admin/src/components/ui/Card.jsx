import React from 'react';

export function Card({
  title,
  subtitle,
  icon: Icon,
  badge,
  actions,
  children,
  className = '',
  bodyClassName = '',
}) {
  const hasHeader = title || Icon || badge || actions;

  return (
    <div className={`card ${className}`.trim()}>
      {hasHeader ? (
        <div className="card-header">
          <div className="card-title">
            {Icon ? <Icon size={16} className="text-muted" /> : null}
            <div>
              <span>{title}</span>
              {subtitle ? (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 400 }}>
                  {subtitle}
                </div>
              ) : null}
            </div>
            {badge}
          </div>
          {actions ? <div>{actions}</div> : null}
        </div>
      ) : null}
      <div className={`card-body ${bodyClassName}`.trim()}>{children}</div>
    </div>
  );
}
