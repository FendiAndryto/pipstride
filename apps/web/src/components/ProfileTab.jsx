// Profile screen composition (ticket 006-03). Each section owns its own state;
// this file only arranges them and keeps the user card.

import React from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useConnectionManager } from '../features/connections/useConnections';
import { SectionHeading } from '../features/profile/sectionPrimitives';
import Mt5ConnectionsSection from '../features/profile/Mt5ConnectionsSection';
import ActiveAccountSection from '../features/profile/ActiveAccountSection';
import AccountEmailSection from '../features/profile/AccountEmailSection';
import PasswordSection from '../features/profile/PasswordSection';
import AccessLogSection from '../features/profile/AccessLogSection';

export default function ProfileTab({
  user,
  bridgeStatus,
  riskStatus,
  connections = [],
  activeConnectionId,
  onSelectConnection,
  onConnectionsChanged,
  onOpenMt5Modal,
  onRefreshUser
}) {
  const { t } = useLanguage();
  const manager = useConnectionManager({
    onChanged: onConnectionsChanged,
    onSelect: onSelectConnection
  });
  const activeConn = connections.find((c) => c.id === activeConnectionId) || connections[0];

  return (
    <div className="profile-tab-container animate-fade-in" style={{ maxWidth: '850px', margin: '0 auto' }}>
      <div className="heading">
        <div>
          <div className="eyebrow">{t('profile_eyebrow')}</div>
          <h1>{t('profile_title')}</h1>
          <div className="sub">{t('profile_sub')}</div>
        </div>
      </div>

      {/* User Card */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            className="icon-box"
            style={{
              width: '46px',
              height: '46px',
              borderRadius: '14px',
              background: '#163b32',
              color: 'var(--g)',
              fontSize: '18px',
              fontWeight: 900
            }}
          >
            {user?.username ? user.username.slice(0, 2).toUpperCase() : 'PS'}
          </div>
          <div className="grow">
            <div style={{ fontSize: '15px', fontWeight: 800 }}>{user?.username || t('profile_role_trader')}</div>
            <div className="sub" style={{ fontSize: '11px' }}>
              {t('profile_account_role', { role: user?.role === 'admin' ? t('profile_role_admin') : t('profile_role_trader') })}
            </div>
          </div>
          <span className="tag">{user?.role ? user.role.toUpperCase() : t('profile_tag_active')}</span>
        </div>
      </div>

      <SectionHeading>{t('profile_connections_section')}</SectionHeading>
      <Mt5ConnectionsSection
        connections={connections}
        activeConnectionId={activeConnectionId}
        onSelectConnection={onSelectConnection}
        onOpenMt5Modal={onOpenMt5Modal}
        manager={manager}
      />

      <SectionHeading>{t('profile_active_account')}</SectionHeading>
      <ActiveAccountSection bridgeStatus={bridgeStatus} riskStatus={riskStatus} activeConn={activeConn} />

      <SectionHeading>{t('profile_email_section')}</SectionHeading>
      <AccountEmailSection user={user} onRefreshUser={onRefreshUser} />

      <SectionHeading>{t('profile_password_section')}</SectionHeading>
      <PasswordSection user={user} />

      <SectionHeading>{t('profile_access_log_section')}</SectionHeading>
      <AccessLogSection />
    </div>
  );
}
