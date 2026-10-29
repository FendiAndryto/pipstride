import React, { useState } from 'react';
import {
  ShieldCheck,
  Monitor,
  Send,
  Clock,
  KeyRound,
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  RefreshCw,
  RotateCw,
  Trash2,
  Download,
  Wallet,
  Mail,
  Server,
  Laptop
} from 'lucide-react';
import { api, downloadPreset } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import RichText from './RichText';

const formatCurrency = (val, currency = 'USD') => {
  if (val === null || val === undefined) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(val);
};

export default function ProfileTab({
  user,
  bridgeStatus,
  riskStatus,
  connections = [],
  activeConnectionId,
  onSelectConnection,
  onConnectionsChanged,
  pollInterval,
  onPollIntervalChange,
  onOpenMt5Modal,
  onTestTelegram,
  isTestingTelegram,
  telegramStatusMsg,
  onRefreshUser
}) {
  const { t } = useLanguage();
  const metrics = bridgeStatus?.metrics || {};
  const isConnected = bridgeStatus?.is_connected || false;
  const terminalConnected = bridgeStatus?.terminal_connected || false;
  const hostType = bridgeStatus?.host_type || bridgeStatus?.metrics?.host_type || 'local';
  const server = metrics.server || 'MetaQuotes-Demo';
  const accountNumber = metrics.account_number || 0;
  const currency = metrics.currency || 'USD';
  const activeConn = connections.find((c) => c.id === activeConnectionId) || connections[0];

  // Passive risk watchdog metrics (read-only, never liquidates positions)
  const dailyDrawdownPercent = riskStatus?.daily_drawdown_percent ?? 0;
  const maxDrawdownPercent = riskStatus?.max_daily_drawdown_percent ?? 3.0;
  const isRiskAlert = riskStatus?.is_alert_active ?? false;
  const marginLevel = riskStatus?.margin_level ?? metrics.margin_level ?? 0;
  const limitUsed = maxDrawdownPercent > 0 ? Math.min(100, (dailyDrawdownPercent / maxDrawdownPercent) * 100) : 0;

  // Connection management state
  const [isBusy, setIsBusy] = useState(false);
  const [connectionMsg, setConnectionMsg] = useState(null);
  const [revealedToken, setRevealedToken] = useState('');
  const [presetFile, setPresetFile] = useState(null);
  const [copiedToken, setCopiedToken] = useState(false);

  const runAction = async (action, successText) => {
    setIsBusy(true);
    setConnectionMsg(null);
    try {
      const result = await action();
      if (onConnectionsChanged) await onConnectionsChanged();
      if (successText) setConnectionMsg({ type: 'success', text: successText });
      return result;
    } catch (err) {
      setConnectionMsg({ type: 'error', text: err.message || t('profile_conn_failed') });
      return null;
    } finally {
      setIsBusy(false);
    }
  };

  const handleCreateConnection = async () => {
    const created = await runAction(
      () => api.createConnection(t('profile_default_account_label', { n: connections.length + 1 })),
      t('profile_conn_created')
    );
    if (created?.token) {
      setRevealedToken(created.token);
      setPresetFile(created.preset || null);
      if (onSelectConnection) onSelectConnection(created.id);
    }
  };

  const handleRotate = (connection) => {
    if (!window.confirm(
      t('modal_rotate_confirm', { label: connection.label })
    )) {
      return;
    }
    runAction(async () => {
      const rotated = await api.rotateConnectionToken(connection.id);
      setRevealedToken(rotated.token);
      setPresetFile(rotated.preset || null);
      return rotated;
    }, t('profile_conn_rotated'));
  };

  const handleRevoke = (connection) => {
    if (!window.confirm(
      t('profile_conn_delete_confirm', { label: connection.label })
    )) {
      return;
    }
    runAction(() => api.revokeConnection(connection.id), t('profile_conn_deleted'));
  };

  const handleCopyToken = () => {
    if (!revealedToken) return;
    navigator.clipboard.writeText(revealedToken);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  // Change password state
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showOldPass, setShowOldPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [isChangingPass, setIsChangingPass] = useState(false);
  const [passFeedback, setPassFeedback] = useState(null);

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPassFeedback(null);

    if (!oldPassword || !newPassword) {
      setPassFeedback({ type: 'error', text: t('err_old_new_required') });
      return;
    }

    if (newPassword.length < 8) {
      setPassFeedback({ type: 'error', text: t('err_new_password_min') });
      return;
    }

    if (!/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setPassFeedback({ type: 'error', text: t('err_new_password_alnum') });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPassFeedback({ type: 'error', text: t('err_new_password_mismatch') });
      return;
    }

    setIsChangingPass(true);
    try {
      const res = await api.changePassword(oldPassword, newPassword);
      setPassFeedback({
        type: 'success',
        text: res.message || t('profile_password_success')
      });
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPassFeedback({ type: 'error', text: err.message || t('err_change_password') });
    } finally {
      setIsChangingPass(false);
    }
  };

  // Account email state
  const [emailInfo, setEmailInfo] = useState({
    email: user?.email || '',
    verified: Boolean(user?.email_verified)
  });
  const [emailInput, setEmailInput] = useState('');
  const [isSavingEmail, setIsSavingEmail] = useState(false);
  const [emailFeedback, setEmailFeedback] = useState(null);

  const handleSaveEmail = async (e) => {
    e.preventDefault();
    setEmailFeedback(null);

    const value = emailInput.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      setEmailFeedback({ type: 'error', text: t('err_email_invalid') });
      return;
    }

    setIsSavingEmail(true);
    try {
      const res = await api.setEmail(value);
      setEmailInfo({ email: res.email, verified: Boolean(res.email_verified) });
      setEmailInput('');
      setEmailFeedback({
        type: 'success',
        text: res.message || t('profile_email_sent')
      });
      if (onRefreshUser) await onRefreshUser();
    } catch (err) {
      setEmailFeedback({ type: 'error', text: err.message || t('err_save_email') });
    } finally {
      setIsSavingEmail(false);
    }
  };

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

      {/* MT5 Connections */}
      <div className="section" style={{ fontSize: '14px', fontWeight: 800, marginBottom: '10px' }}>
        {t('profile_connections_section')}
      </div>

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

        {connectionMsg && (
          <div
            style={{
              padding: '9px 12px',
              borderRadius: '9px',
              fontSize: '11.5px',
              marginBottom: '14px',
              background: connectionMsg.type === 'success' ? 'rgba(69, 224, 173, 0.12)' : 'rgba(255, 113, 128, 0.12)',
              border: `1px solid ${connectionMsg.type === 'success' ? 'rgba(69, 224, 173, 0.4)' : 'rgba(255, 113, 128, 0.4)'}`,
              color: connectionMsg.type === 'success' ? 'var(--g)' : 'var(--red)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            {connectionMsg.type === 'success' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
            <span>{connectionMsg.text}</span>
          </div>
        )}

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
                    style={{
                      flex: 1,
                      textAlign: 'left',
                      background: 'transparent',
                      border: 'none',
                      color: 'inherit',
                      cursor: 'pointer',
                      padding: 0
                    }}
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
                    onClick={() => handleRotate(connection)}
                    disabled={isBusy}
                    title={t('profile_rotate')}
                    style={{ padding: '5px 7px' }}
                  >
                    <RotateCw size={13} />
                  </button>
                  <button
                    type="button"
                    className="btn alt"
                    onClick={() => handleRevoke(connection)}
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
              type="text"
              readOnly
              value={revealedToken}
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
              onClick={handleCopyToken}
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
            onClick={handleCreateConnection}
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

      {/* Active Account Telemetry */}
      <div className="section" style={{ fontSize: '14px', fontWeight: 800, marginBottom: '10px' }}>
        {t('profile_active_account')}
      </div>

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
                style={{
                  fontSize: '9px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '2px 6px'
                }}
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
          <div style={{ background: '#0a1419', border: '1px solid var(--line)', borderRadius: '8px', padding: '9px 12px' }}>
            <div className="tiny" style={{ color: 'var(--muted)', fontSize: '9.5px', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>
              {t('profile_login_mt5')}
            </div>
            <div style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '13px', color: '#fff' }}>
              {accountNumber ? `#${accountNumber}` : t('common_offline')}
            </div>
          </div>

          <div style={{ background: '#0a1419', border: '1px solid var(--line)', borderRadius: '8px', padding: '9px 12px' }}>
            <div className="tiny" style={{ color: 'var(--muted)', fontSize: '9.5px', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>
              {t('profile_balance')}
            </div>
            <div style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '13px', color: 'var(--g)' }}>
              {formatCurrency(metrics.balance ?? 0, currency)}
            </div>
          </div>

          <div style={{ background: '#0a1419', border: '1px solid var(--line)', borderRadius: '8px', padding: '9px 12px' }}>
            <div className="tiny" style={{ color: 'var(--muted)', fontSize: '9.5px', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
              {t('profile_bridge')}
            </div>
            <div>
              <span className={`tag ${isConnected ? '' : 'red'}`} style={{ fontSize: '9px', padding: '2px 6px' }}>
                {isConnected ? t('profile_bridge_live') : t('profile_bridge_offline')}
              </span>
            </div>
          </div>

          <div style={{ background: '#0a1419', border: '1px solid var(--line)', borderRadius: '8px', padding: '9px 12px' }}>
            <div className="tiny" style={{ color: 'var(--muted)', fontSize: '9.5px', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
              {t('profile_broker')}
            </div>
            <div>
              <span className={`tag ${terminalConnected ? '' : 'red'}`} style={{ fontSize: '9px', padding: '2px 6px' }}>
                {terminalConnected ? t('profile_broker_online') : t('profile_broker_offline')}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Passive Risk Watchdog */}
      <div className="section" style={{ fontSize: '14px', fontWeight: 800, marginBottom: '10px' }}>
        {t('profile_risk_section')}
      </div>

      <div className="card" style={{ marginBottom: '20px' }}>
        <div className="cardhead">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShieldCheck size={18} style={{ color: isRiskAlert ? 'var(--amber)' : 'var(--g)' }} />
            <h3>{t('profile_drawdown_monitor')}</h3>
          </div>
          <span className="tag">
            {t('profile_risk_tag', { pct: dailyDrawdownPercent.toFixed(2) })}
          </span>
        </div>

        <p className="sub" style={{ fontSize: '11.5px', marginBottom: '12px', lineHeight: 1.45 }}>
          <RichText text={t('profile_risk_desc')} />
        </p>

        <div style={{ background: '#0a1419', height: '8px', borderRadius: '99px', overflow: 'hidden', marginBottom: '8px', border: '1px solid var(--line)' }}>
          <div
            style={{
              width: `${Math.min(100, Math.max(0, limitUsed))}%`,
              height: '100%',
              background: isRiskAlert || limitUsed > 75 ? 'var(--red)' : limitUsed > 40 ? 'var(--amber)' : 'var(--g)',
              borderRadius: '99px',
              transition: 'width 0.4s ease'
            }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--muted)' }}>
          <span>{t('profile_baseline', { amount: formatCurrency(bridgeStatus?.initial_deposit, currency) })}</span>
          <span>{t('profile_margin_level', { level: marginLevel ? `${marginLevel.toFixed(1)}%` : '—' })}</span>
        </div>
      </div>

      {/* Account Email & Recovery */}
      <div className="section" style={{ fontSize: '14px', fontWeight: 800, marginBottom: '10px' }}>
        {t('profile_email_section')}
      </div>

      <div className="card" style={{ marginBottom: '20px' }}>
        <div className="cardhead">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Mail size={17} style={{ color: 'var(--g)' }} />
            <h3>{t('profile_email_title')}</h3>
          </div>
          <span className={`tag ${emailInfo.verified ? 'green' : 'amber'}`} style={{ fontSize: '9px' }}>
            {emailInfo.verified ? t('profile_verified') : t('profile_unverified')}
          </span>
        </div>

        <p className="sub" style={{ fontSize: '11.5px', marginBottom: '14px', lineHeight: 1.45 }}>
          {t('profile_email_desc')}
        </p>

        <div className="row" style={{ marginBottom: '14px' }}>
          <div className="grow">
            <div className="rowtitle">{emailInfo.email || t('profile_no_email')}</div>
            <div className="rowsub">
              {emailInfo.verified
                ? t('profile_email_confirmed')
                : t('profile_email_send_hint')}
            </div>
          </div>
        </div>

        {emailFeedback && (
          <div
            style={{
              padding: '9px 12px',
              borderRadius: '9px',
              fontSize: '11.5px',
              marginBottom: '14px',
              background: emailFeedback.type === 'success' ? 'rgba(69, 224, 173, 0.12)' : 'rgba(255, 113, 128, 0.12)',
              border: `1px solid ${emailFeedback.type === 'success' ? 'rgba(69, 224, 173, 0.4)' : 'rgba(255, 113, 128, 0.4)'}`,
              color: emailFeedback.type === 'success' ? 'var(--g)' : 'var(--red)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            {emailFeedback.type === 'success' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
            <span>{emailFeedback.text}</span>
          </div>
        )}

        <form
          onSubmit={handleSaveEmail}
          id="profile-email-form"
          style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}
        >
          <input
            type="email"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            placeholder={emailInfo.email || t('profile_email_ph')}
            disabled={isSavingEmail}
            style={{
              flex: 1,
              minWidth: '200px',
              padding: '8px 10px',
              borderRadius: '8px',
              border: '1px solid var(--line)',
              background: '#091318',
              color: 'var(--text)',
              fontSize: '11.5px',
              outline: 'none'
            }}
            autoComplete="email"
            required
          />
          <button
            type="submit"
            className="btn alt"
            disabled={isSavingEmail}
            style={{ fontSize: '11.5px', padding: '8px 16px' }}
            id="profile-email-submit-btn"
          >
            <Mail size={13} />
            <span>{isSavingEmail ? t('profile_sending') : t('profile_save_verify')}</span>
          </button>
        </form>
      </div>

      {/* Account Security & Password Management */}
      <div className="section" style={{ fontSize: '14px', fontWeight: 800, marginBottom: '10px' }}>
        {t('profile_password_section')}
      </div>

      <div className="card" style={{ marginBottom: '20px' }}>
        <div className="cardhead">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <KeyRound size={17} style={{ color: 'var(--g)' }} />
            <h3>{t('profile_password_title')}</h3>
          </div>
          <span className="tag blue">{user?.role ? user.role.toUpperCase() : t('profile_role_trader')}</span>
        </div>

        <p className="sub" style={{ fontSize: '11.5px', marginBottom: '14px', lineHeight: 1.45 }}>
          {t('profile_password_desc')}
        </p>

        {passFeedback && (
          <div
            style={{
              padding: '9px 12px',
              borderRadius: '9px',
              fontSize: '11.5px',
              marginBottom: '14px',
              background: passFeedback.type === 'success' ? 'rgba(69, 224, 173, 0.12)' : 'rgba(255, 113, 128, 0.12)',
              border: `1px solid ${passFeedback.type === 'success' ? 'rgba(69, 224, 173, 0.4)' : 'rgba(255, 113, 128, 0.4)'}`,
              color: passFeedback.type === 'success' ? 'var(--g)' : 'var(--red)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            {passFeedback.type === 'success' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
            <span>{passFeedback.text}</span>
          </div>
        )}

        <form onSubmit={handleChangePassword} id="profile-change-password-form">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '14px' }}>
            <div>
              <label className="label" style={{ display: 'block' }}>{t('profile_current_password')}</label>
              <div style={{ position: 'relative' }}>
                <Lock size={14} style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--muted)' }} />
                <input
                  type={showOldPass ? 'text' : 'password'}
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  placeholder={t('profile_current_ph')}
                  style={{
                    width: '100%',
                    padding: '8px 32px 8px 30px',
                    borderRadius: '8px',
                    border: '1px solid var(--line)',
                    background: '#091318',
                    color: 'var(--text)',
                    fontSize: '11.5px',
                    outline: 'none'
                  }}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowOldPass(!showOldPass)}
                  style={{ position: 'absolute', right: '8px', top: '8px', background: 'none', border: 0, color: 'var(--muted)', cursor: 'pointer' }}
                >
                  {showOldPass ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <div>
              <label className="label" style={{ display: 'block' }}>{t('profile_new_password')}</label>
              <div style={{ position: 'relative' }}>
                <Lock size={14} style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--muted)' }} />
                <input
                  type={showNewPass ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t('profile_new_ph')}
                  style={{
                    width: '100%',
                    padding: '8px 32px 8px 30px',
                    borderRadius: '8px',
                    border: '1px solid var(--line)',
                    background: '#091318',
                    color: 'var(--text)',
                    fontSize: '11.5px',
                    outline: 'none'
                  }}
                  autoComplete="new-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowNewPass(!showNewPass)}
                  style={{ position: 'absolute', right: '8px', top: '8px', background: 'none', border: 0, color: 'var(--muted)', cursor: 'pointer' }}
                >
                  {showNewPass ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <div>
              <label className="label" style={{ display: 'block' }}>{t('profile_repeat_password')}</label>
              <div style={{ position: 'relative' }}>
                <Lock size={14} style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--muted)' }} />
                <input
                  type={showNewPass ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={t('profile_confirm_ph')}
                  style={{
                    width: '100%',
                    padding: '8px 10px 8px 30px',
                    borderRadius: '8px',
                    border: '1px solid var(--line)',
                    background: '#091318',
                    color: 'var(--text)',
                    fontSize: '11.5px',
                    outline: 'none'
                  }}
                  autoComplete="new-password"
                  required
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            className="btn alt"
            disabled={isChangingPass}
            style={{ fontSize: '11.5px', padding: '8px 16px' }}
            id="profile-change-password-btn"
          >
            <KeyRound size={13} />
            <span>{isChangingPass ? t('profile_updating') : t('profile_save_password')}</span>
          </button>
        </form>
      </div>

      {/* Preferences & Telemetry */}
      <div className="section" style={{ fontSize: '14px', fontWeight: 800, marginBottom: '10px' }}>
        {t('profile_system_section')}
      </div>

      <div className="card">
        {/* Telegram Test */}
        <div className="row">
          <div className="grow">
            <div className="rowtitle">{t('profile_telegram_title')}</div>
            <div className="rowsub">{t('profile_telegram_desc')}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              className="btn alt"
              onClick={onTestTelegram}
              disabled={isTestingTelegram}
              id="profile-test-telegram-btn"
            >
              <Send size={13} />
              <span>{isTestingTelegram ? t('profile_testing') : t('profile_test_alert')}</span>
            </button>
          </div>
        </div>
        {telegramStatusMsg && (
          <div style={{ padding: '8px 0', fontSize: '11px', color: telegramStatusMsg.type === 'success' ? 'var(--g)' : 'var(--amber)' }}>
            {telegramStatusMsg.text}
          </div>
        )}

        {/* Polling Interval */}
        <div className="row">
          <div className="grow">
            <div className="rowtitle">{t('profile_poll_title')}</div>
            <div className="rowsub">{t('profile_poll_desc')}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Clock size={13} style={{ color: 'var(--muted)' }} />
            <select
              value={pollInterval}
              onChange={(e) => onPollIntervalChange(Number(e.target.value))}
              style={{
                background: '#0b151b',
                border: '1px solid var(--line)',
                color: 'var(--text)',
                padding: '5px 8px',
                borderRadius: '8px',
                fontSize: '11px',
                outline: 'none'
              }}
              id="profile-poll-rate-select"
            >
              <option value={1000}>{t('profile_poll_1s')}</option>
              <option value={2000}>{t('profile_poll_2s')}</option>
              <option value={5000}>{t('profile_poll_5s')}</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
