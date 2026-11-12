import React, { useState, useEffect } from 'react';
import { ShieldAlert, ShieldX, Clock } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { calculateRemainingSeconds, formatCountdown, isSessionActive } from '../../domain/supportSession';
import { truncateId } from '../../domain/format';

export function SupportBanner({
  session,
  onRevoke,
  onExpire,
}) {
  const [now, setNow] = useState(() => Date.now());
  const [revoking, setRevoking] = useState(false);

  useEffect(() => {
    if (!session || !isSessionActive(session)) return;

    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, [session]);

  const secondsRemaining = session ? calculateRemainingSeconds(session.expires_at, now) : 0;

  useEffect(() => {
    if (session && secondsRemaining <= 0) {
      if (onExpire) onExpire();
    }
  }, [session, secondsRemaining, onExpire]);

  if (!session || !isSessionActive(session) || secondsRemaining <= 0) {
    return null;
  }

  const handleRevoke = async () => {
    setRevoking(true);
    try {
      await onRevoke(session.id);
    } finally {
      setRevoking(false);
    }
  };

  return (
    <div className="support-banner" role="alert" aria-live="polite">
      <div className="support-banner-inner">
        <div className="support-banner-info">
          <div className="support-live-dot" />
          <ShieldAlert size={18} style={{ color: 'var(--accent-amber)' }} />
          <div>
            <strong>Support Elevation Active:</strong>{' '}
            <span style={{ color: 'var(--text-primary)' }}>
              {session.target_username || truncateId(session.target_user_id, 10)}
            </span>
            <span style={{ margin: '0 8px', color: 'var(--text-muted)' }}>|</span>
            <span style={{ color: 'var(--text-secondary)' }}>
              &ldquo;{session.reason}&rdquo;
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Clock size={14} style={{ color: 'var(--accent-amber)' }} />
            <span className="support-countdown">
              {formatCountdown(secondsRemaining)}
            </span>
          </div>

          <Button
            variant="danger"
            size="sm"
            icon={ShieldX}
            loading={revoking}
            onClick={handleRevoke}
          >
            Revoke Elevation
          </Button>
        </div>
      </div>
    </div>
  );
}
