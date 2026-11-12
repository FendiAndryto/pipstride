import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { AuditTable } from '../features/audit/AuditTable';
import { fetchAuditLogs } from '../features/audit/api';
import { RefreshCw, Filter, X } from 'lucide-react';

export function AuditPage() {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [limit] = useState(100);
  const [offset, setOffset] = useState(0);

  // Filters
  const [actionFilter, setActionFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [targetFilter, setTargetFilter] = useState('');

  // Applied filters
  const [applied, setApplied] = useState({
    action: '',
    user_id: '',
    target_user_id: '',
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchAuditLogs({
        action: applied.action,
        user_id: applied.user_id,
        target_user_id: applied.target_user_id,
        limit,
        offset,
      });
      setLogs(data.items || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err.message || 'Failed to load audit logs.');
    } finally {
      setLoading(false);
    }
  }, [applied, limit, offset]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadLogs();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadLogs]);

  const handleApplyFilters = (e) => {
    e.preventDefault();
    setOffset(0);
    setApplied({
      action: actionFilter.trim(),
      user_id: userFilter.trim(),
      target_user_id: targetFilter.trim(),
    });
  };

  const handleClearFilters = () => {
    setActionFilter('');
    setUserFilter('');
    setTargetFilter('');
    setOffset(0);
    setApplied({
      action: '',
      user_id: '',
      target_user_id: '',
    });
  };

  const hasFilters = Boolean(applied.action || applied.user_id || applied.target_user_id);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="page-header">
        <div className="page-title-group">
          <h1>Security Audit Trail</h1>
          <div className="page-subtitle">
            Tamper-evident record of administrative mutations, auth events, and privacy elevations
          </div>
        </div>

        <Button
          variant="secondary"
          size="sm"
          icon={RefreshCw}
          loading={loading}
          onClick={loadLogs}
        >
          Refresh Logs
        </Button>
      </div>

      <Card>
        <form
          onSubmit={handleApplyFilters}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '12px',
            marginBottom: '16px',
            alignItems: 'flex-end',
          }}
        >
          <Input
            label="Filter Action"
            placeholder="e.g. revoke, entitlement, deactivate..."
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
          />

          <Input
            label="Actor User ID"
            placeholder="UUID of acting admin"
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            mono
          />

          <Input
            label="Target User ID"
            placeholder="UUID of affected user"
            value={targetFilter}
            onChange={(e) => setTargetFilter(e.target.value)}
            mono
          />

          <div style={{ display: 'flex', gap: '8px' }}>
            <Button type="submit" variant="primary" icon={Filter}>
              Apply Filters
            </Button>
            {hasFilters ? (
              <Button
                type="button"
                variant="ghost"
                icon={X}
                onClick={handleClearFilters}
              >
                Clear
              </Button>
            ) : null}
          </div>
        </form>

        {error ? (
          <div className="alert alert-danger" role="alert" style={{ marginBottom: '16px' }}>
            {error}
          </div>
        ) : null}

        <AuditTable
          logs={logs}
          total={total}
          limit={limit}
          offset={offset}
          onOffsetChange={setOffset}
          loading={loading}
        />
      </Card>
    </div>
  );
}
