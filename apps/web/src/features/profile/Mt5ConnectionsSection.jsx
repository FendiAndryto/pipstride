// MT5 connection list + token reveal (ticket 006-03). State and destructive
// actions come from the shared useConnectionManager hook.

import React from 'react';
import { Wallet, Copy, Check, Download, RefreshCw, RotateCw, Trash2, Monitor } from 'lucide-react';
import { downloadPreset } from '../../lib/download';
import { useLanguage } from '../../context/LanguageContext';
import ConfirmInline from '../../components/ConfirmInline';
import { Feedback } from './sectionPrimitives';

export default function Mt5ConnectionsSection({
  connections = [],
  activeConnectionId,
  onSelectConnection,
  onOpenMt5Modal,
  manager
}) {
  const { t } = useLanguage();
  const {
    isBusy,
    feedback,
    revealedToken,
    presetFile,
    copiedToken,
    pendingConfirm,
    create,
    requestRotate,
    requestRevoke,
    cancelPending,
    confirmPending,
    copyToken
  } = manager;

  const pendingMessage = pendingConfirm
    ? (pendingConfirm.action === 'rotate'
      ? t('modal_rotate_confirm', { label: pendingConfirm.connection.label })
      : t('profile_conn_delete_confirm', { label: pendingConfirm.connection.label }))
    : null;

  return (
    <>
      <div className="card" style={{ marginBottom: '20px' }}>
        <div className="cardhead">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Wallet size={17} style={{ color: 'var(--g)' }} />
            <h3>{t('profile_connections_title')}</h3>
          </div>
          <span className="tag green">{t('profile_accounts_count', { count: connections.length })}</span>
        </div>

        <p className="sub" style={{ fontSize: '11.5px', marginBottom: '14px', lineHeight: 1.45 }}>
          {t('profile_connections_desc')}
        </p>

        <Feedback feedback={feedback} />
        <ConfirmInline
          message={pendingMessage}
          busy={isBusy}
          onConfirm={confirmPending}
          onCancel={cancelPending}
        />

        {connections.length === 0 ? (
          <div style={{ fontSize: '11.5px', color: 'var(--muted)', marginBottom: '12px' }}>
            {t('profile_no_connections')}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
            {connections.map((connection) => {
              const isActive = connection.id === activeConnectionId;
              return (
                <div
                  key={connection.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 10px',
                    borderRadius: '8px',
                    border: `1px solid ${isActive ? 'rgba(69, 224, 173, 0.45)' : 'var(--line)'}`,
                    background: isActive ? 'rgba(69, 224, 173, 0.07)' : 'transparent'
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onSelectConnection && onSelectConnection(connection.id)}
                    style={{ flex: 1, textAlign: 'left', background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0 }}
                    title={t('profile_make_active')}
                  >
                    <div style={{ fontSize: '12px', fontWeight: 700 }}>
                      {connection.label} {isActive ? `· ${t('menu_active')}` : ''}
                    </div>
                    <div style={{ fontSize: '10.5px', color: '#8899a6', fontFamily: 'monospace' }}>
                      {connection.account_number ? `#${connection.account_number}` : t('modal_not_connected')} ·{' '}
                      {connection.broker_server || t('modal_server_none')} · {connection.token_prefix}…
                    </div>
                  </button>
                  <span className={`tag ${connection.status === 'connected' ? 'green' : ''}`} style={{ fontSize: '9px' }}>
                    {connection.status.toUpperCase()}
                  </span>
                  <button
                    type="button"
                    className="btn alt"
                    onClick={() => requestRotate(connection)}
                    disabled={isBusy}
                    title={t('profile_rotate')}
                    style={{ padding: '5px 7px' }}
                  >
                    <RotateCw size={13} />
                  </button>
                  <button
                    type="button"
                    className="btn alt"
                    onClick={() => requestRevoke(connection)}
                    disabled={isBusy}
                    title={t('profile_delete')}
                    style={{ padding: '5px 7px', color: '#ff8fa3' }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {revealedToken && (
          <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
            <input
              id="profile-revealed-token"
              name="bridge_token"
              type="text"
              readOnly
              value={revealedToken}
              aria-label={t('modal_token_label')}
              style={{
                flex: 1,
                background: '#0a1419',
                border: '1px solid rgba(69, 224, 173, 0.35)',
                borderRadius: '8px',
                color: '#45e0ad',
                fontFamily: 'monospace',
                fontSize: '12px',
                fontWeight: 600,
                padding: '9px 12px'
              }}
            />
            <button
              type="button"
              className="btn alt"
              onClick={copyToken}
              style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              {copiedToken ? <Check size={14} style={{ color: '#45e0ad' }} /> : <Copy size={14} />}
              <span>{copiedToken ? t('common_copied') : t('common_copy')}</span>
            </button>
            <button
              type="button"
              className="btn alt"
              onClick={() => downloadPreset(presetFile)}
              disabled={!presetFile}
              title={t('profile_preset_tip')}
              style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Download size={14} />
              <span>{t('profile_preset')}</span>
            </button>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            className="btn alt"
            onClick={() => create(t('profile_default_account_label', { n: connections.length + 1 }))}
            disabled={isBusy}
            style={{ fontSize: '11px', padding: '7px 12px' }}
          >
            <RefreshCw size={12} className={isBusy ? 'animate-spin' : ''} />
            <span>{t('profile_add_account')}</span>
          </button>
          <button
            type="button"
            className="btn alt"
            onClick={onOpenMt5Modal}
            style={{ padding: '7px 12px', fontSize: '11px' }}
            id="profile-open-mt5-screen-btn"
            title={t('profile_mt5_guide_tip')}
          >
            <Monitor size={13} />
            <span>{t('profile_mt5_guide')}</span>
          </button>
        </div>
      </div>
    </>
  );
}
