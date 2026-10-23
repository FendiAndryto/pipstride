import React, { useState } from 'react';
import {
  User,
  Lock,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  UserPlus,
  Sparkles,
  ShieldCheck,
  Mail
} from 'lucide-react';
import { api, setToken } from '../services/api';

export default function LoginPage({ onLoginSuccess, sessionExpiredMsg, notice }) {
  const [activeTab, setActiveTab] = useState('login'); // 'login' | 'register' | 'forgot'
  
  // Login form state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  
  // Register form state
  const [regUsername, setRegUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);

  // Forgot password state
  const [forgotEmail, setForgotEmail] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(
    sessionExpiredMsg || (notice?.type === 'error' ? notice.text : '')
  );
  const [successMsg, setSuccessMsg] = useState(
    notice && notice.type !== 'error' ? notice.text : ''
  );

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('Mohon masukkan username dan password.');
      return;
    }

    setLoading(true);
    setError('');
    setSuccessMsg('');

    try {
      const data = await api.login(username.trim(), password.trim(), rememberMe);
      if (onLoginSuccess) {
        onLoginSuccess(data);
      }
    } catch (err) {
      setError(err.message || 'Otentikasi gagal. Periksa kembali username dan password Anda.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    const u = regUsername.trim();
    const email = regEmail.trim();
    const p = regPassword.trim();
    const cp = regConfirmPassword.trim();

    if (!u || !p) {
      setError('Mohon lengkapi username dan password.');
      return;
    }

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setError('Mohon masukkan alamat email yang valid.');
      return;
    }

    if (u.length < 3) {
      setError('Username minimal 3 karakter.');
      return;
    }

    if (p.length < 8) {
      setError('Password minimal 8 karakter.');
      return;
    }

    if (!/[a-zA-Z]/.test(p) || !/[0-9]/.test(p)) {
      setError('Password wajib kombinasi huruf dan angka.');
      return;
    }

    if (p !== cp) {
      setError('Konfirmasi password tidak cocok dengan password baru.');
      return;
    }

    setLoading(true);
    setError('');
    setSuccessMsg('');

    try {
      const data = await api.register(u, p, email, rememberMe);
      setSuccessMsg('Akun berhasil dibuat! Cek email Anda untuk verifikasi. Mengalihkan ke dashboard...');
      setTimeout(() => {
        if (onLoginSuccess) {
          onLoginSuccess(data);
        }
      }, 700);
    } catch (err) {
      setError(err.message || 'Registrasi gagal. Username atau email mungkin sudah digunakan.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    const email = forgotEmail.trim();

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setError('Mohon masukkan alamat email yang valid.');
      return;
    }

    setLoading(true);
    setError('');
    setSuccessMsg('');

    try {
      const data = await api.forgotPassword(email);
      setSuccessMsg(
        data?.message ||
          'Jika email tersebut terdaftar, tautan reset password telah dikirim. Periksa inbox Anda.'
      );
    } catch (err) {
      setError(err.message || 'Gagal meminta tautan reset password. Coba lagi nanti.');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickDemo = (demoUser, demoPass) => {
    setUsername(demoUser);
    setPassword(demoPass);
    setError('');
  };

  const handleOfflineDevBypass = () => {
    setToken('dev-demo-token-offline', rememberMe);
    if (onLoginSuccess) {
      onLoginSuccess({ username: username || 'Admin', is_authenticated: true });
    }
  };

  return (
    <div
      className="login-container"
      id="login-view"
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
        {/* Brand Header */}
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
          <h1 style={{ fontSize: '24px', fontWeight: 850, letterSpacing: '-0.5px', margin: '4px 0' }}>
            Pipstride
          </h1>
          <p className="sub" style={{ fontSize: '11.5px', color: 'var(--muted)' }}>
            PURE READ-ONLY MT5 TELEMETRY & JOURNAL
          </p>
        </div>

        {/* Tab Switcher: Login vs Register (hidden in the recovery flow) */}
        {activeTab !== 'forgot' && (
        <div
          style={{
            display: 'flex',
            gap: '4px',
            background: '#071015',
            padding: '4px',
            borderRadius: '12px',
            border: '1px solid var(--line)',
            marginBottom: '18px'
          }}
        >
          <button
            type="button"
            onClick={() => {
              setActiveTab('login');
              setError('');
              setSuccessMsg('');
            }}
            style={{
              flex: 1,
              padding: '8px',
              borderRadius: '9px',
              border: 0,
              fontSize: '11.5px',
              fontWeight: 800,
              cursor: 'pointer',
              background: activeTab === 'login' ? 'var(--g)' : 'transparent',
              color: activeTab === 'login' ? '#06261c' : 'var(--muted)',
              transition: 'all 0.2s ease'
            }}
            id="tab-btn-signin"
          >
            Masuk (Sign In)
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('register');
              setError('');
              setSuccessMsg('');
            }}
            style={{
              flex: 1,
              padding: '8px',
              borderRadius: '9px',
              border: 0,
              fontSize: '11.5px',
              fontWeight: 800,
              cursor: 'pointer',
              background: activeTab === 'register' ? 'var(--g)' : 'transparent',
              color: activeTab === 'register' ? '#06261c' : 'var(--muted)',
              transition: 'all 0.2s ease'
            }}
            id="tab-btn-signup"
          >
            Daftar Akun Baru
          </button>
        </div>
        )}

        {/* Alerts / Error Messages */}
        {error && (
          <div
            className="animate-fade-in"
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
            id="login-error-alert"
          >
            <AlertCircle size={15} style={{ flexShrink: 0, marginTop: '1px' }} />
            <div style={{ flex: 1 }}>{error}</div>
          </div>
        )}

        {successMsg && (
          <div
            className="animate-fade-in"
            style={{
              padding: '10px 14px',
              borderRadius: '10px',
              fontSize: '11px',
              marginBottom: '16px',
              background: 'rgba(69, 224, 173, 0.12)',
              border: '1px solid rgba(69, 224, 173, 0.35)',
              color: 'var(--g)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
            id="login-success-alert"
          >
            <CheckCircle2 size={15} />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Form 1: Sign In */}
        {activeTab === 'login' ? (
          <form onSubmit={handleLoginSubmit} id="signin-form">
            <div style={{ marginBottom: '14px' }}>
              <label htmlFor="signin-username" className="label" style={{ display: 'block' }}>
                Username
              </label>
              <div style={{ position: 'relative' }}>
                <User
                  size={15}
                  style={{ position: 'absolute', left: '12px', top: '12px', color: 'var(--muted)' }}
                />
                <input
                  id="signin-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Masukkan username Anda"
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '10px 12px 10px 36px',
                    borderRadius: '10px',
                    border: '1px solid var(--line)',
                    background: '#091318',
                    color: 'var(--text)',
                    fontSize: '12px',
                    outline: 'none'
                  }}
                  autoComplete="username"
                  required
                />
              </div>
            </div>

            <div style={{ marginBottom: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label htmlFor="signin-password" className="label">
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('forgot');
                    setForgotEmail('');
                    setError('');
                    setSuccessMsg('');
                  }}
                  style={{
                    background: 'none',
                    border: 0,
                    padding: 0,
                    color: 'var(--g)',
                    fontSize: '10.5px',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                  id="forgot-password-link"
                >
                  Lupa password?
                </button>
              </div>
              <div style={{ position: 'relative' }}>
                <Lock
                  size={15}
                  style={{ position: 'absolute', left: '12px', top: '12px', color: 'var(--muted)' }}
                />
                <input
                  id="signin-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '10px 38px 10px 36px',
                    borderRadius: '10px',
                    border: '1px solid var(--line)',
                    background: '#091318',
                    color: 'var(--text)',
                    fontSize: '12px',
                    outline: 'none'
                  }}
                  autoComplete="current-password"
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

            {/* Remember Me Checkbox */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '18px',
                fontSize: '11px',
                color: 'var(--muted)'
              }}
            >
              <label style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  style={{ accentColor: 'var(--g)', cursor: 'pointer' }}
                  id="remember-me-checkbox"
                />
                <span>Ingat sesi saya (Remember Me)</span>
              </label>
              <span className="tiny" style={{ color: 'var(--muted)' }}>
                JWT Secure Session
              </span>
            </div>

            <button
              type="submit"
              className="btn"
              disabled={loading}
              style={{ width: '100%', padding: '11px', fontSize: '12.5px' }}
              id="signin-submit-btn"
            >
              {loading ? (
                <span>Memverifikasi...</span>
              ) : (
                <>
                  <span>Masuk ke Pipstride</span>
                  <ArrowRight size={15} />
                </>
              )}
            </button>

            {/* Demo Quick Credentials */}
            <div
              style={{
                marginTop: '16px',
                paddingTop: '14px',
                borderTop: '1px solid var(--line)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '8px'
              }}
            >
              <span className="tiny" style={{ color: 'var(--muted)' }}>
                Demo Cepat:
              </span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  className="btn alt"
                  style={{ padding: '4px 8px', fontSize: '10px' }}
                  onClick={() => handleQuickDemo('admin', 'change_this_password')}
                  id="quick-demo-admin-btn"
                >
                  <Sparkles size={11} />
                  <span>Isi Demo Admin</span>
                </button>
                {error && (
                  <button
                    type="button"
                    className="btn ghost"
                    style={{ padding: '4px 8px', fontSize: '10px' }}
                    onClick={handleOfflineDevBypass}
                    title="Bypass login jika server backend offline saat development"
                  >
                    <span>Masuk Mode Dev</span>
                  </button>
                )}
              </div>
            </div>
          </form>
        ) : activeTab === 'register' ? (
          /* Form 2: Sign Up / Register */
          <form onSubmit={handleRegisterSubmit} id="signup-form">
            <div style={{ marginBottom: '12px' }}>
              <label htmlFor="reg-username" className="label" style={{ display: 'block' }}>
                Pilih Username
              </label>
              <div style={{ position: 'relative' }}>
                <UserPlus
                  size={15}
                  style={{ position: 'absolute', left: '12px', top: '12px', color: 'var(--muted)' }}
                />
                <input
                  id="reg-username"
                  type="text"
                  value={regUsername}
                  onChange={(e) => setRegUsername(e.target.value)}
                  placeholder="Username baru (min 3 huruf)"
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '10px 12px 10px 36px',
                    borderRadius: '10px',
                    border: '1px solid var(--line)',
                    background: '#091318',
                    color: 'var(--text)',
                    fontSize: '12px',
                    outline: 'none'
                  }}
                  autoComplete="username"
                  required
                />
              </div>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label htmlFor="reg-email" className="label" style={{ display: 'block' }}>
                Email
              </label>
              <div style={{ position: 'relative' }}>
                <Mail
                  size={15}
                  style={{ position: 'absolute', left: '12px', top: '12px', color: 'var(--muted)' }}
                />
                <input
                  id="reg-email"
                  type="email"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  placeholder="nama@email.com"
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '10px 12px 10px 36px',
                    borderRadius: '10px',
                    border: '1px solid var(--line)',
                    background: '#091318',
                    color: 'var(--text)',
                    fontSize: '12px',
                    outline: 'none'
                  }}
                  autoComplete="email"
                  required
                />
              </div>
              <div className="tiny" style={{ color: 'var(--muted)', marginTop: '5px' }}>
                Dipakai untuk reset password dan verifikasi akun.
              </div>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label htmlFor="reg-password" className="label" style={{ display: 'block' }}>
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <Lock
                  size={15}
                  style={{ position: 'absolute', left: '12px', top: '12px', color: 'var(--muted)' }}
                />
                <input
                  id="reg-password"
                  type={showRegPassword ? 'text' : 'password'}
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  placeholder="Minimal 8 karakter (huruf & angka)"
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '10px 38px 10px 36px',
                    borderRadius: '10px',
                    border: '1px solid var(--line)',
                    background: '#091318',
                    color: 'var(--text)',
                    fontSize: '12px',
                    outline: 'none'
                  }}
                  autoComplete="new-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowRegPassword(!showRegPassword)}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '10px',
                    background: 'none',
                    border: 'none',
                    color: 'var(--muted)',
                    cursor: 'pointer'
                  }}
                >
                  {showRegPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label htmlFor="reg-confirm-password" className="label" style={{ display: 'block' }}>
                Konfirmasi Password
              </label>
              <div style={{ position: 'relative' }}>
                <Lock
                  size={15}
                  style={{ position: 'absolute', left: '12px', top: '12px', color: 'var(--muted)' }}
                />
                <input
                  id="reg-confirm-password"
                  type={showRegPassword ? 'text' : 'password'}
                  value={regConfirmPassword}
                  onChange={(e) => setRegConfirmPassword(e.target.value)}
                  placeholder="Ulangi password di atas"
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '10px 12px 10px 36px',
                    borderRadius: '10px',
                    border: '1px solid var(--line)',
                    background: '#091318',
                    color: 'var(--text)',
                    fontSize: '12px',
                    outline: 'none'
                  }}
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
              id="signup-submit-btn"
            >
              {loading ? (
                <span>Mendaftarkan...</span>
              ) : (
                <>
                  <ShieldCheck size={15} />
                  <span>Buat Akun & Masuk Sekarang</span>
                </>
              )}
            </button>
          </form>
        ) : (
          /* Form 3: Forgot password */
          <form onSubmit={handleForgotSubmit} id="forgot-password-form">
            <div style={{ marginBottom: '14px' }}>
              <label htmlFor="forgot-email" className="label" style={{ display: 'block' }}>
                Email Akun
              </label>
              <div style={{ position: 'relative' }}>
                <Mail
                  size={15}
                  style={{ position: 'absolute', left: '12px', top: '12px', color: 'var(--muted)' }}
                />
                <input
                  id="forgot-email"
                  type="email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  placeholder="nama@email.com"
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '10px 12px 10px 36px',
                    borderRadius: '10px',
                    border: '1px solid var(--line)',
                    background: '#091318',
                    color: 'var(--text)',
                    fontSize: '12px',
                    outline: 'none'
                  }}
                  autoComplete="email"
                  required
                />
              </div>
              <div className="tiny" style={{ color: 'var(--muted)', marginTop: '5px' }}>
                Kami akan mengirim tautan satu kali pakai jika alamat tersebut terdaftar.
              </div>
            </div>

            <button
              type="submit"
              className="btn"
              disabled={loading}
              style={{ width: '100%', padding: '11px', fontSize: '12.5px' }}
              id="forgot-submit-btn"
            >
              {loading ? (
                <span>Mengirim...</span>
              ) : (
                <>
                  <Mail size={15} />
                  <span>Kirim Tautan Reset</span>
                </>
              )}
            </button>

            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setActiveTab('login');
                setError('');
                setSuccessMsg('');
              }}
              style={{ width: '100%', marginTop: '12px', padding: '9px', fontSize: '11.5px' }}
              id="forgot-back-btn"
            >
              <ArrowLeft size={14} />
              <span>Kembali ke halaman masuk</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
