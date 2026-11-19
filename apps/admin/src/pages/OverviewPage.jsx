import React, { useState, useEffect, useCallback } from 'react';
import { MetricsGrid } from '../features/metrics/MetricsGrid';
import { fetchMetrics } from '../features/metrics/api';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { formatDateTime, formatNumber } from '../lib/format';
import { RefreshCw } from 'lucide-react';

export function OverviewPage() {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchMetrics();
      setMetrics(data);
    } catch (err) {
      setError(err.message || 'Failed to load telemetry overview metrics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadData();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadData]);

  const shortcuts = [
    { href: '#users/expiring', label: 'Users expiring in the next 7 days', count: metrics?.users?.expiring_soon },
    { href: '#users/pending_connection', label: 'Pending MT5 connections', count: metrics?.connections?.pending },
    { href: '#support/active', label: 'Active support grants (platform-wide)', count: metrics?.support_sessions?.active },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className="page-header">
        <div className="page-title-group">
          <h1>Telemetry Overview</h1>
          <div className="page-subtitle">
            {metrics?.as_of ? `Last updated ${formatDateTime(metrics.as_of)}` : 'Account and platform snapshot'}
          </div>
        </div>

        <Button
          variant="secondary"
          size="sm"
          icon={RefreshCw}
          loading={loading}
          onClick={loadData}
          className="btn-refresh"
          aria-label="Refresh telemetry"
        >
          <span className="btn-label">Refresh</span>
        </Button>
      </div>

      {error ? (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      ) : null}

      {metrics || loading ? <MetricsGrid metrics={metrics} loading={!metrics} /> : null}

      <Card title="Needs attention">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: '8px' }}>
          {shortcuts.map(({ href, label, count }) => (
            <a className="btn btn-secondary" href={href} key={href} style={{ justifyContent: 'space-between', whiteSpace: 'normal', textAlign: 'left' }}>
              <span>{label}</span>
              <strong className="font-mono">{count === undefined ? '—' : formatNumber(count)}</strong>
            </a>
          ))}
        </div>
      </Card>
    </div>
  );
}
