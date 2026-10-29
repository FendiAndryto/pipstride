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
import { useLanguage } from '../context/LanguageContext';

export default function LoginPage({ onLoginSuccess, sessionExpiredMsg, notice }) {
  const { t } = useLanguage();
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
      setError(t('err_credentials_required'));
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
      setError(err.message || t('err_login_failed'));
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
      setError(t('err_register_required'));
      return;
    }

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setError(t('err_email_invalid'));
      return;
    }

    if (u.length < 3) {
      setError(t('err_username_min'));
      return;
    }

    if (p.length < 8) {
      setError(t('err_password_min'));
      return;
    }

    if (!/[a-zA-Z]/.test(p) || !/[0-9]/.test(p)) {
      setError(t('err_password_alnum'));
      return;
    }

    if (p !== cp) {
      setError(t('err_password_mismatch'));
      return;
    }

    setLoading(true);
    setError('');
    setSuccessMsg('');

    try {
      const data = await api.register(u, p, email, rememberMe);
      setSuccessMsg(t('auth_register_success'));
      setTimeout(() => {
        if (onLoginSuccess) {
          onLoginSuccess(data);
        }
      }, 700);
    } catch (err) {
      setError(err.message || t('err_register_failed'));
    } finally {
      setLoading(false);
    }
  };

  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    const email = forgotEmail.trim();

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setError(t('err_email_invalid'));
      return;
    }

    setLoading(true);
    setError('');
    setSuccessMsg('');

    try {
      const data = await api.forgotPassword(email);
      setSuccessMsg(
        data?.message ||
          t('auth_forgot_sent')
      );
    } catch (err) {
      setError(err.message || t('err_forgot_failed'));
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
            {t('auth_brand_sub')}
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
            {t('auth_tab_signin')}
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
            {t('auth_tab_signup')}
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
                {t('auth_username')}
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
                  placeholder={t('auth_username_ph')}
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
                  {t('auth_password')}
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
                  {t('auth_forgot_link')}
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
                  title={showPassword ? t('auth_hide_password') : t('auth_show_password')}
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
                <span>{t('auth_remember')}</span>
              </label>
              <span className="tiny" style={{ color: 'var(--muted)' }}>
                {t('auth_jwt_note')}
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
                <span>{t('auth_signing_in')}</span>
              ) : (
                <>
                  <span>{t('auth_signin_cta')}</span>
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
                {t('auth_demo_quick')}
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
                  <span>{t('auth_demo_fill')}</span>
                </button>
                {error && (
                  <button
                    type="button"
                    className="btn ghost"
                    style={{ padding: '4px 8px', fontSize: '10px' }}
                    onClick={handleOfflineDevBypass}
                    title={t('auth_dev_mode_tip')}
                  >
                    <span>{t('auth_dev_mode')}</span>
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
                {t('auth_reg_username')}
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
                  placeholder={t('auth_reg_username_ph')}
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
                {t('auth_email')}
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
                  placeholder={t('auth_email_ph')}
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
                {t('auth_reg_email_hint')}
              </div>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label htmlFor="reg-password" className="label" style={{ display: 'block' }}>
                {t('auth_password')}
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
                  placeholder={t('auth_reg_password_ph')}
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
                {t('auth_confirm_password')}
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
                  placeholder={t('auth_confirm_ph')}
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
                <span>{t('auth_registering')}</span>
              ) : (
                <>
                  <ShieldCheck size={15} />
                  <span>{t('auth_register_cta')}</span>
                </>
              )}
            </button>
          </form>
        ) : (
          /* Form 3: Forgot password */
          <form onSubmit={handleForgotSubmit} id="forgot-password-form">
            <div style={{ marginBottom: '14px' }}>
              <label htmlFor="forgot-email" className="label" style={{ display: 'block' }}>
                {t('auth_forgot_email_label')}
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
                  placeholder={t('auth_email_ph')}
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
                {t('auth_forgot_hint')}
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
                <span>{t('auth_forgot_sending')}</span>
              ) : (
                <>
                  <Mail size={15} />
                  <span>{t('auth_forgot_cta')}</span>
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
              <span>{t('auth_back_to_signin')}</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
