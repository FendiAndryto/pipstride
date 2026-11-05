// Active account telemetry tiles (ticket 006-03).

import React from 'react';
import { Server, Laptop } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { formatCurrency } from '../../domain/format';
import { StatTile } from './sectionPrimitives';

export default function ActiveAccountSection({ bridgeStatus, activeConn }) {
  const { t } = useLanguage();
  const metrics = bridgeStatus?.metrics || {};
  const isConnected = bridgeStatus?.is_connected || false;
  const terminalConnected = bridgeStatus?.terminal_connected || false;
  const hostType = bridgeStatus?.host_type || bridgeStatus?.metrics?.host_type || 'local';
  const server = metrics.server || 'MetaQuotes-Demo';
  const accountNumber = metrics.account_number || 0;
  const currency = metrics.currency || 'USD';

  return (
    <div className="card" style={{ marginBottom: '20px' }}>
      <div className="cardhead" style={{ marginBottom: '12px', paddingBottom: '10px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
          <div className="coin" style={{ width: '32px', height: '32px', flexShrink: 0, fontSize: '11px' }}>MT</div>
          <div style={{ overflow: 'hidden' }}>
            <div style={{ fontWeight: 800, fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {server}
            </div>
            <div className="tiny" style={{ color: 'var(--muted)', fontSize: '10.5px' }}>
              {activeConn?.label || t('profile_terminal_bridge')}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {isConnected && (
            <span
              className={`tag ${hostType === 'vps' ? 'blue' : 'green'}`}
              style={{ fontSize: '9px', display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 6px' }}
            >
              {hostType === 'vps' ? <Server size={11} /> : <Laptop size={11} />}
              <span>{hostType === 'vps' ? 'VPS' : t('host_local')}</span>
            </span>
          )}
          <span
            className={`tag ${isConnected && terminalConnected ? 'green' : (isConnected ? 'amber' : 'red')}`}
            style={{ fontSize: '9px', flexShrink: 0 }}
          >
            {isConnected && terminalConnected ? t('profile_online') : (isConnected ? t('profile_standby') : t('profile_offline'))}
          </span>
        </div>
      </div>

      <div className="grid-cards-responsive-2col" style={{ margin: 0, gap: '8px' }}>
        <StatTile label={t('profile_login_mt5')}>
          <div style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '13px', color: '#fff' }}>
            {accountNumber ? `#${accountNumber}` : t('common_offline')}
          </div>
        </StatTile>

        <StatTile label={t('profile_balance')}>
          <div style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '13px', color: 'var(--g)' }}>
            {formatCurrency(metrics.balance ?? 0, currency)}
          </div>
        </StatTile>

        <StatTile label={t('profile_bridge')}>
          <div>
            <span className={`tag ${isConnected ? '' : 'red'}`} style={{ fontSize: '9px', padding: '2px 6px' }}>
              {isConnected ? t('profile_bridge_live') : t('profile_bridge_offline')}
            </span>
          </div>
        </StatTile>

        <StatTile label={t('profile_broker')}>
          <div>
            <span className={`tag ${terminalConnected ? '' : 'red'}`} style={{ fontSize: '9px', padding: '2px 6px' }}>
              {terminalConnected ? t('profile_broker_online') : t('profile_broker_offline')}
            </span>
          </div>
        </StatTile>
      </div>
    </div>
  );
}
