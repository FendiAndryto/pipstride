import React, { useState } from 'react';
import {
  LogOut,
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
  Mail
} from 'lucide-react';
import { api, downloadPreset } from '../services/api';

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
  const metrics = bridgeStatus?.metrics || {};
  const isConnected = bridgeStatus?.is_connected || false;
  const terminalConnected = bridgeStatus?.terminal_connected || false;
  const server = metrics.server || 'MetaQuotes-Demo';
  const accountNumber = metrics.account_number || 0;
  const currency = metrics.currency || 'USD';

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
      setConnectionMsg({ type: 'error', text: err.message || 'Gagal memproses koneksi.' });
      return null;
    } finally {
      setIsBusy(false);
    }
  };

  const handleCreateConnection = async () => {
    const created = await runAction(
      () => api.createConnection(`Akun ${connections.length + 1}`),
      'Koneksi dibuat. Salin token di bawah dan tempelkan ke InpBridgeToken.'
    );
    if (created?.token) {
      setRevealedToken(created.token);
      setPresetFile(created.preset || null);
      if (onSelectConnection) onSelectConnection(created.id);
    }
  };

  const handleRotate = (connection) => {
    if (!window.confirm(
      `Rotasi token "${connection.label}"? Token lama langsung berhenti bekerja dan EA harus diperbarui.`
    )) {
      return;
    }
    runAction(async () => {
      const rotated = await api.rotateConnectionToken(connection.id);
      setRevealedToken(rotated.token);
      setPresetFile(rotated.preset || null);
      return rotated;
    }, 'Token baru dibuat. Salin sekarang — token hanya ditampilkan sekali.');
  };

  const handleRevoke = (connection) => {
    if (!window.confirm(
      `Hapus koneksi "${connection.label}"? Token-nya langsung tidak berlaku.`
    )) {
      return;
    }
    runAction(() => api.revokeConnection(connection.id), 'Koneksi dihapus.');
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
      setEmailFeedback({ type: 'error', text: 'Masukkan alamat email yang valid.' });
      return;
    }

    setIsSavingEmail(true);
    try {
      const res = await api.setEmail(value);
      setEmailInfo({ email: res.email, verified: Boolean(res.email_verified) });
      setEmailInput('');
      setEmailFeedback({
        type: 'success',
        text: res.message || 'Tautan verifikasi telah dikirim. Periksa inbox Anda.'
      });
      if (onRefreshUser) await onRefreshUser();
    } catch (err) {
      setEmailFeedback({ type: 'error', text: err.message || 'Gagal menyimpan email.' });
    } finally {
      setIsSavingEmail(false);
    }
  };

  return (
    <div className="profile-tab-container animate-fade-in" style={{ maxWidth: '850px', margin: '0 auto' }}>
      <div className="heading">
        <div>
          <div className="eyebrow">ACCOUNT & PREFERENCES</div>
          <h1>Profile & Connection Security</h1>
          <div className="sub">Kelola akun MT5 terhubung, token koneksi, dan keamanan akun Pipstride Anda.</div>
        </div>
        <button
          type="button"
          className="btn danger"
          onClick={onLogout}
          id="profile-logout-btn"
          title="Sign out of Pipstride"
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
            {user?.username ? user.username.slice(0, 2).toUpperCase() : 'PS'}
          </div>
          <div className="grow">
            <div style={{ fontSize: '15px', fontWeight: 800 }}>{user?.username || 'Trader'}</div>
            <div className="sub" style={{ fontSize: '11px' }}>
              {user?.role === 'admin' ? 'Administrator' : 'Trader'} Account · Pipstride Journal v1.0
            </div>
          </div>
          <span className="tag">{user?.role ? user.role.toUpperCase() : 'ACTIVE'}</span>
        </div>
      </div>

      {/* MT5 Connections */}
      <div className="section" style={{ fontSize: '14px', fontWeight: 800, marginBottom: '10px' }}>
        Koneksi MT5 Terhubung
      </div>

      <div className="card" style={{ marginBottom: '20px' }}>
        <div className="cardhead">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Wallet size={17} style={{ color: 'var(--g)' }} />
            <h3>Akun & Token Koneksi</h3>
          </div>
          <span className="tag green">{connections.length} AKUN</span>
        </div>

        <p className="sub" style={{ fontSize: '11.5px', marginBottom: '14px', lineHeight: 1.45 }}>
          Setiap akun MT5 punya token sendiri dan terikat permanen ke nomor akun yang pertama kali melapor.
          Token hanya ditampilkan sekali, baik saat dibuat maupun dirotasi.
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
            Belum ada akun MT5. Buat koneksi pertama untuk mendapatkan token.
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
                    title="Jadikan akun aktif"
                  >
                    <div style={{ fontSize: '12px', fontWeight: 700 }}>
                      {connection.label} {isActive ? '· aktif' : ''}
                    </div>
                    <div style={{ fontSize: '10.5px', color: '#8899a6', fontFamily: 'monospace' }}>
                      {connection.account_number ? `#${connection.account_number}` : 'belum terhubung'} ·{' '}
                      {connection.broker_server || 'server -'} · {connection.token_prefix}…
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
                    title="Rotasi token"
                    style={{ padding: '5px 7px' }}
                  >
                    <RotateCw size={13} />
                  </button>
                  <button
                    type="button"
                    className="btn alt"
                    onClick={() => handleRevoke(connection)}
                    disabled={isBusy}
                    title="Hapus koneksi"
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
              <span>{copiedToken ? 'Tersalin' : 'Copy'}</span>
            </button>
            <button
              type="button"
              className="btn alt"
              onClick={() => downloadPreset(presetFile)}
              disabled={!presetFile}
              title="Preset .set sudah terisi URL backend dan token koneksi ini"
              style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Download size={14} />
              <span>Preset</span>
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
            <span>Tambah Akun MT5</span>
          </button>
          <button
            type="button"
            className="btn alt"
            onClick={onOpenMt5Modal}
            style={{ padding: '7px 12px', fontSize: '11px' }}
            id="profile-open-mt5-screen-btn"
            title="Panduan koneksi MT5"
          >
            <Monitor size={13} />
            <span>Panduan Koneksi MT5</span>
          </button>
        </div>
      </div>

      {/* Active Account Telemetry */}
      <div className="section" style={{ fontSize: '14px', fontWeight: 800, marginBottom: '10px' }}>
        Akun Aktif
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
          </div>
        </div>
      </div>

      {/* Passive Risk Watchdog */}
      <div className="section" style={{ fontSize: '14px', fontWeight: 800, marginBottom: '10px' }}>
        Risk Watchdog (Read-Only)
      </div>

      <div className="card" style={{ marginBottom: '20px' }}>
        <div className="cardhead">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShieldCheck size={18} style={{ color: isRiskAlert ? 'var(--amber)' : 'var(--g)' }} />
            <h3>Drawdown Monitor</h3>
          </div>
          <span className="tag">
            {dailyDrawdownPercent.toFixed(2)}% (Monitoring Pasif)
          </span>
        </div>

        <p className="sub" style={{ fontSize: '11.5px', marginBottom: '12px', lineHeight: 1.45 }}>
          Pipstride hanya <b>memantau</b> drawdown ekuitas terhadap baseline deposit. Platform tidak pernah menutup
          posisi, mengunci order, atau mengirim perintah eksekusi ke MT5 — peringatan hanya informatif.
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
          <span>Baseline deposit: {formatCurrency(bridgeStatus?.initial_deposit, currency)}</span>
          <span>Margin level: {marginLevel ? `${marginLevel.toFixed(1)}%` : '—'}</span>
        </div>
      </div>

      {/* Account Email & Recovery */}
      <div className="section" style={{ fontSize: '14px', fontWeight: 800, marginBottom: '10px' }}>
        Email & Pemulihan Akun
      </div>

      <div className="card" style={{ marginBottom: '20px' }}>
        <div className="cardhead">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Mail size={17} style={{ color: 'var(--g)' }} />
            <h3>Email Akun</h3>
          </div>
          <span className={`tag ${emailInfo.verified ? 'green' : 'amber'}`} style={{ fontSize: '9px' }}>
            {emailInfo.verified ? 'TERVERIFIKASI' : 'BELUM TERVERIFIKASI'}
          </span>
        </div>

        <p className="sub" style={{ fontSize: '11.5px', marginBottom: '14px', lineHeight: 1.45 }}>
          Email dipakai untuk reset password jika Anda lupa kata sandi. Jurnal tetap berfungsi tanpa email,
          tetapi tidak ada jalur pemulihan mandiri. Mengganti alamat akan membatalkan verifikasi lama.
        </p>

        <div className="row" style={{ marginBottom: '14px' }}>
          <div className="grow">
            <div className="rowtitle">{emailInfo.email || 'Belum ada email terdaftar'}</div>
            <div className="rowsub">
              {emailInfo.verified
                ? 'Alamat sudah dikonfirmasi dan siap dipakai untuk pemulihan.'
                : 'Kirim tautan verifikasi untuk mengaktifkan pemulihan akun.'}
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
            placeholder={emailInfo.email || 'nama@email.com'}
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
            <span>{isSavingEmail ? 'Mengirim...' : 'Simpan & Kirim Verifikasi'}</span>
          </button>
        </form>
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
