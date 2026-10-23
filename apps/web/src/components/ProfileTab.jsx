import React, { useState, useEffect } from 'react';
import {
  LogOut,
  ShieldAlert,
  ShieldCheck,
  Monitor,
  Send,
  RotateCcw,
  Clock,
  KeyRound,
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  RefreshCw
} from 'lucide-react';
import { api } from '../services/api';

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
  onLogout,
  bridgeStatus,
  autopilotStatus,
  pollInterval,
  onPollIntervalChange,
  onOpenMt5Modal,
  onResetDrawdown,
  isResettingDrawdown,
  onTestTelegram,
  isTestingTelegram,
  telegramStatusMsg
}) {
  const metrics = bridgeStatus?.metrics || {};
  const isConnected = bridgeStatus?.is_connected || false;
  const terminalConnected = bridgeStatus?.terminal_connected || false;
  const server = metrics.server || 'MetaQuotes-Demo';
  const accountNumber = metrics.account_number || 0;
  const currency = metrics.currency || 'USD';

  // Drawdown Guard metrics
  const dailyDrawdownPercent = autopilotStatus?.daily_drawdown_percent ?? 0;
  const maxDrawdownPercent = autopilotStatus?.max_daily_drawdown_percent ?? 3.0;
  const isDrawdownLocked = autopilotStatus?.is_drawdown_lockout_active ?? false;
  const startingEquity = autopilotStatus?.starting_equity ?? metrics.equity ?? 10000;
  const limitUsed = maxDrawdownPercent > 0 ? Math.min(100, (dailyDrawdownPercent / maxDrawdownPercent) * 100) : 0;

  // Bridge Token state
  const [bridgeToken, setBridgeToken] = useState(user?.bridge_token || '');
  const [showToken, setShowToken] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [isRegeneratingToken, setIsRegeneratingToken] = useState(false);
  const [tokenMsg, setTokenMsg] = useState(null);

  useEffect(() => {
    if (!bridgeToken) {
      api.getBridgeToken()
        .then(data => {
          if (data?.bridge_token) {
            setBridgeToken(data.bridge_token);
          }
        })
        .catch(() => {});
    }
  }, [bridgeToken]);

  const handleCopyToken = () => {
    if (!bridgeToken) return;
    navigator.clipboard.writeText(bridgeToken);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  const handleRegenerateToken = async () => {
    const confirmed = window.confirm(
      'Peringatan: Membuat Bridge Token baru akan membatalkan token lama seketika. ' +
      'Terminal MT5 yang sedang terhubung akan terputus hingga Anda memasukkan token baru di EA. Lanjutkan?'
    );
    if (!confirmed) return;

    setIsRegeneratingToken(true);
    setTokenMsg(null);
    try {
      const data = await api.regenerateBridgeToken();
      if (data?.bridge_token) {
        setBridgeToken(data.bridge_token);
        setTokenMsg({ type: 'success', text: 'Bridge Token baru berhasil dibuat! Masukkan ke input InpBridgeToken di MT5 EA Anda.' });
      }
    } catch (err) {
      setTokenMsg({ type: 'error', text: err.message || 'Gagal membuat token baru.' });
    } finally {
      setIsRegeneratingToken(false);
    }
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
      setPassFeedback({ type: 'error', text: 'Mohon isi password lama dan password baru.' });
      return;
    }

    if (newPassword.length < 8) {
      setPassFeedback({ type: 'error', text: 'Password baru minimal 8 karakter.' });
      return;
    }

    if (!/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setPassFeedback({ type: 'error', text: 'Password baru wajib berisi kombinasi huruf dan angka.' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPassFeedback({ type: 'error', text: 'Konfirmasi password baru tidak cocok.' });
      return;
    }

    setIsChangingPass(true);
    try {
      const res = await api.changePassword(oldPassword, newPassword);
      setPassFeedback({
        type: 'success',
        text: res.message || 'Password berhasil diperbarui! Seluruh sesi aktif lama telah dicabut demi keamanan.'
      });
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPassFeedback({ type: 'error', text: err.message || 'Gagal mengubah password.' });
    } finally {
      setIsChangingPass(false);
    }
  };

  return (
    <div className="profile-tab-container animate-fade-in" style={{ maxWidth: '850px', margin: '0 auto' }}>
      <div className="heading">
        <div>
          <div className="eyebrow">ACCOUNT & PREFERENCES</div>
          <h1>Profile & Engine Security</h1>
          <div className="sub">Kelola koneksi privat MT5, kredensial Bridge, batas drawdown, dan akun.</div>
        </div>
        <button
          type="button"
          className="btn danger"
          onClick={onLogout}
          id="profile-logout-btn"
          title="Sign out of TradeGear"
        >
          <LogOut size={14} />
          <span>Keluar</span>
        </button>
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
            {user?.username ? user.username.slice(0, 2).toUpperCase() : 'TG'}
          </div>
          <div className="grow">
            <div style={{ fontSize: '15px', fontWeight: 800 }}>{user?.username || 'Trader'}</div>
            <div className="sub" style={{ fontSize: '11px' }}>
              {user?.role === 'admin' ? 'Administrator' : 'Trader'} Account · TradeGear Engine v1.0
            </div>
          </div>
          <span className="tag">{user?.role ? user.role.toUpperCase() : 'ACTIVE'}</span>
        </div>
      </div>

      {/* Bridge MT5 Private Credentials */}
      <div className="section" style={{ fontSize: '14px', fontWeight: 800, marginBottom: '10px' }}>
        Kredensial Bridge MT5 Pribadi
      </div>

      <div className="card" style={{ marginBottom: '20px' }}>
        <div className="cardhead">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <KeyRound size={17} style={{ color: 'var(--g)' }} />
            <h3>Bridge Token Pribadi (InpBridgeToken)</h3>
          </div>
          <span className="tag green">PRIVATE ACCESS</span>
        </div>

        <p className="sub" style={{ fontSize: '11.5px', marginBottom: '14px', lineHeight: 1.45 }}>
          Token ini memastikan terminal MT5 di laptop Anda terhubung secara eksklusif ke akun Anda. Pengguna lain tidak akan dapat melihat saldo atau order Anda.
        </p>

        {tokenMsg && (
          <div
            style={{
              padding: '9px 12px',
              borderRadius: '9px',
              fontSize: '11.5px',
              marginBottom: '14px',
              background: tokenMsg.type === 'success' ? 'rgba(69, 224, 173, 0.12)' : 'rgba(255, 113, 128, 0.12)',
              border: `1px solid ${tokenMsg.type === 'success' ? 'rgba(69, 224, 173, 0.4)' : 'rgba(255, 113, 128, 0.4)'}`,
              color: tokenMsg.type === 'success' ? 'var(--g)' : 'var(--red)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            {tokenMsg.type === 'success' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
            <span>{tokenMsg.text}</span>
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          <input
            type={showToken ? 'text' : 'password'}
            readOnly
            value={bridgeToken || 'Memuat token...'}
            style={{
              flex: 1,
              background: '#0a1419',
              border: '1px solid rgba(69, 224, 173, 0.35)',
              borderRadius: '8px',
              color: '#45e0ad',
              fontFamily: 'monospace',
              fontSize: '12px',
              fontWeight: 600,
              padding: '9px 12px',
              letterSpacing: showToken ? 'normal' : '2px'
            }}
          />
          <button
            type="button"
            className="btn alt"
            onClick={() => setShowToken(!showToken)}
            style={{ padding: '8px 12px' }}
            title={showToken ? 'Sembunyikan Token' : 'Tampilkan Token'}
          >
            {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button
            type="button"
            className="btn alt"
            onClick={handleCopyToken}
            disabled={!bridgeToken}
            style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            {copiedToken ? <Check size={14} style={{ color: '#45e0ad' }} /> : <Copy size={14} />}
            <span>{copiedToken ? 'Tersalin' : 'Copy'}</span>
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn alt"
            onClick={handleRegenerateToken}
            disabled={isRegeneratingToken}
            style={{ fontSize: '11px', padding: '6px 12px', color: '#ffb366' }}
            title="Generate ulang token jika dicurigai bocor"
          >
            <RefreshCw size={12} className={isRegeneratingToken ? 'animate-spin' : ''} />
            <span>{isRegeneratingToken ? 'Generating...' : 'Regenerate Token Baru'}</span>
          </button>
        </div>
      </div>

      {/* Account Security & Password Management */}
      <div className="section" style={{ fontSize: '14px', fontWeight: 800, marginBottom: '10px' }}>
        Keamanan Akun & Password
      </div>

      <div className="card" style={{ marginBottom: '20px' }}>
        <div className="cardhead">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <KeyRound size={17} style={{ color: 'var(--g)' }} />
            <h3>Ganti Password Akun</h3>
          </div>
          <span className="tag blue">{user?.role ? user.role.toUpperCase() : 'TRADER'}</span>
        </div>

        <p className="sub" style={{ fontSize: '11.5px', marginBottom: '14px', lineHeight: 1.45 }}>
          Perbarui kata sandi akun Anda (minimal 8 karakter dengan kombinasi huruf dan angka). Mengganti password akan otomatis mencabut seluruh sesi login lama di perangkat lain.
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
              <label className="label" style={{ display: 'block' }}>Password Saat Ini</label>
              <div style={{ position: 'relative' }}>
                <Lock size={14} style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--muted)' }} />
                <input
                  type={showOldPass ? 'text' : 'password'}
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  placeholder="Password saat ini"
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
              <label className="label" style={{ display: 'block' }}>Password Baru (Min 8 Karakter)</label>
              <div style={{ position: 'relative' }}>
                <Lock size={14} style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--muted)' }} />
                <input
                  type={showNewPass ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min 8 karakter alfanumerik"
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
              <label className="label" style={{ display: 'block' }}>Ulangi Password Baru</label>
              <div style={{ position: 'relative' }}>
                <Lock size={14} style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--muted)' }} />
                <input
                  type={showNewPass ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Konfirmasi password baru"
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
            <span>{isChangingPass ? 'Memperbarui...' : 'Simpan Password Baru'}</span>
          </button>
        </form>
      </div>

      {/* Connected Accounts */}
      <div className="section" style={{ fontSize: '14px', fontWeight: 800, marginBottom: '10px' }}>
        Connected MT5 Accounts
      </div>

      <div className="card" style={{ marginBottom: '20px' }}>
        <div className="row">
          <div className="coin">MT</div>
          <div className="grow">
            <div className="rowtitle">{server}</div>
            <div className="rowsub">
              Login #{accountNumber || 'Offline'} · MT5 Direct Laptop Bridge
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className={`tag ${isConnected ? '' : 'red'}`} title="FastAPI to MT5 Bridge Telemetry">
              {isConnected ? 'BRIDGE LIVE' : 'BRIDGE OFFLINE'}
            </span>
            <span className={`tag ${terminalConnected ? '' : 'red'}`} title="MT5 Terminal to Broker Server Connection">
              {terminalConnected ? 'BROKER ONLINE' : 'BROKER OFFLINE'}
            </span>
            <button
              type="button"
              className="btn alt"
              style={{ padding: '6px 10px', fontSize: '11px' }}
              onClick={onOpenMt5Modal}
              id="profile-open-mt5-screen-btn"
              title="Buka Layar MT5 GUI"
            >
              <Monitor size={13} />
              <span>Panduan Koneksi MT5</span>
            </button>
          </div>
        </div>
      </div>

      {/* Daily Drawdown Guard Progress */}
      <div className="section" style={{ fontSize: '14px', fontWeight: 800, marginBottom: '10px' }}>
        Daily Drawdown Guard & Safeguards
      </div>

      <div className="card" style={{ marginBottom: '20px' }}>
        <div className="cardhead">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {isDrawdownLocked ? (
              <ShieldAlert size={18} style={{ color: 'var(--red)' }} />
            ) : (
              <ShieldCheck size={18} style={{ color: 'var(--g)' }} />
            )}
            <h3>Drawdown Protection Limit</h3>
          </div>
          <span className={`tag ${isDrawdownLocked ? 'red' : limitUsed > 70 ? 'amber' : ''}`}>
            {isDrawdownLocked ? 'LOCKED OUT' : `${dailyDrawdownPercent.toFixed(2)}% / ${maxDrawdownPercent}%`}
          </span>
        </div>

        <p className="sub" style={{ fontSize: '11.5px', marginBottom: '12px', lineHeight: 1.45 }}>
          Melindungi modal dari penurunan ekuitas beruntun. Jika drawdown hari ini menyentuh{' '}
          <b>{maxDrawdownPercent}%</b>, seluruh order baru dan AutoPilot akan otomatis dikunci hingga batas direset.
        </p>

        {/* Drawdown Progress Bar */}
        <div style={{ background: '#0a1419', height: '8px', borderRadius: '99px', overflow: 'hidden', marginBottom: '8px', border: '1px solid var(--line)' }}>
          <div
            style={{
              width: `${Math.min(100, Math.max(0, limitUsed))}%`,
              height: '100%',
              background: isDrawdownLocked || limitUsed > 75 ? 'var(--red)' : limitUsed > 40 ? 'var(--amber)' : 'var(--g)',
              borderRadius: '99px',
              transition: 'width 0.4s ease'
            }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--muted)', marginBottom: '14px' }}>
          <span>Starting Baseline: {formatCurrency(startingEquity, currency)}</span>
          <span>Buffer: {Math.max(0, maxDrawdownPercent - dailyDrawdownPercent).toFixed(2)}%</span>
        </div>

        <div className="btns">
          <button
            type="button"
            className="btn alt"
            onClick={() => onResetDrawdown(metrics.equity)}
            disabled={isResettingDrawdown}
            id="profile-reset-drawdown-btn"
          >
            <RotateCcw size={13} />
            <span>{isResettingDrawdown ? 'Resetting...' : 'Reset Baseline Equity Sekarang'}</span>
          </button>
        </div>
      </div>

      {/* Preferences & Telemetry */}
      <div className="section" style={{ fontSize: '14px', fontWeight: 800, marginBottom: '10px' }}>
        Sistem & Notifikasi Telegram
      </div>

      <div className="card">
        {/* Telegram Test */}
        <div className="row">
          <div className="grow">
            <div className="rowtitle">Telegram Alert Push</div>
            <div className="rowsub">Kirim pesan uji coba ke bot Telegram untuk verifikasi alert real-time.</div>
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
              <span>{isTestingTelegram ? 'Sending...' : 'Test Alert'}</span>
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
            <div className="rowtitle">Refresh Rate Telemetri MT5</div>
            <div className="rowsub">Frekuensi polling live balance, equity, dan open positions.</div>
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
              <option value={1000}>1 detik (Real-time)</option>
              <option value={2000}>2 detik</option>
              <option value={5000}>5 detik</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
