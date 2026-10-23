import React, { useEffect, useState } from 'react';
import {
  X,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Laptop,
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

const TOKEN_NOTE =
  'Token ditampilkan satu kali saja. Salin sekarang dan tempelkan ke input InpBridgeToken di MT5. ' +
  'Server hanya menyimpan hash-nya, jadi token tidak bisa ditampilkan ulang.';

export default function Mt5ConnectModal({
  isOpen,
  onClose,
  isConnected,
  accountNumber,
  connections = [],
  connectionsLoaded = false,
  activeConnectionId,
  onSelectConnection,
  onConnectionsChanged,
  onCheckStatus
}) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [revealedToken, setRevealedToken] = useState('');
  const [presetFile, setPresetFile] = useState(null);
  const [copiedToken, setCopiedToken] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');
  const [newLabel, setNewLabel] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setRevealedToken('');
      setPresetFile(null);
      setError('');
      setNewLabel('');
      setCopiedToken(false);
    }
  }, [isOpen]);

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
      setError(err.message || 'Terjadi kesalahan.');
      return null;
    } finally {
      setIsBusy(false);
    }
  };

  const handleCreate = () =>
    runAction(async () => {
      const created = await api.createConnection(newLabel.trim() || 'Akun MT5');
      setRevealedToken(created.token);
      setPresetFile(created.preset || null);
      setNewLabel('');
      if (onSelectConnection) onSelectConnection(created.id);
      return created;
    });

  const handleRotate = (connection) => {
    if (!window.confirm(
      `Rotasi token "${connection.label}"? Token lama langsung berhenti bekerja dan EA harus diperbarui.`
    )) {
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
    if (!window.confirm(
      `Hapus koneksi "${connection.label}"? Token-nya langsung tidak berlaku dan data live dihentikan.`
    )) {
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
              <Laptop size={22} style={{ color: '#45e0ad' }} />
            </div>
            <div>
              <h3 className="mt5-modal-title">KONEKSI MT5 TELEMETRY MONITOR</h3>
              <span className="mt5-modal-subtitle">Pure Read-Only Telemetry (100% Aman & Bebas Risiko Eksekusi)</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="btn-modal-close"
            id="close-mt5-connect-modal-btn"
            title="Tutup Modal"
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
                Status Bridge: {isConnected ? 'MT5 LOKAL TERHUBUNG (ONLINE)' : 'MENUNGGU KONEKSI MT5 LOKAL'}
              </span>
            </div>
            {isConnected && accountNumber ? (
              <span style={{ fontSize: '0.8rem', opacity: 0.9, fontFamily: 'monospace' }}>
                Akun #{accountNumber}
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
              <span>Privat & Terisolasi Penuh:</span>
            </div>
            <div style={{ color: 'var(--text-main, #e2e8f0)', lineHeight: 1.4 }}>
              Satu token hanya terikat ke satu akun MT5. Token pertama kali yang terhubung akan mengunci nomor akun
              tersebut, sehingga token yang bocor tidak bisa dipakai untuk mengirim data akun lain.
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
                AKUN MT5 TERHUBUNG ({connections.length})
              </span>
              <button
                type="button"
                className="btn alt"
                onClick={handleCreate}
                disabled={isBusy}
                style={{ fontSize: '11px', padding: '6px 10px', display: 'flex', alignItems: 'center', gap: '5px' }}
              >
                <Plus size={13} />
                <span>Tambah Akun</span>
              </button>
            </div>

            {!connectionsLoaded ? (
              <span style={{ fontSize: '11px', color: '#8899a6' }}>Memuat koneksi...</span>
            ) : connections.length === 0 ? (
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="Nama akun, cth: Akun Utama"
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
                  Buat Token
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
                        title="Jadikan akun aktif"
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
                          {connection.label} {isActive ? '· aktif' : ''}
                        </div>
                        <div style={{ fontSize: '10.5px', color: '#8899a6', fontFamily: 'monospace' }}>
                          {connection.account_number ? `#${connection.account_number}` : 'belum terhubung'} ·{' '}
                          {connection.broker_server || 'server -'} · {connection.token_prefix}…
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

                <div style={{ display: 'flex', gap: '8px', marginTop: '2px' }}>
                  <input
                    type="text"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder="Nama akun baru"
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
                    Tambah
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
                Token Koneksi (Wajib Diinput ke EA):
              </span>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                readOnly
                value={revealedToken || ''}
                placeholder={connections.length ? 'Buat atau rotasi token untuk menampilkannya' : 'pst_live_...'}
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
                <span>{copiedToken ? 'Tersalin' : 'Copy'}</span>
              </button>
            </div>
            <span style={{ fontSize: '10px', color: revealedToken ? '#ffd28a' : '#8899a6' }}>
              {TOKEN_NOTE}
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
                <span>Download File EA MT5:</span>
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
                title="Download PipstrideMonitor.mq5 untuk MT5"
              >
                <Download size={14} />
                <span>Download PipstrideMonitor (.mq5)</span>
              </a>

              <button
                type="button"
                className="btn alt"
                onClick={() => downloadPreset(presetFile)}
                disabled={!presetFile}
                id="btn-download-monitor-preset"
                title={
                  presetFile
                    ? 'Preset berisi URL backend dan token koneksi ini'
                    : 'Preset dibuat saat token dibuat atau dirotasi'
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
                <span>Download Preset (.set)</span>
              </button>
            </div>
            <span style={{ fontSize: '10px', color: '#8899a6', lineHeight: 1.4 }}>
              Preset sudah terisi <code>InpBackendUrl</code>, <code>InpBridgeToken</code>, dan daftar simbol. Di MT5 buka
              tab <em>Inputs</em> lalu klik <strong>Load</strong> untuk memuat file ini.
            </span>
          </div>

          {/* Target Backend Endpoint */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 600 }}>
              URL Target Backend untuk PipstrideMonitor:
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
                {copiedUrl ? <Check size={14} style={{ color: '#45e0ad' }} /> : 'Copy'}
              </button>
            </div>
          </div>

          {/* 3 Steps */}
          <div className="mt5-steps-container">
            <h4 className="mt5-steps-title">
              Cara Menghubungkan PipstrideMonitor di MT5 Laptop:
            </h4>

            <div className="mt5-step-card">
              <div className="mt5-step-number">1</div>
              <div className="mt5-step-content">
                <strong>Buat Token & Download EA</strong>
                <p>
                  Klik <strong>Tambah Akun</strong> di atas lalu salin token yang muncul. Setelah itu klik tombol
                  <strong> Download PipstrideMonitor</strong> dan <strong>Download Preset (.set)</strong>. Buka terminal
                  MT5 Anda: menu <strong>File &gt; Open Data Folder</strong>, lalu masuk ke <strong>MQL5 &gt; Experts</strong>{' '}
                  dan tempelkan file EA-nya. Simpan file <code>.set</code> di folder <strong>MQL5 &gt; Presets</strong>.
                </p>
              </div>
            </div>

            <div className="mt5-step-card">
              <div className="mt5-step-number">2</div>
              <div className="mt5-step-content">
                <strong>Whitelist URL di MT5</strong>
                <p>
                  Buka menu MT5: <strong>Tools &gt; Options &gt; Expert Advisors</strong>. Centang <strong>Allow WebRequest
                  for listed URL</strong> dan tambahkan: <code>{bridgeUrl}</code>.
                </p>
              </div>
            </div>

            <div className="mt5-step-card">
              <div className="mt5-step-number">3</div>
              <div className="mt5-step-content">
                <strong>Pasang PipstrideMonitor pada Chart & Masukkan Token</strong>
                <p>
                  Drag <code>PipstrideMonitor.mq5</code> (atau hasil compile <code>.ex5</code>) ke chart aktif. Pada tab
                  <em> Inputs</em>, isi <code>InpBridgeToken</code> dengan token tadi. Pada tab <em>Common</em>, centang
                  <strong> Allow Algo Trading</strong>. EA ini 100% Read-Only (telemetri) tanpa izin eksekusi order
                  sehingga aman dipakai berdampingan dengan EA trading lain milik Anda.
                </p>
              </div>
            </div>
          </div>

          <p className="mt5-success-note">
            Status di dashboard akan otomatis menyala <strong>CONNECTED (HIJAU)</strong> dan menampilkan saldo, posisi
            aktif, dan riwayat secara langsung dan privat hanya untuk akun Anda.
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
            <span>{isRefreshing ? 'Memeriksa...' : 'Cek Status Sekarang'}</span>
          </button>
          <button
            type="button"
            className="btn"
            onClick={onClose}
            id="close-mt5-modal-action-btn"
          >
            <span>Tutup</span>
          </button>
        </div>
      </div>
    </div>
  );
}
