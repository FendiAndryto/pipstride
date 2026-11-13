import React, { useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { formatExpiryStatus, formatDateTime } from '../../domain/format';
import { extendUserExpiry } from './api';
import { AlertCircle, Clock, CheckCircle2 } from 'lucide-react';

const PRESET_DURATIONS = [
  { id: '7d', label: '+7 Hari', days: 7 },
  { id: '30d', label: '+30 Hari (1 Bulan)', days: 30 },
  { id: '90d', label: '+90 Hari (3 Bulan)', days: 90 },
  { id: '365d', label: '+365 Hari (1 Tahun)', days: 365 },
];

export function UserExtendExpiryModal({
  isOpen,
  onClose,
  user,
  onSuccess,
}) {
  const [mode, setMode] = useState('preset'); // 'preset' | 'custom' | 'exact' | 'lifetime'
  const [selectedPresetDays, setSelectedPresetDays] = useState(30);
  const [customDays, setCustomDays] = useState('30');
  const [exactDate, setExactDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!user) return null;

  const currentStatus = formatExpiryStatus(user.expires_at, user.is_active, user.is_expired);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    let payload = {};

    if (mode === 'lifetime') {
      payload = { set_lifetime: true };
    } else if (mode === 'preset') {
      payload = { duration_days: selectedPresetDays };
    } else if (mode === 'custom') {
      const days = parseInt(customDays, 10);
      if (Number.isNaN(days) || days < 1) {
        setError('Jumlah hari harus berupa angka positif minimal 1.');
        return;
      }
      payload = { duration_days: days };
    } else if (mode === 'exact') {
      if (!exactDate) {
        setError('Silakan pilih tanggal kedaluwarsa.');
        return;
      }
      // Create UTC timezone-aware ISO-8601 at end of day 23:59:59Z
      const parsed = new Date(`${exactDate}T23:59:59Z`);
      if (Number.isNaN(parsed.getTime())) {
        setError('Format tanggal tidak valid.');
        return;
      }
      payload = { exact_expires_at: parsed.toISOString() };
    }

    setLoading(true);

    try {
      const updated = await extendUserExpiry(user.id, payload);
      onSuccess(updated);
      onClose();
    } catch (err) {
      setError(err.message || 'Gagal memperbarui masa aktif pengguna.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Atur Masa Aktif: ${user.username}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Batal
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            loading={loading}
            icon={Clock}
          >
            Simpan Perubahan
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {error ? (
          <div className="alert alert-danger" role="alert">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        ) : null}

        {/* Current status display */}
        <div
          style={{
            padding: '12px',
            background: 'var(--bg-card-subtle)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '6px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Status Masa Aktif Saat Ini
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Badge variant={currentStatus.variant}>{currentStatus.label}</Badge>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              {user.expires_at ? formatDateTime(user.expires_at) : 'Masa aktif permanen'}
            </span>
          </div>
        </div>

        {/* Action mode selector */}
        <div className="form-group">
          <label className="form-label">Metode Perpanjangan</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
            <button
              type="button"
              className={`btn btn-sm ${mode === 'preset' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setMode('preset')}
              style={{ justifyContent: 'center' }}
            >
              Preset Durasi
            </button>
            <button
              type="button"
              className={`btn btn-sm ${mode === 'custom' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setMode('custom')}
              style={{ justifyContent: 'center' }}
            >
              Kustom Hari
            </button>
            <button
              type="button"
              className={`btn btn-sm ${mode === 'exact' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setMode('exact')}
              style={{ justifyContent: 'center' }}
            >
              Atur Tanggal Tertentu
            </button>
            <button
              type="button"
              className={`btn btn-sm ${mode === 'lifetime' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setMode('lifetime')}
              style={{ justifyContent: 'center' }}
            >
              Permanen (Lifetime)
            </button>
          </div>
        </div>

        {/* Mode: Preset */}
        {mode === 'preset' && (
          <div className="form-group">
            <label className="form-label">Pilih Tambahan Durasi</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
              {PRESET_DURATIONS.map((preset) => {
                const active = selectedPresetDays === preset.days;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setSelectedPresetDays(preset.days)}
                    style={{
                      padding: '10px 12px',
                      background: active ? 'var(--accent-primary-subtle, rgba(59, 130, 246, 0.1))' : 'var(--bg-card-subtle)',
                      border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                      borderRadius: '6px',
                      color: active ? 'var(--accent-primary)' : 'var(--text-primary)',
                      fontWeight: active ? 600 : 400,
                      cursor: 'pointer',
                      textAlign: 'left',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '13px',
                    }}
                  >
                    <span>{preset.label}</span>
                    {active && <CheckCircle2 size={14} />}
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              Masa aktif akan diperpanjang dari tanggal berakhir saat ini (atau dari sekarang jika sudah kedaluwarsa).
            </div>
          </div>
        )}

        {/* Mode: Custom days */}
        {mode === 'custom' && (
          <Input
            label="Jumlah Tambahan Hari"
            type="number"
            min="1"
            value={customDays}
            onChange={(e) => setCustomDays(e.target.value)}
            placeholder="Contoh: 45"
            helper="Durasi ditambahkan ke masa aktif yang ada (atau dari sekarang jika sudah lewat)."
          />
        )}

        {/* Mode: Exact date */}
        {mode === 'exact' && (
          <div className="form-group">
            <label className="form-label" htmlFor="exact-expiry-date">
              Pilih Tanggal Kedaluwarsa
            </label>
            <div style={{ position: 'relative' }}>
              <input
                id="exact-expiry-date"
                type="date"
                className="form-input"
                value={exactDate}
                onChange={(e) => setExactDate(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              Akun akan aktif sampai akhir hari yang dipilih (23:59:59 UTC).
            </div>
          </div>
        )}

        {/* Mode: Lifetime */}
        {mode === 'lifetime' && (
          <div
            style={{
              padding: '12px',
              background: 'var(--bg-card-subtle)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '6px',
              fontSize: '13px',
              color: 'var(--text-secondary)',
              lineHeight: 1.5,
            }}
          >
            Masa aktif akun akan diatur menjadi <strong>Permanen (Lifetime)</strong>. Akun tidak akan pernah kedaluwarsa kecuali dinonaktifkan secara manual oleh admin.
          </div>
        )}
      </form>
    </Modal>
  );
}
