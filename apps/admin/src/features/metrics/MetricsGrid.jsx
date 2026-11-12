import React from 'react';
import { Users, Link2, TrendingUp, ShieldAlert, LifeBuoy } from 'lucide-react';
import { formatNumber } from '../../domain/format';

export function MetricsGrid({ metrics, loading = false }) {
  if (loading) {
    return (
      <div className="metric-grid">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="metric-card" style={{ opacity: 0.5 }}>
            <div className="metric-header">
              <span className="metric-label">Loading...</span>
            </div>
            <div className="metric-value">—</div>
          </div>
        ))}
      </div>
    );
  }

  const users = metrics?.users || {};
  const conns = metrics?.connections || {};
  const trades = metrics?.trades || {};
  const audit = metrics?.audit_logs || {};
  const support = metrics?.support_sessions || {};

  return (
    <div className="metric-grid">
      <div className="metric-card">
        <div className="metric-header">
          <span className="metric-label">Registered Users</span>
          <Users size={18} className="metric-icon" />
        </div>
        <div className="metric-value">{formatNumber(users.total)}</div>
        <div className="metric-footer">
          <span>Active: <strong style={{ color: 'var(--accent-emerald)' }}>{formatNumber(users.active)}</strong></span>
          <span>•</span>
          <span>Staff: {formatNumber((users.admins || 0) + (users.support || 0))}</span>
        </div>
      </div>

      <div className="metric-card">
        <div className="metric-header">
          <span className="metric-label">MT5 Connections</span>
          <Link2 size={18} className="metric-icon" />
        </div>
        <div className="metric-value">{formatNumber(conns.total)}</div>
        <div className="metric-footer">
          <span>Active: <strong style={{ color: 'var(--accent-emerald)' }}>{formatNumber(conns.active)}</strong></span>
          <span>•</span>
          <span>Revoked: {formatNumber(conns.revoked)}</span>
        </div>
      </div>

      <div className="metric-card">
        <div className="metric-header">
          <span className="metric-label">Trades Recorded</span>
          <TrendingUp size={18} className="metric-icon" />
        </div>
        <div className="metric-value">{formatNumber(trades.total)}</div>
        <div className="metric-footer">
          <span>Last 24h: <strong style={{ color: 'var(--accent-blue)' }}>+{formatNumber(trades.last_24h)}</strong></span>
        </div>
      </div>

      <div className="metric-card">
        <div className="metric-header">
          <span className="metric-label">Audit Events</span>
          <ShieldAlert size={18} className="metric-icon" />
        </div>
        <div className="metric-value">{formatNumber(audit.total)}</div>
        <div className="metric-footer">
          <span>Last 24h: <strong style={{ color: 'var(--accent-amber)' }}>{formatNumber(audit.last_24h)}</strong></span>
        </div>
      </div>

      <div className="metric-card">
        <div className="metric-header">
          <span className="metric-label">Active Support Sessions</span>
          <LifeBuoy size={18} className="metric-icon" />
        </div>
        <div className="metric-value" style={{ color: support.active > 0 ? 'var(--accent-amber)' : 'inherit' }}>
          {formatNumber(support.active)}
        </div>
        <div className="metric-footer">
          <span>{support.active > 0 ? 'Privacy elevation active' : 'Default metadata privacy'}</span>
        </div>
      </div>
    </div>
  );
}
