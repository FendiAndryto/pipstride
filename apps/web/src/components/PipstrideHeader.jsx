import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Monitor, User, Wallet, LogOut, Laptop, Server, Globe } from 'lucide-react';
import { NAV_TABS } from '../constants/nav';
import { useLanguage } from '../context/LanguageContext';

function connectionLabel(connection, t) {
  if (!connection) return t('no_account');
  const account = connection.account_number ? `#${connection.account_number}` : t('unconnected');
  return `${connection.label} · ${account}`;
}

export default function PipstrideHeader({
  activeTab,
  onSelectTab,
  isConnected,
  latency,
  hostType = 'local',
  connections = [],
  activeConnectionId,
  onSelectConnection,
  onOpenMt5Modal,
  user,
  onLogout
}) {
  const { lang, setLang, t } = useLanguage();
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (
        profileMenuRef.current &&
        !profileMenuRef.current.contains(event.target) &&
        !event.target.closest('#header-mobile-account-chip')
      ) {
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
        title={t('header_brand_home')}
      >
        <div className="brand-logo-box">
          <img
            src="/favicon.svg"
            alt={t('header_logo_alt')}
            className="brand-logo-img"
          />
        </div>
        <div className="brand-text">
          Pipstride
          <small>{t('header_brand_tagline')}</small>
        </div>
      </div>

      {/* Desktop Navigation Links */}
      <nav className="nav-desktop" aria-label={t('header_main_nav')}>
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
              <span>{t(`nav_${tab.id}`)}</span>
            </button>
          );
        })}
      </nav>

      {/* Header Right Actions */}
      <div className="header-right">
        {/* Account switcher: one token-bound connection per MT5 account */}
        {connections.length > 0 && (
          <div className="connection-switcher" title={t('select_account')}>
            <Wallet size={14} />
            {connections.length === 1 ? (
              <span className="connection-switcher-static">
                {connectionLabel(connections[0], t)}
              </span>
            ) : (
              <>
                <select
                  id="header-connection-switcher"
                  value={activeConnectionId || ''}
                  onChange={(e) => onSelectConnection(e.target.value)}
                  aria-label={t('select_account')}
                >
                  {connections.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connectionLabel(connection, t)}
                    </option>
                  ))}
                </select>
                <ChevronDown size={13} className="connection-switcher-caret" />
              </>
            )}
          </div>
        )}

        {/* Mobile-only compact active account chip (<720px) */}
        {activeConn?.account_number && (
          <button
            type="button"
            className="header-mobile-account-chip"
            onClick={() => setIsProfileMenuOpen((prev) => !prev)}
            title={`MT5 #${activeConn.account_number}`}
            id="header-mobile-account-chip"
            aria-expanded={isProfileMenuOpen}
            aria-label={t('header_toggle_profile')}
          >
            <Wallet size={11} />
            <span>#{activeConn.account_number}</span>
          </button>
        )}

        {/* Live MT5 Terminal Web-GUI Button */}
        {onOpenMt5Modal && (
          <button
            type="button"
            className="btn alt"
            onClick={onOpenMt5Modal}
            id="header-mt5-gui-btn"
            title={t('header_mt5_screen_tip')}
            style={{ padding: '7px 10px', fontSize: '11px' }}
          >
            <Monitor size={14} />
            <span className="desktop-only-inline">MT5</span>
          </button>
        )}

        {/* MT5 Connection Telemetry Status Pill with Host Indicator */}
        <div
          className={`status-pill ${isConnected ? 'connected' : 'disconnected'}`}
          id="header-connection-status"
          title={
            isConnected
              ? t('header_status_connected_tip', { host: hostType === 'vps' ? t('host_vps') : t('host_local') })
              : t('header_status_offline_tip')
          }
        >
          <span className={`pulse-dot ${isConnected ? 'online' : 'offline'}`} />
          <span>{isConnected ? t('status_live') : t('status_offline')}</span>
          {isConnected && (
            <span className={`host-badge ${hostType === 'vps' ? 'vps' : 'local'}`}>
              {hostType === 'vps' ? <Server size={10} /> : <Laptop size={10} />}
              <span>{hostType === 'vps' ? t('host_vps') : t('host_local')}</span>
            </span>
          )}
          {latency !== null && latency !== undefined && isConnected && (
            <span style={{ opacity: 0.75, fontSize: '9px' }}>{latency}s</span>
          )}
        </div>

        {/* Language Switcher Toggle */}
        <div className="header-lang-switcher" role="group" aria-label={t('header_switch_language')}>
          <button
            type="button"
            className={`header-lang-btn ${lang === 'en' ? 'active' : ''}`}
            onClick={() => setLang('en')}
            id="header-lang-en-btn"
            title={t('header_lang_en')}
          >
            EN
          </button>
          <button
            type="button"
            className={`header-lang-btn ${lang === 'id' ? 'active' : ''}`}
            onClick={() => setLang('id')}
            id="header-lang-id-btn"
            title={t('header_lang_id')}
          >
            ID
          </button>
        </div>

        {/* Profile Avatar & Popover Dropdown Menu */}
        <div className="header-profile-menu-container" ref={profileMenuRef}>
          <button
            type="button"
            className={`header-profile-btn ${activeTab === 'profile' || isProfileMenuOpen ? 'active' : ''}`}
            onClick={() => setIsProfileMenuOpen((prev) => !prev)}
            id="header-profile-btn"
            title={t('header_profile_menu')}
            aria-label={t('header_profile_label')}
            aria-expanded={isProfileMenuOpen}
          >
            <User size={15} />
            <span
              className={`header-profile-status-dot ${isConnected ? 'online' : 'offline'}`}
              aria-label={isConnected ? t('header_mt5_live') : t('header_mt5_offline')}
            />
          </button>

          {isProfileMenuOpen && (
            <div className="header-profile-dropdown animate-fade-in" id="header-profile-dropdown">
              <div className="header-profile-dropdown-user">
                <div className="header-profile-dropdown-avatar">
                  {user?.username ? user.username.slice(0, 2).toUpperCase() : 'PS'}
                </div>
                <div className="header-profile-dropdown-meta">
                  <div className="header-profile-dropdown-name">{user?.username || t('header_trader_fallback')}</div>
                  <div className="header-profile-dropdown-sub">
                    {user?.email || (activeConn?.account_number ? `MT5 #${activeConn.account_number}` : (user?.role === 'admin' ? t('header_role_admin') : t('header_role_trader')))}
                  </div>
                </div>
              </div>

              <div className="header-profile-dropdown-divider" />

              {/* Mobile Account Switcher (when multiple connections exist) */}
              {connections.length > 1 && (
                <div className="header-profile-dropdown-account-switcher" id="header-profile-account-switcher">
                  <div className="header-profile-dropdown-account-label">
                    <Wallet size={12} />
                    <span>{t('select_account')}</span>
                  </div>
                  <select
                    value={activeConnectionId || ''}
                    onChange={(e) => {
                      onSelectConnection(e.target.value);
                      setIsProfileMenuOpen(false);
                    }}
                    className="header-profile-dropdown-select"
                    aria-label={t('select_account')}
                    id="header-profile-account-select"
                  >
                    {connections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {connectionLabel(c, t)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* MT5 Telemetry Status in Profile Dropdown */}
              <div
                className={`header-profile-dropdown-mt5 ${isConnected ? 'connected' : 'disconnected'}`}
                onClick={() => {
                  setIsProfileMenuOpen(false);
                  if (onOpenMt5Modal) onOpenMt5Modal();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setIsProfileMenuOpen(false);
                    if (onOpenMt5Modal) onOpenMt5Modal();
                  }
                }}
                title={t('header_open_modal_tip')}
                role="button"
                tabIndex={0}
              >
                <div className="header-profile-dropdown-mt5-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span className={`pulse-dot ${isConnected ? 'online' : 'offline'}`} />
                    <span className="header-profile-dropdown-mt5-status">
                      {isConnected ? t('header_mt5_live') : t('header_mt5_offline')}
                    </span>
                  </div>
                  {isConnected && (
                    <span className={`host-badge ${hostType === 'vps' ? 'vps' : 'local'}`}>
                      {hostType === 'vps' ? <Server size={10} /> : <Laptop size={10} />}
                      <span>{hostType === 'vps' ? t('host_vps') : t('host_local')}</span>
                    </span>
                  )}
                </div>
                <div className="header-profile-dropdown-mt5-details">
                  <span>{activeConn?.account_number ? `#${activeConn.account_number}` : t('no_account')}</span>
                  {latency !== null && latency !== undefined && isConnected && (
                    <span> · {latency}s</span>
                  )}
                </div>
              </div>

              {/* Mobile-only language switcher inside dropdown */}
              <div className="header-profile-dropdown-lang">
                <span className="header-profile-dropdown-lang-label">
                  <Globe size={13} />
                  <span>{t('header_language')}</span>
                </span>
                <div className="header-lang-switcher">
                  <button
                    type="button"
                    className={`header-lang-btn ${lang === 'en' ? 'active' : ''}`}
                    onClick={() => setLang('en')}
                    title={t('header_lang_en')}
                  >
                    EN
                  </button>
                  <button
                    type="button"
                    className={`header-lang-btn ${lang === 'id' ? 'active' : ''}`}
                    onClick={() => setLang('id')}
                    title={t('header_lang_id')}
                  >
                    ID
                  </button>
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
                <span>{t('menu_profile')}</span>
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
                <span>{t('menu_logout')}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
