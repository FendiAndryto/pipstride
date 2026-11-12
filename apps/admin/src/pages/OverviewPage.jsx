import React, { useState, useEffect, useCallback } from 'react';
import { MetricsGrid } from '../features/metrics/MetricsGrid';
import { fetchMetrics } from '../features/metrics/api';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { RefreshCw, Users, ShieldAlert, LifeBuoy } from 'lucide-react';

export function OverviewPage({ onNavigate }) {
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className="page-header">
        <div className="page-title-group">
          <h1>Telemetry Overview</h1>
          <div className="page-subtitle">
            Real-time aggregate counters across trading platform and administrative surface
          </div>
        </div>

        <Button
          variant="secondary"
          size="sm"
          icon={RefreshCw}
          loading={loading}
          onClick={loadData}
        >
          Refresh Telemetry
        </Button>
      </div>

      {error ? (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      ) : null}

      <MetricsGrid metrics={metrics} loading={loading} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
        <Card
          title="User Accounts & Entitlements"
          subtitle="Directory and connection limits"
          icon={Users}
          actions={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onNavigate('users')}
            >
              Open Users
            </Button>
          }
        >
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            Search accounts, inspect attached MT5 connections, adjust plan tiers (free/core/plus/pro),
            or toggle active status.
          </p>
        </Card>

        <Card
          title="Security & Audit Trail"
          subtitle="Tamper-evident administrative log"
          icon={ShieldAlert}
          actions={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onNavigate('audit')}
            >
              Inspect Audit Log
            </Button>
          }
        >
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            Filter mutations, authentication events, connection revocations, and privacy elevations
            with operator IP addresses.
          </p>
        </Card>

        <Card
          title="Support Elevation Sessions"
          subtitle="Time-boxed privileged access"
          icon={LifeBuoy}
          actions={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onNavigate('support')}
            >
              Manage Sessions
            </Button>
          }
        >
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            Review active and past elevated sessions granted for user troubleshooting under
            ADR 0008 privacy controls.
          </p>
        </Card>
      </div>
    </div>
  );
}
