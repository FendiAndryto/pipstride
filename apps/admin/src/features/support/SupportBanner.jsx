import React, { useState, useEffect } from 'react';
import { ShieldAlert, ShieldX, Clock } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { calculateRemainingSeconds, formatCountdown } from '../../domain/supportSession';
import { truncateId } from '../../domain/format';

function SupportBannerGrant({ session, revoking, onRevoke }) {
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState('');
  const remaining = calculateRemainingSeconds(session.expires_at, now);
  const target = session.target_username || truncateId(session.target_user_id, 10);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const handleRevoke = async () => {
    setError('');
    try {
      await onRevoke(session.id);
    } catch (err) {
      setError(err.detail || err.message || 'Failed to revoke support elevation.');
    }
  };

  return (
    <div>
      <div className="support-banner-inner">
        <div className="support-banner-info">
          <ShieldAlert size={18} style={{ color: 'var(--accent-amber)', flexShrink: 0 }} />
          <div style={{ overflowWrap: 'anywhere' }}>
            <strong>{target}</strong>{' '}
            <span style={{ color: 'var(--text-secondary)' }}>&ldquo;{session.reason}&rdquo;</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Clock size={14} style={{ color: 'var(--accent-amber)' }} />
            <span className="support-countdown">{formatCountdown(remaining)}</span>
          </div>

          <Button
            variant="danger"
            size="sm"
            icon={ShieldX}
            loading={revoking}
            onClick={handleRevoke}
            aria-label={revoking ? `Revoking elevation for ${target}` : `Revoke elevation for ${target}`}
          >
            {revoking ? 'Revoking…' : 'Revoke Elevation'}
          </Button>
        </div>
      </div>
      {error ? <div className="alert alert-danger" role="alert">{error}</div> : null}
    </div>
  );
}

export function SupportBanner({ sessions, verificationError, revokingIds, onRevoke }) {
  const hasSessions = sessions.length > 0;

  if (!hasSessions && !verificationError) return null;

  return (
    <aside className="support-banner" aria-label="Support elevation">
      <div className="support-banner-inner">
        {hasSessions ? (
          <strong role="status">
            {sessions.length} {verificationError ? 'last verified' : 'active'} support {sessions.length === 1 ? 'elevation' : 'elevations'}
          </strong>
        ) : null}
        {verificationError ? (
          <div role="alert">Unable to verify support elevations. {verificationError}</div>
        ) : null}
      </div>
      <div style={{ maxHeight: 'min(30vh, 240px)', overflowY: 'auto' }}>
        {sessions.map((session) => (
          <SupportBannerGrant
            key={session.id}
            session={session}
            revoking={revokingIds.has(session.id)}
            onRevoke={onRevoke}
          />
        ))}
      </div>
    </aside>
  );
}
