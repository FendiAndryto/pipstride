import React, { useState } from 'react';
import {
  X,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Laptop,
  Server,
  Monitor,
  Check,
  ShieldCheck,
  KeyRound,
  Copy,
  Download,
  Plus,
  RotateCw,
  Trash2
} from 'lucide-react';
import { api, downloadPreset } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import RichText from './RichText';

export default function Mt5ConnectModal({
  isOpen,
  onClose,
  isConnected,
  hostType = 'local',
  accountNumber,
  connections = [],
  connectionsLoaded = false,
  activeConnectionId,
  onSelectConnection,
  onConnectionsChanged,
  onCheckStatus
}) {
  const { t } = useLanguage();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [revealedToken, setRevealedToken] = useState('');
  const [presetFile, setPresetFile] = useState(null);
  const [copiedToken, setCopiedToken] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');
  const [newLabel, setNewLabel] = useState('');

  const handleClose = () => {
    setRevealedToken('');
    setPresetFile(null);
    setError('');
    setNewLabel('');
    setCopiedToken(false);
    if (onClose) onClose();
  };

  if (!isOpen) return null;

  const bridgeUrl = typeof window !== 'undefined' ? window.location.origin : 'https://pipstride.app';

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      if (onConnectionsChanged) await onConnectionsChanged();
      if (onCheckStatus) await onCheckStatus();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(bridgeUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const handleCopyToken = () => {
    if (!revealedToken) return;
    navigator.clipboard.writeText(revealedToken);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  const runAction = async (action) => {
    setIsBusy(true);
    setError('');
    try {
      const result = await action();
      if (onConnectionsChanged) await onConnectionsChanged();
      return result;
    } catch (err) {
      setError(err.message || t('modal_error_generic'));
      return null;
    } finally {
      setIsBusy(false);
    }
  };

  const handleCreate = () =>
    runAction(async () => {
      const created = await api.createConnection(newLabel.trim() || t('modal_default_label'));
      setRevealedToken(created.token);
      setPresetFile(created.preset || null);
      setNewLabel('');
      if (onSelectConnection) onSelectConnection(created.id);
      return created;
    });

  const handleRotate = (connection) => {
    if (!window.confirm(t('modal_rotate_confirm', { label: connection.label }))) {
      return;
    }
    return runAction(async () => {
      const rotated = await api.rotateConnectionToken(connection.id);
      setRevealedToken(rotated.token);
      setPresetFile(rotated.preset || null);
      return rotated;
    });
  };

  const handleRevoke = (connection) => {
    if (!window.confirm(t('modal_delete_confirm', { label: connection.label }))) {
      return;
    }
    return runAction(() => api.revokeConnection(connection.id));
  };

  return (
    <div className="modal-backdrop animate-fade-in" id="mt5-connect-modal-backdrop">
      <div className="mt5-connect-modal glass-panel" id="mt5-connect-modal">
        {/* Modal Header */}
        <div className="mt5-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div className="mt5-modal-icon-box">
              <Monitor size={22} style={{ color: '#45e0ad' }} />
            </div>
            <div>
              <h3 className="mt5-modal-title">{t('modal_title')}</h3>
              <span className="mt5-modal-subtitle">{t('modal_subtitle')}</span>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="btn-modal-close"
            id="close-mt5-connect-modal-btn"
            title={t('modal_close')}
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="mt5-modal-body">
          {/* Current Status Pill */}
          <div className={`mt5-status-banner ${isConnected ? 'connected' : 'disconnected'}`}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {isConnected ? (
                <CheckCircle2 size={18} className="text-emerald" />
              ) : (
                <AlertTriangle size={18} className="text-rose" />
              )}
              <span style={{ fontWeight: 700 }}>
                {t('modal_status_title')}:{' '}
                {isConnected ? t('modal_status_connected') : t('modal_status_waiting')}
              </span>
              {isConnected && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    fontSize: '10px',
                    fontWeight: 700,
                    background: hostType === 'vps' ? 'rgba(96, 165, 250, 0.2)' : 'rgba(69, 224, 173, 0.2)',
                    color: hostType === 'vps' ? '#60a5fa' : '#45e0ad',
                    border: `1px solid ${hostType === 'vps' ? 'rgba(96, 165, 250, 0.4)' : 'rgba(69, 224, 173, 0.4)'}`
                  }}
                >
                  {hostType === 'vps' ? <Server size={11} /> : <Laptop size={11} />}
                  <span>{hostType === 'vps' ? t('host_vps') : t('host_local')}</span>
                </span>
              )}
            </div>
            {isConnected && accountNumber ? (
              <span style={{ fontSize: '0.8rem', opacity: 0.9, fontFamily: 'monospace' }}>
                #{accountNumber}
              </span>
            ) : null}
          </div>

          {/* Architecture Edge Info */}
          <div
            style={{
              padding: '12px 14px',
              background: 'rgba(69, 224, 173, 0.08)',
              border: '1px solid rgba(69, 224, 173, 0.25)',
              borderRadius: '8px',
              fontSize: '0.8rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#45e0ad', fontWeight: 700 }}>
              <ShieldCheck size={15} />
              <span>{t('modal_private_title')}</span>
            </div>
            <div style={{ color: 'var(--text-main, #e2e8f0)', lineHeight: 1.4 }}>
              <RichText text={t('modal_private_desc')} />
            </div>
          </div>

          {error && (
            <div
              role="alert"
              style={{
                padding: '10px 12px',
                borderRadius: '8px',
                background: 'rgba(255, 99, 132, 0.12)',
                border: '1px solid rgba(255, 99, 132, 0.35)',
                color: '#ffb3c1',
                fontSize: '0.78rem'
              }}
            >
              {error}
            </div>
          )}

          {/* Connections manager */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 600 }}>
                {t('modal_connected_accounts', { count: connections.length })}
              </span>
              <button
                type="button"
                className="btn alt"
                onClick={handleCreate}
                disabled={isBusy}
                style={{ fontSize: '11px', padding: '6px 10px', display: 'flex', alignItems: 'center', gap: '5px' }}
              >
                <Plus size={13} />
                <span>{t('modal_add_account')}</span>
              </button>
            </div>

            {!connectionsLoaded ? (
              <span style={{ fontSize: '11px', color: '#8899a6' }}>{t('modal_loading_conn')}</span>
            ) : connections.length === 0 ? (
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder={t('modal_account_name_ph')}
                  maxLength={64}
                  style={{
                    flex: 1,
                    background: '#0a1419',
                    border: '1px solid var(--line)',
                    borderRadius: '8px',
                    color: '#e2e8f0',
                    fontSize: '12px',
                    padding: '8px 12px'
                  }}
                />
                <button type="button" className="btn" onClick={handleCreate} disabled={isBusy}>
                  {t('modal_create_token')}
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
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
                        title={t('modal_make_active')}
                        style={{
                          flex: 1,
                          textAlign: 'left',
                          background: 'transparent',
                          border: 'none',
                          color: 'inherit',
                          cursor: 'pointer',
                          padding: 0
                        }}
                      >
                        <div style={{ fontSize: '12px', fontWeight: 700 }}>
                          {connection.label} {isActive ? `· ${t('modal_active')}` : ''}
                        </div>
                        <div style={{ fontSize: '10.5px', color: '#8899a6', fontFamily: 'monospace' }}>
                          {connection.account_number ? `#${connection.account_number}` : t('modal_not_connected')} ·{' '}
                          {connection.broker_server || t('modal_server_none')} · {connection.token_prefix}…
                        </div>
                      </button>

                      <span
                        className={`tag ${connection.status === 'connected' ? 'green' : ''}`}
                        style={{ fontSize: '9px' }}
                      >
                        {connection.status.toUpperCase()}
                      </span>

                      <button
                        type="button"
                        className="btn alt"
                        onClick={() => handleRotate(connection)}
                        disabled={isBusy}
                        title={t('modal_rotate')}
                        style={{ padding: '5px 7px' }}
                      >
                        <RotateCw size={13} />
                      </button>
                      <button
                        type="button"
                        className="btn alt"
                        onClick={() => handleRevoke(connection)}
                        disabled={isBusy}
                        title={t('modal_delete')}
                        style={{ padding: '5px 7px', color: '#ff8fa3' }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  );
                })}

                <div style={{ display: 'flex', gap: '8px', marginTop: '2px' }}>
                  <input
                    type="text"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder={t('modal_account_name_new')}
                    maxLength={64}
                    style={{
                      flex: 1,
                      background: '#0a1419',
                      border: '1px solid var(--line)',
                      borderRadius: '8px',
                      color: '#e2e8f0',
                      fontSize: '12px',
                      padding: '8px 12px'
                    }}
                  />
                  <button
                    type="button"
                    className="btn alt"
                    onClick={handleCreate}
                    disabled={isBusy}
                    style={{ fontSize: '11px', whiteSpace: 'nowrap' }}
                  >
                    {t('modal_add')}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Token reveal (shown exactly once, right after create/rotate) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <KeyRound size={13} style={{ color: '#45e0ad' }} />
              <span style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 600 }}>
                {t('modal_token_label')}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                readOnly
                value={revealedToken || ''}
                placeholder={connections.length ? t('modal_token_ph_empty') : 'pst_live_...'}
                style={{
                  flex: 1,
                  background: '#0a1419',
                  border: '1px solid rgba(69, 224, 173, 0.4)',
                  borderRadius: '8px',
                  color: '#45e0ad',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  fontWeight: 600,
                  padding: '8px 12px'
                }}
              />
              <button
                type="button"
                className="btn alt"
                onClick={handleCopyToken}
                disabled={!revealedToken}
                style={{ fontSize: '11px', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '5px' }}
              >
                {copiedToken ? <Check size={14} style={{ color: '#45e0ad' }} /> : <Copy size={14} />}
                <span>{copiedToken ? t('common_copied') : t('common_copy')}</span>
              </button>
            </div>
            <span style={{ fontSize: '10px', color: revealedToken ? '#ffd28a' : '#8899a6' }}>
              {t('modal_token_note')}
            </span>
          </div>

          {/* Download EA Section */}
          <div
            style={{
              padding: '12px 14px',
              background: 'linear-gradient(135deg, rgba(69, 224, 173, 0.12), rgba(15, 30, 40, 0.8))',
              border: '1px solid rgba(69, 224, 173, 0.35)',
              borderRadius: '8px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#45e0ad', fontWeight: 700, fontSize: '0.85rem' }}>
                <Download size={16} />
                <span>{t('modal_download_ea_title')}</span>
              </div>
              <span style={{ fontSize: '10px', color: '#8899a6', background: 'rgba(0,0,0,0.3)', padding: '2px 8px', borderRadius: '4px' }}>
                MetaTrader 5
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
              <a
                href="/PipstrideMonitor.mq5"
                download="PipstrideMonitor.mq5"
                className="btn"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  fontSize: '11px',
                  padding: '9px 10px',
                  textDecoration: 'none',
                  background: '#45e0ad',
                  color: '#080f14',
                  fontWeight: 700
                }}
                id="btn-download-monitor-mq5"
                title={t('modal_download_ea_tip')}
              >
                <Download size={14} />
                <span>{t('modal_download_ea')}</span>
              </a>

              <button
                type="button"
                className="btn alt"
                onClick={() => downloadPreset(presetFile)}
                disabled={!presetFile}
                id="btn-download-monitor-preset"
                title={
                  presetFile
                    ? t('modal_preset_tip_ready')
                    : t('modal_preset_tip_empty')
                }
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  fontSize: '11px',
                  padding: '9px 10px',
                  opacity: presetFile ? 1 : 0.55
                }}
              >
                <Download size={14} />
                <span>{t('modal_preset')}</span>
              </button>
            </div>
            <span style={{ fontSize: '10px', color: '#8899a6', lineHeight: 1.4 }}>
              <RichText text={t('modal_preset_note')} />
            </span>
          </div>

          {/* Target Backend Endpoint */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 600 }}>
              {t('modal_backend_url')}
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                readOnly
                value={bridgeUrl}
                style={{
                  flex: 1,
                  background: '#0a1419',
                  border: '1px solid var(--line)',
                  borderRadius: '8px',
                  color: '#b8ffe6',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  padding: '8px 12px'
                }}
              />
              <button
                type="button"
                className="btn alt"
                onClick={handleCopyUrl}
                style={{ fontSize: '11px', padding: '8px 12px' }}
              >
                {copiedUrl ? <Check size={14} style={{ color: '#45e0ad' }} /> : t('common_copy')}
              </button>
            </div>
          </div>

          {/* 3 Steps */}
          <div className="mt5-steps-container">
            <h4 className="mt5-steps-title">
              {t('modal_steps_title')}
            </h4>

            <div className="mt5-step-card">
              <div className="mt5-step-number">1</div>
              <div className="mt5-step-content">
                <strong>{t('modal_step1_title')}</strong>
                <p>
                  <RichText text={t('modal_step1_body')} />
                </p>
              </div>
            </div>

            <div className="mt5-step-card">
              <div className="mt5-step-number">2</div>
              <div className="mt5-step-content">
                <strong>{t('modal_step2_title')}</strong>
                <p>
                  <RichText text={t('modal_step2_body', { url: bridgeUrl })} />
                </p>
              </div>
            </div>

            <div className="mt5-step-card">
              <div className="mt5-step-number">3</div>
              <div className="mt5-step-content">
                <strong>{t('modal_step3_title')}</strong>
                <p>
                  <RichText text={t('modal_step3_body')} />
                </p>
              </div>
            </div>
          </div>

          <p className="mt5-success-note">
            <RichText text={t('modal_success_note')} />
          </p>
        </div>

        {/* Modal Footer */}
        <div className="mt5-modal-footer">
          <button
            type="button"
            className="btn alt"
            onClick={handleRefresh}
            disabled={isRefreshing || isBusy}
            id="refresh-mt5-status-btn"
          >
            <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
            <span>{isRefreshing ? t('modal_checking') : t('modal_check_status')}</span>
          </button>
          <button
            type="button"
            className="btn"
            onClick={handleClose}
            id="close-mt5-modal-action-btn"
          >
            <span>{t('modal_close')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
