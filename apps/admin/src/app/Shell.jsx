import React from 'react';
import {
  Activity,
  Users,
  ShieldAlert,
  LifeBuoy,
  LogOut,
  UserCheck,
} from 'lucide-react';
import { SupportBanner } from '../features/support/SupportBanner';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';

export function Shell({
  currentUser,
  currentRoute,
  onNavigate,
  onLogout,
  activeSupportSession,
  onRevokeSupportSession,
  onExpireSupportSession,
  children,
}) {
  const navItems = [
    { id: 'overview', label: 'Overview', shortLabel: 'Overview', icon: Activity },
    { id: 'users', label: 'Users', shortLabel: 'Users', icon: Users },
    { id: 'audit', label: 'Audit Trail', shortLabel: 'Audit', icon: ShieldAlert },
    { id: 'support', label: 'Support Sessions', shortLabel: 'Support', icon: LifeBuoy },
  ];

  return (
    <div className="admin-shell">
      <header className="admin-header">
        <div className="admin-header-inner">
          <div className="brand-section">
            <a
              href="#overview"
              onClick={(e) => {
                e.preventDefault();
                onNavigate('overview');
              }}
              className="brand-logo"
            >
              <div
                style={{
                  width: '24px',
                  height: '24px',
                  background: 'var(--accent-emerald)',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#060a0e',
                  fontWeight: 800,
                  fontSize: '14px',
                }}
              >
                P
              </div>
              <span>PIPSTRIDE</span>
            </a>
            <span className="brand-badge">ADMIN CONSOLE</span>
          </div>

          <nav className="nav-links" aria-label="Main Navigation">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentRoute === item.id;
              return (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate(item.id);
                  }}
                  className={`nav-item ${isActive ? 'active' : ''}`}
                >
                  <Icon size={15} />
                  <span>{item.label}</span>
                </a>
              );
            })}
          </nav>

          <div className="header-actions">
            <div className="user-pill">
              <UserCheck size={14} style={{ color: 'var(--accent-emerald)' }} />
              <span className="user-pill-name" style={{ fontWeight: 600 }}>
                {currentUser?.username || 'Operator'}
              </span>
              <Badge variant={currentUser?.role === 'admin' ? 'danger' : 'warning'}>
                {currentUser?.role?.toUpperCase() || 'STAFF'}
              </Badge>
            </div>

            <Button
              variant="ghost"
              size="sm"
              icon={LogOut}
              onClick={onLogout}
              aria-label="Sign out"
              className="signout-btn"
            >
              <span className="signout-label">Sign Out</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Persistent Support Elevation Banner (ADR 0008 §6) */}
      <SupportBanner
        session={activeSupportSession}
        onRevoke={onRevokeSupportSession}
        onExpire={onExpireSupportSession}
      />

      <main className="admin-main">{children}</main>

      <nav className="mobile-bottom-nav" aria-label="Mobile Navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentRoute === item.id;
          return (
            <a
              key={item.id}
              href={`#${item.id}`}
              onClick={(e) => {
                e.preventDefault();
                onNavigate(item.id);
              }}
              className={`mobile-nav-item ${isActive ? 'active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon size={18} />
              <span>{item.shortLabel}</span>
            </a>
          );
        })}
      </nav>
    </div>
  );
}
