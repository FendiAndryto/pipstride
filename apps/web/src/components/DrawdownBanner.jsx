import React, { useState } from 'react';
import { ShieldAlert, RefreshCw, Unlock } from 'lucide-react';

export default function DrawdownBanner({
  reason,
  lockoutTime,
  onResetGuard,
  isResetting = false
}) {
  const [showOverrideInput, setShowOverrideInput] = useState(false);
  const [newBaselineEquity, setNewBaselineEquity] = useState('');

  const formattedTime = lockoutTime
    ? new Date(lockoutTime * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : 'Recently';

  const handleConfirmReset = () => {
    const val = newBaselineEquity ? parseFloat(newBaselineEquity) : null;
    onResetGuard(val);
    setShowOverrideInput(false);
    setNewBaselineEquity('');
  };

  return (
    <div className="drawdown-lockout-banner" id="drawdown-lockout-banner">
      <div className="lockout-banner-left">
        <div className="lockout-banner-icon">
          <ShieldAlert size={28} />
        </div>
        <div>
          <div className="lockout-banner-title">
            DAILY DRAWDOWN LIMIT BREACHED — TRADING ENGINE LOCKED OUT
          </div>
          <div className="lockout-banner-details">
            <span>{reason || 'Cumulative daily drawdown exceeded maximum threshold.'}</span>
            <span className="lockout-banner-time">Locked at: {formattedTime} (UTC Day Guard)</span>
          </div>
        </div>
      </div>

      <div className="lockout-banner-actions">
        {!showOverrideInput ? (
          <button
            type="button"
            className="btn-drawdown-override"
            id="btn-drawdown-override"
            onClick={() => setShowOverrideInput(true)}
            disabled={isResetting}
          >
            <Unlock size={15} />
            <span>RESET GUARD & RESUME</span>
          </button>
        ) : (
          <div className="override-input-group">
            <input
              type="number"
              step="100"
              placeholder="New Baseline Equity (Optional)"
              value={newBaselineEquity}
              onChange={(e) => setNewBaselineEquity(e.target.value)}
              className="override-baseline-input"
              id="override-baseline-input"
            />
            <button
              type="button"
              className="btn-drawdown-override-confirm"
              id="btn-drawdown-override-confirm"
              onClick={handleConfirmReset}
              disabled={isResetting}
            >
              {isResetting ? <RefreshCw size={14} className="animate-spin" /> : <Unlock size={14} />}
              <span>CONFIRM OVERRIDE</span>
            </button>
            <button
              type="button"
              className="btn-drawdown-override-cancel"
              onClick={() => setShowOverrideInput(false)}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
