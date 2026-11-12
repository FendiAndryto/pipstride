import React, { useState, useEffect, useCallback } from 'react';
import { MetricsGrid } from '../features/metrics/MetricsGrid';
import { fetchMetrics } from '../features/metrics/api';
import { Button } from '../components/ui/Button';
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
    </div>
  );
}
