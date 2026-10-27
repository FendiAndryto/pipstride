import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Monitor, User, Wallet, LogOut } from 'lucide-react';
import { NAV_TABS } from '../constants/nav';

function connectionLabel(connection) {
  if (!connection) return 'Belum ada akun';
  const account = connection.account_number ? `#${connection.account_number}` : 'belum terhubung';
  return `${connection.label} · ${account}`;
}

export default function PipstrideHeader({
  activeTab,
  onSelectTab,
  isConnected,
  latency,
  connections = [],
  activeConnectionId,
  onSelectConnection,
  onOpenMt5Modal,
  user,
  onLogout
}) {
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target)) {
        setIsProfileMenuOpen(false);
      }
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setIsProfileMenuOpen(false);
      }
    }
    if (isProfileMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isProfileMenuOpen]);

  const activeConn = connections.find((c) => c.id === activeConnectionId) || connections[0];
  return (
    <header className="tradegear-header" id="pipstride-header">
      {/* Brand & Logo */}
      <div
        className="brand-group"
        onClick={() => onSelectTab('home')}
        title="Pipstride — Home"
      >
        <div className="brand-logo-box">
          <img
            src="/favicon.svg"
            alt="Pipstride Logo"
            className="brand-logo-img"
          />
        </div>
        <div className="brand-text">
          Pipstride
          <small>JOURNAL • TELEMETRY • ANALYTICS</small>
        </div>
      </div>

      {/* Desktop Navigation Links */}
      <nav className="nav-desktop" aria-label="Main Navigation">
        {NAV_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              className={`nav-desktop-tab ${isActive ? 'active' : ''}`}
              onClick={() => onSelectTab(tab.id)}
              id={`nav-tab-${tab.id}`}
            >
              <Icon size={14} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Header Right Actions */}
      <div className="header-right">
        {/* Account switcher: one token-bound connection per MT5 account */}
        {connections.length > 0 && (
          <div className="connection-switcher" title="Pilih akun MT5">
            <Wallet size={14} />
            {connections.length === 1 ? (
              <span className="connection-switcher-static">
                {connectionLabel(connections[0])}
              </span>
            ) : (
              <>
                <select
                  id="header-connection-switcher"
                  value={activeConnectionId || ''}
                  onChange={(e) => onSelectConnection(e.target.value)}
                  aria-label="Pilih akun MT5"
                >
                  {connections.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connectionLabel(connection)}
                    </option>
                  ))}
                </select>
                <ChevronDown size={13} className="connection-switcher-caret" />
              </>
            )}
          </div>
        )}

        {/* Live MT5 Terminal Web-GUI Button */}
        {onOpenMt5Modal && (
          <button
            type="button"
            className="btn alt"
            onClick={onOpenMt5Modal}
            id="header-mt5-gui-btn"
            title="Open MT5 Terminal Screen"
            style={{ padding: '7px 10px', fontSize: '11px' }}
          >
            <Monitor size={14} />
            <span className="desktop-only-inline">MT5</span>
          </button>
        )}

        {/* MT5 Connection Telemetry Status Pill */}
        <div
          className={`status-pill ${isConnected ? 'connected' : 'disconnected'}`}
          id="header-connection-status"
          title={isConnected ? 'MT5 Bridge is actively streaming' : 'MT5 Bridge is disconnected or offline'}
        >
          <span className={`pulse-dot ${isConnected ? 'online' : 'offline'}`} />
          <span>{isConnected ? 'LIVE' : 'OFFLINE'}</span>
          {latency !== null && latency !== undefined && isConnected && (
            <span style={{ opacity: 0.75, fontSize: '9px' }}>{latency}s</span>
          )}
        </div>

        {/* Profile Avatar & Popover Dropdown Menu */}
        <div className="header-profile-menu-container" ref={profileMenuRef}>
          <button
            type="button"
            className={`header-profile-btn ${activeTab === 'profile' || isProfileMenuOpen ? 'active' : ''}`}
            onClick={() => setIsProfileMenuOpen((prev) => !prev)}
            id="header-profile-btn"
            title="Menu Akun & Sesi"
            aria-label="Menu Akun"
            aria-expanded={isProfileMenuOpen}
          >
            <User size={15} />
          </button>

          {isProfileMenuOpen && (
            <div className="header-profile-dropdown animate-fade-in" id="header-profile-dropdown">
              <div className="header-profile-dropdown-user">
                <div className="header-profile-dropdown-avatar">
                  {user?.username ? user.username.slice(0, 2).toUpperCase() : 'PS'}
                </div>
                <div className="header-profile-dropdown-meta">
                  <div className="header-profile-dropdown-name">{user?.username || 'Trader'}</div>
                  <div className="header-profile-dropdown-sub">
                    {user?.email || (activeConn?.account_number ? `MT5 #${activeConn.account_number}` : (user?.role === 'admin' ? 'Administrator' : 'Trader Account'))}
                  </div>
                </div>
              </div>

              <div className="header-profile-dropdown-divider" />

              <button
                type="button"
                className="header-profile-dropdown-item"
                onClick={() => {
                  setIsProfileMenuOpen(false);
                  onSelectTab('profile');
                }}
                id="header-menu-profile-btn"
              >
                <User size={14} />
                <span>Profil & Pengaturan</span>
              </button>

              <div className="header-profile-dropdown-divider" />

              <button
                type="button"
                className="header-profile-dropdown-item danger"
                onClick={() => {
                  setIsProfileMenuOpen(false);
                  if (onLogout) onLogout();
                }}
                id="header-menu-logout-btn"
              >
                <LogOut size={14} />
                <span>Keluar</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
