import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { SupportSessionsTable } from '../features/support/SupportSessionsTable';
import { fetchSupportSessions, revokeSupportSession } from '../features/support/api';
import { RefreshCw, LifeBuoy } from 'lucide-react';

export function SupportSessionsPage({
  onSessionRevoked,
}) {
  const [sessions, setSessions] = useState([]);
  const [mineOnly, setMineOnly] = useState(true);
  const [activeOnly, setActiveOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchSupportSessions({
        mine: mineOnly,
        active_only: activeOnly,
      });
      setSessions(data.items || []);
    } catch (err) {
      setError(err.message || 'Failed to load support sessions.');
    } finally {
      setLoading(false);
    }
  }, [mineOnly, activeOnly]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadSessions();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadSessions]);

  const handleRevoke = async (sessionId) => {
    setLoading(true);
    try {
      await revokeSupportSession(sessionId);
      setMessage('Support session revoked successfully.');
      setTimeout(() => setMessage(''), 4000);
      if (onSessionRevoked) {
        onSessionRevoked(sessionId);
      }
      await loadSessions();
    } catch (err) {
      setError(err.message || 'Failed to revoke support session.');
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="page-header">
        <div className="page-title-group">
          <h1>Support Elevation Sessions</h1>
          <div className="page-subtitle">
            Time-boxed 30-minute privacy elevation sessions under ADR 0008 controls
          </div>
        </div>

        <Button
          variant="secondary"
          size="sm"
          icon={RefreshCw}
          loading={loading}
          onClick={loadSessions}
          className="btn-refresh"
          aria-label="Refresh sessions"
        >
          <span className="btn-label">Refresh</span>
        </Button>
      </div>

      {message ? (
        <div className="alert alert-info" role="status">
          {message}
        </div>
      ) : null}

      {error ? (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      ) : null}

      <Card
        title="Session Ledger"
        icon={LifeBuoy}
        actions={
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button
              variant={mineOnly ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setMineOnly(true)}
            >
              My Sessions
            </Button>
            <Button
              variant={!mineOnly ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setMineOnly(false)}
            >
              All Staff Sessions
            </Button>
            <Button
              variant={activeOnly ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setActiveOnly((prev) => !prev)}
            >
              {activeOnly ? 'Active Only' : 'All States'}
            </Button>
          </div>
        }
      >
        <SupportSessionsTable
          sessions={sessions}
          onRevokeSession={handleRevoke}
          loading={loading}
        />
      </Card>
    </div>
  );
}
