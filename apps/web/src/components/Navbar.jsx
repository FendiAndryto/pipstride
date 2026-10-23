import React from 'react';
import { Bot, LogOut, Clock, AlertOctagon, Lock, Monitor } from 'lucide-react';

export default function Navbar({
  isConnected,
  latency,
  pollInterval,
  onPollIntervalChange,
  username,
  onLogout,
  onTriggerKillSwitch,
  isKillSwitchActive = false,
  isAutoPilotActive = false,
  isDrawdownLocked = false,
  onToggleAutoPilot = () => {},
  onOpenMt5Modal = () => {}
}) {
  return (
    <header className="navbar" id="main-navbar">
      <div className="brand-wrapper">
        <div className="brand-icon-box">
          <Bot size={22} />
        </div>
        <div>
          <h2 className="brand-title">ROBOT TRADING MT5</h2>
          <span className="brand-tag">Bridge & Execution Engine</span>
        </div>
      </div>

      <div className="nav-actions">
        {/* Live Status Badge */}
        <div
          className={`status-badge ${isConnected ? 'connected' : 'disconnected'}`}
          id="connection-status-badge"
          title={isConnected ? 'Bridge EA actively streaming telemetry' : 'Bridge EA is offline atau timed out'}
        >
          <span className={`pulse-dot ${isConnected ? 'online' : 'offline'}`} />
          <span>{isConnected ? 'CONNECTED' : 'DISCONNECTED'}</span>
          {latency !== null && latency !== undefined && (
            <span style={{ opacity: 0.75, fontSize: '0.75rem', marginLeft: '4px' }}>
              ({latency}s)
            </span>
          )}
        </div>

        {/* Quick Open MT5 Web-GUI Button */}
        <button
          type="button"
          onClick={onOpenMt5Modal}
          className="btn-nav-mt5"
          id="navbar-open-mt5-btn"
          title="Buka Layar MT5 & Login Akun Broker"
        >
          <Monitor size={15} />
          <span>{isConnected ? 'Terminal MT5' : 'Hubungkan MT5'}</span>
        </button>

        {/* Polling Interval Selector */}
        <div className="poll-selector" title="Telemetry refresh frequency">
          <Clock size={14} />
          <label htmlFor="poll-interval-select" style={{ display: 'none' }}>Refresh Rate</label>
          <select
            id="poll-interval-select"
            value={pollInterval}
            onChange={(e) => onPollIntervalChange(Number(e.target.value))}
          >
            <option value={1000}>Refresh: 1s</option>
            <option value={2000}>Refresh: 2s</option>
            <option value={5000}>Refresh: 5s</option>
          </select>
        </div>

        {/* Master Auto-Pilot Switch */}
        <div className="autopilot-nav-wrapper">
          <button
            type="button"
            className={`btn-autopilot-toggle ${
              isDrawdownLocked
                ? 'locked'
                : isKillSwitchActive
                ? 'disabled'
                : isAutoPilotActive
                ? 'active'
                : 'manual'
            }`}
            id="navbar-autopilot-toggle-btn"
            onClick={() => {
              if (!isDrawdownLocked && !isKillSwitchActive) {
                onToggleAutoPilot(!isAutoPilotActive);
              }
            }}
            disabled={isDrawdownLocked || isKillSwitchActive}
            title={
              isDrawdownLocked
                ? 'Auto-Pilot locked out: Daily Drawdown limit exceeded'
                : isKillSwitchActive
                ? 'Auto-Pilot disabled: Kill switch active'
                : isAutoPilotActive
                ? 'Auto-Pilot is ACTIVE: Signals execute automatically without manual confirmation'
                : 'Manual Mode: Signals require manual trader approval before execution'
            }
          >
            {isDrawdownLocked ? (
              <>
                <Lock size={14} className="text-rose" />
                <span>DD LOCKED</span>
              </>
            ) : isAutoPilotActive ? (
              <>
                <span className="autopilot-pulse-indicator" />
                <Bot size={15} />
                <span>AUTOPILOT ON</span>
              </>
            ) : (
              <>
                <Bot size={15} style={{ opacity: 0.6 }} />
                <span>MANUAL CONFIRM</span>
              </>
            )}
          </button>
        </div>

        {/* Emergency Kill Switch Button */}
        <button
          type="button"
          className={`btn-kill-switch ${isKillSwitchActive ? 'active' : ''}`}
          id="navbar-kill-switch-btn"
          onClick={onTriggerKillSwitch}
          title={isKillSwitchActive ? 'Trading locked by Kill Switch' : 'Trigger Emergency Blanket Shutdown'}
        >
          {isKillSwitchActive ? (
            <>
              <Lock size={15} />
              <span>ENGINE LOCKED</span>
            </>
          ) : (
            <>
              <AlertOctagon size={15} />
              <span>KILL SWITCH</span>
            </>
          )}
        </button>

        {/* User Info & Logout */}
        <div className="user-badge" id="current-user-badge">
          <span>{username || 'Admin'}</span>
        </div>

        <button
          onClick={onLogout}
          className="btn-logout"
          id="logout-btn"
          title="Sign out of dashboard"
        >
          <LogOut size={16} />
          <span>Logout</span>
        </button>
      </div>
    </header>
  );
}
