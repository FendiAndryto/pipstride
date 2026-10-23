import React, { useState, useEffect } from 'react';
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
  Bot
} from 'lucide-react';
import { api } from '../services/api';

export default function Mt5ConnectModal({
  isOpen,
  onClose,
  isConnected,
  accountNumber,
  onCheckStatus
}) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [bridgeToken, setBridgeToken] = useState('');
  const [copiedToken, setCopiedToken] = useState(false);
  const [tokenLoading, setTokenLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setTokenLoading(true);
      api.getBridgeToken()
        .then(data => {
          if (data?.bridge_token) {
            setBridgeToken(data.bridge_token);
          }
        })
        .catch(() => {})
        .finally(() => setTokenLoading(false));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const bridgeUrl = typeof window !== 'undefined' ? window.location.origin : 'https://staging-trade-gear.homever.my.id';

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      if (onCheckStatus) {
        await onCheckStatus();
      }
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
    if (!bridgeToken) return;
    navigator.clipboard.writeText(bridgeToken);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
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
          <div
            className={`mt5-status-banner ${isConnected ? 'connected' : 'disconnected'}`}
          >
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
              Koneksi MT5 Anda diikat secara eksklusif menggunakan Connection Token pribadi Anda. Akun pengguna lain yang login di Pipstride tidak akan pernah bisa melihat atau mengakses saldo dan trading MT5 Anda.
            </div>
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
            </div>
          </div>

          {/* Bridge Token Box */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <KeyRound size={13} style={{ color: '#45e0ad' }} />
              <span style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 600 }}>
                Bridge Token Pribadi Anda (Wajib Diinput di EA):
              </span>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                readOnly
                value={tokenLoading ? 'Memuat token...' : bridgeToken}
                placeholder="tg_live_..."
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
                disabled={!bridgeToken}
                style={{ fontSize: '11px', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '5px' }}
              >
                {copiedToken ? <Check size={14} style={{ color: '#45e0ad' }} /> : <Copy size={14} />}
                <span>{copiedToken ? 'Tersalin' : 'Copy'}</span>
              </button>
            </div>
            <span style={{ fontSize: '10px', color: '#8899a6' }}>
              Rahasiakan token ini. Token ini mengidentifikasi MT5 laptop Anda ke akun Pipstride Anda.
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
                <strong>Download & Pasang File EA ke MT5</strong>
                <p>
                  Klik tombol <strong>Download PipstrideMonitor</strong> di atas. Buka terminal MT5 Anda: klik menu <strong>File &gt; Open Data Folder</strong>, lalu masuk ke folder <strong>MQL5 &gt; Experts</strong> dan tempelkan file tersebut di sana.
                </p>
              </div>
            </div>

            <div className="mt5-step-card">
              <div className="mt5-step-number">2</div>
              <div className="mt5-step-content">
                <strong>Whitelist URL di MT5</strong>
                <p>
                  Buka menu MT5: <strong>Tools &gt; Options &gt; Expert Advisors</strong>. Centang <strong>Allow WebRequest for listed URL</strong> dan tambahkan: <code>{bridgeUrl}</code>.
                </p>
              </div>
            </div>

            <div className="mt5-step-card">
              <div className="mt5-step-number">3</div>
              <div className="mt5-step-content">
                <strong>Pasang PipstrideMonitor pada Chart & Masukkan Token</strong>
                <p>
                  Drag <code>PipstrideMonitor.mq5</code> (atau hasil compile <code>.ex5</code>) ke chart aktif (cth: XAUUSD M15). Pada tab <em>Inputs</em>, isi parameter <code>InpBridgeToken</code> dengan token pribadi Anda di atas. Pada tab <em>Common</em>, centang <strong>Allow Algo Trading</strong>. EA ini 100% Read-Only (telemetri) tanpa izin eksekusi order sehingga aman dipakai berdampingan dengan EA trading lain milik Anda.
                </p>
              </div>
            </div>
          </div>

          <p className="mt5-success-note">
            💡 Status di dashboard ini akan otomatis menyala <strong>CONNECTED (HIJAU)</strong> dan menampilkan saldo, posisi aktif, dan riwayat secara langsung dan privat hanya untuk akun Anda.
          </p>
        </div>

        {/* Modal Footer */}
        <div className="mt5-modal-footer">
          <button
            type="button"
            className="btn alt"
            onClick={handleRefresh}
            disabled={isRefreshing}
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
