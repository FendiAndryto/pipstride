import React, { useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { PLAN_OPTIONS } from '../../constants/plans';
import { createUser } from './api';
import { AlertCircle, UserPlus, RefreshCw, Eye, EyeOff } from 'lucide-react';

const USERNAME_REGEX = /^[a-zA-Z0-9_.-]{3,32}$/;

const DURATION_PRESETS = [
  { id: '3d', label: '3 Hari (Trial)', days: 3 },
  { id: '30d', label: '30 Hari (1 Bulan)', days: 30 },
  { id: '90d', label: '90 Hari (3 Bulan)', days: 90 },
  { id: '365d', label: '365 Hari (1 Tahun)', days: 365 },
  { id: 'lifetime', label: 'Permanen (Lifetime)', days: null, lifetime: true },
  { id: 'custom', label: 'Kustom (Jumlah Hari)', days: null },
];

function generateSecurePassword(length = 16) {
  const uppers = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lowers = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%^&*-_';
  const all = uppers + lowers + digits + symbols;

  // Ensure at least one from each required pool
  const required = [
    uppers[getRandomInt(uppers.length)],
    lowers[getRandomInt(lowers.length)],
    digits[getRandomInt(digits.length)],
    symbols[getRandomInt(symbols.length)],
  ];

  const remaining = [];
  for (let i = 4; i < length; i++) {
    remaining.push(all[getRandomInt(all.length)]);
  }

  const combined = [...required, ...remaining];
  // Shuffle using Fisher-Yates with CSPRNG
  for (let i = combined.length - 1; i > 0; i--) {
    const j = getRandomInt(i + 1);
    [combined[i], combined[j]] = [combined[j], combined[i]];
  }
  return combined.join('');
}

function getRandomInt(max) {
  const array = new Uint32Array(1);
  window.crypto.getRandomValues(array);
  return array[0] % max;
}

export function UserCreateModal({ isOpen, onClose, onSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [planCode, setPlanCode] = useState('free');
  const [durationPreset, setDurationPreset] = useState('30d');
  const [customDays, setCustomDays] = useState('30');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleGeneratePassword = () => {
    const pwd = generateSecurePassword(16);
    setPassword(pwd);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const cleanUsername = username.trim();
    if (!USERNAME_REGEX.test(cleanUsername)) {
      setError('Username harus 3–32 karakter dan hanya boleh berisi huruf, angka, titik, minus, atau garis bawah.');
      return;
    }

    if (password.length < 8) {
      setError('Password minimal 8 karakter.');
      return;
    }
    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      setError('Password wajib mengandung kombinasi huruf dan angka.');
      return;
    }

    const payload = {
      username: cleanUsername,
      password,
      email: email.trim() || undefined,
      role: 'trader',
      plan_code: planCode,
    };

    let durationLabel = '';
    const preset = DURATION_PRESETS.find((p) => p.id === durationPreset);
    if (preset?.lifetime) {
      payload.set_lifetime = true;
      durationLabel = 'Permanen (Lifetime)';
    } else if (durationPreset === 'custom') {
      const days = parseInt(customDays, 10);
      if (Number.isNaN(days) || days < 1) {
        setError('Jumlah hari kustom minimal 1 hari.');
        return;
      }
      payload.duration_days = days;
      durationLabel = `${days} Hari`;
    } else if (preset?.days) {
      payload.duration_days = preset.days;
      durationLabel = preset.label;
    } else {
      setError('Pilih masa aktif akun.');
      return;
    }

    const selectedPlan = PLAN_OPTIONS.find((p) => p.code === planCode);
    const planLabel = selectedPlan ? selectedPlan.label : planCode;

    setLoading(true);
    try {
      const createdUser = await createUser(payload);
      onSuccess(createdUser, {
        username: cleanUsername,
        password,
        email: email.trim(),
        planLabel,
        durationLabel,
      });
      // Reset form
      setUsername('');
      setPassword('');
      setEmail('');
      setPlanCode('free');
      setDurationPreset('30d');
      onClose();
    } catch (err) {
      setError(err.message || 'Gagal membuat akun pengguna.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Tambah Pengguna Baru"
      icon={UserPlus}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Batal
          </Button>
          <Button variant="primary" onClick={handleSubmit} loading={loading}>
            Buat Akun
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="stack-gap-md">
        {error ? (
          <div className="alert alert-danger" role="alert">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        ) : null}

        <Input
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="contoh: trader_pro"
          helperText="3–32 karakter (huruf, angka, dot, dash, underscore)"
          required
          autoFocus
        />

        <div className="form-group">
          <label className="form-label" htmlFor="new-user-password">
            Password Akun
          </label>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <input
                id="new-user-password"
                type={showPassword ? 'text' : 'password'}
                className="form-input form-input-mono"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimal 8 karakter"
                required
                style={{ width: '100%', paddingRight: '2.5rem' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: '0.5rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                }}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={handleGeneratePassword}
              title="Generate password acak yang kuat"
            >
              <RefreshCw size={14} />
              <span>Acak</span>
            </Button>
          </div>
          <p className="form-helper-text">Wajib kombinasi huruf dan angka.</p>
        </div>

        <Input
          label="Email (Opsional)"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="trader@example.com"
          helperText="Digunakan untuk recovery password"
        />

        <div className="form-group">
          <label className="form-label" htmlFor="create-plan-select">
            Paket (Plan)
          </label>
          <select
            id="create-plan-select"
            className="form-input"
            value={planCode}
            onChange={(e) => setPlanCode(e.target.value)}
          >
            {PLAN_OPTIONS.map((opt) => (
              <option key={opt.code} value={opt.code}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="create-duration-select">
            Masa Aktif Akun
          </label>
          <select
            id="create-duration-select"
            className="form-input"
            value={durationPreset}
            onChange={(e) => setDurationPreset(e.target.value)}
          >
            {DURATION_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {durationPreset === 'custom' ? (
          <Input
            label="Jumlah Hari Kustom"
            type="number"
            min="1"
            max="3650"
            value={customDays}
            onChange={(e) => setCustomDays(e.target.value)}
            required
            mono
          />
        ) : null}
      </form>
    </Modal>
  );
}
