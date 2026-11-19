import React, { useState, useLayoutEffect, useCallback, useRef } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { SupportSessionsTable } from '../features/support/SupportSessionsTable';
import { fetchSupportSessions } from '../features/support/api';
import { isSessionActive } from '../lib/supportSession';
import { RefreshCw, LifeBuoy } from 'lucide-react';

export function SupportSessionsPage({
  canViewAll,
  initialActiveOnly,
  revokeSession,
  revokedById,
  revokingIds,
}) {
  const [sessions, setSessions] = useState([]);
  const [mineOnly, setMineOnly] = useState(!canViewAll || !initialActiveOnly);
  const [activeOnly, setActiveOnly] = useState(initialActiveOnly);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const pendingRead = useRef(null);
  const messageTimer = useRef(null);
  const mounted = useRef(false);

  const cancelRead = useCallback(() => {
    pendingRead.current?.abort();
    pendingRead.current = null;
  }, []);

  const loadSessions = useCallback(async () => {
    cancelRead();
    const request = new AbortController();
    pendingRead.current = request;
    setLoading(true);
    setError('');
    try {
      const data = await fetchSupportSessions({
        mine: mineOnly,
        active_only: activeOnly,
        signal: request.signal,
      });
      if (!request.signal.aborted) setSessions(data.items || []);
    } catch (err) {
      if (!request.signal.aborted) {
        setSessions([]);
        setError(err.message || 'Failed to load support sessions.');
      }
    } finally {
      if (pendingRead.current === request) {
        pendingRead.current = null;
        setLoading(false);
      }
    }
  }, [mineOnly, activeOnly, cancelRead]);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(messageTimer.current);
    };
  }, []);

  useLayoutEffect(() => {
    const timer = setTimeout(() => {
      void loadSessions();
    }, 0);
    return () => {
      clearTimeout(timer);
      cancelRead();
    };
  }, [loadSessions, cancelRead, revokedById]);

  const changeFilter = (update) => {
    cancelRead();
    setLoading(true);
    update();
  };

  const handleRevoke = async (sessionId) => {
    setError('');
    try {
      const revoked = await revokeSession(sessionId);
      if (!revoked || !mounted.current) return;
      setMessage('Support session revoked successfully.');
      clearTimeout(messageTimer.current);
      messageTimer.current = setTimeout(() => setMessage(''), 4000);
    } catch (err) {
      if (mounted.current) setError(err.message || 'Failed to revoke support session.');
    }
  };

  const currentSessions = sessions.flatMap((session) => {
    const revoked = revokedById.get(session.id);
    if (activeOnly) return !revoked && isSessionActive(session) ? [session] : [];
    return [revoked || session];
  });

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
            {canViewAll ? (
              <>
                <Button
                  variant={mineOnly ? 'primary' : 'secondary'}
                  size="sm"
                  aria-pressed={mineOnly}
                  onClick={() => { if (!mineOnly) changeFilter(() => setMineOnly(true)); }}
                >
                  My Sessions
                </Button>
                <Button
                  variant={!mineOnly ? 'primary' : 'secondary'}
                  size="sm"
                  aria-pressed={!mineOnly}
                  onClick={() => { if (mineOnly) changeFilter(() => setMineOnly(false)); }}
                >
                  All Staff Sessions
                </Button>
              </>
            ) : null}
            <Button
              variant={activeOnly ? 'primary' : 'secondary'}
              size="sm"
              aria-pressed={activeOnly}
              onClick={() => changeFilter(() => setActiveOnly((prev) => !prev))}
            >
              {activeOnly ? 'Active Only' : 'All States'}
            </Button>
          </div>
        }
      >
        <SupportSessionsTable
          sessions={currentSessions}
          onRevokeSession={handleRevoke}
          revokingIds={revokingIds}
          loading={loading}
        />
      </Card>
    </div>
  );
}
