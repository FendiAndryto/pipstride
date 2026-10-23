import React, { useState } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, Lock } from 'lucide-react';
import { api } from '../services/api';

const inputStyle = {
  width: '100%',
  padding: '10px 38px 10px 36px',
  borderRadius: '10px',
  border: '1px solid var(--line)',
  background: '#091318',
  color: 'var(--text)',
  fontSize: '12px',
  outline: 'none'
};

/**
 * Rendered when the dashboard is opened with ``?reset_token=...``.
 * The token is single use; on success every existing session is revoked.
 */
export default function ResetPasswordPage({ token, onDone, onCancel }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const successMessage = 'Password berhasil diperbarui. Silakan masuk dengan password baru Anda.';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password minimal 8 karakter.');
      return;
    }
    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      setError('Password wajib kombinasi huruf dan angka.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Konfirmasi password tidak cocok.');
      return;
    }

    setLoading(true);
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err.message || 'Tautan reset tidak valid atau sudah kedaluwarsa.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
        background: 'radial-gradient(circle at 50% 15%, #133a30 0%, #071015 65%)',
        color: 'var(--text)'
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '440px',
          padding: '28px 24px',
          background: 'rgba(12, 22, 29, 0.95)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid #233e36',
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.7), 0 0 30px rgba(69, 224, 173, 0.15)',
          borderRadius: '20px'
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '22px' }}>
          <div
            className="brand-logo-box"
            style={{
              width: '52px',
              height: '52px',
              margin: '0 auto 12px',
              borderRadius: '16px',
              border: '1px solid rgba(69, 224, 173, 0.5)',
              boxShadow: '0 0 20px rgba(69, 224, 173, 0.25)'
            }}
          >
            <img src="/favicon.svg" alt="Pipstride" style={{ width: '30px', height: '30px' }} />
          </div>
          <h1 style={{ fontSize: '22px', fontWeight: 850, letterSpacing: '-0.5px', margin: '4px 0' }}>
            {done ? 'Password Diperbarui' : 'Atur Password Baru'}
          </h1>
          <p className="sub" style={{ fontSize: '11.5px', color: 'var(--muted)' }}>
            {done
              ? 'Seluruh sesi lama sudah dicabut'
              : 'Tautan ini hanya berlaku sekali dan memiliki masa kedaluwarsa'}
          </p>
        </div>

        {done ? (
          <>
            <div
              style={{
                padding: '12px 14px',
                borderRadius: '10px',
                fontSize: '11.5px',
                marginBottom: '18px',
                background: 'rgba(69, 224, 173, 0.12)',
                border: '1px solid rgba(69, 224, 173, 0.35)',
                color: 'var(--g)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <CheckCircle2 size={16} />
              <span>{successMessage}</span>
            </div>
            <button
              type="button"
              className="btn"
              onClick={() => onDone && onDone(successMessage)}
              style={{ width: '100%', padding: '11px', fontSize: '12.5px' }}
              id="reset-password-done-btn"
            >
              <ArrowLeft size={15} />
              <span>Kembali ke Halaman Masuk</span>
            </button>
          </>
        ) : (
          <>
            {error && (
              <div
                role="alert"
                style={{
                  padding: '10px 14px',
                  borderRadius: '10px',
                  fontSize: '11px',
                  marginBottom: '16px',
                  background: 'rgba(255, 113, 128, 0.12)',
                  border: '1px solid rgba(255, 113, 128, 0.35)',
                  color: '#ff9da7',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px'
                }}
              >
                <AlertCircle size={15} style={{ flexShrink: 0, marginTop: '1px' }} />
                <div style={{ flex: 1 }}>{error}</div>
              </div>
            )}

            <form onSubmit={handleSubmit} id="reset-password-form">
              <div style={{ marginBottom: '14px' }}>
                <label htmlFor="reset-password" className="label" style={{ display: 'block' }}>
                  Password Baru
                </label>
                <div style={{ position: 'relative' }}>
                  <Lock
                    size={15}
                    style={{ position: 'absolute', left: '12px', top: '12px', color: 'var(--muted)' }}
                  />
                  <input
                    id="reset-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimal 8 karakter (huruf & angka)"
                    disabled={loading}
                    style={inputStyle}
                    autoComplete="new-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: 'absolute',
                      right: '10px',
                      top: '10px',
                      background: 'none',
                      border: 'none',
                      color: 'var(--muted)',
                      cursor: 'pointer'
                    }}
                    title={showPassword ? 'Sembunyikan password' : 'Lihat password'}
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <div style={{ marginBottom: '18px' }}>
                <label htmlFor="reset-password-confirm" className="label" style={{ display: 'block' }}>
                  Ulangi Password Baru
                </label>
                <div style={{ position: 'relative' }}>
                  <Lock
                    size={15}
                    style={{ position: 'absolute', left: '12px', top: '12px', color: 'var(--muted)' }}
                  />
                  <input
                    id="reset-password-confirm"
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Ketik ulang password baru"
                    disabled={loading}
                    style={{ ...inputStyle, paddingRight: '12px' }}
                    autoComplete="new-password"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                className="btn"
                disabled={loading}
                style={{ width: '100%', padding: '11px', fontSize: '12.5px' }}
                id="reset-password-submit-btn"
              >
                <KeyRound size={15} />
                <span>{loading ? 'Menyimpan...' : 'Simpan Password Baru'}</span>
              </button>
            </form>

            <button
              type="button"
              onClick={onCancel}
              className="btn ghost"
              style={{ width: '100%', marginTop: '12px', padding: '9px', fontSize: '11.5px' }}
            >
              <ArrowLeft size={14} />
              <span>Batal dan kembali ke halaman masuk</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
